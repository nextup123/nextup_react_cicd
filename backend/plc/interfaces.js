// plc/interfaces.js -- names of the nextplc topics / services and the views sent to the browser.
// The views are built from the ROS messages (PlcBridge) or from the JS engine (SimPlcBridge),
// so the frontend never knows which one it talks to. Toasts of the PLC (/bt_toast_popup) already
// reach the browser through the robot bridge, so they are not subscribed here.

export const TOPIC = {
  state: "/nextplc/state",          // nextplc/msg/PlcState, 50 Hz
  program: "/nextplc/program",      // nextplc/msg/ProgramInfo, latched
  alarms: "/nextplc/alarms",        // nextplc/msg/Alarm
  setBits: "/nextplc/set_bits",     // nextplc/msg/SetBits (fire and forget)
  supervisor: "/nextup_motion_supervisor/status",
};
export const SRV = {
  setBits: "/nextplc/set_bits",
  getBits: "/nextplc/get_bits",
  loadProgram: "/nextplc/load_program",
  forceBit: "/nextplc/force_bit",
};
export const MSG = {
  PlcState: "nextplc/msg/PlcState",
  ProgramInfo: "nextplc/msg/ProgramInfo",
  Alarm: "nextplc/msg/Alarm",
  SetBits: "nextplc/msg/SetBits",
};
export const SRV_TYPE = {
  SetBits: "nextplc/srv/SetBits",
  GetBits: "nextplc/srv/GetBits",
  LoadProgram: "nextplc/srv/LoadProgram",
  ForceBit: "nextplc/srv/ForceBit",
};

/** WebSocket frame types (type/payload, like nextup-react). */
export const WS = {
  state: "PLC_STATE",
  program: "PLC_PROGRAM",
  alarm: "PLC_ALARM",
  toast: "PLC_TOAST",
  event: "PLC_EVENT",      // one log line {time, level, text}
  bridge: "PLC_BRIDGE",    // {simulated, ready, message}
  sim: "PLC_SIM",          // simulator-only panel state {supervisor, inputs...}
};

/** nextplc/msg/PlcState -> the browser view. */
export function stateView(m) {
  const nI = 56, nQ = 32;
  const bits = {};
  for (let i = 0; i < m.bit_names.length; i++) bits[m.bit_names[i]] = m.bit_values[i] ? 1 : 0;
  const forced = [];
  for (let i = 0; i < m.bit_names.length; i++) if (m.bit_forced[i]) forced.push(m.bit_names[i]);
  const logicQ = {}, controlled = {};
  for (let q = 0; q < nQ; q++) {
    const name = m.bit_names[nI + q];
    logicQ[name] = m.logic_q[q] ? 1 : 0;
    controlled[name] = Boolean(m.q_controlled[q]);
  }
  const regs = {};
  for (let r = 0; r < m.reg_names.length; r++) regs[m.reg_names[r]] = Number(m.reg_values[r]);
  const aliases = m.alias_names.map((a, i) => ({ alias: a, target: m.alias_targets[i] }));
  const seqs = m.seq_names.map((name, i) => ({ name, step: Number(m.seq_steps[i] ?? 0), step_name: m.seq_step_names[i] ?? "" }));
  const rungs = (m.rung_texts || []).map((text, i) => ({ text, result: Boolean(m.rung_results?.[i]) }));
  return {
    program: m.program,
    program_ok: Boolean(m.program_ok),
    safe_state: Boolean(m.safe_state),
    scan_count: Number(m.scan_count),
    scan_time_ms: round2(m.scan_time_ms),
    scan_period_ms: round2(m.scan_period_ms),
    forced_count: Number(m.forced_count),
    bits, forced, logic_q: logicQ, q_controlled: controlled, regs, aliases, seqs, rungs,
  };
}

/** nextplc/msg/ProgramInfo -> the browser view. */
export function programView(m) {
  return {
    ok: Boolean(m.ok),
    name: m.name || "",
    path: m.path || "",
    error: m.error || "",
    text: m.text || "",
    rung_count: Number(m.rung_count || 0),
    sequence_count: Number(m.sequence_count || 0),
    has_emergency: Boolean(m.has_emergency),
    blocks: Array.isArray(m.blocks) ? [...m.blocks] : [],
  };
}

export function alarmView(m) {
  return { bit: m.bit, text: m.text, level: m.level, active: Boolean(m.active), time: Date.now() };
}

const round2 = (v) => Math.round(Number(v || 0) * 100) / 100;
