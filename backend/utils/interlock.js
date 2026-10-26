// utils/interlock.js -- changes that must wait while the robot works.
//
// While the robot program (behaviour tree) runs or is paused mid-cycle, or a motion is under
// way, a change to points, motion programs, homes, the tool offset, the PLC program or the
// active project would take effect inside the running cycle (the motion server re-reads points
// and programs on every call, a project load swaps the PLC program). Those routes are wrapped
// with requireIdle(): they answer 409 { code: "ROBOT_BUSY", reasons } and change nothing. The
// browser checks the same thing first (store/interlock.js) and shows the "stop it first" popup.
import { getROSNode } from "../ros/rosService.js";
import { getManager as getPlcManager } from "../plc/plcService.js";

/** Runner states in which a cycle is in progress (control_logic_bt RUNNER.md). */
const RUNNER_ACTIVE = new Set(["RUNNING", "PAUSING", "PAUSED", "STOPPING", "FINISHING", "STEPPING"]);
/** A motion with no status for this long is over (the motion server publishes while it moves). */
const MOTION_QUIET_MS = 5000;

/** What is running right now: [{ key, text }]; empty = the robot is idle. */
export function busyReasons() {
  const reasons = [];
  const ros = getROSNode();
  const runner = ros?.btMon?.runner;
  if (runner && RUNNER_ACTIVE.has(runner.state)) {
    reasons.push({ key: "program", text: runner.state === "PAUSED" ? "The robot program is paused in the middle of a cycle" : "The robot program is running" });
  } else if (ros?.controlActive) {
    reasons.push({ key: "program", text: "The robot program is running" });
  }
  const m = ros?.motion;
  if (m?.active && Date.now() - (ros.motionAt || 0) < MOTION_QUIET_MS) {
    reasons.push({ key: "motion", text: "The robot is moving" });
  }
  return reasons;
}

/** The robot's PLC (Robot mode) and the program it runs, for the project-switch warning. */
export function plcRunning() {
  const m = getPlcManager();
  if (!m || m.mode !== "real") return null;
  const info = m.real?.programInfo;
  return info?.ok ? { program: info.name || "" } : null;
}

export function interlockStatus() {
  const reasons = busyReasons();
  return { busy: reasons.length > 0, reasons, plc: plcRunning() };
}

/** Express middleware: refuse the request while something runs. `action` names it for the popup. */
export function requireIdle(action) {
  return (req, res, next) => {
    const reasons = busyReasons();
    if (!reasons.length) return next();
    res.status(409).json({
      ok: false,
      code: "ROBOT_BUSY",
      action,
      reasons,
      message: `${reasons.map((r) => r.text).join(" and ")}. Stop it first, then ${action}.`,
    });
  };
}

/** Express middleware for a mixed router: only these METHOD /path patterns are guarded. */
export function guardRoutes(action, patterns) {
  const guard = requireIdle(action);
  return (req, res, next) => {
    const hit = patterns.some(([method, re]) => req.method === method && re.test(req.path));
    return hit ? guard(req, res, next) : next();
  };
}
