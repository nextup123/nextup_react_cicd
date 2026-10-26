// yamldoc.js -- edit a program (or block) YAML text in place: the form editor reads rows out of
// the document and writes them back without touching anything else (comments, order, the rest
// of the file). Built on the `yaml` Document API; new items are written as one-line flow maps
// like the manual shows them:  - {out: gpio1.do1, when: "gpio1.di1 AND S.AUTO"}
//
// Every row is a plain object of STRINGS (values exactly as written). Keys keep their order.

import { parseDocument, Document, YAMLMap, YAMLSeq, Scalar, isMap, isSeq, isScalar, isPair } from "yaml";

export const SECTIONS = ["program", "scan_ms", "io", "names", "blocks", "retain", "safe_state", "rungs", "sequences", "alarms"];
export const BLOCK_SECTIONS = ["block", "description", "ports", "locals", "retain", "safe_state", "rungs", "sequences", "alarms"];
// where a missing section is inserted (after the last existing one that comes before it)
const ORDER = { program: 0, block: 0, description: 1, scan_ms: 1, ports: 2, locals: 3, io: 2, names: 3, blocks: 4, retain: 5, safe_state: 6, rungs: 7, sequences: 8, alarms: 9 };

const TO_STRING = { lineWidth: 0, minContentWidth: 0, indent: 2 };

/** Keys that hold an expression, a text or a list (quoted / not quoted when written). */
const QUOTED = new Set(["when", "up", "down", "reset", "emergency", "text", "calc", "start", "abort", "next", "value"]);
const LIST_KEYS = new Set(["do", "exempt", "retain"]);

export class YamlProgram {
  constructor(text) {
    this.text = text;
    this.doc = parseDocument(text || "", { keepSourceTokens: false, uniqueKeys: false });
    if (!isMap(this.doc.contents)) {
      // an empty or scalar file: start a fresh map but keep the comment text
      const comment = this.doc.commentBefore;
      this.doc = new Document(new YAMLMap());
      if (comment) this.doc.commentBefore = comment;
      if (!text || !text.trim()) this.fresh = true;
    }
    this.errors = this.doc.errors.map((e) => ({ line: e.linePos ? e.linePos[0].line : 1, message: e.message.split("\n")[0] }));
  }
  toString() { return this.doc.toString(TO_STRING); }
  get root() { return this.doc.contents; }

  // ---- sections ------------------------------------------------------------------
  section(name) { return this.root.get(name, true); }
  has(name) { return this.root.has(name); }
  /** Get or create a section ('seq' | 'map' | 'scalar'), inserted at its usual place. */
  ensure(name, kind) {
    if (this.root.has(name)) return this.root.get(name, true);
    const node = kind === "seq" ? new YAMLSeq() : kind === "map" ? new YAMLMap() : new Scalar("");
    const pair = this.doc.createPair(name, node);
    const items = this.root.items;
    let at = items.length;
    for (let i = 0; i < items.length; i++) {
      const k = String(items[i].key?.value ?? items[i].key);
      if ((ORDER[k] ?? 99) > (ORDER[name] ?? 99)) { at = i; break; }
    }
    items.splice(at, 0, pair);
    return node;
  }
  remove(name) { this.root.delete(name); }

  scalar(name) { const n = this.root.get(name, true); return isScalar(n) ? String(n.value ?? "") : ""; }
  setScalar(name, value) {
    if (value === "" || value == null) { this.root.delete(name); return; }
    const n = this.root.get(name, true);
    if (isScalar(n)) n.value = coerce(value);
    else { const s = new Scalar(coerce(value)); this.ensure(name, "scalar"); this.root.set(name, s); }
  }

  // ---- list sections (rungs, blocks, alarms, sequences) --------------------------------
  /** rows of a list section as plain objects of strings (nested lists/maps kept as values) */
  list(name) {
    const seq = this.section(name);
    if (!isSeq(seq)) return [];
    return seq.items.map((it) => mapToObj(it));
  }
  setRow(name, index, obj) {
    const seq = this.ensure(name, "seq");
    seq.flow = false;
    const node = objToMap(this.doc, obj, true);
    const old = seq.items[index];
    if (old && (old.comment || old.commentBefore)) { node.commentBefore = old.commentBefore; node.comment = old.comment; }
    seq.items[index] = node;
  }
  addRow(name, obj, at = -1) {
    const seq = this.ensure(name, "seq");
    seq.flow = false; // one rung per line, even if the file started with `rungs: []`
    const node = objToMap(this.doc, obj, true);
    if (at < 0 || at >= seq.items.length) seq.items.push(node);
    else seq.items.splice(at, 0, node);
    return at < 0 ? seq.items.length - 1 : at;
  }
  removeRow(name, index) {
    const seq = this.section(name);
    if (isSeq(seq)) seq.items.splice(index, 1);
  }
  moveRow(name, from, to) {
    const seq = this.section(name);
    if (!isSeq(seq) || to < 0 || to >= seq.items.length) return;
    const [it] = seq.items.splice(from, 1);
    seq.items.splice(to, 0, it);
  }

