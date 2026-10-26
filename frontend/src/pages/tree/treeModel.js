// Pure helpers for the behaviour-tree editor: converting the backend's JSON
// form of the XML into a tree the UI can render, node kinds and colours,
// lookups and structural rules.

/* ───────────── Node kinds, shapes and colours ─────────────
   The SHAPE says what kind of node it is (the four behaviour-tree node kinds,
   plus the root and subtree links). The COLOUR says what the node does
   (flow, motion, IO, timing, messages, result …), see colourGroupOf().
   Colours are hex values because they are painted inside the SVG canvas. */
export const KINDS = {
  root: { label: "Tree root", shape: "root", color: "#344054", hint: "The subtree itself (BehaviorTree)" },
  control: { label: "Control", shape: "square", color: "#4f46e5", hint: "Sequence, Fallback, Parallel … decide which children run" },
  decorator: { label: "Decorator", shape: "diamond", color: "#0891b2", hint: "Wraps one child and changes its result (Repeat, Timeout, Inverter …)" },
  action: { label: "Action", shape: "circle", color: "#059669", hint: "Does something: moves, IO, messages, timers …" },
  condition: { label: "Condition", shape: "hexagon", color: "#b45309", hint: "Checks a state and succeeds or fails" },
  subtree: { label: "Subtree link", shape: "folder", color: "#7a5af8", hint: "<SubTreePlus> reference to another subtree" },
  other: { label: "Unknown type", shape: "circle", color: "#98a2b3", hint: "Node type not found in the node library" },
};
export const KIND_ORDER = ["root", "control", "decorator", "action", "condition", "subtree", "other"];

/* Colour groups: what a node does. First matching rule wins; nodes that match
   no rule use their kind's colour. Matching is on the node type name (and the
   library category), so custom node types get a sensible colour too. */
export const COLOR_GROUPS = [
  { key: "root", label: "Tree root", color: "#344054" },
  { key: "link", label: "Subtree link", color: "#7a5af8" },
  { key: "sequence", label: "Run in order", color: "#4f46e5", test: (t) => /^(Reactive)?Sequence|SequenceStar/.test(t) },
  { key: "fallback", label: "Try alternatives", color: "#8b5cf6", test: (t) => /Fallback|Selector|IfThenElse|WhileDoElse/.test(t) },
  { key: "parallel", label: "Run together", color: "#2563eb", test: (t) => /Parallel/.test(t) },
  { key: "fail", label: "Fail / stop", color: "#dc2626", test: (t) => /Failure|Abort|Error|Halt|Stop|Protection/i.test(t) },
  { key: "success", label: "Succeed", color: "#16a34a", test: (t) => /Success/.test(t) },
  { key: "loop", label: "Repeat / retry", color: "#db2777", test: (t) => /Repeat|Retry|KeepRunning|Loop|Alternating|RunOnce|OneShot/i.test(t) },
  { key: "invert", label: "Invert", color: "#9333ea", test: (t) => /Invert/.test(t) },
  { key: "motion", label: "Robot motion", color: "#1d4ed8", test: (t, e) => e?.category === "motion" || /Planner|Motion|RunPath|Move|Pilz|IsAtPose|Pose/i.test(t) },
  { key: "io", label: "Inputs / outputs", color: "#0d9488", test: (t) => /^D[IO]|DIControl|DoControl|Gpio|Grip|Output|Input|Topic/i.test(t) },
  { key: "time", label: "Timing / wait", color: "#d97706", test: (t) => /Sleep|Delay|Wait|Timer|Timeout|Ticks/i.test(t) },
  { key: "message", label: "Messages", color: "#0284c7", test: (t) => /Msg|Message|Log|Popup|Print|Notify/i.test(t) },
  { key: "data", label: "Variables / maths", color: "#64748b", test: (t, e) => e?.category === "blackboard" || /Var|Arithmetic|Math|Modulo|Compare|Blackboard|Counter/i.test(t) },
];
const GROUP_BY_KEY = new Map(COLOR_GROUPS.map((g) => [g.key, g]));

