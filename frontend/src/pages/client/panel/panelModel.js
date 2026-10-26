// Operator panel model: widget catalog, the default panel, grid placement (collisions, compaction,
// auto-arrange) and the panel store. The layout is one per project (backend /operator-panel:
// control_data/operator_panel.json in the active project, saved and versioned with the project).
import { create } from "zustand";
import { api, errorMessage } from "../../../lib/api";
import { toast } from "../../../store/toast";

export const COLS = 12;
export const ROW_H = 62;
export const GAP = 10;

/** Widget types: label, default size, which bindings fit (see bindings.js BINDING_KINDS). */
export const WIDGETS = {
  button: { label: "Button", hint: "Runs an action, pulses or sets a bit, publishes a value", w: 2, h: 2, kinds: ["action", "plc", "io", "iolist", "topic"] },
  toggle: { label: "Toggle", hint: "On / off switch for a bit, an output or a bool topic", w: 3, h: 1, kinds: ["plc", "io", "iolist", "topic", "robot"] },
  indicator: { label: "Indicator", hint: "Lamp that lights while a signal is on", w: 2, h: 1, kinds: ["plc", "io", "iolist", "topic", "bb", "robot"] },
  radio: { label: "Option buttons", hint: "One of several values (mode, recipe, machine…)", w: 4, h: 2, kinds: ["setting", "robot", "plc", "topic"] },
  dropdown: { label: "Dropdown", hint: "One of several values in a list", w: 3, h: 1, kinds: ["setting", "robot", "plc", "topic"] },
  number: { label: "Number field", hint: "Type a number into a register or topic", w: 3, h: 1, kinds: ["plc", "topic", "robot"] },
  slider: { label: "Slider", hint: "Drag a value between a minimum and a maximum", w: 4, h: 1, kinds: ["plc", "topic", "robot"] },
  text: { label: "Text field", hint: "Send a text on a string topic", w: 4, h: 1, kinds: ["topic"] },
  display: { label: "Value display", hint: "Shows a number, text or state", w: 2, h: 1, kinds: ["plc", "topic", "bb", "robot", "io", "iolist"] },
  group: { label: "Signal group", hint: "Several inputs or outputs in one tile", w: 6, h: 3, kinds: ["group"] },
  label: { label: "Heading", hint: "A title or note to structure the panel", w: 12, h: 1, kinds: [] },
};

export const COLORS = [
  { id: "auto", label: "Auto" },
  { id: "accent", label: "Accent" },
  { id: "green", label: "Green" },
  { id: "red", label: "Red" },
  { id: "amber", label: "Amber" },
  { id: "blue", label: "Blue" },
  { id: "gray", label: "Gray" },
];

let seq = 0;
export const newId = () => `w${Date.now().toString(36)}${(seq++).toString(36)}`;

/** The panel a project starts with: what the old Setup, Inputs and Outputs sections showed, plus the usual safety actions. */
export function defaultLayout() {
  return {
    version: 1,
    widgets: [
      { id: "def-runmode", type: "radio", x: 0, y: 0, w: 5, h: 2, label: "Run mode", color: "accent", binding: { kind: "setting", key: "mode" } },
      { id: "def-cnc", type: "radio", x: 5, y: 0, w: 4, h: 2, label: "CNC machine", color: "accent", binding: { kind: "setting", key: "cnc" } },
      { id: "def-reset", type: "button", x: 9, y: 0, w: 3, h: 1, label: "Reset emergency", color: "amber", binding: { kind: "action", action: "reset_fault" } },
      { id: "def-stopmotion", type: "button", x: 9, y: 1, w: 3, h: 1, label: "Stop motion", color: "red", binding: { kind: "action", action: "motion_stop" } },
      { id: "def-inputs", type: "group", x: 0, y: 2, w: 6, h: 3, label: "Inputs", color: "green", binding: { kind: "group", source: "iolist", dir: "di", items: [] } },
      { id: "def-outputs", type: "group", x: 6, y: 2, w: 6, h: 3, label: "Outputs", color: "green", binding: { kind: "group", source: "iolist", dir: "do", items: [] } },
    ],
  };
}

/* ───────── grid math (x, y, w, h in cells) ───────── */

const overlap = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
export const clampItem = (it) => {
  const w = Math.max(1, Math.min(COLS, Math.round(it.w)));
  const h = Math.max(1, Math.min(8, Math.round(it.h)));
  return { ...it, w, h, x: Math.max(0, Math.min(COLS - w, Math.round(it.x))), y: Math.max(0, Math.round(it.y)) };
};

