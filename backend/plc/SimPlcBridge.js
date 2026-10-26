// plc/SimPlcBridge.js -- the simulated PLC: the JS port of the nextplc engine runs here at the
// scan time, with a simulated motion supervisor and a virtual input panel. Used when Simulation
// is the active mode (BridgeManager). Same public interface as PlcBridge, so the routes and the
// WebSocket handler never know the difference. Nothing here touches hardware.
import fs from "node:fs";
import path from "node:path";
import { EventEmitter } from "node:events";
import YAML from "yaml";
import {
  Engine, Loader, S, kI, kQ, kM, kR, kS, addr as mkAddr, allBitNames, allRegNames, addressName, parseAddress,
} from "./engine/index.js";
import { WS } from "./interfaces.js";
import { StatePusher, STATE_MS } from "./statePush.js";
import { PROGRAMS_DIR, PROJECT_PROGRAM, SIM_RETAIN_FILE as RETAIN_FILE, SIM_ACTIVE_FILE as ACTIVE_FILE, blockDirs } from "./paths.js";

const readFile = (p) => { try { return fs.readFileSync(p, "utf8"); } catch { return null; } };

export class SimPlcBridge {
  constructor(ws, { scanMs = 10 } = {}) {
    this.ws = ws;
    this.simulated = true;
    this.ready = false;
    this.events = new EventEmitter();
    this.engine = new Engine();
    this.scanMs = scanMs;
    this.programPath = "";
    this.programInfo = null;
    this.state = null;
    this.recentAlarms = [];
    this.eventLog = [];
    this.lastScanAt = 0;
    this.lastScanMs = 0;
    this.lastPeriodMs = 0;
    // the simulated supervisor
    this.sup = { profile: "AUTO", armed: true, emergency: false, estop: false, standstill: true, fault: false, ok: true };
    this.inputsStale = false;
    this.emergencyDueAt = -1;
    this.emergencyText = "";
    this.inputNames = allBitNames().slice(0, kI);
    this.retainSaveTimer = null;
    this.watched = false;
    this.pusher = new StatePusher(ws);
  }

  async init() {
    this.loadRetain();
    const active = this.activeProgramPath();
    if (active) await this.loadProgram(active, { quiet: true });
    else this.publishProgramInfo(false, "", "", "no program loaded");
    this.applySupervisor();
    this.ready = true;
    this.log("info", `simulated PLC ready, scan ${this.scanMs} ms`);
  }
  /** Run the scan (Simulation mode active). The image goes to the browser only while a
   *  NextPLC page is open (setWatched); the program keeps running either way. */
  start() {
    if (this.timer) return;
    this.lastScanAt = 0;
    this.timer = setInterval(() => this.tick(), this.scanMs);
    this.setWatched(this.watched);
    this.publishState();
    if (this.programInfo) this.ws.publishState(WS.program, this.programInfo);
    this.publishSim();
  }
  /** Stop the scan (Real mode active): nothing runs, nothing is published. */
  stop() {
    clearInterval(this.timer); clearInterval(this.stateTimer);
    this.timer = null; this.stateTimer = null;
  }
  setWatched(on) {
    this.watched = on;
    clearInterval(this.stateTimer);
    this.stateTimer = on && this.timer ? setInterval(() => this.publishState(), STATE_MS) : null;
    if (on) this.pusher.reset();
  }
  stateAge() { return 0; }

