// Live robot state, fed by the shared WebSocket. Every page reads from here
// instead of keeping its own copy (the old iframes each tracked their own).
import { create } from "zustand";
import { subscribe } from "../lib/ws";
import { subscribeLimited } from "../lib/liveRate";
import { plainText } from "../lib/plainText";

const six = (v) => [v, v, v, v, v, v];
const MAX_LOG_LINES = 600;
const MAX_CYCLE_TIMES = 50;

export const useRobot = create(() => ({
  // Driver / safety
  operational: six(false),
  fault: six(false),
  emergency: six(false),
  homed: six(false),
  hasDriverStatus: false,

  // Motion values
  positions: six(0), // radians, j1..j6
  jointValues: six(0), // degrees (JOINT_VALUES topic)
  cartesian: six(0), // x,y,z (cm), r,p,w (deg)

  // Mode of operation
  mode: null, // 'safeauto' | 'jog' | 'auto' | null
  driveMode: null, // 8 | 9
  modeSwitch: null, // { progress, phase, message, failed } while switching

  // Process / BT
  controlActive: false,
  processStatus: "",
  rosbridgeStatus: "STOPPED",
  servoFrame: null,

  // IO
  doStatus: {}, // { [driver]: { do1, do2, do3, do4 } }
  diStatus: [], // [driver][di1..di5, sto1, sto2, edm]
  gpio: {}, // { [group]: { di: {n: bool}, do: {n: bool} } }
  // Outputs as the controllers ACCEPTED them (applied_commands): what the status dots show
  doApplied: { drivers: {}, gpio: {} },

  // New controllers (supervisor, motion server, drive state broadcaster)
  supervisor: null, // profile, phase, latched, cause, estop, speedOverride, speedScale, isolated, strict …
  motionAt: 0, // when the last motion status arrived
  motion: null, // current / last motion of the motion server (progress, stage, state, error)
  motionHistory: [], // finished motions, newest first (status panel)
  atHome: null, // { atHome, homeName, activeHome, atActiveHome }
  homes: { list: [], active: "" },
  tcp: null, // { speed (m/s), angular, frame }
  driveStates: six(""), // CiA402 state per joint
  lastError: six(0), // last drive error code per joint
  followingError: six(null),
  robotEvents: [], // supervisor + drive error events, newest first
  ioEvents: [], // IO watch edges, newest first

  // Behaviour tree runner (bt_debug_pkg)
  btActive: null, // { cycle, paused, running: [{ name, type, ms }], lastEvent }
  btBlackboard: {},
  btFailure: null, // { node, trace, reason, at } of the last failure
  btRunnerStatus: null, // runner state machine (BT_RUNNER, 2 Hz and on change), for the top-bar program status
  operatorRequest: null, // { id, question, options, timeoutS, at }

  // Misc
  cycleTimes: [], // seconds, newest last
  liveLogs: [], // { id, text, at }
}));

// Derived selectors
export const selectAllOperational = (s) => s.operational.every(Boolean);
export const selectAnyFault = (s) => s.fault.some(Boolean);
export const selectAllHomed = (s) => s.homed.every(Boolean);
export const selectAnyEmergency = (s) => s.emergency.some(Boolean) || Boolean(s.supervisor?.estop);
/** Emergency latched by the supervisor (needs Reset), or the E-stop button pressed. */
export const selectLatched = (s) => Boolean(s.supervisor?.latched);
export const selectMotionActive = (s) => Boolean(s.motion?.active);
export const selectBtRunningNames = (s) => (s.btActive?.running || []).map((r) => r.name);

const MAX_EVENTS = 120;
const MAX_MOTION_HISTORY = 12;
/** A motion with no status for this long is treated as settled. */
const MOTION_QUIET_MS = 4000;

