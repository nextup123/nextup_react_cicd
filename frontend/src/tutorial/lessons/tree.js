// Robot Program lessons: the editing basics. Each lesson does a thing with
// the mouse first, then the same thing with the keyboard shortcut.
import {
  ArrowDownToLine, ArrowRightToLine, ClipboardCopy, Compass, Copy, FolderTree, Keyboard, MousePointer2, PackagePlus, ShieldCheck, SlidersHorizontal, Trash2, Zap,
} from "lucide-react";
import {
  PAGE, PRACTICE, at, byName, clip, isSel, keyOf, label, leaf, latestName, menuOpen, parentOf, practiceSetup, practiceType, pretty, rootSeq, t, tb, viaKeys, viaMenu,
} from "./treeKit";

const G_START = "Start here";
const G_EDIT = "Edit the program (mouse, then keys)";
const G_MORE = "Work faster";

const root = (ctx) => rootSeq(ctx);
const lf = (ctx) => leaf(ctx);

const tour = {
  id: "tree.tour",
  page: PAGE,
  group: G_START,
  icon: Compass,
  title: "Find your way around",
  blurb: "How a robot program reads, and where the tools are.",
  learn: ["Read the tree", "Shapes and colours", "Your practice area"],
  setup: practiceSetup(["leaf"]),
  steps: () => [
    { title: "A program is a tree", text: "The robot program is drawn as a tree. The robot starts at the top and works through it from left to right." },
    {
      target: "bt-subtree-pick",
      title: "Your practice area",
      text: `We opened a subtree called ${PRACTICE} just for the lessons. Your real program is not touched. Switch subtrees here any time.`,
    },
    { target: (ctx) => at(root(ctx)), title: "RootSequence", text: "This square runs the nodes under it one after another, left to right. Everything you add goes in here." },
    {
      target: (ctx) => at(lf(ctx)),
      title: "Shapes tell the kind",
      text: "Squares decide the order (controls). Diamonds change one child (decorators). Circles do things (actions). Hexagons check things (conditions). The colour says what it is about: motion, IO, timing, messages…",
    },
    { target: ".bt-legend", title: "The legend", text: "Forgot a shape or colour? The legend in the corner explains them all." },
    { target: "bt-toolbar", title: "Tools", text: "Undo and redo, search, Validate, and the view buttons are all up here." },
    { target: ["bt-library-btn", "bt-library"], title: "The library", text: "Subtrees, ready-made IO steps and your quick-add list live in the library." },
    { target: "tutorials-btn", title: "More lessons", text: "Come back to the tutorials button for the next lesson whenever you like." },
  ],
};

const view = {
  id: "tree.view",
  page: PAGE,
  group: G_START,
  icon: MousePointer2,
  title: "Select, zoom and views",
  blurb: "Select nodes, see their settings and move around the tree.",
  learn: ["Select a node", "Fit and zoom", "Tree and Ladder views"],
  setup: practiceSetup(["leaf"]),
  steps: () => [
    { target: (ctx) => at(root(ctx)), check: (ctx) => isSel(ctx, root(ctx)), title: "Select", text: "Click RootSequence to select it." },
    { target: "bt-editor", title: "Its settings", text: "The selected node's settings open here. Drag the panel by its title, or close it; clicking a node brings it back." },
    { target: "bt-fit", click: true, title: "Fit", text: "Click Fit to see the whole tree at once." },
    { target: "bt-zoom-in", click: true, title: "Zoom", text: "Zoom in. You can also scroll the mouse wheel over the tree, and drag the empty space to pan." },
    { target: ".bt-view-seg", check: (ctx) => tb(ctx).view === "ladder", title: "Ladder view", text: "Click Ladder: the same program as an indented list. Great for long programs." },
    { target: ".bt-view-seg", check: (ctx) => tb(ctx).view === "tree", title: "Back to the tree", text: "Click Tree to come back." },
  ],
};

