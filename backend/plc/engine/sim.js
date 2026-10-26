// sim.js -- scenario runner (port of nextplc/sim.cpp). Runs the real engine against a script of
// inputs, sensor models and expectations. No ROS, no hardware.
//
//   SUPERVISOR AUTO / SAFEAUTO / JOG / OFF / RESET / MANUAL / MODEL / ARMED 1 ...
//   INPUTS OK | STALE          SET x v   PULSE x 100ms   LINK a -> b AFTER 300ms [INVERT]   UNLINK b
//   TOGGLE x EVERY 200ms   STOP TOGGLE x   AT 1500ms   WAIT 500ms   RUN 2s   PRINT "..."
//   EXPECT x v [WITHIN t]   EXPECT x STAYS v FOR t   EXPECT [NO] ALARM bit [WITHIN t | FOR t]   EXPECT [NO] EMERGENCY

import { kQ, kM, kR, S, addr as mkAddr, addrEq } from "./image.js";
import { parseDuration } from "./expr.js";

class SimError extends Error {
  constructor(line, m) { super(`line ${line}: ${m}`); this.line = line; }
}
const upper = (s) => s.toUpperCase();

function words(line) {
  const out = [];
  let cur = "", quoted = false;
  for (const c of line) {
    if (quoted) {
      if (c === '"') { quoted = false; out.push('"' + cur); cur = ""; }
      else cur += c;
      continue;
    }
    if (c === "#") break;
    if (c === '"') { quoted = true; continue; }
    if (/\s/.test(c) || c === ",") { if (cur) { out.push(cur); cur = ""; } continue; }
    cur += c;
  }
  if (quoted) throw new Error("missing closing quote");
  if (cur) out.push(cur);
  return out;
}
function parseValue(s) {
  const u = upper(s);
  if (u === "ON" || u === "TRUE") return 1;
  if (u === "OFF" || u === "FALSE") return 0;
  if (!/^-?[0-9]+$/.test(u)) return null;
  return parseInt(s, 10);
}

class Runner {
  constructor(engine, opt, res) {
    this.eng = engine; this.opt = { scan_s: 0.01, csv: false, ...opt }; this.res = res;
    this.t_ms = 0;
    this.watch = []; this.links = []; this.deliveries = []; this.toggles = [];
    this.alarms = []; this.emergencies = 0; this.em_checked = 0; this.al_checked = 0;
    this.sup_model = true; this.pending_scan = false; this.emergency_due_ms = -1;
    this.csv = []; this.csv_header = false;
    this.onScan = opt.onScan || null;
  }

  run(scenario) {
    for (let q = 0; q < kQ; q++) this.addWatch(mkAddr("Q", q));
    this.addWatch(mkAddr("S", S.SAFE_STATE));
    this.addWatch(mkAddr("S", S.PLC_EMERGENCY));
    if (this.eng.program) for (let i = 0; i < this.eng.program.sequences.length; i++) this.addWatch(mkAddr("SEQ_STEP", i));
    this.eng.setSystem(S.SUPERVISOR_OK, true);
    this.eng.setSystem(S.DI_OK, true);
    this.eng.setSystem(S.AUTO, true);
    this.scan();
    const lines = String(scenario).split("\n");
    for (let ln = 1; ln <= lines.length; ln++) {
      let w;
      try { w = words(lines[ln - 1]); } catch (e) { throw new SimError(ln, e.message); }
      if (!w.length) continue;
      this.statement(ln, w);
    }
    this.res.csv = this.csv.join("");
    this.res.end_ms = this.t_ms;
    this.res.ok = this.res.checks.every((c) => c.ok);
  }

  resolve(ln, name) {
    const r = this.eng.resolve(name);
    if (!r.ok) throw new SimError(ln, r.err);
    return r.addr;
  }
  value(a) {
    const im = this.eng.image();
    const seqs = this.eng.sequences();
    switch (a.area) {
      case "I": return im.I[a.index] ? 1 : 0;
      case "Q": return this.eng.outputs()[a.index] ? 1 : 0;
      case "M": return im.M[a.index] ? 1 : 0;
      case "R": return im.R[a.index];
      case "S": return im.S[a.index] ? 1 : 0;
      case "SEQ_STEP": return a.index < seqs.length ? seqs[a.index].step : 0;
      case "SEQ_ACTIVE": return a.index < seqs.length && seqs[a.index].step > 0 ? 1 : 0;
      case "SEQ_STEPBIT": return a.index < seqs.length && seqs[a.index].step === a.sub ? 1 : 0;
      default: return 0;
    }
  }
  timeMs(ln, s) {
    const d = parseDuration(s);
    if (!d.ok) throw new SimError(ln, `'${s}': ${d.err}`);
    return d.seconds * 1000;
  }
  name(a) { return this.eng.displayName(a); }

