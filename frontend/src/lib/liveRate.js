// lib/liveRate.js -- render-rate limits for live values from the socket.
//
// The server already sends live state at 5 Hz at most; this keeps React from drawing faster
// than `ms` even when frames bunch up, and draws nothing while the tab is hidden (kiosk on
// another screen, minimised window): the newest value is kept and drawn once the tab shows.
import { subscribe } from "./ws";

const pending = new Set(); // flushers waiting for the tab to show
let visHooked = false;
function hookVisibility() {
  if (visHooked || typeof document === "undefined") return;
  visHooked = true;
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) return;
    const list = [...pending];
    pending.clear();
    for (const f of list) f();
  });
}
const hidden = () => typeof document !== "undefined" && document.hidden;

/**
 * subscribe(type) with at most one `fn(value)` per `ms`.
 * `merge(prev, next)` (optional; prev is undefined for the first frame) combines frames instead
 * of keeping only the newest
 * (for streams that carry one item per frame, such as one topic value).
 * Returns unsubscribe.
 */
export function subscribeLimited(type, ms, fn, merge = null) {
  hookVisibility();
  let value, has = false, timer = null, last = 0;
  const flush = () => {
    timer = null;
    if (!has) return;
    if (hidden()) { pending.add(flush); return; }
    const v = value;
    value = undefined; has = false;
    last = performance.now();
    fn(v);
  };
  const off = subscribe(type, (p) => {
    value = merge ? merge(has ? value : undefined, p) : p;
    has = true;
    if (timer || pending.has(flush)) return;
    const wait = Math.max(0, last + ms - performance.now());
    if (wait === 0 && !hidden()) flush();
    else timer = setTimeout(flush, wait);
  });
  return () => { off(); clearTimeout(timer); pending.delete(flush); };
}

/** Calls fn(visible) now and on every change; returns unsubscribe. */
export function onVisibility(fn) {
  if (typeof document === "undefined") return () => {};
  const h = () => fn(!document.hidden);
  document.addEventListener("visibilitychange", h);
  h();
  return () => document.removeEventListener("visibilitychange", h);
}
