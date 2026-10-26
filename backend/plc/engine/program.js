// program.js -- a loaded, checked program: aliases, rungs, sequences, alarms, safe state, blocks
// (port of nextplc/program.cpp). Every error is reported with the line in the file and nothing
// half-loaded is ever run: load fails as a whole.

import { parseDocument, LineCounter, isMap, isSeq, isScalar } from "yaml";
import {
  kQ, kM, kR, parseAddress, addressName, normalizeName, addrKey, isBit, isWritable, addr as mkAddr,
} from "./image.js";
import { parseExpr, parseDuration } from "./expr.js";
import { newRung } from "./rung.js";
import { newSequence, newStep } from "./sequence.js";

const AREA_ORDER = { I: 0, Q: 1, M: 2, R: 3, S: 4, SEQ_STEP: 5, SEQ_ACTIVE: 6, SEQ_STEPBIT: 7 };
export function compareAddr(a, b) {
  return (AREA_ORDER[a.area] - AREA_ORDER[b.area]) || (a.index - b.index) || ((a.sub || 0) - (b.sub || 0));
}

export class Program {
  constructor() {
    this.name = "";
    this.source_path = "";
    this.source_text = "";
    this.scan_ms = 0;
    this.aliases = new Map();   // normalized alias -> address
    this.alias_of = new Map();  // addrKey -> { addr, alias } (first one)
    this.rungs = [];
    this.sequences = [];
    this.alarms = [];
    this.safe = { value: new Array(kQ).fill(false), exempt: new Array(kQ).fill(false) };
    this.retain = [];
    this.owners = new Map();    // addrKey -> who
    this.used_q = new Array(kQ).fill(false);
    this.has_emergency = false;
    this.blocks = [];
  }

  /** alias | raw address | seq.<name>.step|active|<step>  -> { ok, addr } | { ok:false, err } */
  resolve(text) {
    const n = normalizeName(text);
    const al = this.aliases.get(n);
    if (al) return { ok: true, addr: al };
    if (n.startsWith("seq.")) {
      const dot = n.indexOf(".", 4);
      if (dot < 0) return { ok: false, err: `'${text}': write seq.<name>.step, seq.<name>.active or seq.<name>.<step>` };
      const sname = n.slice(4, dot);
      const what = n.slice(dot + 1);
      for (let i = 0; i < this.sequences.length; i++) {
        const s = this.sequences[i];
        if (normalizeName(s.name) !== sname) continue;
        if (what === "step") return { ok: true, addr: mkAddr("SEQ_STEP", i) };
        if (what === "active") return { ok: true, addr: mkAddr("SEQ_ACTIVE", i) };
        for (let j = 0; j < s.steps.length; j++) if (normalizeName(s.steps[j].name) === what) return { ok: true, addr: mkAddr("SEQ_STEPBIT", i, j + 1) };
        return { ok: false, err: `'${text}': sequence '${s.name}' has no step '${what}'` };
      }
      return { ok: false, err: `'${text}': there is no sequence '${sname}'` };
    }
    const raw = parseAddress(text);
    if (raw.ok) return raw;
    if (!n.includes(".") && n && !/[0-9]/.test(n[0]) && !((n[0] === "m" || n[0] === "r") && n.length > 1 && /[0-9]/.test(n[1]))) {
      return { ok: false, err: `unknown name '${text}' (not in io:/names: and not an address)` };
    }
    return raw;
  }

  canonicalName(a) {
    if (a.area === "SEQ_STEP" || a.area === "SEQ_ACTIVE" || a.area === "SEQ_STEPBIT") {
      if (a.index >= this.sequences.length) return addressName(a);
      const s = this.sequences[a.index];
      if (a.area === "SEQ_STEP") return `seq.${s.name}.step`;
      if (a.area === "SEQ_ACTIVE") return `seq.${s.name}.active`;
      if (a.sub >= 1 && a.sub <= s.steps.length) return `seq.${s.name}.${s.steps[a.sub - 1].name}`;
      return addressName(a);
    }
    return addressName(a);
  }
  displayName(a) {
    const al = this.alias_of.get(addrKey(a));
    return al ? al.alias : this.canonicalName(a);
  }
  ownerOf(a) { return this.owners.get(addrKey(a)) || ""; }

  /** alias table sorted like the node publishes it: [{alias, target}] */
  aliasTable() {
    return [...this.alias_of.values()].sort((x, y) => compareAddr(x.addr, y.addr)).map((x) => ({ alias: x.alias, target: this.canonicalName(x.addr) }));
  }
  usedOutputCount() { return this.used_q.filter(Boolean).length; }
}

// ------------------------------------------------------------------ YAML helpers
class LoadError extends Error {}

function lineOf(lc, n) {
  if (!n || !n.range) return 1;
  return lc.linePos(n.range[0]).line;
}
function scalarText(n) {
  if (n == null) return "";
  if (isScalar(n)) return n.value == null ? "" : (typeof n.value === "string" ? n.value : String(n.value));
  return "";
}
function parseBit01(s) {
  const n = normalizeName(s);
  if (n === "1" || n === "true" || n === "on") return true;
  if (n === "0" || n === "false" || n === "off") return false;
  return null;
}
const KEYWORDS = new Set(["and", "or", "not", "true", "false", "rise", "fall", "on_for", "off_for"]);

function parseYamlDoc(text, what) {
  const lc = new LineCounter();
  const doc = parseDocument(text, { lineCounter: lc, keepSourceTokens: false, uniqueKeys: false, prettyErrors: false });
  if (doc.errors.length) {
    const e = doc.errors[0];
    const line = e.linePos ? e.linePos[0].line : 1;
    throw new LoadError(`line ${line}: ${what}YAML syntax: ${e.message.split("\n")[0]}`);
  }
  return { doc, lc };
}