// Container types that are wrappers even if missing from the node library.
const BUILTIN_WRAPPERS = new Set([
  "BehaviorTree",
  "Sequence",
  "Fallback",
  "Selector",
  "Parallel",
  "WhileDoElse",
  "IfThenElse",
  "ReactiveSequence",
  "ReactiveFallback",
  "SequenceStar",
]);
export const SUBTREE_TAGS = new Set(["SubTree", "SubTreePlus"]);
export const WRAPPER_CHOICES = ["Sequence", "Fallback", "Selector"]; // what /addWrapper accepts
export const CUSTOM_NODE_GROUPS = ["Action", "Condition", "Control", "Decorator"];

// Attributes whose value is a taught point name (offer the point list).
export const POINT_ATTRIBUTES = new Set(["point_name", "pose_goal", "target_name", "start_name", "goal_name", "interim_name", "frame"]);

/* Nodes the robot software provides that older node libraries do not list yet.
   They are added to the library (category "motion") when missing, so they get
   their settings in the node editor and can be used in Quick add. Ports from
   motion_server_pkg RunProgramNode::providedPorts (empty = the default). */
export const RUN_PROGRAM = "RunProgram";
export const RUN_PROGRAM_ATTRS = {
  program: { hint: "Motion program to run (from the Motion Programs page)" },
  repeat: { def: "1", hint: "How many times the program runs. -1 = as set in the program; 0 is not allowed in a tree" },
  speed: { def: "0", unit: "m/s", hint: "Tool speed for steps without their own speed; 0 = the program's speed" },
  acceleration: { def: "0", unit: "m/s²", hint: "Tool acceleration; 0 = the program's" },
  offset_x: { def: "0", unit: "mm", hint: "Shift every point along the robot base X (palletizing slot)" },
  offset_y: { def: "0", unit: "mm", hint: "Shift along base Y" },
  offset_z: { def: "0", unit: "mm", hint: "Shift along base Z (layer height)" },
  offset_rx: { def: "0", unit: "°", hint: "Turn the tool about base X at every point" },
  offset_ry: { def: "0", unit: "°", hint: "Turn about base Y" },
  offset_rz: { def: "0", unit: "°", hint: "Turn about base Z (box turned 90°)" },
  dry_run: { def: "false", hint: "true: the motion server only checks and plans, the robot does not move" },
  timeout_s: { def: "0", unit: "s", hint: "Fail (and stop) after this many seconds; 0 = no limit" },
  stop_on_halt: { def: "true", hint: "Stop the robot when the node is halted" },
};
const BUILTIN_NODES = [
  {
    name: RUN_PROGRAM,
    category: "motion",
    categoryLabel: "Motion",
    group: "Action",
    def: { type: "leaf", attributes: Object.fromEntries(Object.entries(RUN_PROGRAM_ATTRS).map(([k, v]) => [k, v.def ?? ""])) },
  },
];

/* ───────────── Node library (getNodeTypes) ───────────── */
/** Build an index { byName: Map(name → {category, categoryLabel, group, def}), categories: [...] } */
export function indexNodeTypes(data) {
  const cats = data?.categories || {};
  const byName = new Map();
  const categories = [];
  for (const [catKey, cat] of Object.entries(cats)) {
    const nodes = [];
    for (const [group, defs] of Object.entries(cat?.nodes || {})) {
      for (const [name, def] of Object.entries(defs || {})) {
        const entry = { name, category: catKey, categoryLabel: cat.display_name || catKey, group, def: def || {} };
        nodes.push(entry);
        if (!byName.has(name)) byName.set(name, entry);
      }
    }
    nodes.sort((a, b) => a.name.localeCompare(b.name));
    categories.push({ key: catKey, label: cat.display_name || catKey, description: cat.description || "", nodes });
  }
  for (const b of BUILTIN_NODES) {
    if (byName.has(b.name)) continue;
    const entry = { ...b, builtin: true };
    byName.set(b.name, entry);
    let cat = categories.find((c) => c.key === b.category);
    if (!cat) categories.push((cat = { key: b.category, label: b.categoryLabel, description: "", nodes: [] }));
    cat.nodes.push(entry);
    cat.nodes.sort((x, y) => x.name.localeCompare(y.name));
  }
  return { byName, categories };
}