  addWatch(a) {
    if (this.watch.some((w) => addrEq(w.a, a))) return;
    this.watch.push({ a, last: this.value(a) });
  }
  log(text) {
    this.res.log.push({ t_ms: this.t_ms, text });
  }
  logChanges() {
    for (const w of this.watch) {
      const v = this.value(w.a);
      if (v !== w.last) { this.log(`${this.name(w.a)} = ${v}`); w.last = v; }
    }
  }
  csvRow() {
    if (!this.opt.csv) return;
    if (!this.csv_header) { this.csv.push("time_ms" + this.watch.map((w) => "," + this.name(w.a)).join("") + "\n"); this.csv_header = true; }
    this.csv.push(String(Math.round(this.t_ms)) + this.watch.map((w) => "," + this.value(w.a)).join("") + "\n");
  }

  scan() {
    const dt = this.opt.scan_s;
    this.t_ms += dt * 1000;
    for (let i = 0; i < this.deliveries.length;) {
      if (this.deliveries[i].at_ms <= this.t_ms + 1e-6) {
        this.writeBit(this.deliveries[i].to, this.deliveries[i].v, this.deliveries[i].why);
        this.deliveries.splice(i, 1);
      } else i++;
    }
    for (const tg of this.toggles) {
      if (tg.next_ms <= this.t_ms + 1e-6) { this.writeBit(tg.a, !this.value(tg.a), "TOGGLE"); tg.next_ms += tg.period_ms; }
    }
    if (this.sup_model && this.emergency_due_ms >= 0 && this.emergency_due_ms <= this.t_ms + 1e-6) {
      this.eng.setSystem(S.EMERGENCY, true);
      this.emergency_due_ms = -1;
      this.log("supervisor: emergency latched (S.EMERGENCY = 1)");
    }
    this.eng.scan(dt);
    this.res.scans++;
    this.pending_scan = false;
    for (const r of this.eng.takeEmergencyRequests()) {
      this.log(`EMERGENCY REQUEST: ${r.text}  [${r.rung}]`);
      this.emergencies++;
      if (this.sup_model && this.emergency_due_ms < 0 && !this.eng.image().S[S.EMERGENCY]) this.emergency_due_ms = this.t_ms + 20;
    }
    for (const a of this.eng.takeAlarms()) {
      this.log(`${a.active ? "ALARM " : "alarm cleared "}${a.bit}: ${a.text}`);
      if (a.active) this.alarms.push(a.bit);
    }
    for (const l of this.links) {
      const v = this.value(l.from);
      if (v !== l.last_from) {
        l.last_from = v;
        this.deliveries.push({ at_ms: this.t_ms + l.delay_ms, to: l.to, v: (v !== 0) !== l.invert, why: `LINK ${this.name(l.from)} after ${Math.trunc(l.delay_ms)}ms` });
      }
    }
    this.logChanges();
    this.csvRow();
    if (this.onScan) this.onScan(this.t_ms);
  }
  runUntil(untilMs) {
    while (this.t_ms + this.opt.scan_s * 1000 <= untilMs + 1e-6) this.scan();
  }
  writeBit(a, v, why) {
    if (!why) this.pending_scan = true;
    if (a.area === "I") this.eng.setInput(a.index, v);
    else if (a.area === "S") this.eng.setSystem(a.index, v);
    else {
      const r = this.eng.requestWrite(this.name(a), v ? 1 : 0, 0);
      if (!r.ok) this.log(`write refused: ${r.err}`);
    }
    if (why) {
      const watched = this.watch.some((w) => addrEq(w.a, a));
      if (!watched) this.log(`${this.name(a)} = ${v ? 1 : 0}   (${why})`);
      else this.log(`(${why}) -> ${this.name(a)} = ${v ? 1 : 0}`);
    }
  }

