// UI preferences mirrored to the robot server (/ui-prefs).
//
// Pages keep their layout in localStorage under keys starting with
// "nextup." (panel sizes, open tabs, folded sections …). Every write to such
// a key is also sent to the server, and at startup the server's copy is
// written back into localStorage before the app loads. So a layout set once
// is there again in a new browser or on another computer, while localStorage
// keeps working as a fast cache (and as the fallback when the server is
// unreachable).

const PREFIX = "nextup.";
const URL = "/ui-prefs";
const MAX_VALUE = 64 * 1024;
const FLUSH_MS = 600;
// Per-browser state that should not follow the user to another screen.
const LOCAL_ONLY = [/^nextup\.tree\.clipboard/, /^nextup\.pp\.currentPoint/];

const isShared = (k) => typeof k === "string" && k.startsWith(PREFIX) && !LOCAL_ONLY.some((re) => re.test(k));

const proto = typeof Storage !== "undefined" ? Storage.prototype : null;
const rawSet = proto?.setItem;
const rawRemove = proto?.removeItem;

let pendingSet = {};
let pendingRemove = new Set();
let timer = null;

function flush(beacon = false) {
  clearTimeout(timer);
  timer = null;
  const set = pendingSet;
  const remove = [...pendingRemove];
  if (!Object.keys(set).length && !remove.length) return;
  pendingSet = {};
  pendingRemove = new Set();
  const body = JSON.stringify({ set, remove });
  if (beacon && navigator.sendBeacon) {
    navigator.sendBeacon(URL, new Blob([body], { type: "application/json" }));
    return;
  }
  fetch(URL, { method: "PATCH", headers: { "Content-Type": "application/json" }, body }).catch(() => {
    // Keep them for the next try; newer values win.
    pendingSet = { ...set, ...pendingSet };
    remove.forEach((k) => pendingRemove.add(k));
  });
}

function queue(key, value) {
  if (value === null) {
    delete pendingSet[key];
    pendingRemove.add(key);
  } else {
    if (value.length > MAX_VALUE) return;
    pendingRemove.delete(key);
    pendingSet[key] = value;
  }
  if (!timer) timer = setTimeout(flush, FLUSH_MS);
}

/** Mirror every write of a "nextup." localStorage key to the server. */
export function installPrefSync() {
  if (!proto || proto.__nextupSync) return;
  proto.__nextupSync = true;
  proto.setItem = function setItem(key, value) {
    rawSet.call(this, key, value);
    if (this === window.localStorage && isShared(key)) queue(key, String(value));
  };
  proto.removeItem = function removeItem(key) {
    rawRemove.call(this, key);
    if (this === window.localStorage && isShared(key)) queue(key, null);
  };
  window.addEventListener("pagehide", () => flush(true));
}

/**
 * Copy the server's preferences into localStorage. Keys the server does not
 * know yet (set in this browser before syncing existed) are sent up.
 */
export async function loadUiPrefs(timeoutMs = 1500) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(URL, { signal: ctl.signal });
    if (!res.ok) return;
    const { prefs = {} } = await res.json();
    for (const [k, v] of Object.entries(prefs)) {
      if (isShared(k) && typeof v === "string" && localStorage.getItem(k) !== v) rawSet.call(localStorage, k, v);
    }
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (isShared(k) && !(k in prefs)) queue(k, localStorage.getItem(k));
    }
  } catch {
    /* server not reachable: localStorage is used as is */
  } finally {
    clearTimeout(t);
  }
}

/** Forget the saved layout everywhere (server and this browser). */
export async function resetUiPrefs() {
  const keys = [];
  for (let i = 0; i < localStorage.length; i++) if (isShared(localStorage.key(i))) keys.push(localStorage.key(i));
  keys.forEach((k) => rawRemove.call(localStorage, k));
  pendingSet = {};
  pendingRemove = new Set();
  await fetch(URL, { method: "DELETE" }).catch(() => {});
}