  // ---- scan ------------------------------------------------------------------
  tick() {
    const now = performance.now();
    const dt = this.lastScanAt ? (now - this.lastScanAt) / 1000 : this.scanMs / 1000;
    this.lastPeriodMs = this.lastScanAt ? now - this.lastScanAt : this.scanMs;
    this.lastScanAt = now;
    // supervisor model: an emergency request from the program is latched by the supervisor 20 ms later
    if (this.emergencyDueAt >= 0 && now >= this.emergencyDueAt) {
      this.emergencyDueAt = -1;
      if (!this.sup.emergency) {
        this.sup.emergency = true;
        this.applySupervisor();
        this.log("error", `supervisor: emergency latched (${this.emergencyText}) - reset with Reset fault`);
        this.publishSim();
      }
    }
    const t0 = performance.now();
    this.engine.scan(dt);
    this.lastScanMs = performance.now() - t0;
    for (const req of this.engine.takeEmergencyRequests()) {
      this.emergencyText = req.text;
      this.log("error", `EMERGENCY from the program: ${req.text} (${req.rung}) -> trigger_emergency, outputs to safe state`);
      this.ws.broadcast(WS.alarm, { bit: "S.PLC_EMERGENCY", text: `EMERGENCY: ${req.text}`, level: "error", active: true, time: Date.now() });
      this.ws.broadcast(WS.toast, { message: `PLC EMERGENCY: ${req.text}`, messageType: "failure", duration: 10 });
      if (this.emergencyDueAt < 0 && !this.sup.emergency) this.emergencyDueAt = performance.now() + 20;
    }
    for (const ev of this.engine.takeAlarms()) {
      const view = { bit: ev.bit, text: ev.text, level: ev.level, active: ev.active, time: Date.now() };
      this.recentAlarms.push(view);
      if (this.recentAlarms.length > 200) this.recentAlarms.shift();
      this.ws.broadcast(WS.alarm, view);
      if (ev.active) {
        this.log(ev.level === "info" ? "info" : ev.level === "warning" ? "warn" : "error", `ALARM ${ev.bit}: ${ev.text}`);
        if (ev.toast) this.ws.broadcast(WS.toast, { message: ev.text, messageType: ev.level === "info" ? "success" : "failure", duration: 10 });
      } else this.log("info", `alarm cleared ${ev.bit}`);
    }
    this.scheduleRetainSave();
  }

  applySupervisor() {
    const e = this.engine;
    const s = this.sup;
    e.setSystem(S.AUTO, s.ok && s.profile === "AUTO");
    e.setSystem(S.SAFEAUTO, s.ok && s.profile === "SAFEAUTO");
    e.setSystem(S.JOG, s.ok && s.profile === "JOG");
    e.setSystem(S.ARMED, s.ok && s.armed);
    e.setSystem(S.EMERGENCY, !s.ok || s.emergency);
    e.setSystem(S.ESTOP, s.estop);
    e.setSystem(S.STANDSTILL, s.standstill);
    e.setSystem(S.ANY_FAULT, s.fault);
    e.setSystem(S.SUPERVISOR_OK, s.ok);
    e.setSystem(S.DI_OK, !this.inputsStale);
    e.setSystem(S.IO_FAULT, this.inputsStale);
    e.hold(this.inputsStale);
  }

