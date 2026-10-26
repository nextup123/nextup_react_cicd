// sequence.js -- step logic, SFC / GRAFCET style (port of nextplc/sequence.cpp). One step at a time.

import { kQ, kM } from "./image.js";
import { timeReached } from "./blocks.js";
import { asBool } from "./expr.js";

function writeBit(img, a, v) {
  if (a.area === "Q" && a.index < kQ) img.Q[a.index] = v;
  else if (a.area === "M" && a.index < kM) img.M[a.index] = v;
}

export function newSequence() {
  return { name: "", line: 0, start: null, abort: null, steps: [], outputs: [], in_step_s: 0, timed_out: false, src: {} };
}
export function newStep() {
  return { name: "", line: 0, outputs: [], next: null, timeout_s: 0, has_timeout_bit: false, on_timeout: null, src: {} };
}

function enterStep(s, rt, step) {
  rt.step = step;
  s.in_step_s = 0;
  if (step >= 1 && step <= s.steps.length) {
    const st = s.steps[step - 1];
    if (st.next) st.next.reset(); // no edge from before the step was entered
  }
}
function goIdle(s, rt) {
  rt.step = 0;
  s.in_step_s = 0;
}

export function runSequence(s, rt, img, ctx, dt) {
  // start and abort are evaluated EVERY scan so their edge / timer memory stays current
  const start = s.start ? asBool(s.start.eval(ctx, dt)) : false;
  const abort = s.abort ? asBool(s.abort.eval(ctx, dt)) : false;

  if (rt.step === 0) {
    if (start && s.steps.length) {
      s.timed_out = false;
      enterStep(s, rt, 1);
    }
  } else if (abort) {
    goIdle(s, rt);
  } else {
    const st = s.steps[rt.step - 1];
    s.in_step_s += dt;
    const go = st.next ? asBool(st.next.eval(ctx, dt)) : false;
    if (go) {
      if (rt.step >= s.steps.length) goIdle(s, rt);
      else enterStep(s, rt, rt.step + 1);
    } else if (st.timeout_s > 0 && timeReached(s.in_step_s, st.timeout_s)) {
      if (st.has_timeout_bit) writeBit(img, st.on_timeout, true);
      s.timed_out = true;
      goIdle(s, rt);
    }
  }

  // outputs: everything this sequence owns is 0, the active step's bits are 1
  for (const a of s.outputs) writeBit(img, a, false);
  if (rt.step >= 1 && rt.step <= s.steps.length) for (const a of s.steps[rt.step - 1].outputs) writeBit(img, a, true);
}

export function resetSequence(s, rt, img) {
  goIdle(s, rt);
  s.timed_out = false;
  if (s.start) s.start.reset();
  if (s.abort) s.abort.reset();
  for (const st of s.steps) if (st.next) st.next.reset();
  for (const a of s.outputs) writeBit(img, a, false);
}
