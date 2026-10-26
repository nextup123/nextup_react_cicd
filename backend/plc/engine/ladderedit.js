// ladderedit.js -- the EDITABLE ladder model and its two-way conversion with the YAML rung rows.
//
//   condition text  <->  network of plain JSON nodes (what the ladder editor draws and edits)
//   rung row object <->  { net, coil }
//
// Network nodes:
//   { t: "contact", name, nc, edge }          -| |-  -|/|-  -|P|-  -|N|-   edge: null | "rise" | "fall"
//   { t: "cmp", a, op, b, nc }                CMP box: a == != < <= > >= b (number expressions as text)
//   { t: "timer", kind, time, inner, nc }     ON_FOR / OFF_FOR box around a sub-network
//   { t: "group", fn, inner }                 NOT ( … ) / RISE( … ) / FALL( … ) around a sub-network
//   { t: "const", value }                     TRUE / FALSE
//   { t: "series", items: [...] }             AND
//   { t: "parallel", branches: [...] }        OR
//
// Coil (right side of the rung):
//   { type: out|set|reset|toggle, target, timer: ""|ton|tof|tp, time }
//   { type: count, target, down, reset, preset, done }      CU input = the rung network
//   { type: move, target, value }  { type: calc, target, value }   (rung network = when; TRUE = every scan)
//   { type: emergency, text }                                (rung network = the emergency condition)

import { tokenize as tokenizeExpr } from "./expr.js";
import { parseExpr } from "./expr.js";
import { parseAddress, normalizeName } from "./image.js";

// ------------------------------------------------------------------ text -> AST (names kept as written)
/**
 * Parse a condition for the editor. `names`: Map(lower-case name -> "bit" | "num") of the
 * program's aliases (and block ports); unknown names are taken as bits.
 */
export function parseCondition(text, names = new Map()) {
  const resolve = (name) => {
    const n = normalizeName(name);
    const raw = parseAddress(name);
    if (raw.ok) return raw;
    if (names.has(n)) return { ok: true, addr: { area: names.get(n) === "num" ? "R" : "M", index: 0, sub: 0 } };
    if (n.startsWith("seq.")) return { ok: true, addr: { area: n.endsWith(".step") ? "SEQ_STEP" : "SEQ_ACTIVE", index: 0, sub: 0 } };
    return { ok: true, addr: { area: "M", index: 0, sub: 0 } };
  };
  return parseExpr(String(text ?? ""), resolve);
}

/** Print a number expression back to text. */
export function printNum(e) {
  switch (e.kind) {
    case "const": return typeof e.v === "boolean" ? (e.v ? "TRUE" : "FALSE") : String(e.v);
    case "ref": return e.text;
    case "neg": return `-${e.x.kind === "arith" ? `(${printNum(e.x)})` : printNum(e.x)}`;
    case "arith": {
      const prec = (op) => (op === "+" || op === "-" ? 1 : 2);
      const side = (x, right) => (x.kind === "arith" && (prec(x.op) < prec(e.op) || (right && prec(x.op) === prec(e.op))) ? `(${printNum(x)})` : printNum(x));
      return `${side(e.a, false)} ${e.op} ${side(e.b, true)}`;
    }
    default: return netToText(astToNet(e));
  }
}

// ------------------------------------------------------------------ AST -> network
export function astToNet(e) {
  switch (e.kind) {
    case "const": return { t: "const", value: Boolean(e.v) };
    case "ref": return { t: "contact", name: e.text, nc: false, edge: null };
    case "and": return series([astToNet(e.a), astToNet(e.b)]);
    case "or": return parallel([astToNet(e.a), astToNet(e.b)]);
    case "rise":
    case "fall":
      if (e.x.kind === "ref") return { t: "contact", name: e.x.text, nc: false, edge: e.kind };
      return { t: "group", fn: e.kind, inner: astToNet(e.x) };
    case "on_for":
    case "off_for":
      return { t: "timer", kind: e.kind, time: e.ms ? printNum(e.ms) : e.timeText, inner: astToNet(e.x), nc: false };
    case "cmp": return { t: "cmp", a: printNum(e.a), op: e.op, b: printNum(e.b), nc: false };
    case "not": {
      const n = astToNet(e.x);
      if (n.t === "contact" || n.t === "cmp" || n.t === "timer") return { ...n, nc: !n.nc };
      if (n.t === "const") return { t: "const", value: !n.value };
      if (n.t === "group" && n.fn === "not") return n.inner;
      return { t: "group", fn: "not", inner: n };
    }
    default: return { t: "const", value: false };
  }
}

