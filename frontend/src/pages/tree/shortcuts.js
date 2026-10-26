// Keyboard quick-add list (editable, saved in this browser) and the node
// clipboard used by Ctrl+C / Ctrl+X / Ctrl+V.
//   Shift + key → add as child of the selected node
//   Alt   + key → add right after the selected node
import { create } from "zustand";

export const DEFAULT_QUICK_ADD = [
  { key: "s", nodeName: "Sequence", label: "Sequence" },
  { key: "f", nodeName: "Fallback", label: "Fallback" },
  { key: "l", nodeName: "Sleep", label: "Sleep" },
  { key: "m", nodeName: "MsgLogger", label: "Message Logger" },
  { key: "p", nodeName: "MsgPopup", label: "Message Popup" },
  { key: "d", nodeName: "Delay", label: "Delay" },
  { key: "i", nodeName: "Inverter", label: "Inverter" },
  { key: "z", nodeName: "AlwaysFailure", label: "Always Failure" },
  { key: "r", nodeName: "RetryUntilSuccessful", label: "Retry Until Successful" },
  { key: "a", nodeName: "AlwaysSuccess", label: "Always Success" },
];

const QA_KEY = "nextup.tree.quickAdd";

function readQuickAdd() {
  try {
    const raw = JSON.parse(localStorage.getItem(QA_KEY));
    if (!Array.isArray(raw)) return DEFAULT_QUICK_ADD;
    return raw
      .filter((s) => s && typeof s.nodeName === "string" && s.nodeName)
      .map((s) => ({ nodeName: s.nodeName, label: String(s.label || s.nodeName), key: /^[a-z]$/.test(s.key) ? s.key : "" }));
  } catch {
    return DEFAULT_QUICK_ADD;
  }
}

/** items: [{ key: "a".."z" | "", nodeName, label }] */
export const useQuickAdd = create(() => ({ items: readQuickAdd() }));
useQuickAdd.subscribe((s) => {
  try {
    localStorage.setItem(QA_KEY, JSON.stringify(s.items));
  } catch {
    /* storage unavailable */
  }
});

export const quickAdd = {
  add(item) {
    useQuickAdd.setState((s) => ({
      // A key belongs to one entry only: taking it frees it elsewhere.
      items: [...s.items.map((i) => (item.key && i.key === item.key ? { ...i, key: "" } : i)), item],
    }));
  },
  remove(index) {
    useQuickAdd.setState((s) => ({ items: s.items.filter((_, i) => i !== index) }));
  },
  move(index, dir) {
    useQuickAdd.setState((s) => {
      const items = [...s.items];
      const j = index + dir;
      if (j < 0 || j >= items.length) return s;
      [items[index], items[j]] = [items[j], items[index]];
      return { items };
    });
  },
  setKey(index, key) {
    useQuickAdd.setState((s) => ({
      items: s.items.map((i, n) => (n === index ? { ...i, key } : key && i.key === key ? { ...i, key: "" } : i)),
    }));
  },
  reset() {
    useQuickAdd.setState({ items: DEFAULT_QUICK_ADD });
  },
};

/** Quick-add entry for a KeyboardEvent.code ("KeyS"), or undefined. */
export function quickAddByCode(code, items = useQuickAdd.getState().items) {
  const m = /^Key([A-Z])$/.exec(code || "");
  return m ? items.find((i) => i.key === m[1].toLowerCase()) : undefined;
}

/* ───────────── Clipboard ─────────────
   Holds a copy of the node's XML (as the backend's JSON form), so it can be
   pasted into any subtree, also after the original changed or was deleted.
   Saved in the browser so it survives switching subtrees and reloads. */
const CB_KEY = "nextup.tree.clipboard";
function readClipboard() {
  try {
    const raw = JSON.parse(localStorage.getItem(CB_KEY));
    return raw && raw.fragment?.tagName ? raw : null;
  } catch {
    return null;
  }
}
/** clip: { fragment, name, type, count, from } | null */
export const useClipboard = create(() => ({ clip: readClipboard() }));
useClipboard.subscribe((s) => {
  try {
    if (s.clip) localStorage.setItem(CB_KEY, JSON.stringify(s.clip));
    else localStorage.removeItem(CB_KEY);
  } catch {
    /* storage unavailable */
  }
});
// Another tab copied something: pick it up.
if (typeof window !== "undefined")
  window.addEventListener("storage", (e) => e.key === CB_KEY && useClipboard.setState({ clip: readClipboard() }));

export const NAV_SHORTCUTS = [
  { keys: ["Shift", "←"], label: "Select previous sibling" },
  { keys: ["Shift", "→"], label: "Select next sibling" },
  { keys: ["Shift", "↑"], label: "Select parent" },
  { keys: ["Shift", "↓"], label: "Select first child" },
  { keys: ["Ctrl", "←"], label: "Move node left" },
  { keys: ["Ctrl", "→"], label: "Move node right" },
  { keys: ["Ctrl", "D"], label: "Duplicate (new IDs and names)" },
  { keys: ["Ctrl", "C"], label: "Copy node and its children" },
  { keys: ["Ctrl", "X"], label: "Cut node and its children" },
  { keys: ["Ctrl", "V"], label: "Paste inside selected container (else after it)" },
  { keys: ["Ctrl", "Shift", "V"], label: "Paste after selected" },
  { keys: ["Space"], label: "Expand / collapse selected" },
  { keys: ["Enter"], label: "Edit selected (open editor)" },
  { keys: ["C"], label: "Centre on selected" },
  { keys: ["F"], label: "Fit tree to view" },
  { keys: ["Delete"], label: "Delete selected node" },
  { keys: ["Ctrl", "Z"], label: "Undo the last change (one step)" },
  { keys: ["Ctrl", "Y"], label: "Redo what was undone" },
  { keys: ["Ctrl", "F"], label: "Search nodes" },
  { keys: ["Esc"], label: "Close menu / clear selection" },
  { keys: ["Ctrl", "S"], label: "Show this list" },
];
