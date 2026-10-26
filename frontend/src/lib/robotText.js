// Plain-language text for the new controllers' states (mirrors backend/ros/interfaces.js).

export const PROFILE_LABEL = { auto: "AUTO", safeauto: "SAFEAUTO", jog: "JOG" };
export const PROFILE_HINT = {
  auto: "Programs run at full speed",
  safeauto: "Motions capped at 30 % speed",
  jog: "Manual jogging (velocity mode)",
};

export const PHASE_TEXT = {
  startup: "Starting up",
  running: "Running",
  mode_settle: "Waiting for standstill",
  mode_write: "Writing drive mode",
  mode_confirm: "Waiting for drives",
  mode_rollback: "Restoring previous mode",
  reset_release: "Releasing emergency",
  reset_pulse: "Resetting faults",
  reset_wait: "Enabling drives",
  emergency: "Emergency latched",
};

export const CAUSE_TEXT = {
  estop_input: "E-stop button pressed",
  drive_fault: "Drive fault",
  drive_disabled: "A drive was disabled",
  external: "Software emergency stop",
  position_jump: "Position jump rejected",
  reset_failed: "Drives did not come back after reset",
  mode_rollback_failed: "Mode change failed and could not be undone",
};

export const MOTION_KIND = {
  home: "Homing",
  goto_point: "Go to point",
  goto_joints: "Go to joints",
  goto_pose: "Go to pose",
  goto_circ: "Circular move",
  sequence: "Sequence",
  program: "Program",
  cartesian_path: "Cartesian path",
  weave: "Weave",
};

export const MOTION_STATE_TEXT = {
  idle: "Idle",
  checking: "Checking",
  planning: "Planning",
  executing: "Moving",
  verifying: "Verifying",
  succeeded: "Done",
  failed: "Failed",
  canceled: "Stopped",
  aborted: "Aborted",
  unknown: "No status",
};

export const motionTitle = (m) => {
  if (!m?.id) return "";
  const kind = MOTION_KIND[m.kind] || m.kind || "Motion";
  return `${m.dryRun ? "Test: " : ""}${kind}${m.target ? ` ${m.target}` : ""}`;
};