export function series(items) {
  const flat = [];
  for (const it of items) { if (!it) continue; if (it.t === "series") flat.push(...it.items); else flat.push(it); }
  if (!flat.length) return null;
  return flat.length === 1 ? flat[0] : { t: "series", items: flat };
}
export function parallel(branches) {
  const flat = [];
  for (const b of branches) { if (!b) continue; if (b.t === "parallel") flat.push(...b.branches); else flat.push(b); }
  if (!flat.length) return null;
  return flat.length === 1 ? flat[0] : { t: "parallel", branches: flat };
}

/** text -> network ({ ok, net } | { ok: false, err }) */
export function textToNet(text, names) {
  if (!String(text ?? "").trim()) return { ok: true, net: null };
  const r = parseCondition(text, names);
  if (!r.ok) return r;
  return { ok: true, net: astToNet(r.expr) };
}

// ------------------------------------------------------------------ network -> text
export function netToText(n) {
  if (!n) return "TRUE";
  switch (n.t) {
    case "const": return n.value ? "TRUE" : "FALSE";
    case "contact": {
      const base = n.edge === "rise" ? `RISE(${n.name})` : n.edge === "fall" ? `FALL(${n.name})` : n.name;
      return n.nc ? `NOT ${base}` : base;
    }
    case "cmp": { const t = `${n.a} ${n.op} ${n.b}`; return n.nc ? `NOT (${t})` : t; }
    case "timer": { const t = `${n.kind === "off_for" ? "OFF_FOR" : "ON_FOR"}(${netToText(n.inner)}, ${n.time})`; return n.nc ? `NOT ${t}` : t; }
    case "group": return n.fn === "not" ? `NOT (${netToText(n.inner)})` : `${n.fn === "fall" ? "FALL" : "RISE"}(${netToText(n.inner)})`;
    case "series": return n.items.map((x) => (x.t === "parallel" ? `(${netToText(x)})` : netToText(x))).join(" AND ");
    case "parallel": return n.branches.map((x) => netToText(x)).join(" OR ");
    default: return "TRUE";
  }
}

// ------------------------------------------------------------------ rung row <-> { net, coil }
export const COIL_TYPES = ["out", "set", "reset", "toggle", "count", "move", "calc", "emergency"];
const str = (v) => (v === undefined || v === null ? "" : String(v));

export function rowToRung(row, names) {
  const type = row.count !== undefined ? "count" : COIL_TYPES.find((k) => row[k] !== undefined) || "out";
  let condText = "", coil;
  switch (type) {
    case "count":
      condText = str(row.up);
      coil = { type, target: str(row.count), down: str(row.down), reset: str(row.reset), preset: str(row.preset), done: str(row.done) };
      break;
    case "move":
      condText = str(row.when);
      coil = { type, target: str(row.move), value: str(row.value) };
      break;
    case "calc": {
      const c = str(row.calc), eq = c.indexOf("=");
      condText = str(row.when);
      coil = { type, target: c.slice(0, eq).trim(), value: c.slice(eq + 1).trim() };
      break;
    }
    case "emergency":
      condText = str(row.emergency);
      coil = { type, text: str(row.text) };
      break;
    default: {
      const timer = row.ton !== undefined ? "ton" : row.tof !== undefined ? "tof" : row.tp !== undefined ? "tp" : "";
      condText = str(row.when);
      coil = { type, target: str(row[type]), timer, time: timer ? str(row[timer]) : "" };
    }
  }
  const r = textToNet(condText, names);
  if (!r.ok) return { ok: false, err: r.err, condText, coil };
  return { ok: true, net: r.net, coil, condText };
}

