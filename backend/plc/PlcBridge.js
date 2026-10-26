// plc/PlcBridge.js -- the real PLC: talks to nextplc_node through the web backend's own ROS 2
// node (ros/LightweightROSBridge.js; rclnodejs is initialised once per process, so no second
// node is created here).
//
//   subscribes  /nextplc/program (latched), /nextplc/alarms; /nextplc/state (published at 50 Hz)
//               only while a browser shows the live PLC, taken as raw bytes and read at most
//               5 times a second by plcStateCdr.js (rclnodejs needs ~25 ms per message for its
//               ~300 names: decoding all 50 a second was more than a whole core), sent on change
//   services    /nextplc/set_bits, get_bits, load_program, force_bit; reset_fault goes through
//               the supervisor service the robot pages use
import { EventEmitter } from "node:events";
import { TOPIC, SRV, MSG, SRV_TYPE, WS, stateView, programView, alarmView } from "./interfaces.js";
import { resetFault as robotResetFault } from "../ros/robotOps.js";
import { StatePusher, STATE_MS } from "./statePush.js";
import { decodePlcState } from "./plcStateCdr.js";

let rclnodejs = null;
async function loadRcl() {
  if (rclnodejs) return rclnodejs;
  try { rclnodejs = (await import("rclnodejs")).default; } catch { rclnodejs = null; }
  return rclnodejs;
}

const SERVICE_TIMEOUT_MS = 5000;

/** Why the real PLC cannot be used with this robot bridge ("" = it can). */
export async function realUnavailableReason(ros) {
  if (!ros) return "the robot connection is starting";
  if (ros.simulated) return "the console runs the simulated robot: only the simulated PLC is available";
  if (!ros.node) return "the robot connection is not ready";
  const r = await loadRcl();
  if (!r) return "the ROS 2 library is not available";
  for (const t of [MSG.PlcState, MSG.ProgramInfo]) {
    try { r.require(t); } catch { return "the NextPLC message bindings are missing: build nextplc, source the workspace and restart the console"; }
  }
  return "";
}

export class PlcBridge {
  constructor(ws, ros) {
    this.ws = ws;
    this.ros = ros;
    this.simulated = false;
    this.ready = false;
    this.events = new EventEmitter();
    this.node = ros.node;
    this.state = null;
    this.programInfo = null;
    this.recentAlarms = [];
    this.eventLog = [];
    this.clients = {};
    this.lastStateAt = 0;
    this.stateSub = null;
    this.pusher = new StatePusher(ws);
    this.watched = false;
    this.message = "";
  }

  async init() {
    await loadRcl();
    const sub = (type, topic, cb, qos) => {
      // a callback that throws (a message the bindings do not match) is logged, never a crash
      const safeCb = (m) => { try { cb(m); } catch (err) { this.log("error", `message on ${topic} not understood: ${err.message}`); } };
      try { return this.node.createSubscription(type, topic, qos ? { qos } : {}, safeCb); }
      catch (err) { this.log("error", `cannot subscribe ${topic}: ${err.message}`); return null; }
    };
    let latched;
    try {
      const Q = rclnodejs.QoS;
      latched = new Q(Q.HistoryPolicy.RMW_QOS_POLICY_HISTORY_KEEP_LAST, 1, Q.ReliabilityPolicy.RMW_QOS_POLICY_RELIABILITY_RELIABLE, Q.DurabilityPolicy.RMW_QOS_POLICY_DURABILITY_TRANSIENT_LOCAL);
    } catch { latched = undefined; }
    sub(MSG.ProgramInfo, TOPIC.program, (m) => {
      this.programInfo = { ...programView(m), time: Date.now() };
      this.ws.publishState(WS.program, this.programInfo);
      this.log(this.programInfo.ok ? "info" : "error", this.programInfo.ok ? `program ${this.programInfo.name} loaded (${this.programInfo.rung_count} rungs)` : `program refused: ${this.programInfo.error}`);
    }, latched);
    sub(MSG.Alarm, TOPIC.alarms, (m) => {
      const v = alarmView(m);
      this.recentAlarms.push(v);
      if (this.recentAlarms.length > 200) this.recentAlarms.shift();
      this.ws.broadcast(WS.alarm, v);
      this.log(v.active ? (v.level === "info" ? "info" : v.level === "warning" ? "warn" : "error") : "info", v.active ? `ALARM ${v.bit}: ${v.text}` : `alarm cleared ${v.bit}`);
    });
    for (const [key, type, name] of [["setBits", SRV_TYPE.SetBits, SRV.setBits], ["getBits", SRV_TYPE.GetBits, SRV.getBits], ["loadProgram", SRV_TYPE.LoadProgram, SRV.loadProgram], ["forceBit", SRV_TYPE.ForceBit, SRV.forceBit]]) {
      try { this.clients[key] = this.node.createClient(type, name); }
      catch (err) { this.log("error", `cannot create client ${name}: ${err.message}`); }
    }
    this.ready = true;
    this.message = "connected";
    this.log("info", "connected to the PLC on the robot");
  }

