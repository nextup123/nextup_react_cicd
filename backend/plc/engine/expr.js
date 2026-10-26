// expr.js -- the `when:` expression language of a rung (port of nextplc/expr.cpp).
//
//   gpio1.di1 AND NOT M10            contacts in series, normally closed with NOT
//   gpio1.di1 OR (M10 AND S.AUTO)    parallel branches, brackets as in maths
//   RISE(gpio1.di5)  FALL(x)         one scan at the 0->1 / 1->0 change
//   ON_FOR(x, 500ms) OFF_FOR(x, 2s)  x has been 1 / 0 for at least that long
//   ON_FOR(x, R10)                   the same, the time taken from register R10 in milliseconds
//   R0 >= R2   R1 == 3   M10 != 0    compare: == (or =), !=, <, <=, >, >=
//   R0 * 2 + R1 - 1                  arithmetic: + - * / %
//   seq.seq1.step == 3  seq.seq1.s2  state of a sequence (resolved by the loader)
//   TRUE  FALSE
//
// Values: a bit is a JS boolean, a number is an int32. Edge / timer memory lives inside the
// expression node: one expression is evaluated once per scan by the rung or step that owns it.

import { kI, kQ, kM, kR, kS, parseAddress, normalizeName, isBit } from "./image.js";
import { RTrig, FTrig, OnFor } from "./blocks.js";

export const asBool = (v) => v !== 0 && v !== false;
export const asInt = (v) => (typeof v === "boolean" ? (v ? 1 : 0) : v | 0);

/** Read a value from the image for every readable address. ctx = { img, seqs } */
export function readValue(ctx, a) {
  const im = ctx.img;
  switch (a.area) {
    case "I": return a.index < kI && im.I[a.index];
    case "Q": return a.index < kQ && im.Q[a.index];
    case "M": return a.index < kM && im.M[a.index];
    case "S": return a.index < kS && im.S[a.index];
    case "R": return a.index < kR ? im.R[a.index] : 0;
    case "SEQ_STEP": return ctx.seqs && a.index < ctx.seqs.length ? ctx.seqs[a.index].step : 0;
    case "SEQ_ACTIVE": return Boolean(ctx.seqs && a.index < ctx.seqs.length && ctx.seqs[a.index].step !== 0);
    case "SEQ_STEPBIT": return Boolean(ctx.seqs && a.index < ctx.seqs.length && ctx.seqs[a.index].step === a.sub);
    default: return false;
  }
}

/** "500ms", "2s", "1.5s", "1min" -> { ok, seconds } / { ok:false, err }. A bare number is refused. */
export function parseDuration(text) {
  const s = normalizeName(text);
  let i = 0;
  while (i < s.length && /[0-9.]/.test(s[i])) i++;
  if (i === 0) return { ok: false, err: `'${text}' is not a time (write 500ms, 2s, 1.5s or 1min)` };
  const n = parseFloat(s.slice(0, i));
  const unit = s.slice(i);
  let seconds;
  if (unit === "ms") seconds = n / 1000;
  else if (unit === "s" || unit === "sec") seconds = n;
  else if (unit === "min") seconds = n * 60;
  else return { ok: false, err: `'${text}': time needs a unit: ms, s or min` };
  if (seconds < 0 || Number.isNaN(seconds)) return { ok: false, err: `'${text}': time must be positive` };
  return { ok: true, seconds };
}