let logSeq = 0;
/** Wire WebSocket messages into the store. Called once at startup. */
export function initRobotStore() {
  const set = useRobot.setState;
  const get = useRobot.getState;

  subscribe("DRIVER_STATUS", (p) => {
    if (!p) return;
    set({
      operational: p.jointStatus || six(false),
      fault: p.faultStatus || six(false),
      hasDriverStatus: true,
      ...(p.states ? { driveStates: p.states, lastError: p.lastError || six(0), followingError: p.followingError || six(null) } : {}),
    });
  });

  subscribe("EMERGENCY_STATUS", (p) => {
    if (p?.jointStatus) set({ emergency: p.jointStatus.map(Boolean) });
  });

  // Joint states arrive at most 5 times per second (rate limited by the backend).
  subscribe("JOINT_STATES", (p) => {
    if (!p?.positions) return;
    set({ positions: p.positions, homed: p.homingStatus || get().homed });
  });

  subscribe("JOINT_VALUES", (p) => {
    if (Array.isArray(p?.values)) set({ jointValues: p.values });
  });

  subscribe("CARTESIAN_VALUES", (p) => {
    const v = p?.values;
    if (Array.isArray(v)) set({ cartesian: v });
    else if (v && typeof v === "object") set({ cartesian: Object.values(v) });
  });

  subscribe("MODE_STATE", (p) => {
    if (!p) return;
    const patch = { driveMode: p.driveMode ?? get().driveMode };
    if (p.mode) patch.mode = p.mode;
    set(patch);
  });
  subscribe("DETECT_MODE_RESULT", (p) => {
    if (p?.mode) set({ mode: p.mode });
  });
  subscribe("MODE_SWITCH_PROGRESS", (p) => {
    // "done" ends a switch that was started by HOME / START (no MODE_SWITCH_RESULT then)
    if (p) set({ modeSwitch: p.phase === "done" ? null : p });
  });
  subscribe("ACTION_RESULT", () => get().modeSwitch && set({ modeSwitch: null }));
  subscribe("MODE_SWITCH_RESULT", (p) => {
    set({ modeSwitch: null, ...(p?.ok && p.mode ? { mode: p.mode } : {}) });
  });

  // ── New controllers ──
  subscribe("SUPERVISOR_STATUS", (p) => p && set({ supervisor: p, mode: p.profile || get().mode }));
  // Motion status. A late "verifying" for a motion that already finished is
  // ignored, and a watchdog settles a motion whose status stream went quiet
  // (the motion server publishes continuously while a motion is active), so
  // nothing in the UI can stay stuck on a running motion.
  const finishedIds = new Set();
  const onMotion = (p) => {
    if (!p) return;
    if (p.id && !p.final && finishedIds.has(p.id)) return;
    if (p.id && p.final && !finishedIds.has(p.id)) {
      finishedIds.add(p.id);
      if (finishedIds.size > 50) finishedIds.delete(finishedIds.values().next().value);
      const entry = { ...p, message: plainText(p.message), at: Date.now() };
      set({ motionHistory: [entry, ...get().motionHistory.filter((m) => m.id !== p.id)].slice(0, MAX_MOTION_HISTORY) });
    }
    set({ motion: p.message ? { ...p, message: plainText(p.message) } : p, motionAt: Date.now() });
  };
  subscribe("MOTION_STATUS", onMotion);
  subscribe("MOTION_RESULT", onMotion);
  setInterval(() => {
    const { motion, motionAt, supervisor } = get();
    if (!motion?.active || Date.now() - motionAt < MOTION_QUIET_MS) return;
    const done = motion.progress >= 0.999 || (motion.state === "verifying" && supervisor?.standstill);
    set({
      motion: {
        ...motion,
        active: false,
        final: true,
        stale: true,
        state: done ? "succeeded" : "unknown",
        message: done ? "Finished (the motion server stopped reporting)" : "No status from the motion server",
      },
    });
  }, 1000);
  subscribe("AT_HOME", (p) => p && set({ atHome: p }));
  subscribe("HOMES", (p) => p && set({ homes: { list: p.list || [], active: p.active || "" } }));
  subscribe("TCP_STATE", (p) => p && set({ tcp: p }));
  subscribe("ROBOT_EVENT", (p) => p && set({ robotEvents: [p, ...get().robotEvents].slice(0, MAX_EVENTS) }));
  subscribe("IO_EVENT", (p) => p && set({ ioEvents: [p, ...get().ioEvents].slice(0, MAX_EVENTS) }));
  // runner texts can carry tree file paths ("tree loaded: /home/…/main_tree.xml"): plain names only
  subscribe("BT_ACTIVE", (p) => p && set({ btActive: p.lastEvent ? { ...p, lastEvent: plainText(p.lastEvent) } : p }));
  subscribe("BT_BLACKBOARD", (p) => p && set({ btBlackboard: p }));
  subscribe("BT_FAILURE", (p) => p && set({ btFailure: p.reason ? { ...p, reason: plainText(p.reason) } : p }));
  subscribe("BT_RUNNER", (p) => set({ btRunnerStatus: p ? (p.message ? { ...p, message: plainText(p.message) } : p) : null }));
  subscribe("OPERATOR_REQUEST", (p) => set({ operatorRequest: p || null }));

  subscribe("CONTROL_ACTIVE", (p) => set({ controlActive: Boolean(p) }));
  subscribe("PROCESS_STATUS", (p) => set({ processStatus: String(p ?? "") }));
  subscribe("ROSBRIDGE_STATUS", (p) => set({ rosbridgeStatus: String(p ?? "STOPPED") }));
  subscribe("SERVO_FRAME_CHANGED", (p) => p?.frame && set({ servoFrame: p.frame }));

  subscribe("DO_STATUS", (p) => {
    if (!p?.driver) return;
    const { driver, ...rest } = p;
    set({ doStatus: { ...get().doStatus, [driver]: { ...get().doStatus[driver], ...rest } } });
  });
  subscribeLimited("DO_APPLIED", 250, (p) => p && set({ doApplied: { drivers: p.drivers || {}, gpio: p.gpio || {} } }));
  subscribe("DI_STATUS", (p) => Array.isArray(p) && set({ diStatus: p }));
  subscribe("GPIO_STATE", (p) => {
    if (!p?.groups) return;
    const next = { ...get().gpio };
    for (const [g, v] of Object.entries(p.groups)) {
      next[g] = { di: { ...(next[g]?.di || {}), ...(v.di || {}) }, do: { ...(next[g]?.do || {}), ...(v.do || {}) } };
    }
    set({ gpio: next });
  });
  subscribe("GPIO_PUBLISH_CONFIRM", (p) => {
    if (!p?.group) return;
    const cur = get().gpio[p.group] || { di: {}, do: {} };
    set({ gpio: { ...get().gpio, [p.group]: { ...cur, do: { ...cur.do, ...(p.do || {}) } } } });
  });


  subscribe("CYCLE_TIME", (p) => {
    if (typeof p !== "number" || !isFinite(p)) return;
    set({ cycleTimes: [...get().cycleTimes, p].slice(-MAX_CYCLE_TIMES) });
  });

  const addLogs = (lines) => {
    const at = Date.now();
    const entries = lines.map((p) => ({ id: ++logSeq, text: typeof p === "string" ? p : JSON.stringify(p), at }));
    set({ liveLogs: [...get().liveLogs, ...entries].slice(-MAX_LOG_LINES) });
  };
  // The backend sends log lines in batches (a few per second at most).
  subscribe("LOG_MESSAGES", (p) => Array.isArray(p) && p.length && addLogs(p));
  subscribe("LOG_MESSAGE_INCOMING", (p) => addLogs([p]));
}

export function clearLiveLogs() {
  useRobot.setState({ liveLogs: [] });
}
