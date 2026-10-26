// Every editing action of the tree editor in one place, shared by the
// inspector, the context menu, the library panel and keyboard shortcuts.
import { useRef, useState } from "react";
import { invalidate } from "../../lib/queries";
import { errorMessage } from "../../lib/api";
import { confirm } from "../../store/confirm";
import { toast } from "../../store/toast";
import { treeApi } from "./treeApi";
import { useClipboard } from "./shortcuts";
import { RUN_PROGRAM, autoName, capabilities, childKey, childSlotProblem, childSlotWarning, countNodes, defaultAttributes, isWrapperType } from "./treeModel";

export function useTreeActions({ subtreeId, tree, lib, setSelection, onRunProgram }) {
  const [busy, setBusy] = useState(null);
  const busyRef = useRef(false);
  const ctx = useRef({});
  ctx.current = { subtreeId, tree, lib, onRunProgram };

  async function run(what, fn, { success, before, after } = {}) {
    let res;
    if (busyRef.current) {
      toast.info("Please wait, the previous change is still being saved.");
      return false;
    }
    busyRef.current = true;
    setBusy(what);
    try {
      res = await fn();
      before?.(res);
      if (success) toast.success(typeof success === "function" ? success(res) : success);
      await invalidate.tree();
      after?.(res);
      return true;
    } catch (err) {
      toast.error(errorMessage(err), { title: `Could not ${what}` });
      invalidate.tree();
      return false;
    } finally {
      busyRef.current = false;
      setBusy(null);
    }
  }

  const parentOf = (node) => (node?.parentKey ? ctx.current.tree?.byKey.get(node.parentKey) : null);

  async function checkSlot(parent) {
    const problem = childSlotProblem(parent, ctx.current.lib);
    if (problem) {
      toast.warning(problem);
      return false;
    }
    const warn = childSlotWarning(parent, ctx.current.lib);
    if (warn) return confirm({ title: "Add a second child?", message: `${warn}\n\nAdd anyway?`, tone: "warning", confirmLabel: "Add anyway" });
    return true;
  }

  /** mode: "child" (inside `node`, as last child) or "after" (right after `node`). */
  async function addNode(mode, node, typeName, name, attributes) {
    const { subtreeId } = ctx.current;
    if (!node || !subtreeId) return toast.warning("Select a node first.");
    const nodeName = (name || "").trim() || autoName(typeName, ctx.current.tree);
    if (mode === "child") {
      if (!(await checkSlot(node))) return false;
      return run("add the node", () => treeApi.addNode(subtreeId, node.path, typeName, nodeName, attributes || {}), {
        success: `Added ${typeName} inside "${node.name}"`,
      });
    }
    const caps = capabilities(ctx.current.tree, node, ctx.current.lib);
    if (!caps.addAfter.ok) return toast.warning(caps.addAfter.reason);
    if (!(await checkSlot(parentOf(node)))) return false;
    return run("add the node", () => treeApi.addNodeAfter(subtreeId, node.path, typeName, nodeName, attributes || {}), {
      success: `Added ${typeName} after "${node.name}"`,
    });
  }

  /** Add a library node with its default attributes and an automatic name. */
  function quickAdd(mode, node, typeName) {
    const entry = ctx.current.lib?.byName.get(typeName);
    if (!entry) return toast.error(`"${typeName}" is not in the node library.`);
    // RunProgram needs a program: ask for it (and its other settings) first.
    if (typeName === RUN_PROGRAM && ctx.current.onRunProgram) return ctx.current.onRunProgram({ mode, node });
    return addNode(mode, node, typeName, autoName(typeName, ctx.current.tree), defaultAttributes(entry));
  }

  function updateNode(node, attrs) {
    const { subtreeId } = ctx.current;
    return run("save the node", () => treeApi.updateNode(subtreeId, node.path, attrs), { success: "Node updated" });
  }

  async function deleteNode(node, { cut } = {}) {
    const { subtreeId } = ctx.current;
    const caps = capabilities(ctx.current.tree, node, ctx.current.lib);
    if (!caps.del.ok) return toast.warning(caps.del.reason);
    const n = countNodes(node);
    const ok = await confirm({
      title: cut ? `Cut "${node.name}"?` : `Delete "${node.name}"?`,
      message:
        (n > 1 ? `This also removes the ${n - 1} node${n > 2 ? "s" : ""} inside it.` : "The node is removed from the tree.") +
        (cut ? " It stays on the clipboard: paste it anywhere with Ctrl+V." : ""),
      tone: "danger",
      confirmLabel: cut ? "Cut" : "Delete",
    });
    if (!ok) return false;
    // Pick what to select afterwards: next sibling, previous sibling, parent.
    const parent = parentOf(node);
    const sibs = parent?.children || [];
    const next = sibs[node.index + 1] || sibs[node.index - 1] || parent;
    return run(cut ? "cut the node" : "delete the node", () => treeApi.deleteNode(subtreeId, node.path), {
      success: cut ? `Cut "${node.name}", ready to paste` : "Node deleted",
      before: () => setSelection(next ? { key: next.key, idx: null } : null),
    });
  }

  async function deleteWrapperOnly(node) {
    const { subtreeId } = ctx.current;
    const caps = capabilities(ctx.current.tree, node, ctx.current.lib);
    if (!caps.delWrapper.ok) return toast.warning(caps.delWrapper.reason);
    const ok = await confirm({
      title: `Remove container "${node.name}"?`,
      message: "Only the container is removed. Its children move up into its parent, in the same place.",
      tone: "danger",
      confirmLabel: "Remove container",
    });
    if (!ok) return false;
    const parent = parentOf(node);
    return run("remove the container", () => treeApi.deleteWrapperOnly(subtreeId, node.path), {
      success: "Container removed, children kept",
      before: () => setSelection(parent ? { key: parent.key, idx: parent.idx } : null),
    });
  }

  function addWrapper(node, wrapperType) {
    const { subtreeId } = ctx.current;
    const caps = capabilities(ctx.current.tree, node, ctx.current.lib);
    if (!caps.wrap.ok) return toast.warning(caps.wrap.reason);
    // The node moves one level down; select the new wrapper (same index path).
    return run("wrap the node", () => treeApi.addWrapper(subtreeId, node.path, wrapperType), {
      success: `Wrapped "${node.name}" in a ${wrapperType}`,
      before: () => setSelection({ key: null, idx: node.idx }),
    });
  }

  /** Ctrl+D: duplicate right after the node, with new IDs and generated names. */
  function copyNode(node) {
    const { subtreeId } = ctx.current;
    if (!node) return toast.warning("Select a node to duplicate.");
    if (node.type === "BehaviorTree") return toast.warning("The tree root cannot be duplicated.");
    const parent = parentOf(node);
    return run("duplicate the node", () => treeApi.copyNode(subtreeId, node.path), {
      success: (r) => `Duplicated as "${r?.name || node.name}"`,
      before: (r) => r?.ID && parent && setSelection({ key: childKey(parent, r.ID), idx: null }),
    });
  }

  /** Ctrl+C: put the node and everything inside it on the editor clipboard. */
  function copyToClipboard(node, { quiet } = {}) {
    if (!node) return toast.warning("Select a node to copy.");
    if (node.type === "BehaviorTree") return toast.warning("The tree root cannot be copied. Copy its first node instead.");
    const n = countNodes(node);
    useClipboard.setState({
      clip: { fragment: JSON.parse(JSON.stringify(node.raw)), name: node.name, type: node.type, count: n, from: ctx.current.subtreeId },
    });
    if (!quiet) toast.info(`Copied "${node.name}"${n > 1 ? ` with ${n - 1} node${n > 2 ? "s" : ""} inside` : ""}. Select a container and press Ctrl+V.`, { duration: 2500 });
    return true;
  }

  /** Ctrl+X: copy, then delete (asks first, like Delete). */
  async function cutNode(node) {
    const caps = capabilities(ctx.current.tree, node, ctx.current.lib);
    if (!caps.del.ok) return toast.warning(caps.del.reason);
    const before = useClipboard.getState().clip;
    copyToClipboard(node, { quiet: true });
    const ok = await deleteNode(node, { cut: true });
    if (!ok) useClipboard.setState({ clip: before });
    return ok;
  }

  /** Ctrl+V. mode: "auto" (inside a container, otherwise after), "child" or "after". */
  async function paste(node, mode = "auto") {
    const { subtreeId, lib } = ctx.current;
    const clip = useClipboard.getState().clip;
    if (!clip) return toast.info("The clipboard is empty. Select a node and press Ctrl+C first.");
    if (!node) return toast.warning("Select where to paste first.");
    let where = mode;
    if (where === "auto") where = isWrapperType(node.type, lib) && !childSlotProblem(node, lib) ? "child" : "after";
    const parent = where === "child" ? node : parentOf(node);
    if (where === "after") {
      const caps = capabilities(ctx.current.tree, node, lib);
      if (!caps.addAfter.ok) return toast.warning(caps.addAfter.reason);
    }
    if (!(await checkSlot(parent))) return false;
    return run("paste", () => treeApi.pasteNode(subtreeId, node.path, where, clip.fragment), {
      success: (r) => `Pasted "${r?.name || clip.name}" ${where === "child" ? `inside "${node.name}"` : `after "${node.name}"`}`,
      before: (r) => r?.ID && parent && setSelection({ key: childKey(parent, r.ID), idx: null }),
    });
  }

  /** Move `source` so it sits right after `target` (same parent). */
  function moveAfter(source, target) {
    const { subtreeId } = ctx.current;
    if (!source || !target || source.parentKey !== target.parentKey || source.key === target.key)
      return toast.warning("Drop the node onto a sibling (same parent) to move it.");
    return run("move the node", () => treeApi.moveNodeAfter(subtreeId, source.path, target.path), {
      success: `Moved "${source.name}" after "${target.name}"`,
    });
  }

  function swap(a, b) {
    const { subtreeId } = ctx.current;
    if (!a || !b || a.parentKey !== b.parentKey || a.key === b.key) return toast.warning("Only siblings (same parent) can be swapped.");
    return run("swap the nodes", () => treeApi.swapNodes(subtreeId, a.path, b.path), { success: `Swapped "${a.name}" and "${b.name}"` });
  }

  /** Move one position left (-1) or right (+1) among siblings. */
  function moveBy(node, dir) {
    const caps = capabilities(ctx.current.tree, node, ctx.current.lib);
    const cap = dir < 0 ? caps.moveLeft : caps.moveRight;
    if (!cap.ok) return toast.warning(cap.reason);
    const other = parentOf(node)?.children[node.index + dir];
    const { subtreeId } = ctx.current;
    return run("move the node", () => treeApi.swapNodes(subtreeId, node.path, other.path), {
      success: `Moved "${node.name}" ${dir < 0 ? "left" : "right"}`,
    });
  }

  /** Ctrl+Z / Ctrl+Y: the backend keeps one step (the last change made in the editor). */
  function undo() {
    return run("undo", () => treeApi.undo(), { success: (r) => `Undone: ${r?.undone || "last change"}` });
  }

  function redo() {
    return run("redo", () => treeApi.redo(), { success: (r) => `Redone: ${r?.redone || "change"}` });
  }

  /** Insert a <RunProgram> node: inside a container, otherwise right after the node. */
  async function addRunProgram(node, attributes, name, where) {
    if (!node) return toast.warning("Select where to add the program first.");
    const caps = capabilities(ctx.current.tree, node, ctx.current.lib);
    const mode = where || (caps.addChild.ok ? "child" : "after");
    return addNode(mode, node, "RunProgram", name, attributes);
  }

  /** kind: template | doDi; mode: full | reference */
  async function addSubtreeAsChild(kind, parent, childSubtreeId, mode, attributes) {
    const { subtreeId } = ctx.current;
    if (!(await checkSlot(parent))) return false;
    if (kind === "template" && childSubtreeId === subtreeId) return toast.warning("A subtree cannot be added to itself.");
    return run("add the subtree", () =>
      treeApi.addSubtreeAsChild(kind, { subtreeId, parentPath: parent.path, childSubtreeId, mode, attributes: attributes || {} }),
      { success: `"${childSubtreeId}" added ${mode === "reference" ? "as a <SubTreePlus> link" : "as a full copy"}` }
    );
  }

  return {
    busy,
    addNode,
    quickAdd,
    updateNode,
    deleteNode,
    deleteWrapperOnly,
    addWrapper,
    copyNode,
    copyToClipboard,
    cutNode,
    paste,
    moveAfter,
    swap,
    moveBy,
    addSubtreeAsChild,
    addRunProgram,
    undo,
    redo,
  };
}
