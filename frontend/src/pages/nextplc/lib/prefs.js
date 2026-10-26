// Page settings of the NextPLC pages (open tab, hidden panes, help style), kept under
// "nextup.plc.<key>" so the app mirrors them to the robot server like every other layout setting.
import { useCallback, useState } from "react";

const KEY = (k) => `nextup.plc.${k}`;
export function readPref(k, fallback) {
  try { const v = localStorage.getItem(KEY(k)); return v == null ? fallback : JSON.parse(v); } catch { return fallback; }
}
export function writePref(k, v) {
  try { localStorage.setItem(KEY(k), JSON.stringify(v)); } catch { /* ignore */ }
}
/** useState that remembers its value. */
export function usePref(k, fallback) {
  const [v, setV] = useState(() => readPref(k, fallback));
  const set = useCallback((next) => setV((cur) => { const n = typeof next === "function" ? next(cur) : next; writePref(k, n); return n; }), [k]);
  return [v, set];
}
