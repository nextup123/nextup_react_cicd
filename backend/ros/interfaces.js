// backend/ros/interfaces.js
//
// Everything the web backend needs to know about the new NextUp controllers
// (nextup_controllers) and the motion stack (motion_server_pkg, utility_pkg,
// bt_debug_pkg): service and topic names, message enums, error codes, and
// small "view" functions that turn a ROS message into the JSON the browser
// gets. Kept in one place so a renamed service is a one-line change.
//
// The core idea of the new stack: commands are SERVICES (with a real answer
// and an error code), and only a few topics carry status:
//   /nextup_motion_supervisor/status   profile, phase, emergency, speed scale
//   /nextup_motion_server/status       the running / last motion
//   /nextup_motion_server/at_home      at a home or not
// plus the drive and IO broadcasters.

const SUP = '/nextup_motion_supervisor';
const DSB = '/nextup_drive_state_broadcaster';
const MS = '/nextup_motion_server';
const BT_RUNNER = '/control_logic_bt_runner';
const BT = '/control_logic_bt';

const T = 'std_srvs/srv/Trigger';
const SB = 'std_srvs/srv/SetBool';
const J = (n) => `nextup_joint_interfaces/srv/${n}`;
const U = (n) => `nextup_utility_interface/srv/${n}`;
const C = (n) => `control_logic_bt_interfaces/srv/${n}`;

/** key → [service type, service name]. */
export const SRV = Object.freeze({
  // nextup_motion_supervisor: the only writer of mode, reset, emergency and overspeed
  setOperationMode: [J('SetOperationMode'), `${SUP}/set_operation_mode`],
  resetFault: [T, `${SUP}/reset_fault`],
  triggerEmergency: [T, `${SUP}/trigger_emergency`],
  setEmergencyLatching: [SB, `${SUP}/set_emergency_latching`],
  setSpeedOverride: [J('SetSpeedOverride'), `${SUP}/set_speed_override`],
  setModeSpeedLimits: [J('SetModeSpeedLimits'), `${SUP}/set_mode_speed_limits`],
  getModeSpeedLimits: [J('GetModeSpeedLimits'), `${SUP}/get_mode_speed_limits`],
  getEventLog: [J('GetErrorLog'), `${SUP}/get_event_log`],
  clearEventLog: [T, `${SUP}/clear_event_log`],

  // nextup_drive_state_broadcaster: drive errors, fault counters, IO watch
  getErrorLog: [J('GetErrorLog'), `${DSB}/get_error_log`],
  clearErrorLog: [T, `${DSB}/clear_error_log`],
  getFaultCounters: [J('GetFaultCounters'), `${DSB}/get_fault_counters`],
  resetFaultCounters: [T, `${DSB}/reset_fault_counters`],
  reloadCodeTable: [T, `${DSB}/reload_code_table`],
  setIoWatch: [J('SetIoWatch'), `${DSB}/set_io_watch`],
  getIoWatch: [J('GetIoWatch'), `${DSB}/get_io_watch`],
  getIoLog: [J('GetIoLog'), `${DSB}/get_io_log`],
  startIoTrace: [J('StartIoTrace'), `${DSB}/start_io_trace`],

  // nextup_cartesian_broadcaster
  setTcpOffset: [J('SetTcpOffset'), '/nextup_cartesian_broadcaster/set_tcp_offset'],

  // nextup_motion_server: one motion server for web, BT and CLI
  home: [U('StartHoming'), `${MS}/home`],
  gotoPoint: [U('GotoPoint'), `${MS}/goto_point`],
  gotoJoints: [U('GotoJoints'), `${MS}/goto_joints`],
  gotoPose: [U('GotoPose'), `${MS}/goto_pose`],
  runSequence: [U('RunSequence'), `${MS}/run_sequence`],
  runProgram: [U('RunProgram'), `${MS}/run_program`],
  finishProgram: [T, `${MS}/finish_program`],
  listPrograms: [U('ListPrograms'), `${MS}/list_programs`],
  stopMotion: [T, `${MS}/stop`],
  resetMotionServer: [T, `${MS}/reset`],
  clearPlanCache: [T, `${MS}/clear_plan_cache`],
  listPoints: [U('ListPoints'), `${MS}/list_points`],
  listHomes: [U('ListHomes'), `${MS}/homing/list`],
  teachHome: [U('TeachHome'), `${MS}/homing/teach`],
  setActiveHome: [U('SetActiveHome'), `${MS}/homing/set_active`],
  deleteHome: [U('DeleteHome'), `${MS}/homing/delete`],
  getHomingConfig: [U('GetHomingConfig'), `${MS}/homing/get_config`],
  setHomingConfig: [U('SetHomingConfig'), `${MS}/homing/set_config`],
  getGotoConfig: [U('GetGotoConfig'), `${MS}/goto/get_config`],
  setGotoConfig: [U('SetGotoConfig'), `${MS}/goto/set_config`],

  // utility_pkg ui_command_node (jog) and MoveIt Servo
  setJogFrame: [U('SetJogFrame'), '/ui_command_node/set_frame'],
  startServo: [T, '/servo_node/start_servo'],

  // control_logic_bt runner step mode (bt_debug_pkg)
  btPause: [T, `${BT_RUNNER}/debug/pause`],
  btStep: [T, `${BT_RUNNER}/debug/step`],
  btResume: [T, `${BT_RUNNER}/debug/resume`],
  btBreakAt: [U('SetBtBreakpoint'), `${BT_RUNNER}/debug/break_at`],

  // control_logic_bt runner commands (state machine, docs/RUNNER.md)
  runnerStart: [C('StartRun'), `${BT}/start`],
  runnerStop: [T, `${BT}/stop`],
  runnerFinishCycle: [T, `${BT}/finish_cycle`],
  runnerAbort: [T, `${BT}/abort`],
  runnerPause: [T, `${BT}/pause`],
  runnerResume: [T, `${BT}/resume`],
  runnerStep: [T, `${BT}/step`],
  runnerReset: [T, `${BT}/reset`],
  runnerLoadTree: [C('LoadTree'), `${BT}/load_tree`],
  runnerValidateTree: [C('ValidateTree'), `${BT}/validate_tree`],
});

