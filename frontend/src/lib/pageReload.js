// Reloading one page (Alt+R, the page-load fallback) or the whole web app (Settings › System,
// Alt+Shift+R, the automatic reload when a page does not come up).
//
// Reload page   = the page is mounted again, its code is fetched again if it failed, and its
//                 data is read again; the rest of the console (top bar, panels) stays.
// Reload app    = the browser reloads the console. Done automatically at most twice in two
//                 minutes (a page that never loads must not turn into a reload loop), and only
//                 when the robot server answers (a reload against a stopped server would leave
//                 the browser on its own error page).
import { create } from "zustand";
import { queryClient } from "./queryClient";

export const usePageReload = create(() => ({ nonce: 0 }));

const resetters = new Set();
/** nav.js registers each page's code loader, so a reload can fetch a failed one again. */
export function registerPageReset(fn) {
  resetters.add(fn);
}

export function reloadPage() {
  resetters.forEach((fn) => fn());
  usePageReload.setState((s) => ({ nonce: s.nonce + 1 }));
  queryClient.invalidateQueries();
}

const AUTO_KEY = "nextup.autoReloads";
const AUTO_WINDOW_MS = 120_000;
const AUTO_MAX = 2;

function recentAutoReloads() {
  try {
    const list = JSON.parse(sessionStorage.getItem(AUTO_KEY) || "[]");
    return Array.isArray(list) ? list.filter((t) => Date.now() - t < AUTO_WINDOW_MS) : [];
  } catch {
    return [];
  }
}

/** May the console reload itself now? (false after two automatic reloads in two minutes) */
export const autoReloadAllowed = () => recentAutoReloads().length < AUTO_MAX;

/** Does the robot server answer? (2 s) */
export async function serverAnswers() {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 2000);
  try {
    const r = await fetch("/uptime", { cache: "no-store", signal: ctl.signal });
    return r.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(t);
  }
}

export function reloadApp({ auto = false } = {}) {
  if (auto) {
    try {
      sessionStorage.setItem(AUTO_KEY, JSON.stringify([...recentAutoReloads(), Date.now()]));
    } catch {
      /* private mode: reload anyway */
    }
  }
  window.location.reload();
}

/** A page whose code could not be fetched (the console was updated on the robot, network hiccup). */
export const isChunkLoadError = (err) =>
  /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|Loading chunk .* failed/i.test(String(err?.message || err || ""));

/** Alt+R reloads the current page, Alt+Shift+R the whole web app. Installed once by AppShell. */
export function installReloadShortcuts() {
  const onKey = (e) => {
    if (!e.altKey || e.ctrlKey || e.metaKey || e.code !== "KeyR") return;
    e.preventDefault();
    if (e.shiftKey) reloadApp();
    else reloadPage();
  };
  window.addEventListener("keydown", onKey);
  return () => window.removeEventListener("keydown", onKey);
}
