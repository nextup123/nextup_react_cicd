// backend/ros/rateLimit.js
//
// Rate limits for everything the backend forwards from ROS topics to the
// browser. A behaviour tree publishes status and IO topics at its tick rate
// and the drivers publish at their control rate (often 100 Hz or more); the
// UI only needs a few updates per second. Each topic goes through a
// LatestGate: the callback stores the newest message, and the gate hands it
// on at most once per interval. Nothing else runs per message.

/** Interval in ms per kind of data (4 to 5 Hz for live values, slower for the rest). */
export const RATE_MS = Object.freeze({
  JOINT_STATES: 200,      // 5 Hz: joint positions (/joint_states) + per-joint home dots
  JOINT_VALUES: 200,      // 5 Hz
  CARTESIAN_VALUES: 200,  // 5 Hz
  DRIVER_STATUS: 250,     // 4 Hz: operational / fault / CiA402 state per drive (/nextup_joint_states)
  SUPERVISOR: 250,        // 4 Hz: supervisor profile, phase, emergency, speed scale (published at 25 Hz)
  MOTION_STATUS: 200,     // 5 Hz: progress of the running motion (final states go out at once)
  TCP_STATE: 250,         // 4 Hz: TCP speed from the Cartesian broadcaster (published at 50 Hz)
  DIGITAL_INPUTS: 250,    // 4 Hz: driver DI + E-stop (DI5)
  GPIO_STATE: 250,        // 4 Hz
  DO_ECHO: 250,           // 4 Hz: DO command echoes, merged per driver
  BT_STATUS: 250,         // 4 Hz: process status, active flags, running BT nodes
  BT_LIVE: 200,           // 5 Hz: NexRoot runner page, colours of the whole tree (only while the page is open)
  BT_RUNNER: 250,         // 4 Hz max: runner state machine (/control_logic_bt/status, published at 2 Hz + on change)
  BT_BLACKBOARD: 1000,    // 1 Hz: blackboard values (published at 2 Hz per blackboard)
  LOG_BATCH: 250,         // logs are never dropped, only sent in batches
  ROSBRIDGE_STATUS: 1000, // 1 Hz
});

/**
 * Coalesces a stream to its latest value, delivered at most once per
 * `intervalMs`. The first value after a quiet period goes out at once, so a
 * change is never delayed by more than one interval.
 * `merge(prev, next)` (optional) combines values instead of replacing them.
 */
export class LatestGate {
  constructor(intervalMs, deliver, merge = null) {
    this.intervalMs = intervalMs;
    this.deliver = deliver;
    this.merge = merge;
    this.pending = undefined;
    this.hasPending = false;
    this.timer = null;
    this.onTick = this.onTick.bind(this);
  }

  push(value) {
    if (this.hasPending && this.merge) value = this.merge(this.pending, value);
    this.pending = value;
    this.hasPending = true;
    if (!this.timer) this.flush();
  }

  flush() {
    const value = this.pending;
    this.pending = undefined;
    this.hasPending = false;
    this.timer = setTimeout(this.onTick, this.intervalMs);
    try {
      this.deliver(value);
    } catch (err) {
      console.error("[rateLimit] handler failed:", err);
    }
  }

  onTick() {
    this.timer = null;
    if (this.hasPending) this.flush();
  }

  /** Forget a pending value (a newer one was delivered another way). */
  drop() {
    this.pending = undefined;
    this.hasPending = false;
  }

  stop() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.hasPending = false;
    this.pending = undefined;
  }
}

/** Round every number in an array (joint jitter would otherwise defeat dedupe). */
export function roundAll(values, decimals) {
  const f = 10 ** decimals;
  const out = new Array(values.length);
  for (let i = 0; i < values.length; i++) out[i] = Math.round(Number(values[i]) * f) / f;
  return out;
}