// ------------------------------------------------------------------ the builder
class Build {
  constructor(p, opts) {
    this.p = p;
    this.opts = opts;
    this.shared = new Map(); // addrKey -> who (set/reset/on_timeout writers may share)
    this.ctx = "";
    this.lc = null;
  }
  fail(n, msg) { throw new LoadError(`line ${lineOf(this.lc, n)}: ${msg}`); }
  scalar(n, key) {
    if (!isScalar(n)) this.fail(n, `${key} must be a single value`);
    return scalarText(n);
  }
  get(map, key) { return map && isMap(map) ? map.get(key, true) : undefined; }
  has(map, key) { return map && isMap(map) && map.has(key); }
  keyNode(map, key) {
    const pair = map.items.find((it) => String(scalarText(it.key)) === key);
    return pair ? pair.key : map;
  }

  run(yaml) {
    const { doc, lc } = parseYamlDoc(yaml, "");
    this.lc = lc;
    const root = doc.contents;
    if (!isMap(root)) throw new LoadError("line 1: the program file must be a YAML map (program:, io:, rungs: ...)");
    const known = new Set(["program", "scan_ms", "io", "names", "retain", "safe_state", "rungs", "sequences", "alarms", "blocks"]);
    for (const it of root.items) {
      const k = normalizeName(scalarText(it.key));
      if (!known.has(k)) this.fail(it.key, `unknown section '${scalarText(it.key)}'`);
    }
    const p = this.p;
    p.name = this.has(root, "program") ? this.scalar(this.get(root, "program"), "program") : "program";
    if (this.has(root, "scan_ms")) {
      p.scan_ms = parseFloat(this.scalar(this.get(root, "scan_ms"), "scan_ms"));
      if (!(p.scan_ms >= 1 && p.scan_ms <= 1000)) this.fail(this.get(root, "scan_ms"), "scan_ms must be 1..1000");
    }

    this.loadAliases(this.get(root, "io"), this.get(root, "names"));
    const insts = this.expandBlocks(this.get(root, "blocks"), yaml);

    this.declareSequences(this.get(root, "sequences"));
    for (const inst of insts) this.inBlock(inst, () => this.declareSequences(this.get(inst.root, "sequences")));
    for (const inst of insts) this.inBlock(inst, () => this.addInstanceAliases(inst));
    this.loadRetain(this.get(root, "retain"));
    for (const inst of insts) this.inBlock(inst, () => this.loadRetain(this.get(inst.root, "retain")));
    this.loadSafeState(this.get(root, "safe_state"), false);
    for (const inst of insts) this.inBlock(inst, () => this.loadSafeState(this.get(inst.root, "safe_state"), true));
    this.loadRungs(this.get(root, "rungs"));
    let seqIndex = this.loadSequences(this.get(root, "sequences"), 0);
    this.loadAlarms(this.get(root, "alarms"));
    for (const inst of insts) {
      this.inBlock(inst, () => {
        this.ctx = inst.inst.as + ": ";
        inst.inst.first_rung = p.rungs.length;
        this.loadRungs(this.get(inst.root, "rungs"));
        inst.inst.rung_count = p.rungs.length - inst.inst.first_rung;
        for (let k = inst.inst.first_rung; k < p.rungs.length; k++) { p.rungs[k].line = inst.inst.line; p.rungs[k].block = inst.inst.as; }
        seqIndex = this.loadSequences(this.get(inst.root, "sequences"), seqIndex);
        this.loadAlarms(this.get(inst.root, "alarms"));
        this.ctx = "";
      });
      p.blocks.push(inst.inst);
    }
    if (!p.rungs.length && !p.sequences.length) throw new LoadError("the program has no rungs and no sequences");
  }

  // ---- library blocks ---------------------------------------------------------
  inBlock(inst, f) {
    const savedLc = this.lc;
    this.lc = inst.lc;
    try {
      f();
    } catch (e) {
      if (!(e instanceof LoadError)) throw e;
      let tail = e.message;
      if (tail.startsWith("line ")) {
        const c = tail.indexOf(":");
        tail = `${inst.inst.file} ${tail.slice(0, c)}${tail.slice(c)}`;
      }
      throw new LoadError(`line ${inst.inst.line}: block '${inst.inst.block}' (as ${inst.inst.as}), ${tail}`);
    } finally {
      this.lc = savedLc;
    }
  }

  static identChar(c) { return /[A-Za-z0-9_.]/.test(c); }

  /** whole-token replacement of port / local / sequence names in the block text */
  static substitute(text, map, seqs) {
    let out = "";
    let i = 0;
    while (i < text.length) {
      const c = text[i];
      if (/[A-Za-z_]/.test(c)) {
        let j = i;
        while (j < text.length && Build.identChar(text[j])) j++;
        let tok = text.slice(i, j);
        const norm = normalizeName(tok);
        let k = j;
        while (k < text.length && (text[k] === " " || text[k] === "\t")) k++;
        const isKey = k < text.length && text[k] === ":" && (k + 1 >= text.length || /\s/.test(text[k + 1]));
        if (isKey) {
          if (norm === "text" || norm === "name" || norm === "description" || norm === "block") {
            out += tok;
            out += text.slice(j, k + 1);
            i = k + 1;
            while (i < text.length && (text[i] === " " || text[i] === "\t")) { out += text[i]; i++; }
            if (i < text.length && (text[i] === '"' || text[i] === "'")) {
              const q = text[i];
              let e = i + 1;
              while (e < text.length && text[e] !== q) { if (text[e] === "\\" && q === '"') e++; e++; }
              if (e < text.length) e++;
              out += text.slice(i, e);
              i = e;
            } else {
              let e = i;
              while (e < text.length && text[e] !== "," && text[e] !== "}" && text[e] !== "\n" && text[e] !== "#") e++;
              out += text.slice(i, e);
              i = e;
            }
            continue;
          }
        } else if (map.has(norm)) tok = map.get(norm);
        else if (norm.startsWith("seq.")) {
          const dot = norm.indexOf(".", 4);
          const sname = dot < 0 ? norm.slice(4) : norm.slice(4, dot);
          if (seqs.has(sname)) tok = "seq." + seqs.get(sname) + (dot < 0 ? "" : tok.slice(dot));
        }
        out += tok;
        i = j;
      } else if (/[0-9]/.test(c)) {
        let j = i;
        while (j < text.length && Build.identChar(text[j])) j++;
        out += text.slice(i, j);
        i = j;
      } else {
        out += c;
        i++;
      }
    }
    return out;
  }

