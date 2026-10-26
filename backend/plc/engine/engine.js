// engine.js -- the scan cycle (port of nextplc/engine.cpp). No ROS in here.
//
//   every scan (dt = measured time since the last scan):
//     1. S bits: FIRST_SCAN, BLINK_*, SAFE_STATE, PROGRAM_OK
//     2. forced inputs are applied over the real ones
//     3. external writes (set_bits) and expired pulses are applied to M and R
//     4. rungs run top to bottom, then the sequences, then the alarm edges
//     5. the physical outputs are computed: image Q, or the safe state, except exempt outputs;
//        forced outputs win over everything

import { kI, kQ, kM, kR, kS, S, newImage, parseAddress, addressName, addrKey, addrEq } from "./image.js";
import { kTimeEps } from "./blocks.js";
import { readValue, asBool } from "./expr.js";
import { runRung, resetRung } from "./rung.js";
import { runSequence, resetSequence } from "./sequence.js";

export class Engine {
  constructor() {
    this.program = null;
    this.img = newImage();
    this.img.S[S.SAFE_STATE] = true;
    this.real_i = new Array(kI).fill(false);
    this.q_out = new Array(kQ).fill(false);
    this.force_i = new Array(kI).fill(false);
    this.force_i_value = new Array(kI).fill(false);
    this.force_q = new Array(kQ).fill(false);
    this.force_q_value = new Array(kQ).fill(false);
    this.seq_rt = [];
    this.pulses = []; // { a, remaining_s }
    this.alarm_events = [];
    this.emergency_requests = [];
    this.plc_emergency = false;
    this.first_scan = false;
    this.safe_active = true;
    this.hold_ = false;
    this.blink_t = 0;
    this.scan_count = 0;
  }

  // ---- program ------------------------------------------------------------
  /** Takes a loaded Program. M and R are kept, everything else starts fresh. */
  load(program) {
    if (!program) return { ok: false, err: "no program" };
    if (this.program) for (const k of this.program.owners.keys()) { const a = keyToAddr(k); if (a.area === "M") this.img.M[a.index] = false; }
    this.img.Q.fill(false);
    this.program = program;
    this.seq_rt = program.sequences.map(() => ({ step: 0 }));
    for (const r of program.rungs) resetRung(r);
    program.sequences.forEach((s, i) => resetSequence(s, this.seq_rt[i], this.img));
    for (const a of program.alarms) a.prev = false;
    this.pulses = [];
    this.plc_emergency = false;
    this.first_scan = true;
    return { ok: true };
  }
  unload() {
    if (this.program) for (const k of this.program.owners.keys()) { const a = keyToAddr(k); if (a.area === "M") this.img.M[a.index] = false; }
    this.program = null;
    this.seq_rt = [];
    this.pulses = [];
    this.plc_emergency = false;
    this.img.Q.fill(false);
  }
  hasProgram() { return this.program !== null; }

  // ---- inputs from the node ---------------------------------------------
  setInput(i, v) { if (i < kI) this.real_i[i] = Boolean(v); }
  setSystem(bit, v) { if (bit < kS) this.img.S[bit] = Boolean(v); }
  setRegister(r, v) { if (r < kR) this.img.R[r] = v | 0; }
  hold(on) { this.hold_ = Boolean(on); }

  // ---- names ---------------------------------------------------------------
  resolve(name) { return this.program ? this.program.resolve(name) : parseAddress(name); }
  displayName(a) { return this.program ? this.program.displayName(a) : addressName(a); }
  canonicalName(a) { return this.program ? this.program.canonicalName(a) : addressName(a); }

  // ---- external writes (BT, web) ------------------------------------------
  /** Write an M bit (pulse_s > 0: back to 0 after that time) or an R register. Returns { ok, err }. */
  requestWrite(name, value, pulse_s = 0) {
    const r = this.resolve(name);
    if (!r.ok) return r;
    const a = r.addr;
    const shown = this.displayName(a);
    switch (a.area) {
      case "I": return { ok: false, err: `${shown} is a physical input, it cannot be written` };
      case "S": return { ok: false, err: `${shown} is a system bit, it cannot be written` };
      case "Q": return { ok: false, err: `${shown} is a physical output: only a rung may write it (use an M bit and a rung)` };
      case "M": {
        if (this.program) {
          const owner = this.program.ownerOf(a);
          if (owner) return { ok: false, err: `${shown} is driven by ${owner}, a write from outside would be overwritten in the next scan` };
        }
        if (value !== 0 && value !== 1) return { ok: false, err: `${shown} is a bit: value must be 0 or 1` };
        this.img.M[a.index] = value !== 0;
        this.pulses = this.pulses.filter((p) => !addrEq(p.a, a));
        if (pulse_s > 0 && value !== 0) this.pulses.push({ a, remaining_s: pulse_s });
        return { ok: true };
      }
      case "R":
        this.img.R[a.index] = value | 0;
        return { ok: true };
      default:
        return { ok: false, err: `${shown} cannot be written` };
    }
  }

