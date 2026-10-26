// What an operator-panel widget is wired to, how its value is read and how it acts.
//
// Binding kinds:
//   action   one of the console's own commands (ACTIONS: program start/stop, process, mode, reset,
//            motion, PLC, reload ...), the same calls the top bar and the pages make
//   plc      a PLC address or name: bits (I, Q, M, S) are read; M bits and R registers are written
//   io       a robot digital input / output by device and pin (joint1..6 / gpio1, di1, do2, pi_p)
//   iolist   an input / output of the project's IO list (IO Control page), by its name
//   topic    a ROS topic (bool, int, float, string): shown and published
//   bb       a behaviour tree blackboard entry (shown; the runner has no service to write it)
//   robot    a robot / production state (emergency, motion, program, mode, speed, counters ...)
//   setting  the run mode (test speeds / production) or the CNC selection
//   group    a signal group: a list of the above bits, or the whole IO list
import { create } from "zustand";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../../lib/api";
import { send, subscribe } from "../../../lib/ws";
import { subscribeLimited } from "../../../lib/liveRate";
import { robotApi } from "../../../lib/robotApi";
import { reloadApp } from "../../../lib/pageReload";
import { keys, useDiList, useDoList, useSettings } from "../../../lib/queries";
import { queryClient } from "../../../lib/queryClient";
import { selectAllOperational, selectAnyEmergency, selectAnyFault, selectLatched, useRobot } from "../../../store/robot";
import { usePlc } from "../../nextplc/store/plc";
import { plcApi } from "../../nextplc/lib/api";
import { processRunning } from "../../../components/robot/ProcessSwitch";
import { MODES, publishCnc, publishSpeedOverride, publishSpeedScale, resetTotal, speedForSettings, updateSettings, useClientState } from "../clientState";
import { doIdToNumber, setDriverDo, setGpioDo } from "../../io/ioLive";

export const BINDING_KINDS = {
  action: "Console action",
  plc: "PLC bit / register",
  io: "Robot input / output",
  iolist: "IO list signal",
  topic: "ROS topic",
  bb: "Program blackboard",
  robot: "Robot state",
  setting: "Run mode / CNC",
  group: "Signals",
};

/** The settings as the page last read them (Start sends the run mode's speed scale first). */
const settingsNow = () => queryClient.getQueryData(keys.settings);
const ok = (r, fallback) => (r?.ok === false ? Promise.reject(new Error(r.message || "Refused")) : r?.message || fallback);
const wsCmd = (command, value) => send("UI_COMMANDS", value === undefined ? { command } : { command, value });

/**
 * Console actions. safe = stopping / resetting kind, always allowed (no interlock);
 * confirm = asks before it runs unless the widget turns that off.
 */