const addInside = {
  id: "tree.add-inside",
  page: PAGE,
  group: G_EDIT,
  icon: ArrowDownToLine,
  title: "Add a node inside",
  blurb: "Put a new node into a container like RootSequence.",
  learn: ["With the right-click menu", "With a quick-add key"],
  setup: practiceSetup(),
  steps: (ctx) => {
    const p = practiceType(ctx);
    return [
      { target: (c) => at(root(c)), title: "Inside a container", text: "Containers (squares) hold other nodes. \"Add inside\" puts the new node at the end of the container." },
      ...viaMenu({
        id: "inside",
        node: root,
        item: "ctx-add-inside",
        type: () => p.type,
        signal: t("addNode"),
        what: "With the mouse",
        itemText: "Choose Add inside…",
        tip: "Every node type is in this list, grouped like the library.",
      }),
      { target: (c) => at(byName(c, latestName(c))), title: "Added!", text: (c) => `${pretty(p.type)} is now inside RootSequence, at the end.` },
      ...(p.key
        ? viaKeys({
            id: "inside",
            node: root,
            keys: `Shift+${p.key}`,
            signal: t("addNode"),
            what: "Now with the keys",
            text: `Press Shift + ${p.key}. Shift + key adds the node inside the selected one.`,
            tip: "The keys come from the Quick add list in the library. You can change them there.",
          })
        : []),
    ];
  },
  outro: "Shift + letter adds inside the selected node. Next: add a node after another.",
};

const addAfter = {
  id: "tree.add-after",
  page: PAGE,
  group: G_EDIT,
  icon: ArrowRightToLine,
  title: "Add a node after another",
  blurb: "Insert a node right after the one you choose.",
  learn: ["With the right-click menu", "With Alt + key"],
  setup: practiceSetup(["leaf"]),
  steps: (ctx) => {
    const p = practiceType(ctx);
    ctx.mem.leaf = lf(ctx)?.name;
    return [
      ...viaMenu({
        id: "after",
        node: lf,
        item: "ctx-add-after",
        type: () => p.type,
        signal: t("addNodeAfter"),
        what: "With the mouse",
        itemText: "Choose Add after…",
      }),
      { target: (c) => at(byName(c, latestName(c))), title: "Right after it", text: "The new node sits right after the one you clicked, in the same container." },
      ...(p.key
        ? viaKeys({
            id: "after",
            node: lf,
            keys: `Alt+${p.key}`,
            signal: t("addNodeAfter"),
            what: "Now with the keys",
            text: `Press Alt + ${p.key}. Alt + key adds right after the selected node.`,
          })
        : []),
    ];
  },
};

const settings = {
  id: "tree.settings",
  page: PAGE,
  group: G_EDIT,
  icon: SlidersHorizontal,
  title: "Change a node's settings",
  blurb: "Most nodes have settings, like how long a Sleep waits.",
  learn: ["Open the settings", "Change and save", "Open them with Enter"],
  setup: practiceSetup(["Sleep", "leaf"]),
  steps: (ctx) => {
    const target = (c) => nodes1(c, "Sleep") || lf(c);
    return [
      { target: (c) => at(target(c)), check: (c) => isSel(c, target(c)), title: "Pick the node", text: (c) => `Click ${label(target(c))}.` },
      {
        target: "bt-editor",
        signal: t("updateNode"),
        title: "Change it",
        text: (c) => {
          const n = target(c);
          if (n?.type !== "Sleep") return "Change a setting and press Save changes.";
          const v = String(n.attributes?.msec ?? "") === "2000" ? "3000" : "2000";
          return `Set msec to ${v} (${v === "2000" ? "two" : "three"} seconds) and press Save changes.`;
        },
        tip: "Hover a setting's name to see what it does.",
      },
      ...viaKeys({
        id: "enter",
        node: (c) => root(c),
        press: "Enter",
        what: "Now with the keys",
        text: "Press Enter: the settings open with the cursor in the first field, ready to type.",
      }),
    ];
  },
};
function nodes1(ctx, type) {
  return (tb(ctx).tree ? [...tb(ctx).tree.byKey.values()] : []).find((n) => n.type === type) || null;
}