export function kindOf(type, lib) {
  if (type === "BehaviorTree") return "root";
  if (SUBTREE_TAGS.has(type)) return "subtree";
  const e = lib?.byName.get(type);
  if (e) {
    if (e.group === "Control") return "control";
    if (e.group === "Decorator") return "decorator";
    if (e.group === "Condition") return "condition";
    if (e.group === "Action") return "action";
  }
  if (BUILTIN_WRAPPERS.has(type)) return "control";
  return "other";
}

export const shapeOf = (type, lib) => KINDS[kindOf(type, lib)].shape;

/** Colour group of a node type: { key, label, color }. */
export function colourGroupOf(type, lib) {
  const kind = kindOf(type, lib);
  if (kind === "root") return GROUP_BY_KEY.get("root");
  if (kind === "subtree") return GROUP_BY_KEY.get("link");
  const e = lib?.byName.get(type);
  for (const g of COLOR_GROUPS) if (g.test?.(type, e)) return g;
  return { key: `kind:${kind}`, label: KINDS[kind].label, color: KINDS[kind].color };
}

export const colorOf = (type, lib) => colourGroupOf(type, lib).color;

/** SVG path for a node shape centred on 0,0; r is the circle radius the
 *  other shapes are sized to match visually. */
export function shapePath(shape, r) {
  const f = (n) => +n.toFixed(2);
  const roundRect = (w, h, k) =>
    `M${f(-w + k)},${f(-h)}H${f(w - k)}Q${f(w)},${f(-h)} ${f(w)},${f(-h + k)}V${f(h - k)}Q${f(w)},${f(h)} ${f(w - k)},${f(h)}` +
    `H${f(-w + k)}Q${f(-w)},${f(h)} ${f(-w)},${f(h - k)}V${f(-h + k)}Q${f(-w)},${f(-h)} ${f(-w + k)},${f(-h)}Z`;
  switch (shape) {
    case "root":
      return roundRect(r * 1.3, r * 1.3, r * 0.45);
    case "square":
      return roundRect(r, r, r * 0.3);
    case "diamond": {
      const d = r * 1.3;
      return `M0,${f(-d)}L${f(d)},0L0,${f(d)}L${f(-d)},0Z`;
    }
    case "hexagon": {
      const R = r * 1.15;
      return (
        Array.from({ length: 6 }, (_, i) => {
          const a = (i * Math.PI) / 3;
          return `${i ? "L" : "M"}${f(R * Math.cos(a))},${f(R * Math.sin(a))}`;
        }).join("") + "Z"
      );
    }
    case "folder": {
      const w = r * 1.2;
      return `M${f(-w)},${f(-r * 0.8)}H${f(-w * 0.2)}L${f(0)},${f(-r * 0.4)}H${f(w)}V${f(r * 0.85)}H${f(-w)}Z`;
    }
    default:
      return `M${f(r)},0A${f(r)},${f(r)} 0 1,1 ${f(-r)},0A${f(r)},${f(r)} 0 1,1 ${f(r)},0Z`;
  }
}

export function isWrapperType(type, lib) {
  if (BUILTIN_WRAPPERS.has(type)) return true;
  return lib?.byName.get(type)?.def?.type === "wrapper";
}

/* ───────────── Converting backend JSON → UI tree ─────────────
   The backend returns { root: { "@children": [{ tagName: "BehaviorTree", content }] } }
   where content = { "@attributes": {...}, "@children": [{ tagName, content }] }.

   Paths sent back to the backend: the backend resolves each path segment by
   `_uid` OR `ID`. `_uid`s are regenerated every time the XML is re-parsed (each
   list or subtree fetch), so a path made of `_uid`s goes stale as soon as any
   other fetch happens. We therefore use the node's XML `ID` when it is unique
   among its siblings and only fall back to `_uid` otherwise. */
