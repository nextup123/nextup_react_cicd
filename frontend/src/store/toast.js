import { create } from "zustand";

let seq = 0;
const timers = new Map();

export const useToasts = create(() => ({ items: [] }));

function dismiss(id) {
  clearTimeout(timers.get(id));
  timers.delete(id);
  useToasts.setState((s) => ({ items: s.items.filter((t) => t.id !== id) }));
}

/**
 * Show a toast. duration is in ms; 0 keeps it until the user closes it.
 * Errors stay a little longer by default.
 */
let filter = null;
/** Drop some toasts (lib/interlock.js: a refusal its popup already shows). */
export function setToastFilter(fn) {
  filter = fn;
}

function show(kind, message, opts = {}) {
  const text = String(message ?? "");
  if (filter?.(kind, text, opts)) return 0;
  const duration = opts.duration ?? (kind === "error" ? 6000 : 3500);
  // the same message again (a failing poll, a flapping connection): one toast with a count
  const same = useToasts.getState().items.find((t) => t.kind === kind && t.message === text && t.title === opts.title);
  if (same) {
    clearTimeout(timers.get(same.id));
    useToasts.setState((s) => ({ items: s.items.map((t) => (t.id === same.id ? { ...t, count: (t.count || 1) + 1 } : t)) }));
    if (duration > 0) timers.set(same.id, setTimeout(() => dismiss(same.id), duration));
    return same.id;
  }
  const id = ++seq;
  const item = { id, kind, message: text, title: opts.title, source: opts.source };
  useToasts.setState((s) => ({ items: [...s.items, item].slice(-8) }));
  if (duration > 0) timers.set(id, setTimeout(() => dismiss(id), duration));
  return id;
}

export const toast = {
  success: (m, o) => show("success", m, o),
  error: (m, o) => show("error", m, o),
  warning: (m, o) => show("warning", m, o),
  info: (m, o) => show("info", m, o),
  dismiss,
  clear: () => {
    timers.forEach((t) => clearTimeout(t));
    timers.clear();
    useToasts.setState({ items: [] });
  },
};