const del = {
  id: "tree.delete",
  page: PAGE,
  group: G_EDIT,
  icon: Trash2,
  title: "Delete and undo",
  blurb: "Remove a node, then bring it back.",
  learn: ["Delete from the menu", "Undo and redo", "Delete and Ctrl + Z"],
  setup: practiceSetup(["leaf"]),
  steps: (ctx) => {
    ctx.mem.leaf = lf(ctx)?.name;
    const it = (c) => byName(c, c.mem.leaf) || lf(c);
    return [
      ...viaMenu({ id: "del", node: it, item: "ctx-delete", signal: t("deleteNode"), what: "With the mouse", itemText: "Choose Delete, then confirm." }),
      { target: "bt-undo", signal: t("undo"), title: "Undo", text: "Oops? Click Undo. The node comes back." },
      { target: "bt-redo", signal: t("redo"), title: "Redo", text: "Redo does it again: the node is deleted again." },
      { target: "bt-undo", signal: t("undo"), title: "Undo once more", text: "And undo once more to get it back." },
      ...viaKeys({ id: "del", node: it, keys: "Delete", signal: t("deleteNode"), what: "Now with the keys", text: "Press Delete, then confirm." }),
      { target: "bt-stage", keys: "Ctrl+Z", signal: t("undo"), title: "Ctrl + Z", text: "Press Ctrl + Z to undo." },
      { target: "bt-stage", keys: "Ctrl+Y", signal: t("redo"), title: "Ctrl + Y", text: "Ctrl + Y redoes. Try it, then Ctrl + Z again if you want the node back." },
    ];
  },
  outro: "Undo keeps one step: the last change you made in the editor.",
};

const copyPaste = {
  id: "tree.copy-paste",
  page: PAGE,
  group: G_EDIT,
  icon: ClipboardCopy,
  title: "Copy, cut and paste",
  blurb: "Copy a node with everything inside it and paste it somewhere else.",
  learn: ["Copy and paste with the menu", "Ctrl + C, Ctrl + V", "Cut with Ctrl + X"],
  setup: practiceSetup(["leaf"]),
  steps: (ctx) => {
    ctx.mem.leaf = lf(ctx)?.name;
    const it = (c) => byName(c, c.mem.leaf) || lf(c);
    let before = null;
    const copied = () => clip() && clip() !== before;
    return [
      { id: "cp-open", target: (c) => at(it(c)), check: (c) => menuOpen() && isSel(c, it(c)), onEnter: () => (before = clip()), title: "With the mouse", text: (c) => `Right-click ${label(it(c))}.` },
      { target: "ctx-copy", requires: menuOpen, backTo: "cp-open", check: copied, title: "Copy", text: "Choose Copy. The node, and everything inside it, goes on the clipboard." },
      { target: "bt-clip", title: "The clipboard", text: "What you copied shows up here. Click it to paste into the selected node." },
      ...viaMenu({ id: "paste", node: root, item: "ctx-paste-inside", signal: t("pasteNode"), what: "Paste", itemText: "Choose Paste inside." }),
      { target: (c) => at(byName(c, latestName(c))), title: "Pasted!", text: "A copy with fresh names. Pasted nodes never clash with the original." },
      { id: "kc-select", target: (c) => at(it(c)), check: (c) => isSel(c, it(c)), onEnter: () => (before = clip()), title: "Now with the keys", text: (c) => `Click ${label(it(c))} to select it.` },
      { target: (c) => at(it(c)), press: "Ctrl+C", title: "Ctrl + C", text: "Press Ctrl + C to copy." },
      ...viaKeys({ id: "kv", node: root, keys: "Ctrl+V", signal: t("pasteNode"), what: "Ctrl + V", selectText: "Select RootSequence (where to paste).", text: "Press Ctrl + V. On a container it pastes inside; on any other node it pastes after it." }),
      ...viaKeys({ id: "kx", node: (c) => byName(c, latestName(c)) || it(c), keys: "Ctrl+X", signal: t("deleteNode"), what: "Cut", text: "Press Ctrl + X and confirm. Cut = copy, then delete." }),
      ...viaKeys({ id: "ksv", node: it, keys: "Ctrl+Shift+V", signal: t("pasteNode"), what: "Paste after", text: "Press Ctrl + Shift + V: pastes right after the selected node, even on a container." }),
    ];
  },
};