export const ACTIONS = [
  { id: "bt_start", group: "Robot program", label: "Start program", color: "green", run: () => { publishSpeedScale(speedForSettings(settingsNow())); wsCmd("start_bt"); return "Start sent"; } },
  { id: "bt_stop", group: "Robot program", label: "Stop program", color: "red", safe: true, run: () => { wsCmd("control_reset_bt", true); return "Stop sent"; } },
  { id: "bt_finish", group: "Robot program", label: "Finish cycle", color: "amber", safe: true, run: () => { wsCmd("control_exit_bt", true); return "The program stops after this cycle"; } },
  { id: "bt_pause", group: "Robot program", label: "Pause program", color: "amber", safe: true, run: async () => ok(await robotApi.runnerAction("pause"), "Paused") },
  { id: "bt_resume", group: "Robot program", label: "Resume program", color: "green", run: async () => ok(await robotApi.runnerAction("resume"), "Resumed") },
  { id: "bt_load", group: "Robot program", label: "Load robot program", confirm: true, run: async () => ok(await robotApi.runnerLoadMain(), "Program loaded") },
  { id: "process_on", group: "Robot program", label: "Process on", color: "green", run: () => { wsCmd("process_control", "start"); return "Process starting"; } },
  { id: "process_off", group: "Robot program", label: "Process off", color: "gray", safe: true, run: () => { wsCmd("process_control", "stop"); return "Process stopping"; } },
  { id: "mode_auto", group: "Mode", label: "Mode AUTO", confirm: true, run: async () => ok(await robotApi.setMode("auto"), "AUTO") },
  { id: "mode_safeauto", group: "Mode", label: "Mode SAFEAUTO", run: async () => ok(await robotApi.setMode("safeauto"), "SAFEAUTO") },
  { id: "mode_jog", group: "Mode", label: "Mode JOG", run: async () => ok(await robotApi.setMode("jog"), "JOG") },
  { id: "reset_fault", group: "Safety", label: "Reset emergency / fault", color: "amber", safe: true, run: async () => ok(await robotApi.resetFault(), "Reset sent") },
  { id: "estop", group: "Safety", label: "Emergency stop", color: "red", safe: true, run: async () => ok(await robotApi.estop(), "Emergency stop") },
  { id: "motion_stop", group: "Motion", label: "Stop motion", color: "red", safe: true, run: async () => ok(await robotApi.stop(), "Motion stopped") },
  { id: "motion_home", group: "Motion", label: "Go home", confirm: true, run: async () => ok(await robotApi.home({}), "Going home") },
  { id: "motion_program", group: "Motion", label: "Run motion program", arg: "program", confirm: true, run: async (arg) => ok(await robotApi.runProgram({ name: arg }), `Running ${arg}`) },
  { id: "motion_finish", group: "Motion", label: "Finish motion program", safe: true, run: async () => ok(await robotApi.finishProgram(), "Finishing") },
  { id: "motion_reset", group: "Motion", label: "Reset motion server", run: async () => ok(await robotApi.resetMotionServer(), "Motion server reset") },
  { id: "plc_load", group: "PLC", label: "Start PLC (load the program)", confirm: true, run: async () => ok(await plcApi.reload(), "PLC program loaded") },
  { id: "plc_reset", group: "PLC", label: "Reset PLC fault", safe: true, run: async () => ok(await plcApi.resetFault(), "PLC fault reset") },
  { id: "plc_release", group: "PLC", label: "Release all PLC forces", safe: true, run: async () => ok(await plcApi.releaseAll(), "Forces released") },
  { id: "reset_total", group: "Production", label: "Reset total cycle counter", confirm: true, run: async () => { await resetTotal(); return "Total reset to 0"; } },
  { id: "reload_app", group: "Console", label: "Reload the web app", safe: true, confirm: true, run: () => { reloadApp(); return "Reloading"; } },
];
export const actionById = (id) => ACTIONS.find((a) => a.id === id);

/** Robot / production states a widget can show (and the few it can set). */
export const ROBOT_KEYS = [
  { id: "emergency", label: "Emergency stop active", type: "bool" },
  { id: "latched", label: "Emergency latched", type: "bool" },
  { id: "fault", label: "Drive fault", type: "bool" },
  { id: "operational", label: "All drives enabled", type: "bool" },
  { id: "motion", label: "Robot moving", type: "bool" },
  { id: "program", label: "Program running", type: "bool" },
  { id: "process", label: "Process on", type: "bool", writable: true },
  { id: "athome", label: "At home", type: "bool" },
  { id: "mode", label: "Mode (AUTO / SAFEAUTO / JOG)", type: "enum", writable: true, options: [{ value: "auto", label: "AUTO" }, { value: "safeauto", label: "SAFEAUTO" }, { value: "jog", label: "JOG" }] },
  { id: "speed", label: "Speed override %", type: "number", writable: true, min: 0, max: 100 },
  { id: "cycle", label: "Program cycle", type: "number" },
  { id: "session", label: "Cycles this session", type: "number" },
  { id: "total", label: "Cycles total", type: "number" },
  { id: "lastcycle", label: "Last cycle time (s)", type: "number" },
];
export const robotKey = (id) => ROBOT_KEYS.find((k) => k.id === id);

