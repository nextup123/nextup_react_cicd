// Tiny signal bus the tutorials listen to. The app calls tutSignal() where
// something a lesson waits for happens (an API call succeeded, a WebSocket
// command went out, a jog started). It costs nothing while no lesson runs:
// with no listener the call returns at once.
const listeners = new Set();

/** name: "api:POST /main-tree/addNode", "ws:SWITCH_MODE", "jog" … */
export function tutSignal(name, data) {
  if (!listeners.size) return;
  for (const fn of [...listeners]) {
    try {
      fn(name, data);
    } catch {
      /* a lesson must never break the app */
    }
  }
}

export function onTutSignal(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