  // ---- map sections (names, io.X, safe_state, ports, locals) ------------------------------
  /** [{key, value}] of a map section; nested maps come back as objects */
  entries(name) {
    const m = this.section(name);
    if (!isMap(m)) return [];
    return m.items.map((p) => ({ key: String(p.key?.value ?? p.key), value: valueOf(p.value) }));
  }
  setEntry(name, key, value) {
    const m = this.ensure(name, "map");
    const v = typeof value === "object" && value !== null && !Array.isArray(value) ? objToMap(this.doc, value, true) : Array.isArray(value) ? arrToSeq(this.doc, value) : new Scalar(coerce(value));
    if (m.has(key)) m.set(key, v); else m.items.push(this.doc.createPair(key, v));
  }
  renameEntry(name, key, newKey) {
    const m = this.section(name);
    if (!isMap(m)) return;
    const p = m.items.find((x) => String(x.key?.value ?? x.key) === key);
    if (p) p.key = new Scalar(newKey);
  }
  removeEntry(name, key) { const m = this.section(name); if (isMap(m)) m.delete(key); }

  // ---- plain lists (retain, safe_state.exempt) --------------------------------------------
  strings(name) { const s = this.section(name); return isSeq(s) ? s.items.map((x) => String(x.value ?? "")) : []; }
  setStrings(name, values) {
    if (!values.length) { this.root.delete(name); return; }
    const s = this.ensure(name, "seq");
    s.items = values.map((v) => new Scalar(v));
    s.flow = true;
  }

  // ---- sequences: steps live inside the row map -------------------------------------------
  /** steps of sequence i as [{name, do: [...], next, timeout, on_timeout}] */
  steps(i) {
    const seq = this.section("sequences");
    const row = isSeq(seq) ? seq.items[i] : null;
    const st = isMap(row) ? row.get("steps", true) : null;
    return isSeq(st) ? st.items.map((x) => mapToObj(x)) : [];
  }
  setSequence(i, head, steps) {
    // head: {name, start, abort}; steps: [{name, do, next, timeout, on_timeout}]
    const seq = this.ensure("sequences", "seq");
    const m = new YAMLMap();
    for (const k of ["name", "start", "abort"]) if (head[k] !== undefined && head[k] !== "") m.items.push(this.doc.createPair(k, scalarFor(k, head[k])));
    const stSeq = new YAMLSeq();
    for (const s of steps) stSeq.items.push(objToMap(this.doc, s, true));
    m.items.push(this.doc.createPair("steps", stSeq));
    if (i < 0 || i >= seq.items.length) seq.items.push(m); else { const old = seq.items[i]; if (old?.commentBefore) m.commentBefore = old.commentBefore; seq.items[i] = m; }
  }