  // ---- state for the browser ----------------------------------------------------
  buildState() {
    const e = this.engine, im = e.image(), out = e.outputs(), p = e.program;
    const names = allBitNames();
    const bits = {}, forced = [], logicQ = {}, controlled = {};
    for (let i = 0; i < kI; i++) { bits[names[i]] = im.I[i] ? 1 : 0; if (e.inputForced(i)) forced.push(names[i]); }
    for (let q = 0; q < kQ; q++) {
      const n = names[kI + q];
      bits[n] = out[q] ? 1 : 0;
      if (e.outputForced(q)) forced.push(n);
      logicQ[n] = im.Q[q] ? 1 : 0;
      controlled[n] = e.outputUsed(q);
    }
    for (let m = 0; m < kM; m++) bits[names[kI + kQ + m]] = im.M[m] ? 1 : 0;
    for (let s = 0; s < kS; s++) bits[names[kI + kQ + kM + s]] = im.S[s] ? 1 : 0;
    const regs = {};
    allRegNames().forEach((n, r) => { regs[n] = im.R[r]; });
    const seqs = p ? p.sequences.map((s, i) => { const st = e.sequences()[i].step; return { name: s.name, step: st, step_name: st >= 1 && st <= s.steps.length ? s.steps[st - 1].name : "" }; }) : [];
    const rungs = p ? p.rungs.map((r) => ({ text: r.text, result: r.last_result })) : [];
    return {
      program: p ? p.name : "",
      program_ok: Boolean(p),
      safe_state: e.safeState(),
      scan_count: e.scanCount(),
      scan_time_ms: Math.round(this.lastScanMs * 100) / 100,
      scan_period_ms: Math.round(this.lastPeriodMs * 100) / 100,
      forced_count: e.forcedCount(),
      bits, forced, logic_q: logicQ, q_controlled: controlled, regs,
      aliases: p ? p.aliasTable() : [],
      seqs, rungs,
    };
  }
  /** The image is built only for a watching page (5 Hz) and sent when it changed. */
  publishState() {
    if (!this.watched) { this.state = null; return; }
    this.state = this.buildState();
    this.pusher.push(this.state);
  }
  publishSim() {
    this.ws.publishState(WS.sim, { supervisor: { ...this.sup }, inputs_stale: this.inputsStale, scan_ms: this.scanMs });
  }
  publishProgramInfo(ok, p, text, error) {
    const prog = this.engine.program;
    this.programInfo = {
      ok, name: prog ? prog.name : "", path: p, error, text,
      rung_count: prog ? prog.rungs.length : 0,
      sequence_count: prog ? prog.sequences.length : 0,
      has_emergency: Boolean(ok && prog && prog.has_emergency),
      blocks: ok && prog ? prog.blocks.map((b) => `${b.as} = ${b.block}`) : [],
      time: Date.now(),
    };
    this.ws.publishState(WS.program, this.programInfo);
  }
  log(level, text) {
    const ev = { time: Date.now(), level, text };
    this.eventLog.push(ev);
    if (this.eventLog.length > 500) this.eventLog.shift();
    this.ws.broadcast(WS.event, ev);
    this.events.emit("event", ev);
  }

  // ---- program ------------------------------------------------------------------
  activeProgramPath() {
    try {
      const j = JSON.parse(fs.readFileSync(ACTIVE_FILE, "utf8"));
      if (j.path && fs.existsSync(j.path)) return j.path;
    } catch { /* none */ }
    for (const p of [PROJECT_PROGRAM, path.join(PROGRAMS_DIR, "example_cell.yaml")]) if (fs.existsSync(p)) return p;
    return "";
  }
  /** load_program service: empty path = reload the current file. */
  async loadProgram(p, { quiet = false } = {}) {
    const target = p || this.programPath;
    if (!target) return { ok: false, message: "no program file: give a path" };
    const text = readFile(target);
    if (text == null) {
      const message = `cannot open '${target}'`;
      this.publishProgramInfo(false, target, "", message);
      return { ok: false, message };
    }
    const r = Loader.fromTextNamed(text, target, { readFile, blockDirs: blockDirs(target) });
    if (!r.ok) {
      this.publishProgramInfo(false, target, text, r.err);
      this.log("error", `program ${path.basename(target).replace(/\.ya?ml$/i, "")} refused: ${r.err}${this.engine.program ? " (the running program keeps running)" : ""}`);
      return { ok: false, message: r.err };
    }
    const prog = r.program;
    this.engine.load(prog);
    this.programPath = target;
    try { fs.writeFileSync(ACTIVE_FILE, JSON.stringify({ path: target })); } catch { /* ignore */ }
    this.applySupervisor();
    this.loadRetain();
    const used = prog.usedOutputCount();
    const message = `loaded ${prog.name}: ${prog.rungs.length} rungs, ${prog.sequences.length} sequence${prog.sequences.length === 1 ? "" : "s"}, ${prog.alarms.length} alarm${prog.alarms.length === 1 ? "" : "s"}${prog.blocks.length ? `, ${prog.blocks.length} block${prog.blocks.length === 1 ? "" : "s"}` : ""}; controls ${used} of ${kQ} outputs, the others stay free`;
    this.publishProgramInfo(true, target, text, "");
    this.log("info", message);
    this.publishState();
    return { ok: true, message };
  }