  statement(ln, w) {
    const kw = upper(w[0]);
    const need = (n, usage) => { if (w.length < n) throw new SimError(ln, `usage: ${usage}`); };
    if (kw === "SCAN") {
      need(2, "SCAN 10ms");
      this.opt.scan_s = this.timeMs(ln, w[1]) / 1000;
      if (this.opt.scan_s <= 0) throw new SimError(ln, "SCAN must be > 0");
      return;
    }
    if (kw === "WATCH") {
      for (let i = 1; i < w.length; i++) {
        if (upper(w[i]) === "ALL") {
          for (let m = 0; m < kM; m++) this.addWatch(mkAddr("M", m));
          for (let r = 0; r < kR; r++) this.addWatch(mkAddr("R", r));
          continue;
        }
        this.addWatch(this.resolve(ln, w[i]));
      }
      return;
    }
    if (kw === "PRINT") {
      this.log(w.slice(1).map((x) => (x.startsWith('"') ? x.slice(1) : x)).join(" "));
      return;
    }
    if (kw === "SUPERVISOR") {
      need(2, "SUPERVISOR AUTO | SAFEAUTO | JOG | OFF | RESET | MANUAL | ARMED 1 | EMERGENCY 1 | ESTOP 1 | STANDSTILL 1 | FAULT 1");
      const what = upper(w[1]);
      const profile = (a, s, j) => { this.eng.setSystem(S.AUTO, a); this.eng.setSystem(S.SAFEAUTO, s); this.eng.setSystem(S.JOG, j); this.eng.setSystem(S.SUPERVISOR_OK, true); };
      if (what === "AUTO") profile(true, false, false);
      else if (what === "SAFEAUTO") profile(false, true, false);
      else if (what === "JOG") profile(false, false, true);
      else if (what === "OFF") { profile(false, false, false); this.eng.setSystem(S.SUPERVISOR_OK, false); this.eng.setSystem(S.EMERGENCY, true); }
      else if (what === "RESET") { this.eng.setSystem(S.EMERGENCY, false); this.eng.setSystem(S.ESTOP, false); this.eng.setSystem(S.ANY_FAULT, false); this.emergency_due_ms = -1; }
      else if (what === "MANUAL") this.sup_model = false;
      else if (what === "MODEL") this.sup_model = true;
      else {
        need(3, "SUPERVISOR ARMED 1");
        const v = parseValue(w[2]);
        if (v === null) throw new SimError(ln, `'${w[2]}' is not 0/1`);
        if (what === "ARMED") this.eng.setSystem(S.ARMED, v !== 0);
        else if (what === "EMERGENCY") { this.eng.setSystem(S.EMERGENCY, v !== 0); if (!v) this.emergency_due_ms = -1; }
        else if (what === "ESTOP") this.eng.setSystem(S.ESTOP, v !== 0);
        else if (what === "STANDSTILL") this.eng.setSystem(S.STANDSTILL, v !== 0);
        else if (what === "FAULT") this.eng.setSystem(S.ANY_FAULT, v !== 0);
        else throw new SimError(ln, `SUPERVISOR: unknown '${w[1]}'`);
      }
      this.pending_scan = true;
      this.log(`SUPERVISOR ${upper(w[1])}${w.length > 2 ? " " + w[2] : ""}`);
      return;
    }
    if (kw === "INPUTS") {
      need(2, "INPUTS OK | INPUTS STALE");
      const ok = upper(w[1]) === "OK";
      this.eng.setSystem(S.DI_OK, ok);
      this.eng.hold(!ok);
      this.pending_scan = true;
      this.log(`INPUTS ${upper(w[1])}`);
      return;
    }
    if (kw === "SET") {
      need(3, "SET <name> <value>");
      const a = this.resolve(ln, w[1]);
      const v = parseValue(w[2]);
      if (v === null) throw new SimError(ln, `'${w[2]}' is not a value (0, 1, ON, OFF or a number)`);
      if (a.area === "Q") throw new SimError(ln, `${this.name(a)} is a physical output: it is driven by the program, SET its inputs instead`);
      if (a.area === "I" || a.area === "S") this.writeBit(a, v !== 0, "");
      else {
        const r = this.eng.requestWrite(w[1], v, 0);
        if (!r.ok) throw new SimError(ln, `SET refused: ${r.err}`);
      }
      this.pending_scan = true;
      this.log(`SET ${this.name(a)} = ${v}`);
      return;
    }
    if (kw === "PULSE") {
      need(3, "PULSE <bit> 100ms");
      const a = this.resolve(ln, w[1]);
      const ms = this.timeMs(ln, w[2]);
      if (a.area === "I" || a.area === "S") {
        this.writeBit(a, true, "");
        this.deliveries.push({ at_ms: this.t_ms + ms, to: a, v: false, why: "end of PULSE" });
      } else {
        const r = this.eng.requestWrite(w[1], 1, ms / 1000);
        if (!r.ok) throw new SimError(ln, `PULSE refused: ${r.err}`);
      }
      this.pending_scan = true;
      this.log(`PULSE ${this.name(a)} ${w[2]}`);
      return;
    }
    if (kw === "LINK") {
      need(5, "LINK gpio1.do1 -> gpio1.di2 AFTER 300ms [INVERT]");
      let i = 1;
      const from = this.resolve(ln, w[i++]);
      if (w[i] === "->") i++;
      const to = this.resolve(ln, w[i++]);
      if (to.area !== "I" && to.area !== "M") throw new SimError(ln, "LINK: the target must be an input (or an M bit)");
      let ms = 0, invert = false;
      while (i < w.length) {
        const k = upper(w[i]);
        if (k === "AFTER" && i + 1 < w.length) { ms = this.timeMs(ln, w[i + 1]); i += 2; }
        else if (k === "INVERT" || k === "INVERTED") { invert = true; i++; }
        else throw new SimError(ln, `LINK: unexpected '${w[i]}'`);
      }
      this.links.push({ from, to, delay_ms: ms, invert, last_from: this.value(from) });
      this.writeBit(to, (this.value(from) !== 0) !== invert, "");
      this.log(`LINK ${this.name(from)} -> ${this.name(to)} after ${Math.trunc(ms)}ms${invert ? " inverted" : ""}`);
      return;
    }
    if (kw === "UNLINK") {
      need(2, "UNLINK gpio1.di2   (the sensor no longer follows the output)");
      const a = this.resolve(ln, w[1]);
      this.links = this.links.filter((l) => !addrEq(l.to, a));
      this.deliveries = this.deliveries.filter((d) => !(addrEq(d.to, a) && d.why.startsWith("LINK")));
      this.log(`UNLINK ${this.name(a)}`);
      return;
    }
    if (kw === "TOGGLE") {
      need(4, "TOGGLE gpio1.di6 EVERY 200ms");
      const a = this.resolve(ln, w[1]);
      const ms = this.timeMs(ln, w[3]);
      if (ms <= 0) throw new SimError(ln, "TOGGLE period must be > 0");
      this.toggles.push({ a, period_ms: ms, next_ms: this.t_ms + ms });
      this.log(`TOGGLE ${this.name(a)} every ${w[3]}`);
      return;
    }
    if (kw === "STOP") {
      need(3, "STOP TOGGLE gpio1.di6");
      const a = this.resolve(ln, w[2]);
      this.toggles = this.toggles.filter((t) => !addrEq(t.a, a));
      this.log(`STOP TOGGLE ${this.name(a)}`);
      return;
    }
    if (kw === "AT") {
      need(2, "AT 1500ms");
      const ms = this.timeMs(ln, w[1]);
      if (ms < this.t_ms - 1e-6) throw new SimError(ln, `AT ${w[1]} is in the past (now ${Math.trunc(this.t_ms)} ms)`);
      this.runUntil(ms);
      return;
    }
    if (kw === "WAIT" || kw === "RUN") {
      need(2, "WAIT 500ms");
      this.runUntil(this.t_ms + this.timeMs(ln, w[1]));
      return;
    }
    if (kw === "EXPECT") { this.expect(ln, w, w.join(" ")); return; }
    throw new SimError(ln, `unknown statement '${w[0]}' (SCAN WATCH SUPERVISOR INPUTS SET PULSE LINK UNLINK TOGGLE STOP AT WAIT RUN EXPECT PRINT)`);
  }