export function convertSubtree(data) {
  const bt = data?.root?.["@children"]?.find((c) => c.tagName === "BehaviorTree");
  if (!bt) return null;
  const byKey = new Map();
  const byIdx = new Map();
  let order = 0;

  const build = (content, type, parent, seg, index) => {
    const attrs = content?.["@attributes"] || {};
    const path = parent ? [...parent.path, seg] : [];
    const idx = parent ? (parent.idx ? `${parent.idx}.${index}` : `${index}`) : "";
    const node = {
      key: parent ? path.join("\u001f") : "__root__",
      idx,
      type,
      id: attrs.ID ?? null,
      uid: attrs._uid ?? null,
      name: attrs.name || attrs.ID || type,
      attributes: attrs,
      path,
      parentKey: parent?.key ?? null,
      index,
      depth: parent ? parent.depth + 1 : 0,
      order: order++,
      raw: { tagName: type, content },
      children: [],
    };
    byKey.set(node.key, node);
    byIdx.set(idx, node);

    const kids = Array.isArray(content?.["@children"]) ? content["@children"] : [];
    const idCounts = new Map();
    for (const k of kids) {
      const id = k.content?.["@attributes"]?.ID;
      if (id) idCounts.set(id, (idCounts.get(id) || 0) + 1);
    }
    kids.forEach((k, i) => {
      const a = k.content?.["@attributes"] || {};
      const childSeg = a.ID && idCounts.get(a.ID) === 1 ? a.ID : a._uid || a.ID || `#${i}`;
      node.children.push(build(k.content, k.tagName, node, childSeg, i));
    });
    return node;
  };

  const root = build(bt.content, bt.tagName, null, null, 0);
  return { root, byKey, byIdx, count: byKey.size };
}

/** All nodes in display (pre-)order. */
export function flatten(root) {
  const out = [];
  const walk = (n) => {
    out.push(n);
    n.children.forEach(walk);
  };
  if (root) walk(root);
  return out;
}

export function ancestorsOf(tree, node) {
  const out = [];
  let p = node?.parentKey ? tree.byKey.get(node.parentKey) : null;
  while (p) {
    out.push(p);
    p = p.parentKey ? tree.byKey.get(p.parentKey) : null;
  }
  return out;
}

export function containsSubtree(node) {
  if (!node) return false;
  if (SUBTREE_TAGS.has(node.type)) return true;
  return node.children.some(containsSubtree);
}

/** Attribute entries a person should see (internal _uid hidden). */
export const visibleAttrs = (attrs) => Object.entries(attrs || {}).filter(([k]) => k !== "_uid");

export function matchesQuery(node, q) {
  if (!q) return false;
  if ((node.name || "").toLowerCase().includes(q)) return true;
  if ((node.type || "").toLowerCase().includes(q)) return true;
  return visibleAttrs(node.attributes).some(([, v]) => String(v).toLowerCase().includes(q));
}

/* ───────────── Structural rules ───────────── */
/** Reason a new child cannot go into `parent`, or null when it can. */
export function childSlotProblem(parent, lib) {
  if (!parent) return "Select a node first";
  if (!isWrapperType(parent.type, lib)) return `"${parent.name}" is not a container. Select a Sequence, Fallback or another container node.`;
  if (parent.type === "BehaviorTree" && parent.children.length > 0)
    return "The tree root holds exactly one node. Add inside its first Sequence instead.";
  return null;
}

/** Soft warning (confirm) when adding to a decorator that already has a child. */
export function childSlotWarning(parent, lib) {
  if (parent && kindOf(parent.type, lib) === "decorator" && parent.children.length > 0)
    return `"${parent.name}" is a decorator. Decorators normally wrap exactly one child.`;
  return null;
}