  force(name, value, release) {
    const r = this.resolve(name);
    if (!r.ok) return r;
    const a = r.addr;
    if (a.area === "I") { this.force_i[a.index] = !release; this.force_i_value[a.index] = Boolean(value); return { ok: true }; }
    if (a.area === "Q") { this.force_q[a.index] = !release; this.force_q_value[a.index] = Boolean(value); return { ok: true }; }
    return { ok: false, err: `${this.displayName(a)}: only physical inputs and outputs can be forced (write M bits with set_bits)` };
  }
  releaseAllForces() { this.force_i.fill(false); this.force_q.fill(false); }
  forcedCount() { return this.force_i.filter(Boolean).length + this.force_q.filter(Boolean).length; }
  inputForced(i) { return i < kI && this.force_i[i]; }
  outputForced(q) { return q < kQ && this.force_q[q]; }
  outputUsed(q) { return q < kQ && ((this.program && this.program.used_q[q]) || this.force_q[q]); }

  // ---- the cycle ----------------------------------------------------------
  applyPulses(dt) {
    for (let i = 0; i < this.pulses.length;) {
      this.pulses[i].remaining_s -= dt;
      if (this.pulses[i].remaining_s <= kTimeEps) {
        const a = this.pulses[i].a;
        if (a.area === "M") this.img.M[a.index] = false;
        this.pulses.splice(i, 1);
      } else i++;
    }
  }
  runAlarms() {
    if (!this.program) return;
    const ctx = { img: this.img, seqs: this.seq_rt };
    for (const a of this.program.alarms) {
      const now = asBool(readValue(ctx, a.bit));
      if (now !== a.prev) {
        this.alarm_events.push({ bit: this.program.displayName(a.bit), text: a.text, level: a.level, toast: a.toast, active: now });
        a.prev = now;
      }
    }
  }
  computeOutputs() {
    this.safe_active = !this.program || this.hold_ || this.img.S[S.EMERGENCY] || this.plc_emergency;
    this.img.S[S.SAFE_STATE] = this.safe_active;
    this.img.S[S.PLC_EMERGENCY] = this.plc_emergency;
    for (let q = 0; q < kQ; q++) {
      let v = this.img.Q[q];
      if (this.safe_active) {
        if (!this.program) v = false;
        else if (!this.program.safe.exempt[q]) v = this.program.safe.value[q];
      }
      if (this.force_q[q]) v = this.force_q_value[q];
      this.q_out[q] = v;
    }
  }

  scan(dt) {
    if (!(dt > 0) || Number.isNaN(dt)) dt = 0;
    this.scan_count++;

    // 1. system bits the engine owns
    this.img.S[S.FIRST_SCAN] = this.first_scan;
    this.img.S[S.PROGRAM_OK] = this.program !== null;
    this.blink_t += dt;
    if (this.blink_t >= 1) this.blink_t -= 1;
    this.img.S[S.BLINK_1HZ] = this.blink_t < 0.5;
    this.img.S[S.BLINK_2HZ] = this.blink_t < 0.25 || (this.blink_t >= 0.5 && this.blink_t < 0.75);

    // 2. inputs (forced ones win)
    for (let i = 0; i < kI; i++) this.img.I[i] = this.force_i[i] ? this.force_i_value[i] : this.real_i[i];

    // 3. pulses from set_bits
    this.applyPulses(dt);

    // 4. logic
    if (this.program) {
      if (this.plc_emergency && this.img.S[S.EMERGENCY] && this.img.S[S.SUPERVISOR_OK]) this.plc_emergency = false;
      this.img.S[S.PLC_EMERGENCY] = this.plc_emergency;
      const ctx = { img: this.img, seqs: this.seq_rt };
      let number = 0;
      for (const r of this.program.rungs) {
        number++;
        runRung(r, this.img, ctx, dt);
        if (r.type === "emergency" && r.last_result) {
          this.plc_emergency = true;
          this.emergency_requests.push({ text: r.text_emergency, rung: `rung ${number} (emergency, line ${r.line})` });
        }
      }
      const emergency = this.img.S[S.EMERGENCY] || this.plc_emergency;
      this.program.sequences.forEach((s, i) => {
        if (emergency) resetSequence(s, this.seq_rt[i], this.img);
        else runSequence(s, this.seq_rt[i], this.img, ctx, dt);
      });
      this.runAlarms();
    }

    // 5. physical outputs
    this.computeOutputs();
    this.first_scan = false;
  }

  // ---- results ------------------------------------------------------------
  image() { return this.img; }
  outputs() { return this.q_out; }
  safeState() { return this.safe_active; }
  sequences() { return this.seq_rt; }
  takeAlarms() { const out = this.alarm_events; this.alarm_events = []; return out; }
  takeEmergencyRequests() { const out = this.emergency_requests; this.emergency_requests = []; return out; }
  plcEmergency() { return this.plc_emergency; }
  clearPlcEmergency() { this.plc_emergency = false; }
  scanCount() { return this.scan_count; }
}

function keyToAddr(k) {
  const [area, index, sub] = k.split(":");
  return { area, index: Number(index), sub: Number(sub) };
}
export { addrKey };
