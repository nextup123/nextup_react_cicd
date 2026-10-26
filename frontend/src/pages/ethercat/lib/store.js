import { useSyncExternalStore } from 'react';

/** Tiny module-level store (same idea as the toast store). */
export function createStore(initial) {
  let state = initial;
  const listeners = new Set();
  return {
    get: () => state,
    set: (next) => { state = typeof next === 'function' ? next(state) : next; listeners.forEach((l) => l()); },
    subscribe: (l) => { listeners.add(l); return () => listeners.delete(l); },
  };
}

export function useStore(store) {
  return useSyncExternalStore(store.subscribe, store.get);
}

/**
 * Latest fault-log result per drive, shared by the fault log and the overview.
 * pos -> { at, mode, faults: [{ slot, code, label }], error }
 */
export const faultStatus = createStore({});

/** One-shot hand-over when another page opens a page for a specific drive. */
const intents = {};
export function setIntent(page, data) { intents[page] = data; }
// Read in a useState initialiser, cleared in an effect (StrictMode renders twice).
export function peekIntent(page) { return intents[page]; }
export function clearIntent(page) { delete intents[page]; }