const dupMove = {
  id: "tree.duplicate-move",
  page: PAGE,
  group: G_EDIT,
  icon: Copy,
  title: "Duplicate and move",
  blurb: "Make a quick copy in place, and change the order of nodes.",
  learn: ["Duplicate", "Move left and right", "Drag onto a sibling", "Ctrl + D, Ctrl + arrows"],
  setup: practiceSetup(["leaf", "leaf"]),
  steps: (ctx) => {
    ctx.mem.leaf = lf(ctx)?.name;
    const it = (c) => byName(c, c.mem.leaf) || lf(c);
    const moves = [t("swapNodes"), t("moveNodeAfter")];
    return [
      ...viaMenu({ id: "dup", node: it, item: "ctx-duplicate", signal: t("copyNode"), what: "Duplicate", itemText: "Choose Duplicate. A copy appears right after it." }),
      ...viaMenu({
        id: "mv",
        node: it,
        item: ['[data-tut="ctx-move-right"]:not(:disabled)', '[data-tut="ctx-move-left"]:not(:disabled)'],
        signal: moves,
        what: "Move it",
        itemText: "Choose Move left or Move right.",
      }),
      {
        target: (c) => at(parentOf(c, it(c))),
        signal: moves,
        title: "Drag and drop",
        text: "You can also drag a node and drop it onto a neighbour: it moves right after that node. Try it.",
      },
      ...viaKeys({ id: "kd", node: it, keys: "Ctrl+D", signal: t("copyNode"), what: "Now with the keys", text: "Press Ctrl + D to duplicate." }),
      ...viaKeys({ id: "km", node: it, keys: ["Ctrl+←", "Ctrl+→"], signal: t("swapNodes"), what: "Move with the keys", text: "Press Ctrl + ← or Ctrl + → to move it left or right." }),
    ];
  },
};

const wrap = {
  id: "tree.wrap",
  page: PAGE,
  group: G_EDIT,
  icon: PackagePlus,
  title: "Wrap and unwrap",
  blurb: "Put a container around a node, and take it away again.",
  learn: ["Wrap in a Sequence", "Remove the container only"],
  setup: practiceSetup(["leaf"]),
  steps: (ctx) => {
    ctx.mem.leaf = lf(ctx)?.name;
    const it = (c) => byName(c, c.mem.leaf) || lf(c);
    const wrapper = (c) => parentOf(c, it(c));
    return [
      ...viaMenu({ id: "wrap", node: it, item: "ctx-wrap", sub: "ctx-wrap-Sequence", signal: t("addWrapper"), what: "Wrap", itemText: "Choose Wrap in…", pickText: "Choose Sequence." }),
      { target: (c) => at(wrapper(c)), title: "Wrapped", text: "The node now sits inside a new Sequence. Handy when you want to group steps, or add a Retry around them." },
      ...viaMenu({ id: "unwrap", node: wrapper, item: "ctx-unwrap", signal: t("deleteWrapperOnly"), what: "Unwrap", itemText: "Choose Remove container only, then confirm. The children stay." }),
    ];
  },
};

const keys = {
  id: "tree.keys",
  page: PAGE,
  group: G_MORE,
  icon: Keyboard,
  title: "Move around with the keyboard",
  blurb: "Walk the tree, fold branches and search without the mouse.",
  learn: ["Shift + arrows", "Space folds", "F, C, Ctrl + F", "Ctrl + S shows every key"],
  setup: practiceSetup(["leaf", "leaf"]),
  steps: () => [
    { target: (c) => at(rootSeq(c)), check: (c) => isSel(c, rootSeq(c)), title: "Start here", text: "Click RootSequence." },
    { target: "bt-stage", press: "Shift+↓", check: (c) => tb(c).selected?.parentKey === rootSeq(c)?.key, title: "Down", text: "Shift + ↓ selects the first node inside." },
    { target: "bt-stage", press: "Shift+→", title: "Sideways", text: "Shift + → selects the next node; Shift + ← the one before." },
    { target: "bt-stage", press: "Shift+↑", check: (c) => isSel(c, rootSeq(c)), title: "Up", text: "Shift + ↑ goes back up to the parent." },
    { target: (c) => at(rootSeq(c)), press: "Space", title: "Fold", text: "Space folds the selected node, hiding what is inside. Press it again to unfold." },
    { target: (c) => at(rootSeq(c)), press: "Space", title: "Unfold", text: "Press Space again." },
    { target: "bt-stage", press: "F", title: "Fit", text: "F fits the whole tree in view; C centres on the selected node." },
    { target: "bt-search", press: "Ctrl+F", title: "Search", text: "Ctrl + F jumps to search. Type a name, type or setting; the arrows step through the matches." },
    { target: "bt-stage", check: (c) => tb(c).keysOpen, title: "Every key in one place", text: "Click on the tree, then press Ctrl + S to see all shortcuts.", tip: "Click an empty part of the tree first if the search box still has the cursor." },
    { target: "bt-shortcuts", check: (c) => !tb(c).keysOpen, title: "Your cheat sheet", text: "Keep this list in mind. Close it when you're done (Esc)." },
  ],
};

