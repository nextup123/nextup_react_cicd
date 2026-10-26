// backend/ros/robotOps.js
//
// Robot operations on top of the services, shared by the WebSocket handler
// and the /robot REST routes. Each returns a plain result object
// ({ ok, message, ... }) and never throws, so callers can send it straight
// to the browser.
//
// Asynchronous services (mode change, reset, motions) answer at once with
// "accepted" plus an id; the final result arrives later on a status topic.
// These helpers follow the status until that result (with a time limit).

import {
  PROFILE_ID, PROFILE_LABEL, PHASE_TEXT, PHASE_PROGRESS, FAILURE_TEXT, CAUSE_TEXT,
  startAnswer, MOTION_ERROR_TEXT,
} from './interfaces.js';

const MODE_RESULT_TIMEOUT_MS = 8000; // settle (2 s) + confirm (1 s) + rollback, with margin
const RESET_TIMEOUT_MS = 6000; // release + pulse + wait (3 s), with margin

const fail = (message, extra = {}) => ({ ok: false, message, ...extra });

/** Text for a supervisor that refuses motion, or null when motion is possible. */
export function motionBlocker(s) {
  if (!s) return null; // unknown: let the motion server decide
  if (s.estop) return 'The E-stop button is pressed';
  if (s.latched) return `Emergency is latched (${CAUSE_TEXT[s.cause] || s.cause || 'unknown cause'}): press Reset first`;
  return null;
}

/**
 * Switch the supervisor profile (AUTO / SAFEAUTO / JOG) and wait for the result.
 * onProgress({ phase, progress, message }) streams the supervisor's phases.
 */
export async function switchProfile(ros, mode, { onProgress } = {}) {
  const profile = PROFILE_ID[mode];
  if (!profile) return fail(`Invalid mode '${mode}'`);
  const label = PROFILE_LABEL[mode];
  const s = ros.supervisor;
  if (s && s.profile === mode && s.targetProfile === mode && s.phase === 'running') {
    return { ok: true, mode, message: `Already in ${label}` };
  }
  if (s?.latched && mode !== 'jog') return fail(`Cannot switch to ${label}: emergency is latched, press Reset first`, { mode });

  onProgress?.({ phase: 'request', progress: 5, message: `Requesting ${label}` });
  const r = await ros.callService('setOperationMode', { profile }, { timeoutMs: 2000 });
  if (!r.ok) return fail(`Mode change failed: ${r.message}`, { mode, unavailable: r.unavailable });
  if (!r.response.accepted) return fail(r.response.message || `${label} was refused`, { mode });

  const id = Number(r.response.request_id);
  let lastPhase = null;
  const done = await ros.waitForSupervisor(
    (st) => st.request.id === id && ['success', 'failed', 'rejected'].includes(st.request.result),
    MODE_RESULT_TIMEOUT_MS,
    (st) => {
      if (st.phase !== lastPhase) {
        lastPhase = st.phase;
        onProgress?.({ phase: st.phase, progress: PHASE_PROGRESS[st.phase] ?? 50, message: PHASE_TEXT[st.phase] || st.phase });
      }
    }
  );
  if (!done) return fail(`No result for the ${label} request within ${MODE_RESULT_TIMEOUT_MS / 1000} s`, { mode });
  if (done.request.result !== 'success') {
    return fail(FAILURE_TEXT[done.request.failure] || `${label} ${done.request.result}`, { mode, failure: done.request.failure });
  }
  onProgress?.({ phase: 'done', progress: 100, message: `${label} active` });
  return { ok: true, mode, message: `${label} active` };
}

/**
 * Motions run in AUTO or SAFEAUTO only. Coming from JOG (or no profile yet),
 * switch to SAFEAUTO first, as the old Home button did.
 */
export async function ensureMotionProfile(ros, { onProgress } = {}) {
  const s = ros.supervisor;
  const blocker = motionBlocker(s);
  if (blocker) return fail(blocker);
  if (!s || s.profile === 'auto' || s.profile === 'safeauto') return { ok: true, switched: false };
  const res = await switchProfile(ros, 'safeauto', { onProgress });
  return res.ok ? { ok: true, switched: true } : res;
}

