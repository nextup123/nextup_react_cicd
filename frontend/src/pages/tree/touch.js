// Which kind of pointer the user is working with right now: "touch" (finger
// or pen on a tablet / teach pendant) or "mouse". Touch-only UI (bigger hit
// targets, the action bar, the hold-to-move gesture hints) keys off this, so
// the mouse and keyboard experience is untouched. Hybrid devices follow the
// last pointer used. Also mirrored on <html data-input="…"> for CSS.
import { create } from "zustand";

const initial = () =>
  typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches ? "touch" : "mouse";

export const useInputMode = create(() => ({ mode: initial() }));

if (typeof window !== "undefined") {
  const apply = (mode) => {
    document.documentElement.dataset.input = mode;
    if (useInputMode.getState().mode !== mode) useInputMode.setState({ mode });
  };
  apply(useInputMode.getState().mode);
  window.addEventListener(
    "pointerdown",
    (e) => apply(e.pointerType === "mouse" ? "mouse" : "touch"),
    { capture: true, passive: true }
  );
}

export const isTouchMode = () => useInputMode.getState().mode === "touch";

/* Long press for plain DOM elements (ladder rows): hold still for a moment to
   call onHold(clientX, clientY); the tap's click is then swallowed. One
   gesture at a time, so the state can live here. */
let lastTouchAt = 0;
if (typeof window !== "undefined")
  window.addEventListener("touchstart", () => (lastTouchAt = Date.now()), { capture: true, passive: true });
/** True right after a touch: ignore the contextmenu / mouse events it emulates. */
export const touchedRecently = () => Date.now() - lastTouchAt < 1000;

let press = null;
export function longPress(onHold, ms = 450) {
  const clear = () => {
    if (press) clearTimeout(press.timer);
    press = null;
  };
  return {
    onTouchStart: (e) => {
      clear();
      if (e.touches.length !== 1) return;
      const t = e.touches[0];
      const p = { x: t.clientX, y: t.clientY, fired: false };
      p.timer = setTimeout(() => {
        p.fired = true;
        navigator.vibrate?.(15);
        onHold(p.x, p.y);
      }, ms);
      press = p;
    },
    onTouchMove: (e) => {
      const t = e.touches[0];
      if (press && !press.fired && (e.touches.length > 1 || Math.hypot(t.clientX - press.x, t.clientY - press.y) > 10)) clear();
    },
    onTouchEnd: (e) => {
      if (press?.fired && e.cancelable) e.preventDefault();
      clear();
    },
    onTouchCancel: clear,
  };
}