/** What can be done with the selected node; every `false` comes with a reason. */
export function capabilities(tree, node, lib) {
  const none = { reason: "Select a node in the tree first" };
  if (!tree || !node)
    return { addChild: none, addAfter: none, wrap: none, copy: none, del: none, delWrapper: none, moveLeft: none, moveRight: none };
  const isRoot = node.type === "BehaviorTree" || !node.parentKey;
  const parent = node.parentKey ? tree.byKey.get(node.parentKey) : null;
  const ok = { ok: true };
  const no = (reason) => ({ reason });
  const rootReason = "Not available on the tree root";

  const addChildProblem = childSlotProblem(node, lib);
  const afterProblem = isRoot ? rootReason : childSlotProblem(parent, lib);
  let delWrapper = ok;
  if (isRoot) delWrapper = no(rootReason);
  else if (!isWrapperType(node.type, lib)) delWrapper = no("Only container nodes can be removed while keeping their children");
  else if (!parent || !isWrapperType(parent.type, lib)) delWrapper = no("Its parent is not a container");
  else if (parent.type === "BehaviorTree" && node.children.length !== 1)
    delWrapper = no("The tree root must keep exactly one node, so this container cannot be dissolved");

  return {
    addChild: addChildProblem ? no(addChildProblem) : ok,
    addAfter: afterProblem ? no(afterProblem) : ok,
    wrap: isRoot ? no(rootReason) : ok,
    copy: isRoot ? no(rootReason) : ok,
    del: isRoot ? no("The tree root cannot be deleted. Delete the whole subtree from the library instead.") : ok,
    delWrapper,
    moveLeft: isRoot ? no(rootReason) : node.index === 0 ? no("Already the first child") : ok,
    moveRight: isRoot ? no(rootReason) : node.index >= (parent?.children.length ?? 1) - 1 ? no("Already the last child") : ok,
  };
}

export function countNodes(n) {
  return n ? 1 + n.children.reduce((s, c) => s + countNodes(c), 0) : 0;
}

/** Key of a child of `parent` whose XML ID is `id` (IDs from the backend are unique). */
export const childKey = (parent, id) => (parent ? [...parent.path, id].join("\u001f") : null);

/* ───────────── Misc ───────────── */
/** Automatic node name <Type>_<HHMMSS><2 digits>. The two extra digits are the
 *  hundredths of a second, so nodes added in the same second differ; if the name
 *  is still taken (in this subtree or handed out earlier) random digits are used. */
const issuedNames = new Set();
export function autoName(type, tree) {
  const d = new Date();
  const p2 = (n) => String(n).padStart(2, "0");
  const stamp = `${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}`;
  const inTree = new Set();
  tree?.byKey?.forEach((n) => n?.name && inTree.add(n.name));
  const taken = (n) => issuedNames.has(n) || inTree.has(n);
  let name = `${type}_${stamp}${p2(Math.floor(d.getMilliseconds() / 10))}`;
  for (let i = 0; i < 200 && taken(name); i++) name = `${type}_${stamp}${p2(Math.floor(Math.random() * 100))}`;
  for (let i = 2; taken(name); i++) name = `${type}_${stamp}_${i}`;
  issuedNames.add(name);
  return name;
}

/** Default attributes of a library node as strings. */
export function defaultAttributes(entry) {
  const out = {};
  for (const [k, v] of Object.entries(entry?.def?.attributes || {})) out[k] = v == null ? "" : String(v);
  return out;
}

/** DO/DI subtree flavour, used to pick the reference attribute. */
export function doDiFlavour(id = "") {
  const s = id.toLowerCase();
  if (/\[di\]/.test(s)) return "DI";
  if (/\[do\]/.test(s)) return "DO";
  return s.includes("grip") || s.includes("do") ? "DO" : "DI"; // old heuristic
}

export const isBoolLike = (v) => v === "true" || v === "false";