/**
 * Start a motion service (home, gotoPoint, gotoJoints, gotoPose, runSequence, runProgram).
 * Returns startAnswer() plus { switched } when JOG was left for SAFEAUTO first.
 */
export async function startMotion(ros, key, request, { autoProfile = true, onProgress } = {}) {
  let switched = false;
  if (autoProfile && !request?.dry_run) {
    const p = await ensureMotionProfile(ros, { onProgress });
    if (!p.ok) return { ...fail(p.message), accepted: false };
    switched = p.switched;
  }
  const r = await ros.callService(key, request, { timeoutMs: 4000 });
  if (!r.ok) return { ...fail(r.message, { unavailable: r.unavailable }), accepted: false, switched };
  const a = startAnswer(r.response);
  if (!a.ok && !a.message) a.message = MOTION_ERROR_TEXT[a.error] || 'Refused';
  return { ...a, switched };
}

/** Stop the running motion (motion server ~/stop; MoveIt stop as a fallback). */
export async function stopMotion(ros) {
  const r = await ros.callService('stopMotion', {}, { timeoutMs: 2500, waitMs: 0 });
  if (r.ok) return { ok: r.response.success !== false, message: r.response.message || 'Motion stopped' };
  ros.publishMoveitStopCommand?.();
  return { ok: true, message: `Stop sent to MoveIt (${r.message})`, fallback: true };
}

/** Fault reset through the supervisor; waits until it is back RUNNING. */
export async function resetFault(ros, { onProgress } = {}) {
  const s = ros.supervisor;
  if (s?.estop) return fail('Release the E-stop button first: a reset is refused while it is pressed');
  const r = await ros.callService('resetFault', {}, { timeoutMs: 2000 });
  if (!r.ok) return fail(`Reset failed: ${r.message}`, { unavailable: r.unavailable });
  if (r.response.success === false) return fail(r.response.message || 'Reset was refused');
  let lastPhase = null;
  let sawReset = false;
  const started = Date.now();
  // Done when the supervisor is RUNNING and unlatched after it went through the
  // reset phases (or, if they were too quick to be seen at 4 Hz, after 0.6 s).
  const done = await ros.waitForSupervisor(
    (st) => !st.latched && st.phase === 'running' && (sawReset || Date.now() - started > 600),
    RESET_TIMEOUT_MS,
    (st) => {
      if (st.phase.startsWith('reset')) sawReset = true;
      if (st.phase !== lastPhase) {
        lastPhase = st.phase;
        onProgress?.({ phase: st.phase, progress: PHASE_PROGRESS[st.phase] ?? 50, message: PHASE_TEXT[st.phase] || st.phase });
      }
    }
  );
  const now = ros.supervisor;
  if (!done && now?.latched) return fail(`Reset did not complete: ${CAUSE_TEXT[now.cause] || now.cause || 'emergency still latched'}`);
  return { ok: true, message: `Reset complete (${PROFILE_LABEL[now?.profile] || 'JOG'})` };
}

/** Software emergency through the supervisor (compatibility topic as a fallback). */
export async function triggerEmergency(ros) {
  const r = await ros.callService('triggerEmergency', {}, { timeoutMs: 1000, waitMs: 0 });
  if (r.ok && r.response.success !== false) return { ok: true, message: r.response.message || 'Emergency triggered' };
  try {
    ros.publishCompatEmergency();
    return { ok: true, message: 'Emergency sent on the compatibility topic', fallback: true };
  } catch (err) {
    return fail(`Emergency could not be sent: ${r.message || err.message}`);
  }
}

/** Speed override (percent, capped by the active profile). */
export async function setSpeedOverride(ros, percent) {
  const p = Math.max(0, Math.min(100, Math.round(Number(percent))));
  if (!Number.isFinite(p)) return fail('percent must be a number 0..100');
  const r = await ros.callService('setSpeedOverride', { percent: p }, { timeoutMs: 1500, waitMs: 0 });
  if (!r.ok) return fail(r.message, { unavailable: r.unavailable });
  return { ok: r.response.success !== false, requested: p, effective: Number(r.response.effective_percent), message: r.response.message || '' };
}