  static collectUsed(text, m, r) {
    let i = 0;
    while (i < text.length) {
      if (/[A-Za-z_]/.test(text[i])) {
        let j = i;
        while (j < text.length && Build.identChar(text[j])) j++;
        const a = parseAddress(text.slice(i, j));
        if (a.ok) {
          if (a.addr.area === "M") m.add(a.addr.index);
          if (a.addr.area === "R") r.add(a.addr.index);
        }
        i = j;
      } else i++;
    }
  }

  findBlockFile(use, n) {
    const tried = [];
    const read = this.opts.readFile;
    if (use.includes("/") || use.endsWith(".yaml")) {
      const t = read(use);
      if (t != null) return { file: use, text: t };
      tried.push(use);
    } else {
      const dirs = [];
      if (this.p.source_path) dirs.push(dirOf(this.p.source_path) + "/blocks");
      for (const d of this.opts.blockDirs || []) dirs.push(d);
      for (const d of dirs) {
        const path = `${d}/${use}.yaml`;
        const t = read(path);
        if (t != null) return { file: path, text: t };
        tried.push(path);
      }
    }
    this.fail(n, `block '${use}' not found; looked for: ${tried.join(", ")}`);
  }

  expandBlocks(blocks, programText) {
    const out = [];
    if (!blocks) return out;
    if (!isSeq(blocks)) this.fail(blocks, "blocks: must be a list of {use: <block>, as: <name>, with: {...}}");
    const usedM = new Set(), usedR = new Set();
    Build.collectUsed(programText, usedM, usedR);
    const names = new Set();
    for (const bn of blocks.items) {
      if (!isMap(bn) || !this.has(bn, "use")) this.fail(bn, "a block instance is {use: cylinder, as: clamp, with: {port: address, ...}}");
      this.allowedKeys(bn, ["use", "as", "with"], "block instance");
      const inst = { block: "", as: "", file: "", description: "", ports: [], locals: [], line: lineOf(this.lc, bn), first_rung: 0, rung_count: 0 };
      const in_ = { inst, root: null, lc: null, seq_names: [], port_addr: [] };
      inst.block = this.scalar(this.get(bn, "use"), "use");
      const found = this.findBlockFile(inst.block, this.get(bn, "use"));
      inst.file = found.file;
      {
        let stem = inst.block.includes("/") ? inst.block.slice(inst.block.lastIndexOf("/") + 1) : inst.block;
        if (stem.endsWith(".yaml")) stem = stem.slice(0, -5);
        inst.block = stem;
      }
      inst.as = this.has(bn, "as") ? this.scalar(this.get(bn, "as"), "as") : inst.block;
      const asn = normalizeName(inst.as);
      if (!/^[a-z0-9_]+$/.test(asn)) this.fail(this.has(bn, "as") ? this.get(bn, "as") : bn, `as: '${inst.as}': only letters, digits and _`);
      if (names.has(asn)) this.fail(bn, `as: '${inst.as}' is used twice`);
      names.add(asn);

      const text = found.text;
      let meta, metaLc;
      try {
        const parsed = parseYamlDoc(text, "");
        meta = parsed.doc.contents; metaLc = parsed.lc;
      } catch (e) {
        this.fail(this.get(bn, "use"), `block file ${inst.file} ${e.message.replace(/^line (\d+): /, "line $1: ")}`);
      }
      if (!isMap(meta) || !this.has(meta, "ports")) this.fail(this.get(bn, "use"), `block file ${inst.file}: needs block:, ports: and rungs:/sequences:`);
      const knownB = new Set(["block", "description", "ports", "locals", "retain", "safe_state", "rungs", "sequences", "alarms"]);
      for (const kv of meta.items) if (!knownB.has(normalizeName(scalarText(kv.key)))) this.fail(this.get(bn, "use"), `block file ${inst.file}: unknown section '${scalarText(kv.key)}'`);
      if (this.has(meta, "description")) inst.description = scalarText(this.get(meta, "description"));

      const map = new Map();
      const portNames = new Set();
      const withN = this.get(bn, "with");
      if (withN && !isMap(withN)) this.fail(withN, "with: must be a map port: address");
      const withGet = (pnorm) => {
        if (!withN) return null;
        for (const kv of withN.items) if (normalizeName(scalarText(kv.key)) === pnorm) return kv;
        return null;
      };
      const ports = this.get(meta, "ports");
      if (!isMap(ports)) this.fail(this.get(bn, "use"), `block file ${inst.file}: ports: must be a map`);
      for (const pn of ports.items) {
        const pname = scalarText(pn.key);
        const pnorm = normalizeName(pname);
        portNames.add(pnorm);
        let kind = "in", def = "", optional = false;
        if (isMap(pn.value)) {
          if (pn.value.has("kind")) kind = normalizeName(scalarText(pn.value.get("kind", true)));
          if (pn.value.has("default")) def = scalarText(pn.value.get("default", true));
          if (pn.value.has("optional")) optional = parseBit01(scalarText(pn.value.get("optional", true))) === true;
        } else if (isScalar(pn.value)) kind = normalizeName(scalarText(pn.value));
        if (!["in", "out", "register", "time", "number"].includes(kind)) this.fail(this.get(bn, "use"), `block file ${inst.file}: port '${pname}': kind must be in, out, register, time or number`);
        let bound = "";
        let wn = null;
        const w = withGet(pnorm);
        if (w) { wn = w.value; bound = this.scalar(w.value, pname); }
        if (!bound && !def && optional) {
          if (kind === "in") { map.set(pnorm, "FALSE"); inst.ports.push([pname, "(open)"]); continue; }
          if (kind === "out" || kind === "register") {
            const bit = kind === "out";
            const used = bit ? usedM : usedR;
            let i = (bit ? kM : kR) - 1;
            while (i >= 0 && used.has(i)) i--;
            if (i < 0) this.fail(bn, `no free ${bit ? "M bit" : "register"} left for the open port '${pname}' of block '${inst.block}'`);
            used.add(i);
            const la = mkAddr(bit ? "M" : "R", i);
            map.set(pnorm, addressName(la));
            inst.ports.push([pname, "(open)"]);
            inst.locals.push([pname, la]);
            continue;
          }
        }
        if (!bound) {
          if (!def) this.fail(bn, `block '${inst.block}' (as ${inst.as}): port '${pname}' (${kind}) is not connected; add with: {${pname}: ...}`);
          bound = def;
          const dn = normalizeName(def);
          if (map.has(dn)) {
            bound = map.get(dn);
            for (const pb of inst.ports) if (normalizeName(pb[0]) === dn) bound = pb[1];
          } else {
            const w2 = withGet(dn);
            if (w2) bound = this.scalar(w2.value, pname);
          }
        }
        const where = wn || bn;
        const res = this.p.resolve(bound);
        const isAddr = res.ok;
        const a = res.addr;
        const bu = normalizeName(bound);
        const constBit = bu === "true" || bu === "false";
        if (kind === "in" && !constBit && !(isAddr && isBit(a))) this.fail(where, `port '${pname}' needs a bit (I, Q, M or S): '${bound}'${isAddr ? " is not a bit" : ": " + res.err}`);
        if (kind === "out" && !(isAddr && isBit(a) && isWritable(a) && a.area !== "I")) this.fail(where, `port '${pname}' is written by the block, it needs a Q or M bit: '${bound}'`);
        if (kind === "register" && !(isAddr && a.area === "R")) this.fail(where, `port '${pname}' needs a register (R0..R${kR - 1}): '${bound}'`);
        if (kind === "time") {
          if (!(parseDuration(bound).ok || (isAddr && a.area === "R"))) this.fail(where, `port '${pname}' needs a time (500ms, 2s) or a register holding milliseconds: '${bound}'`);
        }
        if (kind === "number") {
          const num = /^-?[0-9]+$/.test(bound);
          if (!(num || (isAddr && a.area === "R"))) this.fail(where, `port '${pname}' needs a number or a register: '${bound}'`);
        }
        map.set(pnorm, bound);
        inst.ports.push([pname, bound]);
        if (isAddr) in_.port_addr.push([pname, a]);
      }
      const localsN = this.get(meta, "locals");
      if (withN) {
        for (const kv of withN.items) {
          const k = normalizeName(scalarText(kv.key));
          let isLocal = false;
          if (localsN && isMap(localsN)) for (const ln of localsN.items) if (normalizeName(scalarText(ln.key)) === k) isLocal = true;
          if (!portNames.has(k) && !isLocal) this.fail(kv.key, `block '${inst.block}' has no port '${scalarText(kv.key)}'`);
        }
      }
      if (localsN) {
        if (!isMap(localsN)) this.fail(this.get(bn, "use"), `block file ${inst.file}: locals: must be a map name: M | R`);
        for (const ln of localsN.items) {
          const lname = scalarText(ln.key);
          const lnorm = normalizeName(lname);
          const area = normalizeName(scalarText(ln.value));
          if (portNames.has(lnorm)) this.fail(this.get(bn, "use"), `block file ${inst.file}: '${lname}' is a port and a local`);
          if (area !== "m" && area !== "r") this.fail(this.get(bn, "use"), `block file ${inst.file}: local '${lname}' must be M or R`);
          let a = null;
          const w = withGet(lnorm);
          if (w) {
            const res = this.p.resolve(this.scalar(w.value, lname));
            if (!res.ok || res.addr.area !== (area === "m" ? "M" : "R")) this.fail(w.value, `local '${lname}' of block '${inst.block}' must be a${area === "m" ? "n M bit" : " register"}`);
            a = res.addr;
            (area === "m" ? usedM : usedR).add(a.index);
          } else {
            const used = area === "m" ? usedM : usedR;
            let i = (area === "m" ? kM : kR) - 1;
            while (i >= 0 && used.has(i)) i--;
            if (i < 0) this.fail(bn, `no free ${area === "m" ? "M bit" : "register"} left for the locals of block '${inst.block}'`);
            used.add(i);
            a = mkAddr(area === "m" ? "M" : "R", i);
          }
          map.set(lnorm, addressName(a));
          inst.locals.push([lname, a]);
        }
      }
      const seqmap = new Map();
      const seqsN = this.get(meta, "sequences");
      if (seqsN && isSeq(seqsN)) {
        for (const sn of seqsN.items) if (isMap(sn) && sn.has("name")) {
          const sname = scalarText(sn.get("name", true));
          seqmap.set(normalizeName(sname), `${inst.as}_${sname}`);
          in_.seq_names.push(`${inst.as}_${sname}`);
        }
      }
      const expanded = Build.substitute(text, map, seqmap);
      try {
        const parsed = parseYamlDoc(expanded, "");
        in_.root = parsed.doc.contents;
        in_.lc = parsed.lc;
      } catch (e) {
        this.fail(this.get(bn, "use"), `block file ${inst.file} ${e.message.replace(/^line (\d+): YAML syntax: /, "line $1 (after connecting the ports): ")}`);
      }
      in_.expanded = expanded;
      void metaLc;
      out.push(in_);
    }
    return out;
  }