  /** /nextplc/state is only taken while a browser shows the live PLC (CPU). */
  setWatched(on) {
    this.watched = on;
    if (on && !this.stateSub) {
      this.pusher.reset();
      const onState = (m) => {
        try { this.state = stateView(m); } catch { return; }
        this.pusher.push(this.state);
      };
      const seen = () => { this.lastStateAt = Date.now(); };
      try {
        if (typeof this.ros.subscribeState === "function") {
          // raw bytes, newest message decoded at most every STATE_MS
          const gate = this.ros.subscribeState(MSG.PlcState, TOPIC.state, STATE_MS, onState, { onMessage: seen, decode: decodePlcState });
          this.stateSub = gate ? { destroy: () => gate.destroy?.() } : null;
        } else {
          let last = 0;
          const sub = this.node.createSubscription(MSG.PlcState, TOPIC.state, {}, (m) => {
            seen();
            const now = Date.now();
            if (now - last >= STATE_MS) { last = now; onState(m); }
          });
          this.stateSub = { destroy: () => this.node.destroySubscription(sub) };
        }
      } catch (err) { this.log("error", `cannot subscribe ${TOPIC.state}: ${err.message}`); }
    } else if (!on && this.stateSub) {
      try { this.stateSub.destroy(); } catch { /* gone */ }
      this.stateSub = null;
      this.lastStateAt = 0;
    }
  }
  start() { if (this.state) this.ws.publishState(WS.state, this.state); if (this.programInfo) this.ws.publishState(WS.program, this.programInfo); }
  stop() { this.setWatched(false); }
  /** ms since the last /nextplc/state (Infinity = never; null = not listening). */
  stateAge() { if (!this.stateSub) return null; return this.lastStateAt ? Date.now() - this.lastStateAt : Infinity; }
  /** A page started watching: send the current image at once. */
  publishState() { this.pusher.reset(); if (this.state) this.pusher.push(this.state); }

  log(level, text) {
    const ev = { time: Date.now(), level, text };
    this.eventLog.push(ev);
    if (this.eventLog.length > 500) this.eventLog.shift();
    this.ws.broadcast(WS.event, ev);
    this.events.emit("event", ev);
  }

  async call(key, request) {
    const client = this.clients[key];
    if (!client) return { ok: false, message: "the PLC message bindings are missing: rebuild nextplc and restart the console" };
    let ready = false;
    try { ready = client.isServiceServerAvailable() || (await client.waitForService(1500)); } catch { ready = false; }
    if (!ready) return { ok: false, message: "the PLC on the robot does not answer: is it running?" };
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve({ ok: false, message: `the PLC did not answer within ${SERVICE_TIMEOUT_MS / 1000} s` }), SERVICE_TIMEOUT_MS);
      try {
        client.sendRequest(request, (res) => {
          clearTimeout(timer);
          const r = typeof res?.toPlainObject === "function" ? res.toPlainObject() : res;
          resolve({ ...r, ok: Boolean(r?.ok), message: r?.message || "" });
        });
      } catch (err) { clearTimeout(timer); resolve({ ok: false, message: err.message }); }
    });
  }

  async loadProgram(path) { return this.call("loadProgram", { path: path || "" }); }
  async setBits(names, values, pulseMs = []) {
    return this.call("setBits", { name: names, value: values.map((v) => Number(v) | 0), pulse_ms: names.map((_, i) => Number(pulseMs[i]) || 0) });
  }
  async getBits(names = []) { return this.call("getBits", { name: names }); }
  /** Does the PLC on the robot answer at all? (its services are there) */
  async answers(timeoutMs = 2500) {
    const c = this.clients.getBits || this.clients.loadProgram;
    if (!c) return false;
    try { return c.isServiceServerAvailable() || Boolean(await c.waitForService(timeoutMs)); } catch { return false; }
  }
  async forceBit(name, value, release) { return this.call("forceBit", { name, value: Boolean(value), release: Boolean(release) }); }
  async releaseAllForces() {
    if (!this.state) return { ok: false, message: "no state from the PLC yet" };
    for (const n of this.state.forced) { const r = await this.forceBit(n, false, true); if (!r.ok) return r; }
    return { ok: true, message: "all forces released" };
  }
  /** The same reset as the top bar's: through the supervisor, waits until it runs again. */
  async resetFault() {
    const r = await robotResetFault(this.ros);
    return { ok: Boolean(r.ok), message: r.message || "" };
  }

  // simulator-only calls are refused on the real robot
  simSetInput() { return { ok: false, message: "virtual inputs exist only in the simulator: force the input instead" }; }
  simPulseInput() { return this.simSetInput(); }
  simSupervisor() { return { ok: false, message: "on the robot the supervisor is operated from the top bar" }; }
  simInputsStale() { return this.simSupervisor(); }
  simPanel() { return null; }
  shutdown() { this.setWatched(false); }
}