// ------------------------------------------------------------------ AST nodes
export class Const {
  constructor(v) { this.kind = "const"; this.v = v; }
  eval() { return this.v; }
  reset() {}
  collect() {}
  isBool() { return typeof this.v === "boolean"; }
}
export class Ref {
  constructor(a, text) { this.kind = "ref"; this.a = a; this.text = text; }
  eval(ctx) { return readValue(ctx, this.a); }
  reset() {}
  collect(out) { out.push(this.a); }
  isBool() { return isBit(this.a); }
}
export class Not {
  constructor(x) { this.kind = "not"; this.x = x; }
  eval(c, dt) { return !asBool(this.x.eval(c, dt)); }
  reset() { this.x.reset(); }
  collect(o) { this.x.collect(o); }
  isBool() { return true; }
}
export class Neg {
  constructor(x) { this.kind = "neg"; this.x = x; }
  eval(c, dt) { return (-asInt(this.x.eval(c, dt))) | 0; }
  reset() { this.x.reset(); }
  collect(o) { this.x.collect(o); }
  isBool() { return false; }
}
/** AND / OR: both sides are always evaluated so edge and timer memory inside keeps running. */
export class Logic {
  constructor(isAnd, a, b) { this.kind = isAnd ? "and" : "or"; this.is_and = isAnd; this.a = a; this.b = b; }
  eval(c, dt) {
    const x = asBool(this.a.eval(c, dt));
    const y = asBool(this.b.eval(c, dt));
    return this.is_and ? x && y : x || y;
  }
  reset() { this.a.reset(); this.b.reset(); }
  collect(o) { this.a.collect(o); this.b.collect(o); }
  isBool() { return true; }
}
export class Cmp {
  constructor(op, a, b) { this.kind = "cmp"; this.op = op; this.a = a; this.b = b; }
  eval(c, dt) {
    const x = asInt(this.a.eval(c, dt));
    const y = asInt(this.b.eval(c, dt));
    switch (this.op) {
      case "==": return x === y;
      case "!=": return x !== y;
      case "<": return x < y;
      case "<=": return x <= y;
      case ">": return x > y;
      default: return x >= y;
    }
  }
  reset() { this.a.reset(); this.b.reset(); }
  collect(o) { this.a.collect(o); this.b.collect(o); }
  isBool() { return true; }
}
const INT32_MAX = 2147483647, INT32_MIN = -2147483648;
export class Arith {
  constructor(op, a, b) { this.kind = "arith"; this.op = op; this.a = a; this.b = b; }
  eval(c, dt) {
    const x = asInt(this.a.eval(c, dt));
    const y = asInt(this.b.eval(c, dt));
    let r;
    switch (this.op) {
      case "+": r = x + y; break;
      case "-": r = x - y; break;
      case "*": r = x * y; break;
      case "/": r = y === 0 ? 0 : Math.trunc(x / y); break; // division by zero gives 0, never a crash
      default: r = y === 0 ? 0 : x % y; break;
    }
    return Math.max(INT32_MIN, Math.min(INT32_MAX, r)) | 0;
  }
  reset() { this.a.reset(); this.b.reset(); }
  collect(o) { this.a.collect(o); this.b.collect(o); }
  isBool() { return false; }
}
export class Rise {
  constructor(x) { this.kind = "rise"; this.x = x; this.t = new RTrig(); }
  eval(c, dt) { return this.t.run(asBool(this.x.eval(c, dt))); }
  reset() { this.t.reset(); this.x.reset(); }
  collect(o) { this.x.collect(o); }
  isBool() { return true; }
}
export class Fall {
  constructor(x) { this.kind = "fall"; this.x = x; this.t = new FTrig(); }
  eval(c, dt) { return this.t.run(asBool(this.x.eval(c, dt))); }
  reset() { this.t.reset(); this.x.reset(); }
  collect(o) { this.x.collect(o); }
  isBool() { return true; }
}
export class ForTime {
  constructor(on, x, presetS, msExpr = null, timeText = "") {
    this.kind = on ? "on_for" : "off_for"; this.on = on; this.x = x; this.ms = msExpr; this.t = new OnFor(presetS); this.timeText = timeText;
  }
  eval(c, dt) {
    if (this.ms) this.t.preset_s = Math.max(0, asInt(this.ms.eval(c, dt))) / 1000;
    const input = asBool(this.x.eval(c, dt));
    return this.t.run(this.on ? input : !input, dt);
  }
  reset() { this.t.reset(); this.x.reset(); if (this.ms) this.ms.reset(); }
  collect(o) { this.x.collect(o); if (this.ms) this.ms.collect(o); }
  isBool() { return true; }
}

// ------------------------------------------------------------------ tokenizer
const isIdentStart = (c) => /[A-Za-z_]/.test(c);
const isIdentChar = (c) => /[A-Za-z0-9_.]/.test(c);