  // ---- retain -----------------------------------------------------------------------
  loadRetain() {
    const t = readFile(RETAIN_FILE);
    if (!t) return;
    try {
      const y = YAML.parse(t) || {};
      for (const [k, v] of Object.entries(y)) { const a = parseAddress(k); if (a.ok && a.addr.area === "R") this.engine.setRegister(a.addr.index, Number(v) | 0); }
    } catch { /* ignore a bad file */ }
  }
  scheduleRetainSave() {
    const p = this.engine.program;
    if (!p || !p.retain.length) return;
    // runs every scan: compare numbers, no string or array per scan
    const im = this.engine.image();
    const last = this.lastRetain;
    let same = last && last.prog === p && last.vals.length === p.retain.length;
    for (let i = 0; same && i < p.retain.length; i++) if (last.vals[i] !== im.R[p.retain[i].index]) same = false;
    if (same) return;
    this.lastRetain = { prog: p, vals: p.retain.map((a) => im.R[a.index]) };
    clearTimeout(this.retainSaveTimer);
    this.retainSaveTimer = setTimeout(() => {
      const obj = {};
      for (const a of p.retain) obj[addressName(a)] = im.R[a.index];
      try { fs.writeFileSync(RETAIN_FILE, YAML.stringify(obj)); } catch { /* ignore */ }
    }, 200);
  }

  // ---- services --------------------------------------------------------------------
  async setBits(names, values, pulseMs = []) {
    if (!Array.isArray(names) || names.length !== values.length) return { ok: false, message: "name and value lists must have the same length" };
    // the whole request is applied or refused: check first
    const errs = [];
    for (let i = 0; i < names.length; i++) {
      const r = this.engine.resolve(names[i]);
      if (!r.ok) errs.push(r.err);
      else if (!["M", "R"].includes(r.addr.area)) errs.push(`${names[i]}: only M bits and R registers can be written from outside`);
      else if (r.addr.area === "M" && this.engine.program && this.engine.program.ownerOf(r.addr)) errs.push(`${this.engine.displayName(r.addr)} is driven by ${this.engine.program.ownerOf(r.addr)}`);
    }
    if (errs.length) return { ok: false, message: errs.join("; ") };
    for (let i = 0; i < names.length; i++) {
      const r = this.engine.requestWrite(names[i], Number(values[i]) | 0, (Number(pulseMs[i]) || 0) / 1000);
      if (!r.ok) return { ok: false, message: r.err };
    }
    this.log("info", `set_bits ${names.map((n, i) => `${n}=${values[i]}${pulseMs[i] ? ` (${pulseMs[i]} ms)` : ""}`).join(", ")}`);
    return { ok: true, message: "ok" };
  }
  async getBits(names = []) {
    const st = this.buildState();
    if (!names.length) {
      const out = [];
      for (const [n, v] of Object.entries(st.bits)) out.push({ name: n, value: v });
      for (const [n, v] of Object.entries(st.regs)) out.push({ name: n, value: v });
      return { ok: true, message: "ok", name: out.map((x) => x.name), value: out.map((x) => x.value) };
    }
    const name = [], value = [];
    for (const n of names) {
      const r = this.engine.resolve(n);
      if (!r.ok) return { ok: false, message: r.err, name: [], value: [] };
      const canon = this.engine.canonicalName(r.addr);
      let v = 0;
      if (r.addr.area === "R") v = st.regs[canon];
      else if (canon in st.bits) v = st.bits[canon];
      else { const im = this.engine.image(); const seqs = this.engine.sequences(); v = r.addr.area === "SEQ_STEP" ? seqs[r.addr.index].step : r.addr.area === "SEQ_ACTIVE" ? (seqs[r.addr.index].step ? 1 : 0) : seqs[r.addr.index].step === r.addr.sub ? 1 : 0; void im; }
      name.push(n); value.push(v);
    }
    return { ok: true, message: "ok", name, value };
  }
  async forceBit(name, value, release) {
    if (this.engine.image().S[S.AUTO] && !process.env.NEXTPLC_ALLOW_FORCE_IN_AUTO) return { ok: false, message: "force is refused in AUTO (parameter allow_force_in_auto); switch the supervisor to JOG or SAFEAUTO" };
    const r = this.engine.force(name, Boolean(value), Boolean(release));
    if (!r.ok) return { ok: false, message: r.err };
    this.log("warn", release ? `force released ${name}` : `FORCED ${name} = ${value ? 1 : 0}`);
    return { ok: true, message: release ? `${name} released` : `${name} forced to ${value ? 1 : 0}` };
  }
  async releaseAllForces() {
    this.engine.releaseAllForces();
    this.log("warn", "all forces released");
    return { ok: true, message: "all forces released" };
  }
  async resetFault() {
    this.sup.emergency = false; this.sup.estop = false; this.sup.fault = false;
    this.emergencyDueAt = -1;
    this.engine.clearPlcEmergency();
    this.applySupervisor();
    this.log("info", "supervisor: reset_fault (simulated)");
    this.publishSim();
    return { ok: true, message: "fault reset (simulated supervisor)" };
  }