  check(ln, text, ok, detail) {
    this.res.checks.push({ line: ln, text, ok, t_ms: this.t_ms, detail });
    this.log(`${ok ? "OK    " : "FAIL  "}${text}${detail ? `   (${detail})` : ""}`);
  }

  expect(ln, w, text) {
    if (this.pending_scan) this.scan();
    if (w.length < 2) throw new SimError(ln, "usage: EXPECT <name> <value> [WITHIN t | STAYS v FOR t], EXPECT ALARM <bit>, EXPECT EMERGENCY");
    let i = 1, negate = false;
    if (upper(w[1]) === "NO") { negate = true; i++; }
    const what = i < w.length ? upper(w[i]) : "";
    const tick = () => this.t_ms + this.opt.scan_s * 1000;

    if (what === "EMERGENCY" || what === "ALARM") {
      i++;
      let bit = "";
      if (what === "ALARM") {
        if (i >= w.length) throw new SimError(ln, "EXPECT ALARM needs the alarm bit");
        bit = this.name(this.resolve(ln, w[i++]));
      }
      let window = 0;
      if (i < w.length && (upper(w[i]) === "WITHIN" || upper(w[i]) === "FOR") && i + 1 < w.length) window = this.timeMs(ln, w[i + 1]);
      const em0 = this.emergencies, al0 = this.alarms.length;
      const happened = () => {
        if (what === "EMERGENCY") return this.emergencies > em0;
        for (let k = al0; k < this.alarms.length; k++) if (this.alarms[k] === bit) return true;
        return false;
      };
      let seen = what === "EMERGENCY" ? this.emergencies > this.em_checked : false;
      if (what === "ALARM") for (let k = this.al_checked; k < this.alarms.length; k++) if (this.alarms[k] === bit) seen = true;
      const end = this.t_ms + window;
      while (!seen && !happened() && tick() <= end + 1e-6) this.scan();
      if (negate) {
        const ok = !(seen || happened());
        this.check(ln, text, ok, ok ? "" : `it happened at ${Math.trunc(this.t_ms)} ms`);
      } else {
        const ok = seen || happened();
        this.check(ln, text, ok, ok ? `at ${Math.trunc(this.t_ms)} ms` : "did not happen");
      }
      this.em_checked = this.emergencies;
      this.al_checked = this.alarms.length;
      return;
    }

    const a = this.resolve(ln, w[i++]);
    if (i >= w.length) throw new SimError(ln, `EXPECT ${w[1]}: missing the value`);
    if (upper(w[i]) === "STAYS") {
      i++;
      const v = i < w.length ? parseValue(w[i]) : null;
      if (v === null) throw new SimError(ln, "EXPECT ... STAYS needs a value");
      i++;
      if (i + 1 >= w.length || upper(w[i]) !== "FOR") throw new SimError(ln, "EXPECT ... STAYS <value> FOR <time>");
      const end = this.t_ms + this.timeMs(ln, w[i + 1]);
      let ok = this.value(a) === v;
      let badAt = this.t_ms;
      while (ok && tick() <= end + 1e-6) { this.scan(); if (this.value(a) !== v) { ok = false; badAt = this.t_ms; } }
      this.check(ln, text, ok, ok ? "" : `${this.name(a)} became ${this.value(a)} at ${Math.trunc(badAt)} ms`);
      return;
    }
    const v = parseValue(w[i]);
    if (v === null) throw new SimError(ln, `'${w[i]}' is not a value`);
    i++;
    if (i < w.length) {
      if (upper(w[i]) !== "WITHIN" || i + 1 >= w.length) throw new SimError(ln, "after the value only WITHIN <time> is allowed");
      const end = this.t_ms + this.timeMs(ln, w[i + 1]);
      while (this.value(a) !== v && tick() <= end + 1e-6) this.scan();
      const ok = this.value(a) === v;
      this.check(ln, text, ok, ok ? `at ${Math.trunc(this.t_ms)} ms` : `${this.name(a)} is still ${this.value(a)}`);
      return;
    }
    const ok = this.value(a) === v;
    this.check(ln, text, ok, ok ? "" : `${this.name(a)} is ${this.value(a)}`);
  }
}

/**
 * Run a scenario against an engine with a loaded program.
 * Returns { ok (= scenario ran), result: { ok (= all checks passed), end_ms, log: [{t_ms,text}], checks, csv, scans }, err }.
 */
export function runScenario(engine, scenario, opt = {}) {
  const result = { ok: false, end_ms: 0, log: [], checks: [], csv: "", scans: 0 };
  try {
    new Runner(engine, opt, result).run(scenario);
    return { ok: true, result };
  } catch (e) {
    return { ok: false, result, err: e.message || String(e), line: e.line };
  }
}

export function summary(r) {
  const failed = r.checks.filter((c) => !c.ok).length;
  const n = r.checks.length;
  if (failed === 0) return `PASS (${n} check${n === 1 ? "" : "s"}, ${(r.end_ms / 1000).toFixed(2)} s simulated, ${r.scans} scans)`;
  return `FAIL (${failed} of ${n} checks failed, ${(r.end_ms / 1000).toFixed(2)} s simulated)`;
}

/** Format a log line like nextplc_sim prints it: "    310 ms  text". */
export function formatLogLine(l) {
  return `${String(Math.round(l.t_ms)).padStart(7)} ms  ${l.text}`;
}