export const SETTING_KEYS = {
  mode: { label: "Run mode", options: Object.entries(MODES).map(([value, m]) => ({ value, label: m.label, title: m.hint })) },
  cnc: { label: "CNC machine", options: [{ value: "cnc1", label: "CNC 1" }, { value: "cnc2", label: "CNC 2" }, { value: "both", label: "Both" }] },
};

export const TOPIC_TYPES = [
  { value: "bool", label: "Bool" },
  { value: "int", label: "Int32" },
  { value: "int64", label: "Int64" },
  { value: "float", label: "Float64" },
  { value: "string", label: "String" },
];

/** Driver pins: di1..di5, sto1, sto2, edm (1..8) and do1..do3, pi_p (1..4); GPIO di1..di8, do1..do8. */
export const IO_DEVICES = ["joint1", "joint2", "joint3", "joint4", "joint5", "joint6", "gpio1"];
export const ioPins = (device, dir) => {
  const gpio = device.startsWith("gpio");
  if (dir === "di") return gpio ? [1, 2, 3, 4, 5, 6, 7, 8].map((n) => `di${n}`) : ["di1", "di2", "di3", "di4", "di5", "sto1", "sto2", "edm"];
  return gpio ? [1, 2, 3, 4, 5, 6, 7, 8].map((n) => `do${n}`) : ["do1", "do2", "do3", "pi_p"];
};
const DRIVER_DI = { di1: 1, di2: 2, di3: 3, di4: 4, di5: 5, sto1: 6, sto2: 7, edm: 8 };

/* ───────── topics: live values + publishing ───────── */

export const useTopics = create(() => ({ values: {} }));
// one value per frame: frames are merged and drawn at 4 Hz max, nothing while the tab is hidden
subscribeLimited("PANEL_TOPIC", 250, (batch) => useTopics.setState((s) => ({ values: { ...s.values, ...batch } })),
  (acc, p) => (p?.name ? { ...acc, [p.name]: p.value } : acc));
let watched = [];
let tabVisible = typeof document === "undefined" || !document.hidden;
const sendWatch = () => send("PANEL_WATCH", { topics: tabVisible ? watched : [] }, { queue: false });
/** Tell the server which topics the panel shows (sent again after a reconnect; none while the tab is hidden). */
export function watchTopics(list) {
  watched = list;
  sendWatch();
}
subscribe("__OPEN__", () => watched.length && tabVisible && sendWatch());
if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    tabVisible = !document.hidden;
    if (watched.length) sendWatch();
  });
}
const normTopic = (n) => (String(n || "").startsWith("/") ? String(n) : `/${n || ""}`);
export const useTopicList = (enabled) => useQuery({ queryKey: ["operator-panel", "topics"], queryFn: () => api.get("/operator-panel/topics"), enabled, staleTime: 10_000 });

/* ───────── reading ───────── */

/** A PLC name (canonical or the program's alias) -> canonical, using the live alias table. */
export function plcCanon(state, name) {
  const n = String(name || "").trim();
  if (!n || !state) return n;
  if (n in state.bits || n in state.regs) return n;
  const low = n.toLowerCase();
  for (const k of Object.keys(state.bits)) if (k.toLowerCase() === low) return k;
  for (const k of Object.keys(state.regs)) if (k.toLowerCase() === low) return k;
  const a = (state.aliases || []).find((x) => String(x.alias || x.name || "").toLowerCase() === low);
  return a ? a.target : n;
}
export function readPlc(state, name) {
  if (!state) return undefined;
  const c = plcCanon(state, name);
  if (c in state.bits) return state.bits[c];
  if (c in state.regs) return state.regs[c];
  return undefined;
}
export const isPlcRegister = (name) => /^r\d+$/i.test(String(name || "").trim());