  // ---- simulator-only: the virtual panel ------------------------------------------------
  simSetInput(name, value) {
    const r = this.engine.resolve(name);
    if (!r.ok) return { ok: false, message: r.err };
    if (r.addr.area !== "I") return { ok: false, message: `${name} is not a physical input` };
    this.engine.setInput(r.addr.index, Boolean(value));
    return { ok: true, message: `${addressName(r.addr)} = ${value ? 1 : 0}` };
  }
  simPulseInput(name, ms) {
    const r = this.simSetInput(name, true);
    if (!r.ok) return r;
    setTimeout(() => this.simSetInput(name, false), Math.max(10, Number(ms) || 100));
    return { ok: true, message: `${name} pulsed ${ms} ms` };
  }
  simSupervisor(cmd, value) {
    const s = this.sup;
    switch (String(cmd).toUpperCase()) {
      case "AUTO": case "SAFEAUTO": case "JOG": s.profile = String(cmd).toUpperCase(); s.ok = true; break;
      case "OFF": s.ok = false; break;
      case "ON": s.ok = true; break;
      case "ARMED": s.armed = Boolean(value); break;
      case "EMERGENCY": s.emergency = Boolean(value); if (!value) this.engine.clearPlcEmergency(); break;
      case "ESTOP": s.estop = Boolean(value); if (value) s.emergency = true; break;
      case "STANDSTILL": s.standstill = Boolean(value); break;
      case "FAULT": s.fault = Boolean(value); break;
      case "RESET": return this.resetFault();
      default: return { ok: false, message: `unknown supervisor command '${cmd}'` };
    }
    this.applySupervisor();
    this.log("info", `supervisor (simulated): ${String(cmd).toUpperCase()}${value !== undefined ? ` ${value ? 1 : 0}` : ""}`);
    this.publishSim();
    return { ok: true, message: "ok" };
  }
  simInputsStale(stale) {
    this.inputsStale = Boolean(stale);
    this.applySupervisor();
    this.log(stale ? "warn" : "info", stale ? "inputs STALE: outputs held in the safe state" : "inputs fresh again");
    this.publishSim();
    return { ok: true, message: "ok" };
  }
  simPanel() {
    return { supervisor: { ...this.sup }, inputs_stale: this.inputsStale, scan_ms: this.scanMs };
  }

  shutdown() { this.stop(); }
}
