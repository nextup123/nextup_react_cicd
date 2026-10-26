// Which top-bar status panels are open (robot joints, motion, program) and
// where they float. They stay open until closed, so all three can be watched
// at once while debugging, and each one (open or folded to its header) is
// dragged anywhere in the window by its header; the spot is kept per panel.
// Kept in localStorage (nextup.*, so it follows the user through /ui-prefs).
// `order` is the right-to-left order a newly opened panel takes under the top
// bar when it has no spot yet; `z` is the stacking order (last = on top).
import { create } from "zustand";

const KEY = "nextup.statusDock";
export const DOCK_PANELS = ["joints", "motion", "program"];

/** Panel widths in px (unfolded / folded); statusDock.css uses the same. */
export const DOCK_WIDTH = { joints: 400, motion: 360, program: 380 };
export const DOCK_FOLDED_WIDTH = 240;
export const DOCK_HEAD_H = 40;
const EDGE = 8; // gap kept to the window edges
const GAP = 8;

function cleanOrder(order) {
  const known = Array.isArray(order) ? order.filter((p, i) => DOCK_PANELS.includes(p) && order.indexOf(p) === i) : [];
  return [...known, ...DOCK_PANELS.filter((p) => !known.includes(p))];
}

function cleanPos(pos) {
  const out = {};
  if (pos && typeof pos === "object")
    for (const p of DOCK_PANELS) {
      const v = pos[p];
      if (v && Number.isFinite(v.x) && Number.isFinite(v.y)) out[p] = { x: v.x, y: v.y };
    }
  return out;
}

function load() {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || "{}");
    return {
      open: Array.isArray(v.open) ? v.open.filter((p) => DOCK_PANELS.includes(p)) : [],
      folded: Array.isArray(v.folded) ? v.folded : [],
      order: cleanOrder(v.order),
      z: cleanOrder(v.z),
      pos: cleanPos(v.pos),
    };
  } catch {
    return { open: [], folded: [], order: [...DOCK_PANELS], z: [...DOCK_PANELS], pos: {} };
  }
}

function save({ open, folded, order, z, pos }) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ open, folded, order, z, pos }));
  } catch {
    /* ignore */
  }
}

export const useStatusDock = create(() => load());

const update = (fn) => {
  const next = fn(useStatusDock.getState());
  useStatusDock.setState(next);
  save(useStatusDock.getState());
};

export const dockWidth = (id, folded) => Math.min(folded ? DOCK_FOLDED_WIDTH : DOCK_WIDTH[id] || 380, window.innerWidth - 2 * EDGE);

/** Keep a panel's header inside the window (the body may hang below the edge, it scrolls). */
export function clampDockPos({ x, y }, width) {
  const maxX = Math.max(EDGE, window.innerWidth - width - EDGE);
  const maxY = Math.max(EDGE, window.innerHeight - DOCK_HEAD_H - EDGE);
  return { x: Math.round(Math.min(Math.max(x, EDGE), maxX)), y: Math.round(Math.min(Math.max(y, EDGE), maxY)) };
}

/** Under the top bar (where the panels sat before they could float). */
function homeTop() {
  const bar = document.querySelector(".topbar")?.getBoundingClientRect();
  return Math.round((bar ? bar.bottom : 64) + 6);
}

/**
 * Spot for a panel opened without one: under the top bar, right-aligned, to
 * the left of the panels already sitting on that row (as before, side by
 * side). When the row is full it starts again at the right, one header lower.
 */
function homeSpot(id, state) {
  const top = homeTop();
  const w = dockWidth(id, false);
  const right = window.innerWidth - 16;
  for (let row = 0; row < 4; row++) {
    const y = top + row * (DOCK_HEAD_H + GAP);
    const onRow = state.open.filter((p) => p !== id && state.pos[p] && Math.abs(state.pos[p].y - y) < DOCK_HEAD_H / 2);
    const left = Math.min(right + GAP, ...onRow.map((p) => state.pos[p].x));
    const x = left - GAP - w;
    if (x >= EDGE) return clampDockPos({ x, y }, w);
  }
  return clampDockPos({ x: right - w, y: top }, w);
}

const raised = (z, id) => [...z.filter((p) => p !== id), id];

/** Open or close a panel (a folded panel unfolds instead of closing). */
export function toggleDockPanel(id) {
  update((s) => {
    const { open, folded, pos, z } = s;
    if (open.includes(id) && folded.includes(id)) return { folded: folded.filter((p) => p !== id), z: raised(z, id) };
    if (open.includes(id)) return { open: open.filter((p) => p !== id) };
    const spot = pos[id] ? clampDockPos(pos[id], dockWidth(id, false)) : homeSpot(id, s);
    return { open: [...open, id], folded: folded.filter((p) => p !== id), pos: { ...pos, [id]: spot }, z: raised(z, id) };
  });
}

export const closeDockPanel = (id) => update(({ open }) => ({ open: open.filter((p) => p !== id) }));
export const toggleDockFold = (id) => update(({ folded }) => ({ folded: folded.includes(id) ? folded.filter((p) => p !== id) : [...folded, id] }));

/** Bring a panel to the front (on press). */
export const raiseDockPanel = (id) => {
  const { z } = useStatusDock.getState();
  if (z[z.length - 1] !== id) update(() => ({ z: raised(z, id) }));
};

/** Keep where a panel was dropped. */
export const setDockPos = (id, p) => update(({ pos }) => ({ pos: { ...pos, [id]: { x: Math.round(p.x), y: Math.round(p.y) } } }));

/** Give open panels that have no spot yet (older saved layouts) one under the top bar. */
export function ensureDockSpots() {
  const s = useStatusDock.getState();
  const missing = [...DOCK_PANELS].reverse().filter((p) => s.open.includes(p) && !s.pos[p]);
  if (!missing.length) return;
  let pos = { ...s.pos };
  for (const id of missing) pos = { ...pos, [id]: homeSpot(id, { ...s, pos }) };
  update(() => ({ pos }));
}

/** Put every open panel back under the top bar, side by side. */
export function resetDockPositions() {
  update(() => ({ pos: {}, order: [...DOCK_PANELS] }));
  const s = useStatusDock.getState();
  let pos = {};
  // right-to-left in the default order, as when they are opened one by one
  for (const id of [...DOCK_PANELS].reverse().filter((p) => s.open.includes(p))) pos = { ...pos, [id]: homeSpot(id, { ...s, pos }) };
  update(() => ({ pos }));
}

export const useDockOpen = (id) => useStatusDock((s) => s.open.includes(id));
