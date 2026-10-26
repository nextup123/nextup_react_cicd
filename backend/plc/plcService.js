// plc/plcService.js -- the NextPLC bridge manager: Simulation and Real, switched from the UI.
//
//   sim   SimPlcBridge  the JS port of the engine, in-process, scan 10 ms; virtual inputs
//   real  PlcBridge     nextplc_node on the robot, through the web backend's ROS 2 node
//
// Only the ACTIVE bridge reaches the browser: each bridge writes to the WebSocket through a gate
// that is open only while it is active. The live image (PLC_STATE, 10 Hz) is sent only while at
// least one browser shows a NextPLC page (PLC_WATCH from the page, dropped when the socket
// closes), so the rest of the console costs nothing extra. The chosen mode is saved and restored
// at the next start; Real is offered only with the real robot bridge.
import fs from "node:fs";
import { PlcBridge, realUnavailableReason } from "./PlcBridge.js";
import { SimPlcBridge } from "./SimPlcBridge.js";
import { WS } from "./interfaces.js";
import { MODE_FILE, PROJECT_PROGRAM, ensureDirs } from "./paths.js";
import eventBus from "../utils/pm_utils/eventBus.js";

const TRYING_FILE = `${MODE_FILE}.connecting`;

class GatedWS {
  constructor(ws) { this.ws = ws; this.open = false; }
  broadcast(type, payload) { if (this.open) this.ws.broadcast({ type, payload }); }
  publishState(type, payload) { if (this.open) return this.ws.publishState(type, payload); return false; }
  resetState(type) { this.ws.resetState?.(type); }
}

class BridgeManager {
  constructor(ws, getRos) {
    this.ws = ws;
    this.getRos = getRos;
    this.mode = "sim";
    this.sim = null;
    this.real = null;
    this.realError = "";
    this.gates = {};
    this.switching = false;
    this.watchers = new Set();
  }
  async init() {
    ensureDirs();
    this.gates.sim = new GatedWS(this.ws);
    this.sim = new SimPlcBridge(this.gates.sim);
    await this.sim.init();
    let wanted = process.env.NEXTPLC_MODE || "";
    if (!wanted) { try { wanted = JSON.parse(fs.readFileSync(MODE_FILE, "utf8")).mode; } catch { wanted = "sim"; } }
    // The last switch to the robot's PLC never settled (the console stopped while connecting):
    // start with the simulated PLC instead of failing the same way again at every start.
    if (fs.existsSync(TRYING_FILE)) {
      try { fs.unlinkSync(TRYING_FILE); } catch { /* ignore */ }
      if (wanted === "real") {
        wanted = "sim";
        this.realError = "the last connection to the robot's PLC stopped the console; started with the simulated PLC";
        console.log(`[PLC] ${this.realError}`);
        try { fs.writeFileSync(MODE_FILE, JSON.stringify({ mode: "sim" })); } catch { /* ignore */ }
      }
    }
    if (wanted === "real") {
      const r = await this.setMode("real", { save: false });
      if (!r.ok) { console.log(`[PLC] real PLC not available at start-up (${r.message}); using the simulated PLC`); await this.setMode("sim", { save: false }); }
    } else await this.setMode("sim", { save: false });
    // a robot whose PLC still loads another file at its start gets this project's program
    if (this.mode === "real") setTimeout(() => { if (this.real?.programInfo?.path !== PROJECT_PROGRAM) this.loadProjectProgram(); }, 3000);
    this.watchdog = setInterval(() => this.publishBridge(), 1000);
  }
  get active() { return this.mode === "real" ? this.real : this.sim; }
  clearTrying() { try { fs.unlinkSync(TRYING_FILE); } catch { /* not there */ } }

