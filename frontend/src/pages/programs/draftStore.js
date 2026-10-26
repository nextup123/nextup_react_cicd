// The program being edited: the saved version, the draft, undo / redo and the
// selected step. One draft at a time; switching programs with unsaved
// changes asks first (ProgramsPage).
import { create } from "zustand";

const LIMIT = 100;
const COALESCE_MS = 700;
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export const useDraft = create((set, get) => ({
  savedName: null, // name in programs.yaml (null = not saved yet)
  base: null, // program as saved
  draft: null,
  past: [],
  future: [],
  sel: 0, // selected step index (-1 = program settings)
  lastKey: null,
  lastAt: 0,

  open(program, { isNew = false, sel = 0 } = {}) {
    set({ savedName: isNew ? null : program.name, base: isNew ? null : program, draft: program, past: [], future: [], sel, lastKey: null, lastAt: 0 });
  },
  close() {
    set({ savedName: null, base: null, draft: null, past: [], future: [], sel: 0 });
  },
  /** Apply an edit. `key` groups fast edits of one field into one undo step. */
  edit(fn, key = null, sel) {
    const s = get();
    if (!s.draft) return;
    const next = typeof fn === "function" ? fn(s.draft) : fn;
    if (!next || same(next, s.draft)) return;
    const now = Date.now();
    const merge = key && key === s.lastKey && now - s.lastAt < COALESCE_MS;
    set({
      draft: next,
      past: merge ? s.past : [...s.past.slice(-LIMIT + 1), { draft: s.draft, sel: s.sel }],
      future: [],
      lastKey: key,
      lastAt: now,
      ...(sel !== undefined ? { sel } : {}),
    });
  },
  editStep(i, patch, key) {
    get().edit((d) => ({ ...d, steps: d.steps.map((st, k) => (k === i ? (typeof patch === "function" ? patch(st) : { ...st, ...patch }) : st)) }), key ? `${i}:${key}` : null);
  },
  undo() {
    const s = get();
    const prev = s.past[s.past.length - 1];
    if (!prev) return;
    set({ draft: prev.draft, sel: prev.sel, past: s.past.slice(0, -1), future: [{ draft: s.draft, sel: s.sel }, ...s.future], lastKey: null });
  },
  redo() {
    const s = get();
    const next = s.future[0];
    if (!next) return;
    set({ draft: next.draft, sel: next.sel, future: s.future.slice(1), past: [...s.past, { draft: s.draft, sel: s.sel }], lastKey: null });
  },
  select(sel) {
    set({ sel, lastKey: null });
  },
  /** After a save: the draft becomes the saved version (history kept). */
  saved(program) {
    set({ savedName: program.name, base: program, draft: program });
  },
  discard() {
    const s = get();
    if (s.base) set({ draft: s.base, past: [...s.past, { draft: s.draft, sel: s.sel }], future: [] });
  },
}));

export const isDirty = (s) => Boolean(s.draft) && (!s.base || !same(s.base, s.draft));
