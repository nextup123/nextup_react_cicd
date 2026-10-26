// Client Control state that must outlive the page component:
//  - settings writes are serialized and always merge into the latest file
//    (the old page posted a stale copy and could overwrite total_operations)
//  - cycle counting keeps running while the operator is on another page
//  - the speed-override value and "already initialised" flags survive navigation
import { create } from "zustand";
import { api } from "../../lib/api";
import { invalidate, keys } from "../../lib/queries";
import { queryClient } from "../../lib/queryClient";
import { send, subscribe } from "../../lib/ws";

let queue = Promise.resolve();

/** Apply `patch` (object or fn(current) => object) to /settings, one write at a time. */
export function updateSettings(patch) {
  const job = queue.then(async () => {
    const current = (await api.get("/settings")) || {};
    const next = { ...current, ...(typeof patch === "function" ? patch(current) : patch) };
    await api.post("/settings", next);
    queryClient.setQueryData(keys.settings, next);
    return next;
  });
  queue = job.catch(() => {});
  return job;
}

/** Reset total operations (GET /cycle/reset), serialized with the other writes. */
export function resetTotal() {
  const job = queue.then(async () => {
    await api.get("/cycle/reset");
    await invalidate.settings();
  });
  queue = job.catch(() => {});
  return job;
}

export const useClientState = create(() => ({
  currentOps: 0, // cycles completed since the app was opened
  speedOverride: 100, // last value published with SET_SPEED_INT8 (0..100)
  speedInitDone: false, // initial ramp to 40 already done this session
  settingsPublished: false, // mode speed + CNC already published this session
}));

// Every CYCLE_TIME is one finished cycle (same as the old page).
subscribe("CYCLE_TIME", () => {
  useClientState.setState((s) => ({ currentOps: s.currentOps + 1 }));
  updateSettings((cur) => ({ total_operations: (Number(cur.total_operations) || 0) + 1 })).catch((err) =>
    console.error("Could not save the cycle count", err)
  );
});

/* ───────── Mode / speed / CNC ───────── */

export const MODES = {
  low_testing: { label: "Low speed test", hint: "Fixed slow speed for first runs", min: 0.01, max: 0.2, fixed: 0.1 },
  high_testing: { label: "High speed test", hint: "Adjustable 0.50 – 0.90", min: 0.5, max: 0.9 },
  production: { label: "Production", hint: "Program speed (no scaling)", fixed: 0 },
};

/** Speed scale that a settings object implies (same rules as the old page). */
export function speedForSettings(s) {
  if (!s) return 0.1;
  if (s.mode === "low_testing") return 0.1;
  if (s.mode === "high_testing") return Math.min(0.9, Math.max(0.5, Number(s.speed) || 0.5));
  if (s.mode === "production") return 0;
  return 0.1;
}

export const publishSpeedScale = (value) => send("UI_COMMANDS", { command: "set_speed", value: parseFloat(value) });
export const publishCnc = (value) => send("UI_COMMANDS", { command: "select_cnc", value: String(value) });

/* ───────── Speed override (0..100, /speed_scale Int8) ───────── */

let rampTimer = null;
const stopRamp = () => {
  clearInterval(rampTimer);
  rampTimer = null;
};

function publishStepwise(target) {
  const v = Math.round(Math.min(100, Math.max(0, target)));
  const last = useClientState.getState().speedOverride;
  if (v === last) return;
  const step = v > last ? 1 : -1;
  for (let i = last + step; i !== v + step; i += step) send("SET_SPEED_INT8", { value: i });
  useClientState.setState({ speedOverride: v });
}

/**
 * Operator change of the speed override. Publishes every integer between the
 * last published value and `target` (as the old slider did) so the robot
 * never sees a jump.
 */
export function publishSpeedOverride(target) {
  stopRamp();
  publishStepwise(target);
}

/** First visit of the session: ramp the override from 100 down to 40 over ~1.5 s (old behaviour). */
export function initialSpeedRamp() {
  if (useClientState.getState().speedInitDone) return;
  useClientState.setState({ speedInitDone: true, speedOverride: 100 });
  send("SET_SPEED_INT8", { value: 100 });
  rampTimer = setInterval(() => {
    const cur = useClientState.getState().speedOverride;
    if (cur <= 40) return stopRamp();
    publishStepwise(cur - 1);
  }, 25);
}
