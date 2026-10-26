// Helpers for the Robot Program lessons: the practice subtree, finding nodes
// on the canvas, and step builders for "do it with the mouse" and "now with
// the keys". Lessons practise in their own subtree, never in the program the
// robot runs.
import { invalidate } from "../../lib/queries";
import { treeApi } from "../../pages/tree/treeApi";
import { useClipboard, useQuickAdd } from "../../pages/tree/shortcuts";
import { flatten, isWrapperType } from "../../pages/tree/treeModel";
import { api } from "../engine";

export const PAGE = "/tree";
export const PRACTICE = "Practice_tutorial";

const esc = (s) => (window.CSS?.escape ? CSS.escape(s) : String(s).replace(/"/g, '\\"'));
export const tb = (ctx) => ctx.bridge("tree") || {};
export const nodes = (ctx) => flatten(tb(ctx).tree?.root);
export const rootSeq = (ctx) => tb(ctx).tree?.root?.children?.[0] || null;
export const byName = (ctx, name) => (name ? nodes(ctx).find((n) => n.name === name) || null : null);
export const parentOf = (ctx, n) => (n?.parentKey ? tb(ctx).tree?.byKey.get(n.parentKey) || null : null);
export const at = (node) => (node ? `.bt-stage [data-key="${esc(node.key)}"]` : null);
export const isSel = (ctx, node) => !!node && tb(ctx).selected?.key === node.key;
export const menuOpen = () => !!document.querySelector('[data-tut="ctx-menu"]');
export const pickerOpen = () => !!document.querySelector('[data-tut="ctx-search"]');
/** The menu is open, or what it started is still going (confirm dialog, saving). */
const stillInMenu = (ctx) => menuOpen() || !!document.querySelector(".overlay") || !!tb(ctx).busy;
export const clip = () => useClipboard.getState().clip;
export const t = (path) => api(`/main-tree/${path}`);
export const pretty = (name) => String(name).replace(/([a-z0-9])([A-Z])/g, "$1 $2");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, ms, what) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try {
      if (fn()) return;
    } catch {
      /* not yet */
    }
    await sleep(100);
  }
  throw new Error(what);
}

/** Leaves of the practice subtree (most recent first by position). */
const leaves = (ctx, lib) => nodes(ctx).filter((n) => n.depth > 1 && !isWrapperType(n.type, lib) && !n.children.length).reverse();

/** Name of the node the person made last (add, add after, paste, duplicate). */
export function latestName(ctx) {
  const keys = Object.keys(ctx.mem.last).reverse();
  for (const k of keys) {
    const d = ctx.mem.last[k];
    if (/addNode(After)?$/.test(k)) return d?.body?.nodeName;
    if (/(pasteNode|copyNode)$/.test(k)) return d?.data?.name;
  }
  return null;
}

/** A leaf to work on: the remembered one, the latest made, else any leaf in the practice subtree. */
export function leaf(ctx, memKey = "leaf") {
  const lib = tb(ctx).lib;
  const remembered = byName(ctx, ctx.mem[memKey]);
  if (remembered) return remembered;
  const latest = byName(ctx, latestName(ctx));
  if (latest && !isWrapperType(latest.type, lib)) return latest;
  return leaves(ctx, lib)[0] || null;
}

/** A simple node type to practise with, and its quick-add key if it has one. */
export function practiceType(ctx) {
  const lib = tb(ctx).lib;
  const items = useQuickAdd.getState().items;
  const keyed = items.filter((i) => i.key && lib?.byName.has(i.nodeName) && !isWrapperType(i.nodeName, lib));
  const prefer = ["Sleep", "AlwaysSuccess", "MsgLogger", "Delay"];
  for (const p of prefer) {
    const k = keyed.find((i) => i.nodeName === p);
    if (k) return { type: k.nodeName, key: k.key.toUpperCase() };
  }
  if (keyed[0]) return { type: keyed[0].nodeName, key: keyed[0].key.toUpperCase() };
  const any = prefer.find((p) => lib?.byName.has(p)) || "AlwaysSuccess";
  return { type: any, key: null };
}

/** Quick-add key of a node type ("S"), or null. */
export const keyOf = (type) => useQuickAdd.getState().items.find((i) => i.nodeName === type && i.key)?.key.toUpperCase() || null;