export function tokenize(s) {
  const out = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (/\s/.test(c)) { i++; continue; }
    const t = { type: "End", text: "", number: 0, col: i + 1 };
    if (c === "(") { t.type = "LParen"; i++; }
    else if (c === ")") { t.type = "RParen"; i++; }
    else if (c === ",") { t.type = "Comma"; i++; }
    else if (isIdentStart(c)) {
      let j = i;
      while (j < s.length && isIdentChar(s[j])) j++;
      t.type = "Ident";
      t.text = normalizeName(s.slice(i, j));
      t.raw = s.slice(i, j);
      i = j;
    } else if (/[0-9]/.test(c)) {
      let j = i;
      while (j < s.length && /[0-9.]/.test(s[j])) j++;
      let k = j;
      while (k < s.length && /[A-Za-z]/.test(s[k])) k++;
      if (k > j) {
        t.type = "Duration";
        t.text = s.slice(i, k);
        const d = parseDuration(t.text);
        if (!d.ok) throw new Error(`column ${t.col}: ${d.err}`);
        t.number = d.seconds;
      } else {
        t.type = "Number";
        t.text = s.slice(i, j);
        if (t.text.includes(".")) throw new Error(`column ${t.col}: '${t.text}' - only whole numbers (or a time like 1.5s)`);
        t.number = parseFloat(t.text);
      }
      i = k;
    } else {
      const two = ["==", "!=", "<=", ">=", "&&", "||"];
      const op2 = two.find((op) => s.startsWith(op, i));
      if (op2) { t.type = "Op"; t.text = op2; i += 2; }
      else {
        if (!"<>=+-*/%!".includes(c)) throw new Error(`column ${t.col}: unexpected character '${c}'`);
        t.type = "Op"; t.text = c; i++;
      }
    }
    out.push(t);
  }
  out.push({ type: "End", text: "", number: 0, col: s.length + 1 });
  return out;
}

// ------------------------------------------------------------------ parser
//   or   := and ( OR and )*
//   and  := not ( AND not )*
//   not  := NOT not | cmp
//   cmp  := add ( (== != < <= > >=) add )?
//   add  := mul ( (+ -) mul )*
//   mul  := unary ( (* / %) unary )*
//   unary:= - unary | primary
//   prim := ( or ) | FUNC ( ... ) | number | TRUE | FALSE | name
class Parser {
  constructor(toks, resolve) { this.t = toks; this.p = 0; this.resolve = resolve; }
  cur() { return this.t[this.p]; }
  next() { if (this.p + 1 < this.t.length) this.p++; }
  fail(what) { throw new Error(`column ${this.cur().col}: ${what}`); }
  isKeyword(kw) { return this.cur().type === "Ident" && this.cur().text === kw; }
  isOp(op) { return this.cur().type === "Op" && this.cur().text === op; }
  expect(type, what) { if (this.cur().type !== type) this.fail(`expected ${what}`); this.next(); }
  needBool(e, where) { if (!e.isBool()) this.fail(`${where} needs a bit (use a comparison for a number, e.g. R0 > 0)`); }

