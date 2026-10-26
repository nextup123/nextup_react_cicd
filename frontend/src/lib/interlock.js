// Safety interlock: changes that would take effect inside a running cycle (points, motion
// programs, homes, tool offset, planner, PLC program, project switch) wait until the robot
// program is stopped and the robot stands still. Every such request is checked here before it
// leaves the browser (api.js calls guardRequest); the server checks the same thing again
// (backend utils/interlock.js, 409 ROBOT_BUSY). Either way the user gets one popup
// (layout/BusyPopup.jsx) and nothing is changed.
import { create } from "zustand";
import { useRobot } from "../store/robot";
import { setToastFilter } from "../store/toast";

const RUNNER_ACTIVE = new Set(["RUNNING", "PAUSING", "PAUSED", "STOPPING", "FINISHING", "STEPPING"]);

/** What runs right now: [{ key, text }]; empty = idle. */
export function busyReasons(s = useRobot.getState()) {
  const out = [];
  const state = s.btRunnerStatus?.state;
  if (state && RUNNER_ACTIVE.has(state)) out.push({ key: "program", text: state === "PAUSED" ? "The robot program is paused in the middle of a cycle" : "The robot program is running" });
  else if (s.controlActive) out.push({ key: "program", text: "The robot program is running" });
  if (s.motion?.active) out.push({ key: "motion", text: "The robot is moving" });
  return out;
}

/** true while anything runs (re-renders on change). */
export const useRobotBusy = () => useRobot((s) => busyReasons(s).length > 0);

export const useBusyPopup = create(() => ({ open: false, action: "", reasons: [], at: 0 }));

export function showBusy(action, reasons) {
  useBusyPopup.setState({ open: true, action: action || "make this change", reasons: reasons || busyReasons(), at: Date.now() });
}
export const closeBusy = () => useBusyPopup.setState({ open: false });

/** Call before a change: true = go ahead; false = something runs, the popup is shown. */
export function guardIdle(action) {
  const reasons = busyReasons();
  if (!reasons.length) return true;
  showBusy(action, reasons);
  return false;
}

/** The error a refused request throws (callers may ignore it: the popup already told the user). */
export class RobotBusyError extends Error {
  constructor(action, reasons) {
    super(`${reasons.map((r) => r.text).join(" and ")}. Stop it first, then ${action}.`);
    this.name = "RobotBusyError";
    this.code = "ROBOT_BUSY";
    this.status = 409;
    this.reasons = reasons;
  }
}

// METHOD + path of every request that changes something the running cycle uses (same list as
// the server's, see server.js "SAFETY INTERLOCK").
const GUARDED = [
  ["POST", /^\/point-planning\/(addPoint|updatePoint|deletePoint|deleteAll|reorderPoints|undo|editedPoint)$/, "change the points"],
  ["POST", /^\/robot\/(programs|programs\/order|programs\/create-file)$/, "change the motion programs"],
  ["PUT", /^\/robot\/programs\/raw$/, "change the motion programs"],
  ["DELETE", /^\/robot\/programs\/[^/]+$/, "change the motion programs"],
  ["POST", /^\/robot\/(tcp-offset|speed-limits|homes\/teach|homes\/active|config\/homing|config\/goto)$/, "change this setting"],
  ["DELETE", /^\/robot\/homes\/[^/]+$/, "change the homes"],
  ["POST", /^\/ros\/(togglePlanner|setMotionType)$/, "change the planner"],
  ["POST", /^\/api\/projects\/(load|overwrite|restore)$/, "switch the project"],
  ["POST", /^\/plc-api\/system\/mode$/, "switch to the robot's PLC", (body) => body?.mode === "real"],
  ["POST", /^\/plc-api\/(programs\/load|plc\/load)$/, "change the PLC program", () => plcIsReal()],
  ["POST", /^\/ecat-api\/(sdo\/set|reset|homing|homing\/batch|driver-config\/apply|recipes\/execute|node\/start|node\/stop)$/, "write to the drives"],
];

// loading into the simulated PLC reaches nothing: only the robot's PLC is guarded
let plcIsReal = () => true;
/** The NextPLC store says which PLC the pages talk to. */
export function setPlcModeProbe(fn) {
  plcIsReal = fn;
}

/** api.js: refuse a guarded request while something runs (throws RobotBusyError). */
export function guardRequest(method, path, body) {
  const p = String(path).split("?")[0];
  const hit = GUARDED.find(([m, re, , when]) => m === method && re.test(p) && (!when || when(body)));
  if (!hit) return;
  const reasons = busyReasons();
  if (!reasons.length) return;
  showBusy(hit[2], reasons);
  throw new RobotBusyError(hit[2], reasons);
}

/** api.js: the server refused (409 ROBOT_BUSY): same popup. */
export function onServerBusy(data) {
  showBusy(data?.action, Array.isArray(data?.reasons) ? data.reasons : []);
}

/** Error toasts for a refusal the popup already shows are dropped (store/toast.js asks). */
export function isBusyEcho(message) {
  const { at, open } = useBusyPopup.getState();
  return open && Date.now() - at < 3000 && /Stop it first/.test(String(message || ""));
}
setToastFilter((kind, text) => kind === "error" && isBusyEcho(text));