  // ---- sequences, edited in place (the SFC editor): one field / one step at a time -----------
  seqNode(i) { const s = this.section("sequences"); return isSeq(s) && isMap(s.items[i]) ? s.items[i] : null; }
  /** start / abort / name of sequence i; an empty abort removes the key */
  setSeqField(i, key, value) {
    const m = this.seqNode(i);
    if (!m) return;
    if ((value === "" || value == null) && key === "abort") { m.delete(key); return; }
    const s = scalarFor(key, value);
    if (m.has(key)) m.set(key, s);
    else {
      // keep the usual order name, start, abort, steps
      const at = m.items.findIndex((p) => String(p.key?.value ?? p.key) === "steps");
      const pair = this.doc.createPair(key, s);
      if (at < 0) m.items.push(pair); else m.items.splice(at, 0, pair);
    }
  }
  stepsNode(i) { const m = this.seqNode(i); const st = m ? m.get("steps", true) : null; return isSeq(st) ? st : null; }
  setStep(i, j, obj) {
    const st = this.stepsNode(i);
    if (!st) return;
    const node = objToMap(this.doc, obj, true);
    const old = st.items[j];
    if (old && (old.comment || old.commentBefore)) { node.commentBefore = old.commentBefore; node.comment = old.comment; }
    st.items[j] = node;
  }
  addStep(i, obj, at = -1) {
    const st = this.stepsNode(i);
    if (!st) return -1;
    st.flow = false;
    const node = objToMap(this.doc, obj, true);
    if (at < 0 || at >= st.items.length) { st.items.push(node); return st.items.length - 1; }
    st.items.splice(at, 0, node);
    return at;
  }
  removeStep(i, j) { const st = this.stepsNode(i); if (st && st.items.length > 1) st.items.splice(j, 1); }
  moveStep(i, from, to) {
    const st = this.stepsNode(i);
    if (!st || to < 0 || to >= st.items.length) return;
    const [it] = st.items.splice(from, 1);
    st.items.splice(to, 0, it);
  }
  /** line (1-based) of sequence i in the text, or 0 */
  lineOfSeq(i) { const m = this.seqNode(i); return m && m.range ? this.text.slice(0, m.range[0]).split("\n").length : 0; }

  // ---- the usual shapes, typed --------------------------------------------------------------
  rungs() { return this.list("rungs").map((r, index) => ({ index, ...r, type: rungType(r) })); }
  blocks() { return this.list("blocks"); }
  alarms() { return this.list("alarms"); }
  sequences() { return this.list("sequences").map((s, i) => ({ ...s, steps: this.steps(i) })); }
  names() {
    const out = [];
    for (const { key, value } of this.entries("names")) out.push({ key, value: String(value), section: "names" });
    const io = this.section("io");
    if (isMap(io)) for (const p of io.items) if (isMap(p.value)) for (const q of p.value.items) out.push({ key: String(q.key?.value), value: String(q.value?.value ?? ""), section: `io.${String(p.key?.value)}` });
    return out;
  }
  setName(key, value, oldKey) {
    if (oldKey && oldKey !== key) this.removeName(oldKey);
    this.setEntry("names", key, value);
  }
  removeName(key) {
    this.removeEntry("names", key);
    const io = this.section("io");
    if (isMap(io)) for (const p of io.items) if (isMap(p.value)) p.value.delete(key);
  }
  safeState() {
    const m = this.section("safe_state");
    const out = { default: "0", exempt: [], values: [] };
    if (!isMap(m)) return out;
    for (const p of m.items) {
      const k = String(p.key?.value ?? p.key);
      if (k === "default") out.default = String(p.value?.value ?? "0");
      else if (k === "exempt") out.exempt = isSeq(p.value) ? p.value.items.map((x) => String(x.value)) : [];
      else out.values.push({ name: k, value: String(p.value?.value ?? "0") });
    }
    return out;
  }
  setSafeState({ default: def, exempt, values }) {
    if ((!def || def === "0") && !exempt.length && !values.length) { this.root.delete("safe_state"); return; }
    const m = this.ensure("safe_state", "map");
    m.items = [];
    if (def !== undefined && def !== null) m.items.push(this.doc.createPair("default", new Scalar(coerce(def))));
    if (exempt.length) { const s = new YAMLSeq(); s.items = exempt.map((v) => new Scalar(v)); s.flow = true; m.items.push(this.doc.createPair("exempt", s)); }
    for (const v of values) m.items.push(this.doc.createPair(v.name, new Scalar(coerce(v.value))));
  }

  /** Comment lines above row i of a list section ("" when none), without the leading '#'. */
  rowComment(name, i) {
    const seq = this.section(name);
    const it = isSeq(seq) ? seq.items[i] : null;
    return it && it.commentBefore ? String(it.commentBefore).split("\n").map((l) => l.replace(/^ ?/, "")).join("\n") : "";
  }
  setRowComment(name, i, text) {
    const seq = this.section(name);
    const it = isSeq(seq) ? seq.items[i] : null;
    if (!it) return;
    const t = String(text || "").trim();
    it.commentBefore = t ? t.split("\n").map((l) => ` ${l}`).join("\n") : undefined;
  }
  /** Map(lower-case name -> "bit" | "num") of the names / io aliases (for the ladder parser). */
  nameKinds() {
    const m = new Map();
    for (const n of this.names()) m.set(n.key.toLowerCase(), /^r\d+$/i.test(n.value.trim()) ? "num" : "bit");
    return m;
  }

