// plc/statePush.js -- PLC_STATE to the browser, the same for the simulated and the robot's PLC.
//
// CPU: the image is built at most STATE_MS apart (5 Hz) and sent only when something the page
// shows changed (bits, registers, steps, rung results, forces). The scan counters change on every
// scan, so on their own they go out at most once per second: a PLC that stands still costs one
// small frame a second, not five.
import { WS } from "./interfaces.js";

export const STATE_MS = 200;      // 5 Hz max
const IDLE_MS = 1000;             // scan counters only: 1 Hz

export class StatePusher {
  constructor(ws) {
    this.ws = ws;
    this.lastKey = "";
    this.lastAt = 0;
  }
  /** true when a frame went out. */
  push(state) {
    if (!state) return false;
    const { scan_count, scan_time_ms, scan_period_ms, ...shown } = state;
    const key = JSON.stringify(shown);
    const now = Date.now();
    if (key === this.lastKey && now - this.lastAt < IDLE_MS) return false;
    this.lastKey = key;
    this.lastAt = now;
    return this.ws.publishState(WS.state, state);
  }
  /** The next push always goes out (a page opened, the PLC switched). */
  reset() {
    this.lastKey = "";
    this.lastAt = 0;
  }
}