const quick = {
  id: "tree.quick-add",
  page: PAGE,
  group: G_MORE,
  icon: Zap,
  title: "Your quick-add list",
  blurb: "One-click buttons and keys for the nodes you use most.",
  learn: ["Open the library", "Add with one click", "Change the keys"],
  setup: practiceSetup(),
  steps: (ctx) => {
    const p = practiceType(ctx);
    return [
      { target: ["bt-library", "bt-library-btn"], check: (c) => tb(c).libraryOpen, title: "Open the library", text: "Click Library." },
      { target: (c) => at(rootSeq(c)), check: (c) => isSel(c, rootSeq(c)), title: "Select where", text: "Click RootSequence: quick add works on the selected node." },
      {
        target: [`qa-child-${p.type}`, "bt-lib-quick"],
        signal: t("addNode"),
        title: "One click",
        text: `In Quick add, click the ↳ button next to ${pretty(p.type)}: it adds inside. The → button adds after.`,
        tip: "Folded? Click the Quick add heading to open it.",
      },
      { target: "bt-qa-edit", title: "Make it yours", text: "Edit lets you add node types to the list, give them a letter and change the order. Each letter works as Shift + letter (inside) and Alt + letter (after)." },
    ];
  },
};

const subtrees = {
  id: "tree.subtrees",
  page: PAGE,
  group: G_MORE,
  icon: FolderTree,
  title: "Subtrees: reuse parts",
  blurb: "Build a part once, use it in many places.",
  learn: ["Make a subtree", "Switch subtrees", "Insert it as a link"],
  setup: practiceSetup(),
  steps: () => {
    const part = "Practice_part";
    return [
      { target: ["bt-library", "bt-library-btn"], check: (c) => tb(c).libraryOpen, title: "Open the library", text: "Click Library." },
      { title: "What is a subtree?", target: "bt-lib-subtrees", text: "A subtree is a small program with its own name, like \"pick_part\". The main program can use it many times." },
      {
        target: "bt-lib-create",
        check: (c) => tb(c).subtrees?.includes(part),
        title: "Make one",
        text: `Type ${part} and press Add.`,
      },
      { target: "bt-subtree-pick", check: (c) => tb(c).subtreeId === PRACTICE, title: "Switch back", text: `Your new subtree opened. Use this list to go back to ${PRACTICE}.` },
      { target: (c) => at(rootSeq(c)), check: (c) => isSel(c, rootSeq(c)), title: "Where it goes", text: "Select RootSequence." },
      {
        target: [`[data-tut-subtree="${part}"] [data-tut="bt-lib-insert"]`, "bt-insert-subtree"],
        check: () => !!document.querySelector('[data-tut="bt-insert-subtree"]'),
        title: "Insert it",
        text: `Click the + next to ${part} in the library.`,
      },
      {
        target: "bt-insert-subtree",
        signal: t("addSubtreeAsChild"),
        requires: () => !!document.querySelector('[data-tut="bt-insert-subtree"]'),
        title: "Link or copy?",
        text: "A link always runs the latest version of the subtree. A full copy is a separate copy you can change on its own. Choose one and insert.",
      },
      { target: "bt-stage", title: "Done!", text: "The link shows as a folder shape. Change Practice_part once, and every place that links to it runs the new version." },
    ];
  },
  outro: "Tip: keep Practice_part or delete it from the library's subtree list (bin button).",
};

const validate = {
  id: "tree.validate",
  page: PAGE,
  group: G_MORE,
  icon: ShieldCheck,
  title: "Check the program",
  blurb: "Find mistakes before the robot runs: missing points, empty settings and more.",
  learn: ["Validate", "Jump to each problem"],
  setup: practiceSetup(),
  steps: () => [
    { target: "bt-validate", click: true, title: "Validate", text: "Click Validate. It checks the main program the robot runs. Nothing moves." },
    { target: [".validation-popup", ".vp", ".bt-stage"], title: "Problems in red", text: "Problems are listed and the nodes get a red mark. Use the arrows in the result window to jump from one to the next." },
  ],
};

export default [tour, view, addInside, addAfter, settings, del, copyPaste, dupMove, wrap, keys, quick, subtrees, validate];
