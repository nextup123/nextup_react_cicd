// blocks.js -- the standard IEC 61131-3 function blocks (port of nextplc/blocks.hpp).
// Every block has its own memory and one run() per scan; dt is the measured scan time in seconds.

export const kTimeEps = 1e-6;
export const timeReached = (elapsed, preset) => elapsed + kTimeEps >= preset;

/** Rising edge: 1 for one scan when the input goes 0 -> 1. Not armed until the first run after reset. */
export class RTrig {
  constructor() { this.prev = false; this.armed = false; }
  run(input) {
    const out = this.armed && input && !this.prev;
    this.prev = input;
    this.armed = true;
    return out;
  }
  reset() { this.prev = false; this.armed = false; }
}

/** Falling edge: 1 for one scan when the input goes 1 -> 0. */
export class FTrig {
  constructor() { this.prev = false; this.armed = false; }
  run(input) {
    const out = this.armed && !input && this.prev;
    this.prev = input;
    this.armed = true;
    return out;
  }
  reset() { this.prev = false; this.armed = false; }
}

/** TON on-delay. */
export class Ton {
  constructor(preset = 0) { this.preset_s = preset; this.elapsed_s = 0; }
  run(input, dt) {
    if (!input) { this.elapsed_s = 0; return false; }
    if (!timeReached(this.elapsed_s, this.preset_s)) this.elapsed_s += dt;
    return timeReached(this.elapsed_s, this.preset_s);
  }
  reset() { this.elapsed_s = 0; }
}

/** TOF off-delay. */
export class Tof {
  constructor(preset = 0) { this.preset_s = preset; this.elapsed_s = 0; this.was_on = false; }
  run(input, dt) {
    if (input) { this.elapsed_s = 0; this.was_on = true; return true; }
    if (!this.was_on) return false;
    this.elapsed_s += dt;
    if (timeReached(this.elapsed_s, this.preset_s)) { this.was_on = false; return false; }
    return true;
  }
  reset() { this.elapsed_s = 0; this.was_on = false; }
}

/** TP pulse: on the rising edge the output is 1 for exactly preset_s. */
export class Tp {
  constructor(preset = 0) { this.preset_s = preset; this.elapsed_s = 0; this.running = false; this.edge = new RTrig(); }
  run(input, dt) {
    const rise = this.edge.run(input);
    if (this.running) {
      this.elapsed_s += dt;
      if (timeReached(this.elapsed_s, this.preset_s)) this.running = false;
    } else if (rise) {
      this.running = true;
      this.elapsed_s = 0;
    }
    return this.running;
  }
  reset() { this.elapsed_s = 0; this.running = false; this.edge.reset(); }
}

/** "Input has been 1 for at least preset_s". */
export class OnFor {
  constructor(preset = 0) { this.preset_s = preset; this.elapsed_s = 0; }
  run(input, dt) {
    if (!input) { this.elapsed_s = 0; return false; }
    if (!timeReached(this.elapsed_s, this.preset_s)) this.elapsed_s += dt;
    return timeReached(this.elapsed_s, this.preset_s);
  }
  reset() { this.elapsed_s = 0; }
}

const INT32_MAX = 2147483647;
const INT32_MIN = -2147483648;

/** CTUD up/down counter with edge detection and a level reset. */
export class Ctud {
  constructor() { this.up_edge = new RTrig(); this.down_edge = new RTrig(); this.count = 0; }
  run(up, down, reset, preset) {
    const u = this.up_edge.run(up);
    const d = this.down_edge.run(down);
    if (reset) this.count = 0;
    else {
      if (u && this.count < INT32_MAX) this.count++;
      if (d && this.count > INT32_MIN) this.count--;
    }
    return this.count >= preset;
  }
  resetEdges() { this.up_edge.reset(); this.down_edge.reset(); }
}