/** Topics the bridge subscribes to or publishes on. */
export const TOPIC = Object.freeze({
  SUPERVISOR_STATUS: `${SUP}/status`,
  SUPERVISOR_EVENTS: `${SUP}/events`,
  MOTION_STATUS: `${MS}/status`,
  AT_HOME: `${MS}/at_home`,
  JOINT_STATES: '/joint_states',
  NEXTUP_JOINT_STATES: '/nextup_joint_states',
  DIGITAL_INPUTS: '/nextup_digital_inputs',
  CARTESIAN_STATE: '/nextup_cartesian_broadcaster/state',
  JOINT_VALUES: '/joint_values',
  CARTESIAN_VALUES: '/cartesian_values',
  ERROR_EVENTS: `${DSB}/error_events`,
  IO_EVENTS: `${DSB}/io_events`,
  BT_TREE: '/control_logic_bt/tree',
  BT_ACTIVE: '/control_logic_bt/active',
  BT_BLACKBOARD: '/control_logic_bt/blackboard',
  BT_EVENTS: '/control_logic_bt/events',
  BT_STATUS: '/control_logic_bt/status',
  BT_OPERATOR_REQUEST: '/bt_operator_request',
  BT_OPERATOR_REPLY: '/bt_operator_reply',
  BT_BREAKPOINT_CONTINUE: '/bt_breakpoint_continue',
  // Digital outputs (new controllers): one command topic for all joints, and the commands the
  // controllers ACCEPTED (republished on applied_commands = the output reached the controller)
  DO_COMMANDS: '/nextup_digital_output_controller/commands',
  DO_APPLIED: '/nextup_digital_output_controller/applied_commands',
  GPIO_COMMANDS: '/nextup_gpio_command_controller/commands',
  GPIO_APPLIED: '/nextup_gpio_command_controller/applied_commands',
  // supervisor compatibility topic, only used when its service is missing
  COMPAT_EMERGENCY: '/nextup_emergency_trigger_controller/commands',
});