/** Move everything up as far as it goes (top to bottom; nothing overlaps afterwards). */
export function compact(list) {
  const sorted = [...list].sort((a, b) => a.y - b.y || a.x - b.x);
  const placed = [];
  for (const it of sorted) {
    const c = { ...it, y: 0 };
    while (placed.some((p) => overlap(p, c))) c.y++;
    placed.push(c);
  }
  return placed;
}

/** Put `moved` where it was dropped; the others keep their order and move up or down around it. */
export function placeItem(list, moved) {
  const m = clampItem(moved);
  const out = [m];
  for (const o of list.filter((x) => x.id !== m.id).sort((a, b) => a.y - b.y || a.x - b.x)) {
    const c = { ...o, y: 0 };
    while (out.some((p) => overlap(p, c))) c.y++;
    out.push(c);
  }
  return compact(out);
}

/** First free spot for a w×h widget (row by row). */
export function freeSpot(list, w, h) {
  for (let y = 0; y < 200; y++) for (let x = 0; x <= COLS - w; x++) {
    const c = { x, y, w, h };
    if (!list.some((p) => overlap(p, c))) return { x, y };
  }
  return { x: 0, y: list.reduce((m, p) => Math.max(m, p.y + p.h), 0) };
}

/**
 * Auto-arrange: widgets keep their size and reading order and are packed into the first spot
 * that fits (headings start a new section across the full width); then every widget grows to
 * the right into free cells beside it, so the rows end on the same edge with no holes.
 */
export function autoArrange(list) {
  const sorted = [...list].sort((a, b) => a.y - b.y || a.x - b.x);
  const out = [];
  let top = 0;
  const bottom = () => out.reduce((m, p) => Math.max(m, p.y + p.h), 0);
  for (const it of sorted) {
    if (it.type === "label") {
      const y = bottom();
      out.push({ ...it, x: 0, y, w: COLS, h: 1 });
      top = y + 1;
      continue;
    }
    const w = Math.min(COLS, it.w);
    let spot = null;
    for (let y = top; !spot && y < top + 400; y++) {
      for (let x = 0; x <= COLS - w; x++) {
        const c = { x, y, w, h: it.h };
        if (!out.some((p) => overlap(p, c))) { spot = c; break; }
      }
    }
    out.push({ ...it, ...spot });
  }
  for (const it of [...out].sort((a, b) => a.y - b.y || b.x - a.x)) {
    if (it.type === "label") continue;
    while (it.x + it.w < COLS && !out.some((p) => p !== it && overlap(p, { x: it.x + it.w, y: it.y, w: 1, h: it.h }))) it.w++;
  }
  return out;
}

/* ───────── store ───────── */

let saveTimer = null;
export const usePanel = create((set, get) => ({
  layout: null, // { version, widgets }
  loaded: false,
  custom: false, // the project has its own panel (else the default one is shown)
  editing: false,
  error: "",
  async load() {
    try {
      const r = await api.get("/operator-panel");
      const layout = r?.layout && Array.isArray(r.layout.widgets) ? r.layout : defaultLayout();
      set({ layout: { ...layout, widgets: compact(layout.widgets.map(clampItem)) }, loaded: true, custom: Boolean(r?.layout), error: "" });
      if (r?.message) toast.warning(r.message);
    } catch (err) {
      set({ layout: defaultLayout(), loaded: true, custom: false, error: errorMessage(err, "Could not load the panel") });
    }
  },
  /** Change the widgets (fn(list) -> list); saved to the project half a second later. */
  update(fn) {
    const cur = get().layout || defaultLayout();
    const widgets = fn(cur.widgets);
    set({ layout: { ...cur, widgets }, custom: true });
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => get().save(), 500);
  },
  async save() {
    clearTimeout(saveTimer);
    try {
      await api.put("/operator-panel", { layout: get().layout });
    } catch (err) {
      toast.error(errorMessage(err, "Could not save the panel"));
    }
  },
  async resetToDefault() {
    clearTimeout(saveTimer);
    try { await api.del("/operator-panel"); } catch { /* shown as default anyway */ }
    set({ layout: defaultLayout(), custom: false });
  },
  setEditing: (editing) => set({ editing }),
}));
