import { create } from "zustand";

export const useConfirmStore = create(() => ({ current: null }));

/**
 * Promise-based confirmation dialog.
 *   if (await confirm({ title: "Delete point?", message: "...", tone: "danger", confirmLabel: "Delete" })) ...
 * Pass `input: { label, defaultValue, placeholder }` to ask for a value; the
 * promise then resolves to the entered string (or null when cancelled).
 */
export function confirm(opts) {
  return new Promise((resolve) => {
    useConfirmStore.setState({ current: { ...opts, resolve } });
  });
}

export function prompt(opts) {
  return confirm({ ...opts, input: opts.input || { label: opts.label, defaultValue: opts.defaultValue ?? "" } });
}