/** Message types whose generated rclnodejs bindings must match the installed .msg files. */
export const CUSTOM_TYPES = Object.freeze([
  'nextup_joint_interfaces/msg/NextupSupervisorStatus',
  'nextup_joint_interfaces/msg/NextupJointState',
  'nextup_joint_interfaces/msg/NextupDigitalInputs',
  'nextup_joint_interfaces/msg/NextupCartesianState',
  'nextup_joint_interfaces/msg/NextupErrorEvent',
  'nextup_joint_interfaces/msg/NextupIoEvent',
  'nextup_joint_interfaces/msg/NextupDigitalOutputsCommand',
  'nextup_utility_interface/msg/MotionStatus',
  'nextup_utility_interface/msg/AtHome',
  'nextup_utility_interface/msg/BtActive',
  'nextup_utility_interface/msg/BtTree',
  'nextup_utility_interface/msg/BtBlackboard',
  'nextup_utility_interface/msg/BtEvent',
  'control_logic_bt_interfaces/msg/RunnerStatus',
]);

/* ─────────────── supervisor enums (NextupSupervisorStatus.msg) ─────────────── */

export const PROFILE = Object.freeze({ 0: null, 1: 'auto', 2: 'safeauto', 3: 'jog' });
export const PROFILE_ID = Object.freeze({ auto: 1, safeauto: 2, jog: 3 });
export const PROFILE_LABEL = Object.freeze({ auto: 'AUTO', safeauto: 'SAFEAUTO', jog: 'JOG' });

export const PHASE = Object.freeze([
  'startup', 'running', 'mode_settle', 'mode_write', 'mode_confirm',
  'mode_rollback', 'reset_release', 'reset_pulse', 'reset_wait', 'emergency',
]);
export const PHASE_TEXT = Object.freeze({
  startup: 'Starting up: waiting for the drives',
  running: 'Running',
  mode_settle: 'Mode change: waiting for standstill',
  mode_write: 'Mode change: writing the drive mode',
  mode_confirm: 'Mode change: waiting for the drives to confirm',
  mode_rollback: 'Mode change failed: restoring the previous mode',
  reset_release: 'Reset: releasing the emergency',
  reset_pulse: 'Reset: pulsing fault reset',
  reset_wait: 'Reset: waiting for the drives to enable',
  emergency: 'Emergency latched',
});
/** Progress (percent) shown for each phase of a mode change or reset. */
export const PHASE_PROGRESS = Object.freeze({
  mode_settle: 25, mode_write: 50, mode_confirm: 75, mode_rollback: 90,
  reset_release: 30, reset_pulse: 60, reset_wait: 85,
});

export const CAUSE = Object.freeze([
  null, 'estop_input', 'drive_fault', 'drive_disabled', 'external',
  'position_jump', 'reset_failed', 'mode_rollback_failed',
]);
export const CAUSE_TEXT = Object.freeze({
  estop_input: 'E-stop button pressed',
  drive_fault: 'Drive fault',
  drive_disabled: 'A drive left OPERATION_ENABLED',
  external: 'Software emergency (E-STOP button or a program)',
  position_jump: 'Position jump rejected',
  reset_failed: 'Drives did not come back after reset',
  mode_rollback_failed: 'Mode change failed and could not be undone',
});

export const RESULT = Object.freeze([null, 'in_progress', 'success', 'failed', 'rejected']);

export const FAILURE = Object.freeze([
  null, 'busy', 'emergency_latched', 'drives_not_ready', 'not_standstill', 'estop_active',
  'settle_timeout', 'mode_confirm_timeout', 'reset_timeout', 'invalid_request',
  'aborted_by_emergency', 'jog_only_isolated',
]);
export const FAILURE_TEXT = Object.freeze({
  busy: 'The supervisor is busy with another request',
  emergency_latched: 'Emergency is latched: press Reset first',
  drives_not_ready: 'Drives are not ready',
  not_standstill: 'The robot is moving: wait until it stands still',
  estop_active: 'The E-stop button is pressed',
  settle_timeout: 'The robot did not come to a standstill in time',
  mode_confirm_timeout: 'The drives did not confirm the new mode',
  reset_timeout: 'The drives did not enable after the reset',
  invalid_request: 'Invalid request',
  aborted_by_emergency: 'Aborted by an emergency',
  jog_only_isolated: 'A joint is isolated: only JOG is allowed until it is reset',
});