/** { net, coil } -> rung row in the manual's key order */
export function rungToRow(net, coil) {
  const cond = net ? netToText(net) : "";
  const isTrue = !net || (net.t === "const" && net.value);
  switch (coil.type) {
    case "count": return { count: coil.target, up: cond || "FALSE", down: coil.down || undefined, reset: coil.reset || undefined, preset: coil.preset || undefined, done: coil.done || undefined };
    case "move": return { move: coil.target, value: coil.value || "0", when: isTrue ? undefined : cond };
    case "calc": return { calc: `${coil.target} = ${coil.value || "0"}`, when: isTrue ? undefined : cond };
    case "emergency": return { emergency: cond || "FALSE", text: coil.text || undefined };
    default: {
      const row = { [coil.type]: coil.target, when: cond || "TRUE" };
      if (coil.type === "out" && coil.timer) row[coil.timer] = coil.time || "500ms";
      return row;
    }
  }
}

// ------------------------------------------------------------------ editing by path
// A path is an array of child indices from the root network ([] = the root itself).

export function getAt(net, path) {
  let n = net;
  for (const i of path) {
    if (!n) return null;
    if (n.t === "series") n = n.items[i];
    else if (n.t === "parallel") n = n.branches[i];
    else if (n.t === "timer" || n.t === "group") n = i === 0 ? n.inner : null;
    else return null;
  }
  return n;
}
function kids(n) { return n.t === "series" ? n.items : n.t === "parallel" ? n.branches : n.t === "timer" || n.t === "group" ? [n.inner] : null; }
function withKids(n, list) {
  if (n.t === "series") return series(list);
  if (n.t === "parallel") return parallel(list);
  if (n.t === "timer" || n.t === "group") return list[0] ? { ...n, inner: list[0] } : null;
  return n;
}
/** Replace the node at path (null = delete it); structure is normalized on the way up. */
export function replaceAt(net, path, node) {
  if (!path.length) return node;
  const [i, ...rest] = path;
  const ks = kids(net);
  if (!ks) return net;
  const copy = [...ks];
  const sub = replaceAt(copy[i], rest, node);
  if (sub === null) copy.splice(i, 1); else copy[i] = sub;
  return withKids(net, copy);
}
/** Insert a node in series before / after the node at path. */
export function insertSeries(net, path, node, after = true) {
  if (!net) return node;
  const target = getAt(net, path);
  if (!target) return series([net, node]);
  const parentPath = path.slice(0, -1);
  const parent = path.length ? getAt(net, parentPath) : null;
  if (parent && parent.t === "series") {
    const i = path[path.length - 1];
    const items = [...parent.items];
    items.splice(after ? i + 1 : i, 0, node);
    return replaceAt(net, parentPath, series(items));
  }
  return replaceAt(net, path, series(after ? [target, node] : [node, target]));
}
/** Put a new branch in parallel with the node at path (the classic OR branch). */
export function insertParallel(net, path, node) {
  if (!net) return node;
  const target = getAt(net, path);
  const parentPath = path.slice(0, -1);
  const parent = path.length ? getAt(net, parentPath) : null;
  if (parent && parent.t === "parallel") {
    return replaceAt(net, parentPath, parallel([...parent.branches, node]));
  }
  return replaceAt(net, path, parallel([target, node]));
}
export function deleteAt(net, path) {
  if (!path.length) return null;
  return replaceAt(net, path, null);
}
/** Wrap the node at path in a timer box / group. */
export function wrapAt(net, path, wrapper) {
  const target = getAt(net, path);
  return replaceAt(net, path, { ...wrapper, inner: target });
}
/** Remove a wrapper (timer / group) and keep what is inside. */
export function unwrapAt(net, path) {
  const target = getAt(net, path);
  if (!target || !(target.t === "timer" || target.t === "group")) return net;
  return replaceAt(net, path, target.inner);
}

/** Every address-like name a network reads (for live values and the cross reference). */
export function namesIn(net, out = []) {
  if (!net) return out;
  switch (net.t) {
    case "contact": out.push(net.name); break;
    case "cmp": for (const s of [net.a, net.b]) for (const t of tokenizeExpr(s)) if (t.type === "Ident") out.push(t.raw || t.text); break;
    case "timer": case "group": namesIn(net.inner, out); break;
    case "series": net.items.forEach((x) => namesIn(x, out)); break;
    case "parallel": net.branches.forEach((x) => namesIn(x, out)); break;
    default: break;
  }
  return out;
}

export const NEW_CONTACT = () => ({ t: "contact", name: "", nc: false, edge: null });