function readIo(s, device, pin) {
  if (!device || !pin) return undefined;
  if (device.startsWith("gpio")) {
    const dir = pin.slice(0, 2);
    return s.gpio?.[device]?.[dir]?.[Number(pin.slice(2))];
  }
  const d = Number(device.replace(/\D/g, ""));
  if (pin.startsWith("do") || pin === "pi_p") return s.doStatus?.[d]?.[`do${doIdToNumber(pin.replace("do", ""))}`];
  return s.diStatus?.[d - 1]?.[DRIVER_DI[pin] - 1];
}
/** An IO list item -> { device, pin } */
export function listItemIo(item, dir) {
  if (!item) return null;
  if (item.type === "gpio") return { device: `gpio${String(item.gpio_id).replace(/\D/g, "") || 1}`, pin: `${dir}${dir === "do" ? item.do_id : item.di_id}`, item };
  const id = dir === "do" ? (String(item.do_id).toLowerCase() === "pi_p" ? "pi_p" : `do${item.do_id}`) : Object.keys(DRIVER_DI)[Number(item.di_id) - 1];
  return { device: `joint${item.driver_id}`, pin: id, item };
}
export const ioLabel = (name = "") => String(name).replace(/\[(DO|DI)\]$/, "");

function bbValue(boards, key) {
  for (const list of Object.values(boards || {})) {
    const hit = (list || []).find((e) => e.key === key);
    if (hit) return hit.value;
  }
  return undefined;
}

function robotValue(s, id) {
  switch (id) {
    case "emergency": return selectAnyEmergency(s);
    case "latched": return selectLatched(s);
    case "fault": return selectAnyFault(s);
    case "operational": return s.hasDriverStatus ? selectAllOperational(s) : undefined;
    case "motion": return Boolean(s.motion?.active);
    case "program": return ["RUNNING", "PAUSING", "STOPPING", "FINISHING", "STEPPING"].includes(s.btRunnerStatus?.state) || Boolean(s.controlActive);
    case "process": return processRunning(s.processStatus);
    case "athome": return s.atHome ? Boolean(s.atHome.atHome) : undefined;
    case "mode": return s.supervisor?.profile || s.mode || undefined;
    case "cycle": return s.btActive?.cycle ?? s.btRunnerStatus?.cycle;
    case "lastcycle": { const v = s.cycleTimes.filter((t) => t > 0 && t < 300); return v.length ? Number(v[v.length - 1].toFixed(2)) : undefined; }
    default: return undefined;
  }
}


/**
 * Live value of a binding: { value, known }. Every store is read through a selector that returns
 * undefined for other kinds, so the hooks run in the same order for every widget.
 */
export function useBindingValue(b) {
  const kind = b?.kind;
  const plcState = usePlc((s) => (kind === "plc" ? readPlc(s.state, b.name) : undefined));
  const di = useDiList();
  const dout = useDoList();
  const { data: settings } = useSettings();
  const listIo = kind === "iolist" ? listItemIo((b.dir === "do" ? dout.data : di.data || [])?.find?.((x) => x.name === b.name), b.dir) : null;
  const io = kind === "io" ? b : listIo;
  const ioVal = useRobot((s) => (io ? readIo(s, io.device, io.pin) : undefined));
  const topic = useTopics((s) => (kind === "topic" ? s.values[normTopic(b.name)] : undefined));
  const bb = useRobot((s) => (kind === "bb" ? bbValue(s.btBlackboard, b.key) : undefined));
  const cs = useClientState((s) => (kind === "robot" ? (b.key === "speed" ? s.speedOverride : b.key === "session" ? s.currentOps : undefined) : undefined));
  const rv = useRobot((s) => (kind === "robot" ? robotValue(s, b.key) : undefined));
  switch (kind) {
    case "plc": return { value: plcState, known: plcState !== undefined };
    case "io": case "iolist": return { value: ioVal, known: ioVal !== undefined, io };
    case "topic": return { value: topic, known: topic !== undefined };
    case "bb": return { value: bb, known: bb !== undefined };
    case "robot": {
      const v = b.key === "speed" || b.key === "session" ? cs : b.key === "total" ? settings?.total_operations : rv;
      return { value: v, known: v !== undefined && v !== null };
    }
    case "setting": { const v = settings?.[b.key]; return { value: v, known: v !== undefined }; }
    default: return { value: undefined, known: false };
  }
}