  parse() {
    const out = this.parseOr();
    if (this.cur().type !== "End") this.fail(`unexpected '${this.cur().text}'`);
    return out;
  }
  parseOr() {
    let lhs = this.parseAnd();
    while (this.isKeyword("or") || this.isOp("||")) {
      this.next();
      const rhs = this.parseAnd();
      this.needBool(lhs, "OR"); this.needBool(rhs, "OR");
      lhs = new Logic(false, lhs, rhs);
    }
    return lhs;
  }
  parseAnd() {
    let lhs = this.parseNot();
    while (this.isKeyword("and") || this.isOp("&&")) {
      this.next();
      const rhs = this.parseNot();
      this.needBool(lhs, "AND"); this.needBool(rhs, "AND");
      lhs = new Logic(true, lhs, rhs);
    }
    return lhs;
  }
  parseNot() {
    if (this.isKeyword("not") || this.isOp("!")) {
      this.next();
      const x = this.parseNot();
      this.needBool(x, "NOT");
      return new Not(x);
    }
    return this.parseCmp();
  }
  parseCmp() {
    const lhs = this.parseAdd();
    if (this.cur().type === "Op") {
      const op = this.cur().text;
      const map = { "==": "==", "=": "==", "!=": "!=", "<": "<", "<=": "<=", ">": ">", ">=": ">=" };
      if (map[op]) {
        this.next();
        const rhs = this.parseAdd();
        return new Cmp(map[op], lhs, rhs);
      }
    }
    return lhs;
  }
  parseAdd() {
    let lhs = this.parseMul();
    while (this.isOp("+") || this.isOp("-")) {
      const op = this.cur().text; this.next();
      lhs = new Arith(op, lhs, this.parseMul());
    }
    return lhs;
  }
  parseMul() {
    let lhs = this.parseUnary();
    while (this.isOp("*") || this.isOp("/") || this.isOp("%")) {
      const op = this.cur().text; this.next();
      lhs = new Arith(op, lhs, this.parseUnary());
    }
    return lhs;
  }
  parseUnary() {
    if (this.isOp("-")) { this.next(); return new Neg(this.parseUnary()); }
    return this.parsePrimary();
  }
  parsePrimary() {
    const tok = this.cur();
    if (tok.type === "LParen") {
      this.next();
      const e = this.parseOr();
      this.expect("RParen", "')'");
      return e;
    }
    if (tok.type === "Number") { this.next(); return new Const(tok.number | 0); }
    if (tok.type === "Duration") this.fail(`a time (${tok.text}) is only allowed inside ON_FOR / OFF_FOR`);
    if (tok.type !== "Ident") this.fail(tok.type === "End" ? "expression ends too early" : `unexpected '${tok.text}'`);
    const name = tok.text;
    if (name === "true" || name === "false") { this.next(); return new Const(name === "true"); }
    if (name === "rise" || name === "fall") {
      const up = name === "rise" ? "RISE" : "FALL";
      this.next();
      this.expect("LParen", `'(' after ${up}`);
      const x = this.parseOr();
      this.needBool(x, up);
      this.expect("RParen", "')'");
      return name === "rise" ? new Rise(x) : new Fall(x);
    }
    if (name === "on_for" || name === "off_for") {
      const on = name === "on_for";
      const up = on ? "ON_FOR" : "OFF_FOR";
      this.next();
      this.expect("LParen", `'(' after ${up}`);
      const x = this.parseOr();
      this.needBool(x, up);
      this.expect("Comma", "',' and a time, e.g. ON_FOR(x, 500ms) or ON_FOR(x, R10)");
      if (this.cur().type === "Duration") {
        const secs = this.cur().number, txt = this.cur().text;
        this.next();
        this.expect("RParen", "')'");
        return new ForTime(on, x, secs, null, txt);
      }
      if (this.cur().type === "Number") this.fail("a time needs a unit (500ms, 2s) or a register in milliseconds (R10)");
      const msTok = this.cur();
      const ms = this.parseAdd();
      if (ms.isBool()) this.fail("the time of ON_FOR / OFF_FOR must be a time (500ms) or a register in ms (R10), not a bit");
      this.expect("RParen", "')'");
      return new ForTime(on, x, 0, ms, msTok.raw || msTok.text);
    }
    if (name === "and" || name === "or" || name === "not") this.fail(`unexpected '${name}'`);
    const r = this.resolve(tok.raw || name);
    if (!r.ok) this.fail(r.err);
    this.next();
    return new Ref(r.addr, tok.raw || name);
  }
}

/**
 * Parse an expression. `resolve(name)` -> { ok, addr } | { ok:false, err } (raw addresses, aliases, seq.*).
 * Returns { ok: true, expr } or { ok: false, err } (err carries the column).
 */
export function parseExpr(text, resolve = (n) => parseAddress(n)) {
  let toks;
  try { toks = tokenize(String(text)); } catch (e) { return { ok: false, err: e.message }; }
  if (toks.length === 1) return { ok: false, err: "empty expression" };
  try { return { ok: true, expr: new Parser(toks, resolve).parse() }; }
  catch (e) { return { ok: false, err: e.message }; }
}