/* ─────────────── motion server (MotionStatus.msg) ─────────────── */

export const MOTION_STATE = Object.freeze([
  'idle', 'checking', 'planning', 'executing', 'verifying',
  'succeeded', 'failed', 'canceled', 'aborted',
]);
export const MOTION_ACTIVE = new Set(['checking', 'planning', 'executing', 'verifying']);
export const MOTION_FINAL = new Set(['succeeded', 'failed', 'canceled', 'aborted']);

export const MOTION_ERROR = Object.freeze([
  'E_OK', 'E_BUSY', 'E_NOT_READY', 'E_NO_JOINT_STATE', 'E_EMERGENCY_ACTIVE',
  'E_JOG_MODE_ACTIVE', 'E_DRIVES_NOT_READY', 'E_CONTROLLER_INACTIVE', 'E_UNKNOWN_TARGET',
  'E_INVALID_TARGET', 'E_TARGET_IN_COLLISION', 'E_PLANNING_FAILED', 'E_LIN_NOT_FEASIBLE',
  'E_EXECUTION_FAILED', 'E_TARGET_NOT_REACHED', 'E_STALLED', 'E_CANCELED', 'E_FILE_ERROR',
  'E_HOME_LOCKED', 'E_SUPERVISOR_UNAVAILABLE', 'E_UNREACHABLE',
]);
/** One plain sentence per error code, for toasts. */
export const MOTION_ERROR_TEXT = Object.freeze({
  E_BUSY: 'Another motion is running',
  E_NOT_READY: 'The motion planner is not ready yet',
  E_NO_JOINT_STATE: 'No fresh joint positions from the robot',
  E_EMERGENCY_ACTIVE: 'Emergency is active',
  E_JOG_MODE_ACTIVE: 'The robot is in JOG mode',
  E_DRIVES_NOT_READY: 'Drives are not ready (not armed, not enabled, or a joint is isolated)',
  E_CONTROLLER_INACTIVE: 'The trajectory controller is not active',
  E_UNKNOWN_TARGET: 'Unknown point, home or frame',
  E_INVALID_TARGET: 'Invalid target (missing joint, out of limits)',
  E_TARGET_IN_COLLISION: 'The target is in collision',
  E_PLANNING_FAILED: 'Planning failed',
  E_LIN_NOT_FEASIBLE: 'No straight-line path to the target',
  E_EXECUTION_FAILED: 'Execution failed',
  E_TARGET_NOT_REACHED: 'The target was not reached within tolerance',
  E_STALLED: 'The robot stalled while moving',
  E_CANCELED: 'Stopped',
  E_FILE_ERROR: 'A configuration file could not be read or written',
  E_HOME_LOCKED: 'This home is locked',
  E_SUPERVISOR_UNAVAILABLE: 'No status from the motion supervisor',
  E_UNREACHABLE: 'The pose cannot be reached',
});

/* ─────────────── helpers ─────────────── */

const arr = (v) => (v == null ? [] : Array.from(v));
const num = (v, d = 0) => (typeof v === 'number' && isFinite(v) ? v : typeof v === 'bigint' ? Number(v) : d);
const round = (v, d = 3) => Math.round(num(v) * 10 ** d) / 10 ** d;

/** NextupSupervisorStatus → browser JSON (only what changes the UI). */
export function supervisorView(m) {
  const names = arr(m.name);
  const profile = PROFILE[m.profile] ?? null;
  const targetProfile = PROFILE[m.target_profile] ?? null;
  const phase = PHASE[m.phase] || `phase_${m.phase}`;
  const cause = CAUSE[m.emergency_cause] ?? null;
  const ej = num(m.emergency_joint, -1);
  return {
    profile,
    targetProfile,
    driveMode: num(m.drive_mode) || null,
    phase,
    armed: Boolean(m.armed),
    latched: Boolean(m.emergency_latched),
    cause,
    causeJoint: ej >= 0 ? names[ej] || `joint${ej + 1}` : null,
    estop: Boolean(m.estop_input),
    allEnabled: Boolean(m.all_operation_enabled),
    anyFault: Boolean(m.any_fault),
    standstill: Boolean(m.standstill),
    strict: m.strict_latching === undefined ? true : Boolean(m.strict_latching),
    speedOverride: num(m.speed_override),
    speedScale: num(m.speed_scale),
    names,
    thresholds: arr(m.overspeed_threshold).map(Number),
    isolated: arr(m.isolated).map(Boolean),
    request: {
      id: num(m.last_request_id),
      result: RESULT[m.last_result] ?? null,
      failure: FAILURE[m.last_failure] ?? null,
    },
  };
}