export const truthy = (v) => v === true || v === 1 || (typeof v === "number" && v !== 0) || ["true", "1", "on", "yes"].includes(String(v).toLowerCase());

/* ───────── writing ───────── */

/** Can this binding be written (by toggles, fields, option buttons)? */
export function writable(b) {
  if (!b) return false;
  if (b.kind === "plc") return /^(m\d+|r\d+)$/i.test(String(b.name || "").trim()) || !/^(gpio|joint|s\.)/i.test(String(b.name || ""));
  if (b.kind === "io" || b.kind === "iolist") return b.kind === "io" ? /^(do|pi_p)/.test(b.pin || "") : b.dir === "do";
  if (b.kind === "topic" || b.kind === "setting" || b.kind === "action") return true;
  if (b.kind === "robot") return Boolean(robotKey(b.key)?.writable);
  return false;
}

/** Set a binding to `value` (bool for bits, number / text otherwise). Returns a message. */
export async function writeBinding(b, value, { pulseMs = 0, guard = false, io } = {}) {
  switch (b.kind) {
    case "plc": {
      const name = String(b.name || "").trim();
      const v = isPlcRegister(name) ? Math.trunc(Number(value)) || 0 : truthy(value) ? 1 : 0;
      return ok(await plcApi.setBits(name, v, pulseMs || 0), `${name} = ${v}`);
    }
    case "io": case "iolist": {
      const t = io || (b.kind === "io" ? b : null);
      if (!t) throw new Error("This output is not in the IO list any more");
      const on = truthy(value);
      const set = (x) => (t.device.startsWith("gpio") ? setGpioDo(t.device, Number(t.pin.slice(2)), x) : setDriverDo(Number(t.device.replace(/\D/g, "")), doIdToNumber(t.pin.replace("do", "")), x));
      set(on);
      if (pulseMs > 0 && on) setTimeout(() => set(false), pulseMs);
      return "";
    }
    case "topic": {
      const r = await api.post("/operator-panel/publish", { name: b.name, type: b.type || "string", value, guard });
      return ok(r, "Sent");
    }
    case "setting": {
      if (b.key === "mode") {
        const cur = settingsNow() || {};
        let speed = 0.1;
        if (value === "high_testing") speed = Math.max(0.5, Number(cur.speed) || 0.5);
        if (value === "production") speed = 0;
        const patch = { mode: value, speed };
        publishSpeedScale(speedForSettings(patch));
        await updateSettings(patch);
        return MODES[value]?.label || "";
      }
      if (b.key === "cnc") { publishCnc(value); await updateSettings({ cnc: value }); return ""; }
      if (b.key === "speed") { publishSpeedScale(value); await updateSettings({ speed: value }); return ""; }
      return "";
    }
    case "robot": {
      if (b.key === "process") { wsCmd("process_control", truthy(value) ? "start" : "stop"); return ""; }
      if (b.key === "mode") return ok(await robotApi.setMode(String(value)), String(value).toUpperCase());
      if (b.key === "speed") { publishSpeedOverride(Number(value)); return ""; }
      throw new Error("This state cannot be set");
    }
    default: throw new Error("Nothing to set");
  }
}

/** Is this write a stop / safe-state kind (allowed while the robot works)? */
export function isSafeWrite(b, value) {
  if (b.kind === "robot" && b.key === "process") return !truthy(value);
  if (b.kind === "robot" && b.key === "speed") return true; // the override applies while running, as on the deck
  return false;
}

export { useSettings };
