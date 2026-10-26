// IO controls pinned to float over every page (IO Control → pin icon).
// Saved in the browser, with each control's position.
import { create } from "zustand";

const KEY = "nextup.floatingIo";

function read() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || "[]");
    return Array.isArray(raw) ? raw.filter((p) => p && typeof p.name === "string") : [];
  } catch {
    return [];
  }
}

/** pins: [{ name, x, y, seq }] — seq is a snapshot of the IO sequence step. */
export const useFloating = create(() => ({ pins: read() }));

useFloating.subscribe((s) => {
  try {
    localStorage.setItem(KEY, JSON.stringify(s.pins));
  } catch {
    /* ignore */
  }
});

const PIN_W = 230;
const PIN_H = 40;

export function isPinned(name) {
  return useFloating.getState().pins.some((p) => p.name === name);
}

export function pinControl(seq) {
  const { pins } = useFloating.getState();
  if (pins.some((p) => p.name === seq.name)) return;
  // New controls stack up from the bottom-right corner.
  const x = Math.max(8, window.innerWidth - PIN_W - 24);
  const y = Math.max(72, window.innerHeight - 24 - (pins.length + 1) * (PIN_H + 8));
  useFloating.setState({ pins: [...pins, { name: seq.name, x, y, seq }] });
}

export function unpinControl(name) {
  useFloating.setState((s) => ({ pins: s.pins.filter((p) => p.name !== name) }));
}

export function togglePin(seq) {
  if (isPinned(seq.name)) unpinControl(seq.name);
  else pinControl(seq);
}

export function movePin(name, x, y) {
  useFloating.setState((s) => ({ pins: s.pins.map((p) => (p.name === name ? { ...p, x, y } : p)) }));
}

/** Keep the snapshot of a pinned step current when the IO list changes. */
export function syncPins(sequences) {
  const byName = new Map(sequences.map((s) => [s.name, s]));
  const { pins } = useFloating.getState();
  let changed = false;
  const next = pins.map((p) => {
    const fresh = byName.get(p.name);
    if (fresh && JSON.stringify(fresh) !== JSON.stringify(p.seq)) {
      changed = true;
      return { ...p, seq: fresh };
    }
    return p;
  });
  if (changed) useFloating.setState({ pins: next });
}
