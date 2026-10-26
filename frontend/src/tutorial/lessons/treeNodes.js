// Node lessons, built from the live node library: one lesson per family of
// nodes that behave alike (nodeCatalog.js), plus a short lesson per category
// for library nodes the catalog does not know (custom nodes, new nodes).
import { Shapes } from "lucide-react";
import { KINDS, colorOf, isWrapperType, kindOf } from "../../pages/tree/treeModel";
import { FAMILIES, FALLBACK_ICON, SKIP_NODES } from "./nodeCatalog";
import { PAGE, at, byName, isSel, keyOf, latestName, menuOpen, pickerOpen, practiceSetup, pretty, rootSeq, t, tb, viaMenu } from "./treeKit";

const SHAPE_WORD = { square: "a square", diamond: "a diamond", circle: "a circle", hexagon: "a hexagon" };

function attrLine(lib, name, info) {
  const keys = Object.keys(lib.byName.get(name)?.def?.attributes || {}).filter((k) => k !== "_uid");
  if (!keys.length) return null;
  const hints = info?.attrs || {};
  const shown = keys.slice(0, 4).map((k) => (hints[k] ? `${k} (${hints[k]})` : k));
  return `${pretty(name)} settings: ${shown.join(", ")}${keys.length > 4 ? "…" : ""}.`;
}

/** Steps shared by every node lesson: meet, add, (child), (settings), example. */
function nodeSteps({ title, what, members, lib, child, info = {}, example, tip }) {
  const first = members[0];
  const kind = kindOf(first, lib);
  const isWrap = isWrapperType(first, lib);
  const needs = child === "mixed" ? (isWrap ? (kind === "decorator" ? "one" : "many") : "none") : child;
  const signal = t("addNode", "POST");
  const madeIt = (ctx) => byName(ctx, ctx.mem.made);
  const key = keyOf(first);
  const lines = members.map((m) => `${pretty(m)}: ${info[m]?.line || KINDS[kindOf(m, lib)].hint}`);
  const settings = members.map((m) => attrLine(lib, m, info[m])).filter(Boolean);

  const steps = [
    {
      title,
      text: what,
      list: lines,
      swatches: members.map((m) => colorOf(m, lib)),
      tip: `${members.length > 1 ? "They are" : "It is"} drawn as ${SHAPE_WORD[KINDS[kind].shape] || "a shape"} (${KINDS[kind].label.toLowerCase()}).${tip ? ` ${tip}` : ""}`,
    },
    ...viaMenu({
      id: `n-${first}`,
      node: (ctx) => rootSeq(ctx),
      item: "ctx-add-inside",
      type: () => first,
      signal: { ...signal, test: (b) => members.includes(b.nodeType) },
      what: `Add ${members.length > 1 ? `a ${pretty(first)}` : pretty(first)}`,
      itemText: "Choose Add inside…",
      pickText: `Click ${pretty(first)}${members.length > 1 ? ` (or any of: ${members.slice(1).map(pretty).join(", ")})` : ""}. Typing its name in the search box finds it fast.${key ? ` Shortcut: select a container and press Shift + ${key}.` : ""}`,
    }),
    {
      target: (ctx) => at(madeIt(ctx)),
      onEnter: (ctx) => (ctx.mem.made = latestName(ctx)),
      title: "There it is!",
      text: (ctx) => `Your ${pretty(madeIt(ctx)?.type || first)} is in the tree. Look for ${SHAPE_WORD[KINDS[kind].shape] || "its shape"} in this colour.`,
    },
  ];

  const branches = (lib.byName.get(first)?.def?.children || []).length;
  const childType = lib.byName.has("AlwaysSuccess") ? "AlwaysSuccess" : lib.byName.has("Sleep") ? "Sleep" : null;
  if (branches && childType) {
    // Comes with its branches (Sequence1, Sequence2 …): fill the first one.
    const branch = (ctx) => madeIt(ctx)?.children?.[0] || null;
    steps.push(
      { target: (ctx) => at(madeIt(ctx)), title: "Branches included", text: `It comes with ${branches} Sequence branches ready. Your steps go inside them, not next to them.` },
      ...viaMenu({
        id: `b-${first}`,
        node: branch,
        item: "ctx-add-inside",
        type: () => childType,
        signal: t("addNode"),
        what: "Fill the first branch",
        itemText: "Choose Add inside…",
        pickText: `Click ${pretty(childType)} (a simple node to practise with).`,
      })
    );
  } else if (needs === "one" || needs === "many") {
    if (childType)
      steps.push(
        ...viaMenu({
          id: `c-${first}`,
          node: madeIt,
          item: "ctx-add-inside",
          type: () => childType,
          signal: t("addNode"),
          what: needs === "one" ? "Give it a child" : "Add a child",
          itemText: needs === "one" ? "A decorator works on exactly one child. Choose Add inside…" : "A control decides how its children run. Choose Add inside…",
          pickText: `Click ${pretty(childType)} (a simple node to practise with).`,
        })
      );
  }

  if (settings.length) {
    steps.push(
      { target: (ctx) => at(madeIt(ctx)), check: (ctx) => isSel(ctx, madeIt(ctx)), title: "Its settings", text: (ctx) => `Click your ${pretty(madeIt(ctx)?.type || first)} to open its settings.` },
      {
        target: "bt-editor",
        signal: t("updateNode"),
        title: "Set it up",
        text: (ctx) => attrLine(lib, madeIt(ctx)?.type || first, info[madeIt(ctx)?.type || first]) + " Change one and press Save.",
        tip: "Hover a setting's name for its hint. Fields for points offer your taught points.",
      }
    );
  }

  if (example) steps.push({ title: "Use it like this", text: example, target: (ctx) => at(madeIt(ctx)) });
  return steps;
}