  /** Switch to "sim" or "real". Returns { ok, message }. */
  async setMode(mode, { save = true } = {}) {
    if (mode !== "sim" && mode !== "real") return { ok: false, message: `unknown mode '${mode}'` };
    if (this.switching) return { ok: false, message: "a switch is already in progress" };
    this.switching = true;
    try {
      if (mode === "real") {
        const ros = this.getRos();
        const why = await realUnavailableReason(ros);
        if (why) { this.realError = why; return { ok: false, message: why }; }
        // marks the attempt: if the console stops while connecting, the next start uses the simulator
        try { fs.writeFileSync(TRYING_FILE, String(Date.now())); } catch { /* ignore */ }
        if (!this.real) {
          this.gates.real = new GatedWS(this.ws);
          const b = new PlcBridge(this.gates.real, ros);
          try { await b.init(); } catch (e) { this.clearTrying(); this.realError = `the robot PLC connection failed: ${e.message}`; return { ok: false, message: this.realError }; }
          this.real = b;
        }
        // the robot's PLC must answer before anything is sent to it
        if (!(await this.real.answers())) {
          this.clearTrying();
          this.realError = "the PLC on the robot does not answer: start it on the robot, then try again";
          return { ok: false, message: this.realError };
        }
        this.realError = "";
        setTimeout(() => this.clearTrying(), 15_000);
      }
      for (const g of Object.values(this.gates)) g.open = false;
      for (const t of [WS.state, WS.program, WS.sim]) this.ws.resetState?.(t);
      if (mode === "real") { this.sim.setWatched(false); this.sim.stop(); }
      else this.real?.setWatched(false);
      this.mode = mode;
      this.gates[mode].open = true;
      this.active.start();
      this.active.setWatched(this.watchers.size > 0);
      if (mode === "sim") this.ws.publishState(WS.program, this.sim.programInfo || { ok: false, name: "", path: "", error: "no program loaded", text: "" });
      this.publishBridge();
      this.ws.broadcast({ type: WS.event, payload: { time: Date.now(), level: mode === "real" ? "warn" : "info", text: mode === "real" ? "switched to the ROBOT's PLC: commands switch real outputs" : "switched to the SIMULATED PLC: nothing reaches the robot" } });
      if (save) { try { fs.writeFileSync(MODE_FILE, JSON.stringify({ mode })); } catch { /* ignore */ } }
      return { ok: true, message: mode === "real" ? "Robot PLC" : "Simulated PLC" };
    } finally {
      this.switching = false;
    }
  }

  /** Another project became active (load, restore): the PLC runs that project's program. */
  async loadProjectProgram() {
    ensureDirs();
    if (!fs.existsSync(PROJECT_PROGRAM) || !this.active) return;
    const r = await this.active.loadProgram(PROJECT_PROGRAM).catch((e) => ({ ok: false, message: e.message }));
    if (!r.ok) console.log(`[PLC] this project's program was not loaded: ${r.message}`);
  }

  /** A browser opened (on) or left (off) a NextPLC page. */
  watch(client, on) {
    const before = this.watchers.size;
    if (on) this.watchers.add(client); else this.watchers.delete(client);
    if ((before > 0) !== (this.watchers.size > 0)) {
      this.active?.setWatched(this.watchers.size > 0);
      if (this.watchers.size > 0) { this.active?.publishState?.(); this.active?.start?.(); }
    }
  }

  status() {
    const ros = this.getRos();
    const real = this.mode === "real" ? this.real : null;
    const age = real ? real.stateAge() : null;
    const robotReal = Boolean(ros && !ros.simulated && ros.node);
    return {
      mode: this.mode,
      simulated: this.mode === "sim",
      ready: Boolean(this.active?.ready),
      real_available: robotReal,
      real_reason: !robotReal ? (ros?.simulated ? "the console runs the simulated robot" : "the robot connection is not ready") : this.realError,
      node_alive: real ? (age == null ? null : age < 3000) : null,
      message: real
        ? age == null ? "connected" : age === Infinity ? "no data from the PLC on the robot yet: is it running?" : age > 3000 ? `no data from the PLC on the robot for ${Math.round(age / 1000)} s: is it still running?` : "connected"
        : "simulated PLC: nothing reaches the robot",
    };
  }
  publishBridge() { this.ws.publishState(WS.bridge, this.status()); }
  shutdown() { clearInterval(this.watchdog); this.sim?.shutdown(); this.real?.shutdown(); }
}

let manager = null;
let starting = null;
/** The active bridge (what every route talks to). */
export function getBridge() { return manager ? manager.active : null; }
export function getManager() { return manager; }

/** Start once, after the robot bridge (getRos returns it). Never throws. */
export function startPlc(ws, getRos) {
  if (starting) return starting;
  const m = new BridgeManager(ws, getRos);
  starting = m.init().then(() => {
    manager = m;
    eventBus.on("project:activated", () => { m.loadProjectProgram(); });
    return m;
  }).catch((err) => { console.error("[PLC] start failed:", err); return null; });
  // the socket: page watch on/off; a closed socket stops watching
  ws.onClientClose?.((client) => manager?.watch(client, false));
  return starting;
}

/** WebSocket messages for the PLC (PLC_WATCH, PLC_SET_BITS, PLC_SIM_INPUT). true = handled. */
export function handlePlcMessage(msg, client) {
  if (!msg || typeof msg.type !== "string" || !msg.type.startsWith("PLC_")) return false;
  const m = manager;
  if (!m) return true;
  if (msg.type === "PLC_WATCH") m.watch(client, Boolean(msg.payload?.on));
  else if (msg.type === "PLC_SET_BITS") m.active?.setBits(msg.payload.name, msg.payload.value, msg.payload.pulse_ms || []);
  else if (msg.type === "PLC_SIM_INPUT") m.active?.simSetInput(msg.payload.name, msg.payload.value);
  return true;
}