/** MotionStatus → browser JSON. */
export function motionView(m) {
  const state = MOTION_STATE[m.state] || 'idle';
  const code = num(m.error_code);
  return {
    id: m.motion_id || '',
    kind: m.kind || '',
    target: m.target || '',
    motionType: m.motion_type || '',
    planner: m.planner_id || '',
    state,
    active: MOTION_ACTIVE.has(state),
    final: MOTION_FINAL.has(state),
    stage: num(m.stage),
    stageCount: num(m.stage_count),
    stageLabel: m.stage_label || '',
    progress: round(m.progress, 3),
    speed: round(m.speed_mps, 3),
    acceleration: round(m.acceleration_mps2, 3),
    achievedSpeed: round(m.achieved_speed_mps, 3),
    speedScale: num(m.supervisor_speed_scale),
    dryRun: Boolean(m.dry_run),
    errorCode: code,
    error: code ? MOTION_ERROR[code] || `E_${code}` : null,
    message: m.message || '',
    targetJoints: arr(m.target_joints).map((v) => round(v, 5)),
    elapsed: round(m.elapsed_s, 1),
    cached: Boolean(m.cached_plan),
    pathFraction: round(m.path_fraction, 4),
    pathLength: round(m.path_length_mm, 1),
  };
}

/** Start-service answer → { ok, accepted, motionId, errorCode, error, message, targetJoints }. */
export function startAnswer(res) {
  const code = num(res?.error_code);
  const error = code ? MOTION_ERROR[code] || `E_${code}` : null;
  return {
    ok: Boolean(res?.accepted),
    accepted: Boolean(res?.accepted),
    motionId: res?.motion_id || '',
    errorCode: code,
    error,
    message: res?.message || (error ? MOTION_ERROR_TEXT[error] || error : ''),
    targetJoints: arr(res?.target_joints).map(Number),
    loops: res?.loops,
    stepCount: res?.step_count,
  };
}

/** NextupErrorEvent → JSON (event log and error log entries). */
export function errorEventView(e) {
  const sec = num(e?.stamp?.sec);
  return {
    stamp: sec ? sec * 1000 + Math.round(num(e?.stamp?.nanosec) / 1e6) : null,
    time: e?.time || '',
    source: e?.source || '',
    joint: e?.joint || '',
    event: e?.event || '',
    code: num(e?.code),
    codeHex: e?.code_hex || '',
    previousCode: num(e?.previous_code),
    description: e?.description || '',
    state: e?.state || '',
    statusword: num(e?.statusword),
    mode: num(e?.mode),
    count: num(e?.count, 1),
    detail: e?.detail || '',
  };
}

/** NextupIoEvent → JSON. */
export function ioEventView(e) {
  const sec = num(e?.stamp?.sec);
  return {
    stamp: sec ? sec * 1000 + Math.round(num(e?.stamp?.nanosec) / 1e6) : null,
    time: e?.time || '',
    signal: e?.signal || '',
    device: e?.device || '',
    input: e?.input || '',
    bit: num(e?.bit),
    event: e?.event || '',
    value: Boolean(e?.value),
    wasFor: round(e?.was_for_s, 3),
    count: num(e?.count),
    positionsDeg: arr(e?.positions_deg).map((v) => round(v, 2)),
    profile: e?.profile || '',
    phase: PHASE[e?.phase] || '',
    detail: e?.detail || '',
  };
}

/** BtActive → JSON. */
export function btActiveView(m) {
  return {
    cycle: num(m.cycle),
    treeId: m.tree_id || '',
    paused: Boolean(m.paused),
    ticks: num(m.tick_count),
    running: arr(m.running).map((r) => ({
      uid: num(r.uid),
      name: r.name || '',
      type: r.type || '',
      ms: Math.round(num(r.since_ms)),
    })),
    ancestors: arr(m.ancestors),
    lastEvent: m.last_event || '',
  };
}