/** Lessons for the node library `lib` (indexNodeTypes result). */
export function nodeLessons(lib) {
  if (!lib?.byName?.size) return [];
  const known = new Set();
  const out = [];
  for (const f of FAMILIES) {
    const members = Object.keys(f.nodes).filter((n) => lib.byName.has(n) && !SKIP_NODES.has(n));
    Object.keys(f.nodes).forEach((n) => known.add(n));
    if (!members.length) continue;
    out.push({
      id: `tree.node.${f.id}`,
      page: PAGE,
      group: "Nodes",
      icon: f.icon,
      title: f.title,
      blurb: f.what,
      nodes: members,
      swatches: members.map((m) => colorOf(m, lib)),
      learn: [`What ${members.length > 1 ? "they do" : "it does"}`, "Add one", ...(members.some((m) => Object.keys(lib.byName.get(m)?.def?.attributes || {}).length) ? ["Set it up"] : [])],
      setup: practiceSetup(),
      steps: () => nodeSteps({ title: f.title, what: f.what, members, lib, child: f.child, info: f.nodes, example: f.example, tip: f.tip }),
    });
  }
  // Anything else in the library, one lesson per category.
  for (const cat of lib.categories || []) {
    const rest = cat.nodes.map((n) => n.name).filter((n, i, a) => a.indexOf(n) === i && !known.has(n) && !SKIP_NODES.has(n));
    if (!rest.length) continue;
    rest.forEach((n) => known.add(n));
    const kind = kindOf(rest[0], lib);
    out.push({
      id: `tree.node.more.${cat.key}`,
      page: PAGE,
      group: "Nodes",
      icon: FALLBACK_ICON[kind] || Shapes,
      title: `More ${cat.label.toLowerCase()} nodes`,
      blurb: cat.description || `Other ${cat.label.toLowerCase()} nodes in your library.`,
      nodes: rest,
      swatches: rest.map((m) => colorOf(m, lib)),
      learn: ["Meet them", "Add one"],
      setup: practiceSetup(),
      steps: () => nodeSteps({ title: `More ${cat.label.toLowerCase()} nodes`, what: cat.description || "More nodes from your library.", members: rest, lib, child: "mixed" }),
    });
  }
  return out;
}

export { menuOpen, pickerOpen, tb };