  /** clamp.<port> and clamp.<local> can be read by the program's own rungs */
  addInstanceAliases(inst) {
    for (const [port, a] of inst.port_addr) {
      const alias = normalizeName(`${inst.inst.as}.${port}`);
      if (!this.p.aliases.has(alias)) this.p.aliases.set(alias, a);
    }
    for (const [local, a] of inst.inst.locals) {
      const alias = `${inst.inst.as}.${local}`;
      this.p.aliases.set(normalizeName(alias), a);
      if (!this.p.alias_of.has(addrKey(a))) this.p.alias_of.set(addrKey(a), { addr: a, alias });
    }
  }

  // ---- helpers ------------------------------------------------------------
  addr(n, key) {
    const s = this.scalar(n, key);
    const r = this.p.resolve(s);
    if (!r.ok) this.fail(n, `${key}: ${r.err}`);
    return r.addr;
  }
  writableBit(n, key) {
    const a = this.addr(n, key);
    const s = this.scalar(n, key);
    if (a.area === "I") this.fail(n, `${key}: '${s}' is a physical input, it cannot be written`);
    if (a.area === "S") this.fail(n, `${key}: system bits cannot be written`);
    if (a.area === "R") this.fail(n, `${key}: '${s}' is a register, this needs a bit (Q or M)`);
    if (!isWritable(a)) this.fail(n, `${key}: '${s}' cannot be written`);
    return a;
  }
  writableReg(n, key) {
    const a = this.addr(n, key);
    if (a.area !== "R") this.fail(n, `${key}: '${this.scalar(n, key)}' must be a register (R0..R${kR - 1})`);
    return a;
  }
  expr(n, key, mustBeBool) {
    const s = this.scalar(n, key);
    const r = parseExpr(s, (name) => this.p.resolve(name));
    if (!r.ok) this.fail(n, `${key}: ${r.err}`);
    if (mustBeBool && !r.expr.isBool()) this.fail(n, `${key}: '${s}' is a number, a condition needs a bit (e.g. R0 > 0)`);
    r.expr.text = s;
    return r.expr;
  }
  duration(n, key) {
    const d = parseDuration(this.scalar(n, key));
    if (!d.ok) this.fail(n, `${key}: ${d.err}`);
    if (d.seconds <= 0) this.fail(n, `${key}: time must be greater than 0`);
    return d.seconds;
  }
  own(n, a, who) {
    const k = addrKey(a);
    if (this.p.owners.has(k)) this.fail(n, `${this.p.displayName(a)} is already written by ${this.p.owners.get(k)} (one owner per bit)`);
    if (this.shared.has(k)) this.fail(n, `${this.p.displayName(a)} is set/reset by ${this.shared.get(k)}, it cannot also be driven by ${who}`);
    this.p.owners.set(k, who);
    if (a.area === "Q") this.p.used_q[a.index] = true;
  }
  share(n, a, who) {
    const k = addrKey(a);
    if (this.p.owners.has(k)) this.fail(n, `${this.p.displayName(a)} is driven by ${this.p.owners.get(k)}, a set/reset cannot write it too`);
    if (!this.shared.has(k)) this.shared.set(k, who);
    if (a.area === "Q") this.p.used_q[a.index] = true;
  }
  allowedKeys(n, keys, what) {
    for (const kv of n.items) {
      const k = normalizeName(scalarText(kv.key));
      if (!keys.includes(k)) this.fail(kv.key, `${what}: unknown key '${scalarText(kv.key)}'`);
    }
  }