/* ───────────── Practice subtree ───────────── */
async function openPractice(ctx) {
  await waitFor(() => tb(ctx).subtrees, 10000, "The Robot Program page did not load. Open it and try again.");
  if (!tb(ctx).subtrees.includes(PRACTICE)) {
    await treeApi.addSubtree(PRACTICE);
    await invalidate.tree();
    await waitFor(() => tb(ctx).subtrees?.includes(PRACTICE), 8000, "The practice subtree could not be created.");
  }
  if (tb(ctx).subtreeId !== PRACTICE) tb(ctx).openSubtree(PRACTICE);
  await waitFor(() => tb(ctx).subtreeId === PRACTICE && tb(ctx).tree && tb(ctx).lib, 8000, "The practice subtree did not open.");
  if (tb(ctx).view !== "tree") tb(ctx).setView("tree");
  // The practice subtree always starts with a RootSequence to build in.
  if (!rootSeq(ctx)) {
    await treeApi.addNode(PRACTICE, tb(ctx).tree.root.path, "Sequence", "RootSequence", {});
    await invalidate.tree();
    await waitFor(() => rootSeq(ctx), 5000, "The practice subtree could not be prepared.");
  }
}

/** Setup for every Robot Program lesson; `need` adds nodes the lesson works on. */
export function practiceSetup(need = []) {
  return async (ctx) => {
    await openPractice(ctx);
    const lib = tb(ctx).lib;
    for (const type of need) {
      const want = type === "leaf" ? practiceType(ctx).type : type;
      if (!lib?.byName.has(want)) continue;
      const have = type === "leaf" ? leaves(ctx, lib).length > 0 : nodes(ctx).some((n) => n.type === want);
      if (have) continue;
      const name = `${want}_practice`;
      await treeApi.addNode(PRACTICE, rootSeq(ctx).path, want, name, defaults(lib, want));
      await invalidate.tree();
      await waitFor(() => byName(ctx, name), 5000, "The practice nodes could not be added.");
    }
    tb(ctx).select?.(null);
  };
}

function defaults(lib, type) {
  const a = lib?.byName.get(type)?.def?.attributes || {};
  return Object.fromEntries(Object.entries(a).map(([k, v]) => [k, v ?? ""]));
}

export async function resetPractice() {
  try {
    await treeApi.deleteSubtree(PRACTICE);
  } catch {
    /* not there */
  }
  await treeApi.addSubtree(PRACTICE);
  await invalidate.tree();
}

export async function removePractice() {
  await treeApi.deleteSubtree(PRACTICE);
  await invalidate.tree();
}

/* ───────────── Step builders ───────────── */
/**
 * Right-click a node, choose a menu item, and (for add) pick the node type.
 *   node(ctx) → node, item: "ctx-add-inside", type(ctx) → type name (for pickers),
 *   signal: what finishes it. Any other way to the same result also counts.
 */
export function viaMenu({ id, node, item, type, signal, what, itemText, pickText, sub, tip }) {
  const group = `menu-${id}`;
  const steps = [
    {
      id: `${group}-open`,
      group,
      target: (ctx) => at(node(ctx)),
      check: (ctx) => menuOpen() && isSel(ctx, node(ctx)),
      title: what,
      text: (ctx) => `Right-click ${label(node(ctx))} to open its menu. On a touch screen, press and hold it.`,
      missing: "That node is not on the screen. Press Fit (F) to see the whole tree, or skip.",
    },
    {
      group,
      target: item,
      requires: stillInMenu,
      backTo: `${group}-open`,
      ...(type || sub ? { check: () => (sub ? !!document.querySelector(`[data-tut="${sub}"]`) : pickerOpen()) } : { signal }),
      title: what,
      text: itemText,
      tip,
    },
  ];
  if (type)
    steps.push({
      group,
      target: (ctx) => [`[data-tut="ctx-type-${type(ctx)}"]`, "ctx-menu"],
      requires: stillInMenu,
      backTo: `${group}-open`,
      signal,
      title: what,
      text: (ctx) => pickText || `Click ${pretty(type(ctx))}. Tip: type its name in the search box to find it fast.`,
    });
  if (sub)
    steps.push({ group, target: sub, requires: stillInMenu, backTo: `${group}-open`, signal, title: what, text: pickText });
  return steps;
}

/** Select a node, then press keys. */
export function viaKeys({ id, node, keys, signal, press, what, text, tip, selectText }) {
  return [
    {
      id: `keys-${id}-select`,
      target: (ctx) => at(node(ctx)),
      check: (ctx) => isSel(ctx, node(ctx)),
      title: what,
      text: (ctx) => selectText || `Click ${label(node(ctx))} to select it.`,
      missing: "That node is not on the screen. Press F to fit the tree, or skip.",
    },
    {
      target: (ctx) => at(node(ctx)),
      keys: signal ? keys : undefined,
      press: signal ? undefined : press || keys,
      signal,
      requires: (ctx) => !!tb(ctx).selected,
      backTo: `keys-${id}-select`,
      title: what,
      text,
      tip,
    },
  ];
}

export const label = (n) => (n ? `"${n.name}"` : "the node");