/** BtTree → JSON (summary; the full structure is the XML the editor already has). */
export function btTreeView(m) {
  return {
    treeId: m.tree_id || '',
    xmlFile: m.xml_file || '',
    hash: m.tree_hash || '',
    nodeCount: arr(m.nodes).length,
    warnings: arr(m.warnings),
  };
}

/**
 * "[bt][failure]FAILED_NODE: X TRACE: A -> B -> X TIME: ... REASON: ..." (bt_debug_pkg
 * log line) → { node, trace[], reason } or null. Parsing the log line costs nothing extra:
 * the line arrives anyway, so the high-rate /control_logic_bt/events topic is not needed.
 */
export function parseBtFailure(line) {
  if (typeof line !== 'string' || !line.includes('[bt][failure]')) return null;
  const grab = (key, next) => {
    const i = line.indexOf(`${key}:`);
    if (i < 0) return '';
    const from = i + key.length + 1;
    let to = line.length;
    for (const n of next) {
      const j = line.indexOf(` ${n}:`, from);
      if (j >= 0 && j < to) to = j;
    }
    return line.slice(from, to).trim();
  };
  const node = grab('FAILED_NODE', ['TRACE', 'TIME', 'REASON']);
  if (!node) return null;
  const trace = grab('TRACE', ['TIME', 'REASON']).split('->').map((s) => s.trim()).filter(Boolean);
  return { node, trace, reason: grab('REASON', []), at: Date.now() };
}

/** "/bt_operator_request" payload "id,question,opt1|opt2,timeout_s" → object. */
export function parseOperatorRequest(data) {
  const parts = String(data || '').split(',');
  if (parts.length < 2) return null;
  const id = parts[0].trim();
  const timeout = Number(parts[parts.length - 1]);
  const hasTimeout = parts.length >= 4 && isFinite(timeout);
  const options = (parts.length >= 3 ? parts[hasTimeout ? parts.length - 2 : parts.length - 1] : 'Continue|Abort')
    .split('|').map((s) => s.trim()).filter(Boolean);
  const question = parts.slice(1, hasTimeout ? parts.length - 2 : parts.length - 1).join(',').trim();
  return { id, question, options: options.length ? options : ['Continue'], timeoutS: hasTimeout ? timeout : 0, at: Date.now() };
}

/* ─────────────── digital outputs (NextupDigitalOutputsCommand.msg) ─────────────── */

/** Fields of the message in output order: do1, do2, do3, pi_p (= DO 4 in the UI). */
export const DO_FIELDS = Object.freeze(['do1', 'do2', 'do3', 'pi_p']);

/**
 * NextupDigitalOutputsCommand -> { [driver]: { do1: bool, …, do4: bool } } with only the outputs
 * the message sets (1 = ON, 0 = OFF; -1 = leave as it is is skipped). `name` empty = joint1..6 in
 * order; the driver number is the joint name's trailing number ("joint3" -> 3).
 */
export function doCommandView(msg, jointOrder) {
  const names = Array.from(msg?.name || []);
  const out = {};
  DO_FIELDS.forEach((field, k) => {
    const vals = Array.from(msg?.[field] || []);
    vals.forEach((v, i) => {
      const n = Number(v);
      if (n !== 0 && n !== 1) return;
      const joint = names.length ? names[i] : jointOrder[i];
      const m = /(\d+)$/.exec(String(joint || ''));
      if (!m) return;
      const d = Number(m[1]);
      (out[d] || (out[d] = {}))[`do${k + 1}`] = n === 1;
    });
  });
  return out;
}

/** control_msgs/DynamicInterfaceGroupValues -> { [group]: { [channel]: bool } } for do<N> names. */
export function gpioCommandView(msg) {
  const out = {};
  (msg?.interface_groups || []).forEach((g, gi) => {
    const iv = msg.interface_values?.[gi];
    if (!iv) return;
    (iv.interface_names || []).forEach((name, i) => {
      const m = /^do0*(\d+)$/i.exec(name);
      if (m) (out[g] || (out[g] = {}))[Number(m[1])] = Boolean(iv.values?.[i]);
    });
  });
  return out;
}