  // ---- sections -----------------------------------------------------------
  declareSequences(seqs) {
    if (!seqs) return;
    if (!isSeq(seqs)) this.fail(seqs, "sequences: must be a list");
    const names = new Set();
    for (const sn of seqs.items) {
      if (!isMap(sn) || !sn.has("name")) this.fail(sn, "a sequence needs a name:");
      const s = newSequence();
      s.name = this.scalar(sn.get("name", true), "name");
      s.line = lineOf(this.lc, sn);
      const norm = normalizeName(s.name);
      if (!norm || norm.includes(".")) this.fail(sn.get("name", true), `sequence name '${s.name}' must not be empty or contain '.'`);
      if (names.has(norm)) this.fail(sn.get("name", true), `sequence name '${s.name}' is used twice`);
      names.add(norm);
      const steps = sn.get("steps", true);
      if (!steps || !isSeq(steps) || steps.items.length === 0) this.fail(sn, `sequence '${s.name}' needs steps: (a list)`);
      const stepNames = new Set();
      for (const stn of steps.items) {
        if (!isMap(stn) || !stn.has("name")) this.fail(stn, "every step needs a name:");
        const st = newStep();
        st.name = this.scalar(stn.get("name", true), "name");
        st.line = lineOf(this.lc, stn);
        const sname = normalizeName(st.name);
        if (sname === "step" || sname === "active" || !sname || sname.includes(".")) this.fail(stn.get("name", true), `step name '${st.name}' is not allowed`);
        if (stepNames.has(sname)) this.fail(stn.get("name", true), `step name '${st.name}' is used twice in sequence '${s.name}'`);
        stepNames.add(sname);
        s.steps.push(st);
      }
      this.p.sequences.push(s);
    }
  }

