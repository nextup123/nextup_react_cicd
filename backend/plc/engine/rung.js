// rung.js -- one line of logic (port of nextplc/rung.cpp). Rungs run top to bottom, once per scan.
//
//   - {out: gpio1.do1, when: "gpio1.di1 AND M10"}                coil
//   - {out: gpio1.do2, when: "gpio1.di1", ton: 500ms}            TON (also tof:, tp:)
//   - {emergency: "gpio1.di5 AND S.AUTO", text: "door opened"}   rising edge -> robot emergency
//   - {set: M21, when: "gpio1.di3"}  / {reset: M21, when: ...}   latch
//   - {toggle: gpio1.do5, when: "RISE(gpio1.di1)"}
//   - {count: R0, up: "gpio1.di6", reset: "gpio1.di7", preset: 10, done: M24}
//   - {move: R1, value: 3, when: "RISE(gpio1.di8)"}
//   - {calc: "R2 = R0 * 2 + R1", when: "TRUE"}

import { kQ, kM, kR } from "./image.js";
import { Ton, Tof, Tp, RTrig, Ctud } from "./blocks.js";
import { asBool, asInt, readValue } from "./expr.js";

function writeBit(img, a, v) {
  if (a.area === "Q" && a.index < kQ) img.Q[a.index] = v;
  else if (a.area === "M" && a.index < kM) img.M[a.index] = v;
}
function writeNum(img, a, v) {
  if (a.area === "R" && a.index < kR) img.R[a.index] = v | 0;
}
function readNum(img, a) {
  return a.area === "R" && a.index < kR ? img.R[a.index] : 0;
}

/** A new, empty rung record. The loader fills it. */
export function newRung() {
  return {
    type: "out",          // out | set | reset | toggle | count | move | calc | emergency
    line: 0,
    text: "",
    target: null,
    when: null,
    timer: "none",        // none | ton | tof | tp
    timer_text: "",
    timer_ms: null,
    ton: new Ton(), tof: new Tof(), tp: new Tp(),
    toggle_edge: new RTrig(),
    up: null, down: null, reset_expr: null, preset: null,
    has_done: false, done: null,
    counter: new Ctud(),
    value: null,
    value_text: "",
    text_emergency: "",
    emergency_edge: new RTrig(),
    last_result: false,
    // source texts for the UI (not used by the engine)
    src: {},
  };
}

export function runRung(r, img, ctx, dt) {
  switch (r.type) {
    case "out": {
      let v = asBool(r.when.eval(ctx, dt));
      if (r.timer_ms) {
        const s = Math.max(0, asInt(r.timer_ms.eval(ctx, dt))) / 1000;
        r.ton.preset_s = s; r.tof.preset_s = s; r.tp.preset_s = s;
      }
      if (r.timer === "ton") v = r.ton.run(v, dt);
      else if (r.timer === "tof") v = r.tof.run(v, dt);
      else if (r.timer === "tp") v = r.tp.run(v, dt);
      r.last_result = v;
      writeBit(img, r.target, v); // a coil writes 1 AND 0, every scan
      break;
    }
    case "set": {
      const c = asBool(r.when.eval(ctx, dt));
      r.last_result = c;
      if (c) writeBit(img, r.target, true);
      break;
    }
    case "reset": {
      const c = asBool(r.when.eval(ctx, dt));
      r.last_result = c;
      if (c) writeBit(img, r.target, false);
      break;
    }
    case "toggle": {
      const c = asBool(r.when.eval(ctx, dt));
      r.last_result = c;
      if (r.toggle_edge.run(c)) writeBit(img, r.target, !asBool(readValue(ctx, r.target)));
      break;
    }
    case "count": {
      const up = r.up ? asBool(r.up.eval(ctx, dt)) : false;
      const down = r.down ? asBool(r.down.eval(ctx, dt)) : false;
      const rst = r.reset_expr ? asBool(r.reset_expr.eval(ctx, dt)) : false;
      const preset = r.preset ? asInt(r.preset.eval(ctx, dt)) : 2147483647;
      r.counter.count = readNum(img, r.target); // the register IS the counter memory
      const done = r.counter.run(up, down, rst, preset);
      writeNum(img, r.target, r.counter.count);
      r.last_result = done;
      if (r.has_done) writeBit(img, r.done, done);
      break;
    }
    case "emergency": {
      const c = asBool(r.when.eval(ctx, dt));
      r.last_result = r.emergency_edge.run(c);
      break;
    }
    case "move":
    case "calc": {
      const c = r.when ? asBool(r.when.eval(ctx, dt)) : true;
      r.last_result = c;
      if (c) writeNum(img, r.target, asInt(r.value.eval(ctx, dt)));
      break;
    }
    default:
      break;
  }
}

export function resetRung(r) {
  for (const e of [r.when, r.up, r.down, r.reset_expr, r.preset, r.value, r.timer_ms]) if (e) e.reset();
  r.emergency_edge.reset();
  r.ton.reset(); r.tof.reset(); r.tp.reset();
  r.toggle_edge.reset();
  r.counter.resetEdges();
  r.last_result = false;
}
