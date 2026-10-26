// REST calls for the new controllers (backend /robot, see backend/ros/robotRoutes.js).
// Every call resolves to the JSON answer { ok, message, ... }; a robot "no"
// (ok: false) is not thrown, so callers can show the message.
import { api } from "./api";
import { toast } from "../store/toast";

const post = (path, body) => api.post(`/robot${path}`, body);
const get = (path) => api.get(`/robot${path}`);
const del = (path) => api.del(`/robot${path}`);
const qs = (o) => {
  const p = new URLSearchParams();
  Object.entries(o || {}).forEach(([k, v]) => v !== undefined && v !== "" && v !== null && p.set(k, v));
  const s = p.toString();
  return s ? `?${s}` : "";
};

export const robotApi = {
  state: () => get("/state"),
  capabilities: () => get("/capabilities"),

  // supervisor
  setMode: (mode) => post("/mode", { mode }),
  resetFault: () => post("/reset-fault"),
  estop: () => post("/estop"),
  setLatching: (strict) => post("/latching", { strict }),
  setSpeedOverride: (percent) => post("/speed-override", { percent }),
  speedLimits: () => get("/speed-limits"),
  setSpeedLimits: (mode, thresholds, persist) => post("/speed-limits", { mode, thresholds, persist }),

  // logs
  events: (q) => get(`/events${qs(q)}`),
  clearEvents: () => del("/events"),
  errors: (q) => get(`/errors${qs(q)}`),
  clearErrors: () => del("/errors"),
  faultCounters: () => get("/fault-counters"),
  resetFaultCounters: () => del("/fault-counters"),
  reloadCodeTable: () => post("/code-table/reload"),
  motionLog: (max = 200) => get(`/motion-log${qs({ max })}`),
  blackbox: () => get("/blackbox"),

  // IO watch
  ioWatch: () => get("/io-watch"),
  addIoWatch: (w) => post("/io-watch", w),
  removeIoWatch: (name) => del(`/io-watch/${encodeURIComponent(name)}`),
  ioLog: (q) => get(`/io-log${qs(q)}`),
  ioTrace: (durationS) => post("/io-trace", { durationS }),

  // tool
  setTcpOffset: (o) => post("/tcp-offset", o),

  // motions
  home: (o = {}) => post("/home", o),
  gotoPoint: (o) => post("/goto/point", o),
  gotoJoints: (o) => post("/goto/joints", o),
  gotoPose: (o) => post("/goto/pose", o),
  stop: () => post("/stop"),
  resetMotionServer: () => post("/motion-server/reset"),
  clearPlanCache: () => post("/plan-cache/clear"),

  // homes
  homes: () => get("/homes"),
  teachHome: (o) => post("/homes/teach", o),
  setActiveHome: (name) => post("/homes/active", { name }),
  deleteHome: (name) => del(`/homes/${encodeURIComponent(name)}`),

  // config
  homingConfig: () => get("/config/homing"),
  setHomingConfig: (config) => post("/config/homing", { config }),
  gotoConfig: () => get("/config/goto"),
  setGotoConfig: (config) => post("/config/goto", { config }),

  // behaviour tree
  btPause: () => post("/bt/pause"),
  btStep: () => post("/bt/step"),
  btResume: () => post("/bt/resume"),
  btBreak: (name, onFailureOnly = false) => post("/bt/break", { name, onFailureOnly }),
  btContinue: () => post("/bt/continue"),

  // behaviour tree runner (control_logic_bt state machine) and the NexRoot runner page
  btStructure: () => get("/bt/structure"),
  btTrees: () => get("/bt/trees"),
  runnerStart: ({ cycles = 0, tree = "", dryRun = false, simMode = false } = {}) => post("/bt/runner/start", { cycles, tree, dryRun, simMode }),
  runnerAction: (action) => post(`/bt/runner/${action}`),
  runnerLoad: (xml) => post("/bt/runner/load", { xml }),
  runnerValidate: (xml, o = {}) => post("/bt/runner/validate", { xml, ...o }),
  // the main program (control_data main tree): what Load and Validate use
  runnerLoadMain: () => post("/bt/runner/load", { main: true }),
  runnerValidateMain: () => post("/bt/runner/validate", { main: true, checkPoints: true }),
  operatorReply: (id, choice) => post("/bt/operator-reply", { id, choice }),

  // programs
  programs: () => get("/programs"),
  saveProgram: (program, oldName) => post("/programs", { program, oldName }),
  deleteProgram: (name) => del(`/programs/${encodeURIComponent(name)}`),
  runProgram: (o) => post("/programs/run", o),
  finishProgram: () => post("/programs/finish"),

  sim: (kind, arg) => post(`/sim/${kind}`, { arg }),
};

/** Run a robot call and toast the answer. Returns the answer (or null on a network error). */
export async function robotCall(fn, { success, quietOk = false } = {}) {
  try {
    const r = await fn();
    if (r?.ok === false) toast.error(r.message || "Refused");
    else if (!quietOk) toast.success(success || r?.message || "Done");
    return r;
  } catch (err) {
    toast.error(err?.message || "Request failed");
    return null;
  }
}