  addAlias(keyN, valN, mustBe) {
    const alias = scalarText(keyN);
    const norm = normalizeName(alias);
    if (!norm) this.fail(keyN, "empty alias");
    if (KEYWORDS.has(norm)) this.fail(keyN, `'${alias}' is a keyword, it cannot be an alias`);
    if (norm.startsWith("seq.") || norm.startsWith("s.")) this.fail(keyN, `'${alias}': aliases must not start with seq. or S.`);
    if (parseAddress(norm).ok) this.fail(keyN, `'${alias}' is a raw address, it cannot be an alias`);
    if (!/^[a-z0-9_]+$/.test(norm)) this.fail(keyN, `alias '${alias}': only letters, digits and _`);
    if (/[0-9]/.test(norm[0])) this.fail(keyN, `alias '${alias}' must not start with a digit`);
    if (this.p.aliases.has(norm)) this.fail(keyN, `alias '${alias}' is defined twice`);
    const r = parseAddress(this.scalar(valN, alias));
    if (!r.ok) this.fail(valN, `${alias}: ${r.err}`);
    if (mustBe && r.addr.area !== mustBe) this.fail(valN, `${alias}: '${scalarText(valN)}' is not in this section's area`);
    this.p.aliases.set(norm, r.addr);
    if (!this.p.alias_of.has(addrKey(r.addr))) this.p.alias_of.set(addrKey(r.addr), { addr: r.addr, alias });
  }
  loadAliases(io, names) {
    if (io) {
      if (!isMap(io)) this.fail(io, "io: must be a map with I:, Q:, M:, R:");
      for (const sec of io.items) {
        const k = normalizeName(scalarText(sec.key));
        const area = { i: "I", q: "Q", m: "M", r: "R" }[k];
        if (!area) this.fail(sec.key, "io: sections are I, Q, M, R");
        if (!isMap(sec.value)) this.fail(sec.value || sec.key, `io.${k}: must be a map alias: address`);
        for (const kv of sec.value.items) this.addAlias(kv.key, kv.value, area);
      }
    }
    if (names) {
      if (!isMap(names)) this.fail(names, "names: must be a map alias: address");
      for (const kv of names.items) this.addAlias(kv.key, kv.value, null);
    }
  }
  loadRetain(n) {
    if (!n) return;
    if (!isSeq(n)) this.fail(n, "retain: must be a list of registers");
    for (const item of n.items) {
      const a = this.addr(item, "retain");
      if (a.area !== "R") this.fail(item, `retain: only registers (R0..R${kR - 1}) can be retained`);
      this.p.retain.push(a);
    }
  }
  loadSafeState(n, merge) {
    if (!merge) this.p.safe = { value: new Array(kQ).fill(false), exempt: new Array(kQ).fill(false) };
    if (!n) return;
    if (!isMap(n)) this.fail(n, "safe_state: must be a map");
    let def = false;
    if (n.has("default")) {
      if (merge) this.fail(n.get("default", true), "safe_state.default is not allowed in a block (only the program decides it)");
      def = parseBit01(this.scalar(n.get("default", true), "default"));
      if (def === null) this.fail(n.get("default", true), "safe_state.default must be 0 or 1");
    }
    if (!merge) this.p.safe.value.fill(def);
    for (const kv of n.items) {
      const k = normalizeName(scalarText(kv.key));
      if (k === "default") continue;
      if (k === "exempt") {
        if (!isSeq(kv.value)) this.fail(kv.value || kv.key, "safe_state.exempt must be a list of outputs");
        for (const item of kv.value.items) {
          const a = this.addr(item, "exempt");
          if (a.area !== "Q") {
            if (merge) continue;
            this.fail(item, `safe_state.exempt: '${scalarText(item)}' is not a physical output`);
          }
          this.p.safe.exempt[a.index] = true;
        }
        continue;
      }
      const r = this.p.resolve(scalarText(kv.key));
      if (!r.ok) this.fail(kv.key, `safe_state: ${r.err}`);
      if (r.addr.area !== "Q") {
        if (merge) continue;
        this.fail(kv.key, `safe_state: '${scalarText(kv.key)}' is not a physical output`);
      }
      const v = parseBit01(this.scalar(kv.value, "safe_state value"));
      if (v === null) this.fail(kv.value, "safe_state value must be 0 or 1");
      this.p.safe.value[r.addr.index] = v;
    }
  }

