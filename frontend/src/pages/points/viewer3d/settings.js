// Visual settings of the 3D view: three modes plus every value on its own.
//
// Saved under "nextup.view3d" in localStorage, which lib/uiPrefs.js mirrors
// to the robot server, so every browser opens with the same settings.
// Changing any single value turns the mode into "custom".
import { create } from "zustand";

export const KEY = "nextup.view3d";

export const MODES = {
  performance: {
    label: "Performance",
    hint: "Lowest CPU: 15 Hz, simple shading, low-detail meshes, no shadows or anti-aliasing",
    values: { hz: 15, shading: "flat", detail: "low", shadows: false, antialias: false, resolution: 0.75, smooth: false, lighting: "soft" },
  },
  balanced: {
    label: "Balanced",
    hint: "24 Hz, shaded, medium-detail meshes, smooth motion, no anti-aliasing",
    values: { hz: 24, shading: "shaded", detail: "medium", shadows: false, antialias: false, resolution: 1, smooth: true, lighting: "studio" },
  },
  visuals: {
    label: "Visuals",
    hint: "60 Hz, realistic materials, full-detail meshes, shadows (uses the most CPU / GPU)",
    values: { hz: 60, shading: "realistic", detail: "full", shadows: true, antialias: true, resolution: 2, smooth: true, lighting: "studio" },
  },
};

export const DEFAULTS = {
  mode: "balanced",
  ...MODES.balanced.values,
  colorMode: "model", // model | custom
  color: "#c9d1ee",
  brightness: 1,
  grid: true,
  floor: true,
  axes: true, // base frame axes
  tcpFrame: true,
  background: "", // "" = from the theme
  showStats: false,
  points: true, // teach points as labelled balls
};

export const HZ_CHOICES = [5, 10, 15, 20, 24, 30, 45, 60];

function read() {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || "null");
    if (!v || typeof v !== "object") return { ...DEFAULTS };
    // A named mode always means its own values (only "custom" keeps single values).
    return { ...DEFAULTS, ...v, ...(MODES[v.mode]?.values || {}) };
  } catch {
    return { ...DEFAULTS };
  }
}

function save(s) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* storage full or blocked: keep it for this session */
  }
}

export const useView3d = create(() => read());

/** Applies a mode's values (keeps colours and scene options). */
export function setMode(mode) {
  const m = MODES[mode];
  if (!m) return;
  const next = { ...useView3d.getState(), ...m.values, mode };
  useView3d.setState(next, true);
  save(next);
}

/** Changes one or more values; the mode becomes "custom" when a mode value changes. */
export function setView3d(patch) {
  const cur = useView3d.getState();
  const next = { ...cur, ...patch };
  const modeKeys = Object.keys(MODES.balanced.values);
  if (Object.keys(patch).some((k) => modeKeys.includes(k))) {
    const match = Object.entries(MODES).find(([, m]) => modeKeys.every((k) => m.values[k] === next[k]));
    next.mode = match ? match[0] : "custom";
  }
  useView3d.setState(next, true);
  save(next);
}

export function resetView3d() {
  useView3d.setState({ ...DEFAULTS }, true);
  save({ ...DEFAULTS });
}

/** Re-read after the server's copy was loaded into localStorage. */
export function reloadView3d() {
  useView3d.setState(read(), true);
}