  /** The line (1-based) of row i of a list section in the CURRENT text, or 0. */
  lineOfRow(name, i) {
    const seq = this.section(name);
    const it = isSeq(seq) ? seq.items[i] : null;
    if (!it || !it.range) return 0;
    return this.text.slice(0, it.range[0]).split("\n").length;
  }
}

// ---- helpers ----------------------------------------------------------------------------------
export function rungType(r) {
  if (r.count !== undefined) return "count";
  for (const k of ["out", "set", "reset", "toggle", "move", "calc", "emergency"]) if (r[k] !== undefined) return k;
  return "?";
}
function coerce(v) {
  if (typeof v !== "string") return v;
  if (/^-?\d+$/.test(v)) return Number(v);
  if (v === "true") return true;
  if (v === "false") return false;
  return v;
}
function scalarFor(key, v, quoted = QUOTED.has(key)) {
  if (Array.isArray(v)) return null;
  const s = new Scalar(quoted ? String(v) : coerce(v));
  if (quoted && typeof s.value === "string" && (key !== "value" || /[^0-9-]/.test(s.value))) s.type = "QUOTE_DOUBLE";
  if (key === "value" && /^-?\d+$/.test(String(v))) s.value = Number(v);
  return s;
}
function arrToSeq(doc, arr) {
  const s = new YAMLSeq();
  s.items = arr.map((x) => new Scalar(coerce(String(x))));
  s.flow = true;
  return s;
}
function objToMap(doc, obj, flow) {
  const m = new YAMLMap();
  const isCount = obj.count !== undefined; // reset: is an expression in a count rung, a target bit in a reset rung
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null || v === "") continue;
    if (Array.isArray(v)) { if (!v.length && !LIST_KEYS.has(k)) continue; m.items.push(doc.createPair(k, arrToSeq(doc, v))); }
    else if (typeof v === "object") m.items.push(doc.createPair(k, objToMap(doc, v, true)));
    else m.items.push(doc.createPair(k, scalarFor(k, v, k === "reset" ? isCount : QUOTED.has(k))));
  }
  m.flow = flow;
  return m;
}
function valueOf(n) {
  if (isScalar(n)) return n.value == null ? "" : String(n.value);
  if (isSeq(n)) return n.items.map(valueOf);
  if (isMap(n)) return mapToObj(n);
  return "";
}
function mapToObj(n) {
  const o = {};
  if (!isMap(n)) return o;
  for (const p of n.items) o[String(p.key?.value ?? p.key)] = valueOf(p.value);
  return o;
}

/** A fresh program file with the sections commented. */
export function newProgramYaml(name = "my_cell") {
  return `# ${name}.yaml -- nextplc program. Every 10 ms: read inputs -> rungs top to bottom -> sequences -> write outputs.
# Raw addresses: gpio1.di1..di8, gpio1.do1..do8, joint1..6.di1..di8, joint1..6.do1..do3 / pi_p, M0..M127, R0..R31, S.AUTO ...
# Use the Form tab or "Add a rung" to build lines; the Guide tab explains every key.
program: ${name}

names:                       # optional names for raw addresses
  start_button: gpio1.di7
  part_present: gpio1.di1
  clamp: gpio1.do1

rungs:
  - {out: clamp, when: "ON_FOR(part_present, 300ms) AND S.AUTO"}
`;
}

/** A fresh block file. */
export function newBlockYaml(name = "my_block") {
  return `# ${name} -- describe what the block does and its ports here (shown in the library).
block: ${name}
description: "What this block does"
ports:
  command:  {kind: in}                    # a bit the block reads
  feedback: {kind: in, optional: true}    # may be left open (reads 0)
  output:   {kind: out}                   # a Q or M bit the block writes (one owner)
  fault:    {kind: out, optional: true}
  fb_time:  {kind: time, default: 1s}     # 500ms, 2s or a register in ms
locals:
  pending: M                              # internal bits / registers, allocated per instance
rungs:
  - {out: output,  when: "command AND NOT fault"}
  - {out: pending, when: "output AND NOT feedback"}
  - {set: fault,   when: "ON_FOR(pending, fb_time)"}
alarms:
  - {bit: fault, text: "Feedback missing", level: error, toast: true}
`;
}