  loadRungs(rungs) {
    if (!rungs) return;
    if (!isSeq(rungs)) this.fail(rungs, "rungs: must be a list");
    let number = 0;
    for (const rn of rungs.items) {
      number++;
      if (!isMap(rn)) this.fail(rn, 'a rung is a map, e.g. {out: gpio1.do1, when: "gpio1.di1"}');
      const r = newRung();
      r.line = lineOf(this.lc, rn);
      let typeKey = null, found = 0;
      if (rn.has("count")) {
        typeKey = "count"; found = 1;
        for (const k of ["out", "set", "toggle", "move", "calc", "emergency"]) if (rn.has(k)) found++;
      } else {
        for (const k of ["out", "set", "reset", "toggle", "move", "calc", "emergency"]) if (rn.has(k)) { typeKey = k; found++; }
      }
      if (found !== 1) this.fail(rn, "a rung needs exactly one of out:, set:, reset:, toggle:, count:, move:, calc:, emergency:");
      const tk = typeKey;
      const who = `${this.ctx}rung ${number} (${tk}, line ${r.line})`;
      let text = this.ctx;
      const g = (k) => rn.get(k, true);
      const sc = (k) => this.scalar(g(k), k);

      if (tk === "out" || tk === "set" || tk === "reset" || tk === "toggle") {
        this.allowedKeys(rn, [tk, "when", "ton", "tof", "tp"], "rung");
        if (!rn.has("when")) this.fail(rn, `${tk}: needs when:`);
        r.target = this.writableBit(g(tk), tk);
        r.when = this.expr(g("when"), "when", true);
        r.src = { target: sc(tk), when: sc("when") };
        text += `${tk} ${this.p.displayName(r.target)} when ${sc("when")}`;
        r.type = tk;
        let timers = 0;
        for (const t of ["ton", "tof", "tp"]) {
          if (!rn.has(t)) continue;
          timers++;
          if (tk !== "out") this.fail(g(t), `${t}: timers are only allowed on out: rungs`);
          let s = 0;
          const d = parseDuration(sc(t));
          if (d.ok) {
            s = d.seconds;
            if (s <= 0) this.fail(g(t), `${t}: time must be greater than 0`);
          } else {
            const txt = sc(t);
            if (!/[A-Za-z]/.test(txt)) this.fail(g(t), `${t}: ${d.err}`);
            const ms = parseExpr(txt, (name) => this.p.resolve(name));
            if (!ms.ok || ms.expr.isBool()) this.fail(g(t), `${t}: write a time with unit (500ms, 2s) or a register holding milliseconds (R10): ${d.err}`);
            r.timer_ms = ms.expr;
          }
          r.timer = t;
          r.timer_text = sc(t);
          if (t === "ton") r.ton.preset_s = s; else if (t === "tof") r.tof.preset_s = s; else r.tp.preset_s = s;
          text += ` ${t} ${sc(t)}`;
        }
        if (timers > 1) this.fail(rn, "only one of ton:, tof:, tp: per rung");
        if (tk === "out" || tk === "toggle") this.own(g(tk), r.target, who);
        else this.share(g(tk), r.target, who);
      } else if (tk === "count") {
        this.allowedKeys(rn, ["count", "up", "down", "reset", "preset", "done"], "count rung");
        r.type = "count";
        r.target = this.writableReg(g("count"), "count");
        if (!rn.has("up") && !rn.has("down")) this.fail(rn, "count: needs up: and/or down:");
        if (rn.has("up")) r.up = this.expr(g("up"), "up", true);
        if (rn.has("down")) r.down = this.expr(g("down"), "down", true);
        if (rn.has("reset")) r.reset_expr = this.expr(g("reset"), "reset", true);
        if (rn.has("preset")) r.preset = this.expr(g("preset"), "preset", false);
        if (rn.has("done")) {
          if (!rn.has("preset")) this.fail(g("done"), "done: needs a preset:");
          r.has_done = true;
          r.done = this.writableBit(g("done"), "done");
          this.own(g("done"), r.done, who);
        }
        this.own(g("count"), r.target, who);
        r.src = { target: sc("count"), up: rn.has("up") ? sc("up") : "", down: rn.has("down") ? sc("down") : "", reset: rn.has("reset") ? sc("reset") : "", preset: rn.has("preset") ? sc("preset") : "", done: rn.has("done") ? sc("done") : "" };
        text += `count ${this.p.displayName(r.target)}`;
        if (rn.has("up")) text += ` up ${sc("up")}`;
        if (rn.has("down")) text += ` down ${sc("down")}`;
        if (rn.has("reset")) text += ` reset ${sc("reset")}`;
        if (rn.has("preset")) text += ` preset ${sc("preset")}`;
        if (rn.has("done")) text += ` done ${this.p.displayName(r.done)}`;
      } else if (tk === "emergency") {
        this.allowedKeys(rn, ["emergency", "text"], "emergency rung");
        r.type = "emergency";
        r.when = this.expr(g("emergency"), "emergency", true);
        r.text_emergency = rn.has("text") ? sc("text") : `PLC emergency (rung ${number})`;
        this.p.has_emergency = true;
        r.src = { when: sc("emergency"), text: r.text_emergency };
        text += `emergency when ${sc("emergency")} "${r.text_emergency}"`;
      } else if (tk === "move") {
        this.allowedKeys(rn, ["move", "value", "when"], "move rung");
        r.type = "move";
        r.target = this.writableReg(g("move"), "move");
        if (!rn.has("value")) this.fail(rn, "move: needs value:");
        r.value = this.expr(g("value"), "value", false);
        r.value_text = sc("value");
        if (rn.has("when")) r.when = this.expr(g("when"), "when", true);
        if (this.p.owners.has(addrKey(r.target))) this.fail(g("move"), `${this.p.displayName(r.target)} is a counter (${this.p.owners.get(addrKey(r.target))}), move/calc cannot write it`);
        r.src = { target: sc("move"), value: sc("value"), when: rn.has("when") ? sc("when") : "" };
        text += `move ${this.p.displayName(r.target)} = ${sc("value")}`;
        if (rn.has("when")) text += ` when ${sc("when")}`;
      } else {
        this.allowedKeys(rn, ["calc", "when"], "calc rung");
        r.type = "calc";
        const c = sc("calc");
        const eq = c.indexOf("=");
        if (eq < 0 || c.indexOf("==") === eq) this.fail(g("calc"), 'calc: write "R2 = R0 + 1"');
        const lhs = c.slice(0, eq);
        const t = this.p.resolve(lhs);
        if (!t.ok) this.fail(g("calc"), `calc: ${t.err}`);
        if (t.addr.area !== "R") this.fail(g("calc"), `calc: left side '${normalizeName(lhs)}' must be a register`);
        r.target = t.addr;
        const e = parseExpr(c.slice(eq + 1), (name) => this.p.resolve(name));
        if (!e.ok) this.fail(g("calc"), `calc: ${e.err}`);
        r.value = e.expr;
        r.value_text = c.slice(eq + 1).trim();
        if (rn.has("when")) r.when = this.expr(g("when"), "when", true);
        if (this.p.owners.has(addrKey(r.target))) this.fail(g("calc"), `${this.p.displayName(r.target)} is a counter (${this.p.owners.get(addrKey(r.target))}), move/calc cannot write it`);
        r.src = { target: lhs.trim(), value: r.value_text, when: rn.has("when") ? sc("when") : "" };
        text += `calc ${c}`;
        if (rn.has("when")) text += ` when ${sc("when")}`;
      }
      r.text = text;
      this.p.rungs.push(r);
    }
  }

