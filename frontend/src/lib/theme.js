// Theme = accent colour + mode, applied as html[data-accent] / html[data-mode].
//
// Saved under the localStorage key "nextup.theme", which lib/uiPrefs.js
// mirrors to the robot server, so a new browser opens with the same theme.
// index.html applies the stored copy before anything is drawn (no flash of
// the wrong theme); main.jsx applies it again once the server's copy is in.
import { useSyncExternalStore } from "react";
import { ACCENTS, MODES } from "./themeList";

export { ACCENTS, MODES };
export const KEY = "nextup.theme";
export const DEFAULT_THEME = { accent: "indigo", mode: "light" };
// "auto" follows the computer's light / dark setting.
export const MODE_CHOICES = ["light", "gray", "dark", "auto"];

const darkQuery = typeof window !== "undefined" && window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;
const listeners = new Set();
let current = read();

function read() {
  try {
    const t = JSON.parse(localStorage.getItem(KEY) || "null") || {};
    return {
      accent: ACCENTS.some((a) => a.id === t.accent) ? t.accent : DEFAULT_THEME.accent,
      mode: MODE_CHOICES.includes(t.mode) ? t.mode : DEFAULT_THEME.mode,
    };
  } catch {
    return { ...DEFAULT_THEME };
  }
}

/** The mode actually shown ("auto" resolved to light or dark). */
export const resolveMode = (mode) => (mode === "auto" ? (darkQuery?.matches ? "dark" : "light") : mode);

let switchTimer = null;
function paint(theme, animate) {
  const root = document.documentElement;
  if (animate) {
    root.classList.add("theme-switching");
    clearTimeout(switchTimer);
    switchTimer = setTimeout(() => root.classList.remove("theme-switching"), 260);
  }
  root.dataset.accent = theme.accent;
  root.dataset.mode = resolveMode(theme.mode);
}

function emit() {
  listeners.forEach((fn) => fn());
}

/** Apply the stored theme (startup, or after the server's prefs arrive). */
export function applyStoredTheme() {
  current = read();
  paint(current, false);
  emit();
}

/** Change accent and / or mode; applied at once and saved. */
export function setTheme(patch) {
  current = { ...current, ...patch };
  paint(current, true);
  localStorage.setItem(KEY, JSON.stringify(current));
  emit();
}

export function useTheme() {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => current,
  );
}

/** Re-paints in "auto" mode when the computer switches light / dark. */
darkQuery?.addEventListener?.("change", () => {
  if (current.mode === "auto") {
    paint(current, true);
    emit();
  }
});
// Another tab changed the theme.
window.addEventListener?.("storage", (e) => {
  if (e.key === KEY) applyStoredTheme();
});

/** Reads a CSS custom property of the current theme (for canvas / WebGL). */
export const themeVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