  loadSequences(seqs, i) {
    if (!seqs) return i;
    for (const sn of seqs.items) {
      const s = this.p.sequences[i++];
      this.allowedKeys(sn, ["name", "start", "abort", "steps"], "sequence");
      if (!sn.has("start")) this.fail(sn, `sequence '${s.name}' needs start:`);
      s.start = this.expr(sn.get("start", true), "start", true);
      if (sn.has("abort")) s.abort = this.expr(sn.get("abort", true), "abort", true);
      s.src = { start: scalarText(sn.get("start", true)), abort: sn.has("abort") ? scalarText(sn.get("abort", true)) : "" };
      const who = `${this.ctx}sequence ${s.name}`;
      s.block = this.ctx ? this.ctx.slice(0, -2) : "";
      const owned = new Set();
      let j = 0;
      for (const stn of sn.get("steps", true).items) {
        const st = s.steps[j++];
        this.allowedKeys(stn, ["name", "do", "next", "timeout", "on_timeout"], "step");
        if (!stn.has("next")) this.fail(stn, `step '${st.name}' needs next:`);
        st.next = this.expr(stn.get("next", true), "next", true);
        st.src = { next: scalarText(stn.get("next", true)), do: [] };
        if (stn.has("do")) {
          const d = stn.get("do", true);
          if (!isSeq(d)) this.fail(d, "do: must be a list of bits, e.g. [gpio1.do1, M11]");
          for (const item of d.items) {
            const a = this.writableBit(item, "do");
            if (!owned.has(addrKey(a))) {
              this.own(item, a, who);
              owned.add(addrKey(a));
              s.outputs.push(a);
            }
            st.outputs.push(a);
            st.src.do.push(scalarText(item));
          }
        }
        if (stn.has("timeout")) {
          st.timeout_s = this.duration(stn.get("timeout", true), "timeout");
          st.src.timeout = scalarText(stn.get("timeout", true));
          if (!stn.has("on_timeout")) this.fail(stn.get("timeout", true), "timeout: needs on_timeout: (the bit that reports it)");
          st.has_timeout_bit = true;
          st.on_timeout = this.writableBit(stn.get("on_timeout", true), "on_timeout");
          st.src.on_timeout = scalarText(stn.get("on_timeout", true));
          this.share(stn.get("on_timeout", true), st.on_timeout, who);
        } else if (stn.has("on_timeout")) {
          this.fail(stn.get("on_timeout", true), "on_timeout: needs timeout:");
        }
      }
    }
    return i;
  }

  loadAlarms(alarms) {
    if (!alarms) return;
    if (!isSeq(alarms)) this.fail(alarms, "alarms: must be a list");
    for (const an of alarms.items) {
      if (!isMap(an)) this.fail(an, 'an alarm is {bit: M30, text: "...", level: error, toast: true}');
      this.allowedKeys(an, ["bit", "text", "level", "toast"], "alarm");
      const a = { bit: null, text: "", level: "error", toast: true, line: lineOf(this.lc, an), prev: false };
      if (!an.has("bit")) this.fail(an, "alarm needs bit:");
      a.bit = this.addr(an.get("bit", true), "bit");
      if (!isBit(a.bit)) this.fail(an.get("bit", true), `alarm bit: '${scalarText(an.get("bit", true))}' is not a bit`);
      a.text = an.has("text") ? this.scalar(an.get("text", true), "text") : this.p.displayName(a.bit);
      if (an.has("level")) {
        a.level = normalizeName(this.scalar(an.get("level", true), "level"));
        if (!["info", "warning", "error"].includes(a.level)) this.fail(an.get("level", true), "level: info, warning or error");
      }
      if (an.has("toast")) {
        const t = parseBit01(this.scalar(an.get("toast", true), "toast"));
        if (t === null) this.fail(an.get("toast", true), "toast: true or false");
        a.toast = t;
      }
      a.block = this.ctx ? this.ctx.slice(0, -2) : "";
      this.p.alarms.push(a);
    }
  }
}

function dirOf(path) {
  const s = path.lastIndexOf("/");
  return s < 0 ? "." : path.slice(0, s);
}

// ------------------------------------------------------------------ Loader
/**
 * opts: { sourcePath, readFile(path) -> text | null, blockDirs: [] }
 * readFile is how library blocks are found (fs in Node, a fetched map in the browser).
 */
function buildYaml(yaml, opts) {
  const p = new Program();
  p.source_text = yaml;
  p.source_path = opts.sourcePath || "";
  try {
    new Build(p, { readFile: () => null, blockDirs: [], ...opts }).run(yaml);
  } catch (e) {
    if (e instanceof LoadError) return { ok: false, err: e.message };
    return { ok: false, err: e.message || String(e) };
  }
  return { ok: true, program: p };
}

export const Loader = {
  /** Always YAML, no sniffing. */
  fromYaml(yaml, opts = {}) { return buildYaml(yaml, opts); },

  /** YAML text (the only program format). */
  fromText(text, opts = {}) { return buildYaml(text, opts); },

  /** A file's text with its path (blocks are also looked up in <dir of path>/blocks). A .plc path is
   *  refused like the node does: sentence programs are not supported any more. */
  fromTextNamed(text, path, opts = {}) {
    if (String(path || "").toLowerCase().endsWith(".plc")) return { ok: false, err: `'${path}': .plc sentence programs are not supported any more; write the program in YAML (doc/LOGIC.md)` };
    const r = buildYaml(text, { ...opts, sourcePath: path });
    if (r.ok) r.program.source_path = path || "";
    return r;
  },
};

export { LoadError };
