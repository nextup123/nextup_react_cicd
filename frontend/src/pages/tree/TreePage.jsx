// Robot Program (was "Main Tree"): behaviour-tree editor. The tree view takes
// the whole page; the library slides in from the left when opened, and the
// selected node's settings float at the top-right corner of the tree view.
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  ChevronDown,
  ChevronUp,
  ChevronsDownUp,
  ChevronsUpDown,
  ClipboardPaste,
  Crosshair,
  GitBranch,
  ListTree,
  Maximize2,
  Network,
  PanelLeftOpen,
  Redo2,
  ShieldCheck,
  SlidersHorizontal,
  Undo2,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { Alert, Badge, Button, Card, EmptyState, IconButton, Loading, SearchInput, Segmented, Spinner } from "../../components/ui";
import { errorMessage } from "../../lib/api";
import { invalidate } from "../../lib/queries";
import { queryClient } from "../../lib/queryClient";
import { confirm } from "../../store/confirm";
import { toast } from "../../store/toast";
import CustomNodeModal from "./CustomNodeModal";
import LadderView from "./LadderView";
import Legend from "./Legend";
import LibraryPanel from "./LibraryPanel";
import { InsertSubtreeModal, PreviewModal, RunProgramModal, ShortcutsModal, XmlModal } from "./Modals";
import NodeContextMenu from "./NodeContextMenu";
import NodeEditorPanel from "./NodeEditorPanel";
import TouchActionBar from "./TouchActionBar";
import TreeCanvas from "./TreeCanvas";
import { LiveRunBar, setBreakpoint, useBtDebug, useLiveHighlight } from "./LiveRun";
import { isTouchMode, useInputMode } from "./touch";
import { quickAddByCode, useClipboard } from "./shortcuts";
import { treeApi, treeKeys, useDoDiList, useNodeTypes, useSubtree, useSubtreeList, useUndoState } from "./treeApi";
import { usePrograms } from "../programs/programsApi";
import { ancestorsOf, capabilities, flatten, matchesQuery } from "./treeModel";
import { useTreeActions } from "./useTreeActions";
import { useBridge } from "../../tutorial/bridge";
import "./tree.css";
import { Split } from "../../components/ui/Split";
import ValidationPopup, { useValidation } from "../../components/robot/ValidationPopup";

/* Small per-browser UI preferences (never shared data). */
const PREF = "nextup.tree.";
function usePref(name, initial, { parse = JSON.parse, serialize = JSON.stringify } = {}) {
  const [v, setV] = useState(() => {
    try {
      const raw = localStorage.getItem(PREF + name);
      return raw == null ? initial : parse(raw);
    } catch {
      return initial;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(PREF + name, serialize(v));
    } catch {
      /* storage unavailable */
    }
  }, [name, v, serialize]);
  return [v, setV];
}
const setPref = { parse: (s) => new Set(JSON.parse(s)), serialize: (s) => JSON.stringify([...s]) };
const DEFAULT_LABELS = new Set(["BehaviorTree", "Sequence", "Fallback", "SubTreePlus"]);

const typing = () => {
  const el = document.activeElement;
  return el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable);
};
const dialogOpen = () => !!document.querySelector(".overlay");

export default function TreePage() {
  const nodeTypes = useNodeTypes();
  const lib = nodeTypes.data;
  const subtrees = useSubtreeList();
  const programs = usePrograms();
  const undoState = useUndoState();
  const doDis = useDoDiList();

  const [subtreeId, setSubtreeId] = usePref("subtree", "main_tree");
  const sub = useSubtree(subtreeId);
  const tree = sub.data;

  const [view, setView] = usePref("view", "tree");
  const [spacing, setSpacing] = usePref("spacing", { x: 30, y: 90 });
  const [labelTypes, setLabelTypes] = usePref("labels", DEFAULT_LABELS, setPref);
  const [legendOpen, setLegendOpen] = usePref("legend", false);

  const [libraryOpen, setLibraryOpen] = usePref("libraryOpen", false);
  const [selection, setSelection] = useState(null); // { key, idx }
  const [collapsedBySubtree, setCollapsedBySubtree] = usePref("collapsed", {});
  const collapsed = useMemo(() => new Set(collapsedBySubtree[subtreeId] || []), [collapsedBySubtree, subtreeId]);
  const setCollapsed = useCallback(
    (fn) =>
      setCollapsedBySubtree((all) => {
        const cur = new Set(all[subtreeId] || []);
        const next = typeof fn === "function" ? fn(cur) : fn;
        return { ...all, [subtreeId]: [...next] };
      }),
    [subtreeId, setCollapsedBySubtree]
  );
  const [editorOpen, setEditorOpen] = useState(true);
  const [editorFocus, setEditorFocus] = useState(0);
  const clip = useClipboard((st) => st.clip);
  const touch = useInputMode((st) => st.mode === "touch");
  const [menu, setMenu] = useState(null);
  const [insertReq, setInsertReq] = useState(null);
  const [programReq, setProgramReq] = useState(null);
  const [previewReq, setPreviewReq] = useState(null);
  const [xmlType, setXmlType] = useState(null);
  const [customOpen, setCustomOpen] = useState(false);
  const [keysOpen, setKeysOpen] = useState(false);
  const [reloading, setReloading] = useState(false);
  const [query, setQuery] = useState("");
  const [focusIdx, setFocusIdx] = useState(0);
  const canvasRef = useRef(null);
  const searchRef = useRef(null);

  // If the remembered subtree no longer exists, fall back to main_tree.
  useEffect(() => {
    const list = subtrees.data;
    if (!list?.length) return;
    if (!subtreeId || !list.includes(subtreeId)) setSubtreeId(list.includes("main_tree") ? "main_tree" : list[0]);
  }, [subtrees.data, subtreeId, setSubtreeId]);

  /* ───── Selection (kept across reloads by ID path, then by position) ───── */
  const selected = tree && selection ? (selection.key && tree.byKey.get(selection.key)) || (selection.idx != null ? tree.byIdx.get(selection.idx) : null) || null : null;
  useEffect(() => {
    if (!tree || !selection) return;
    const n = (selection.key && tree.byKey.get(selection.key)) || (selection.idx != null && tree.byIdx.get(selection.idx));
    if (!n) setSelection(null);
    else if (n.key !== selection.key || n.idx !== selection.idx) setSelection({ key: n.key, idx: n.idx });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tree]);

  const select = useCallback(
    (key) => {
      const n = key && tree?.byKey.get(key);
      setSelection(n ? { key: n.key, idx: n.idx } : null);
    },
    [tree]
  );

  // Clicking a node (tree or ladder) also brings the editor back. On a touch
  // screen a closed editor stays closed (it would cover the tree); the action
  // bar's Edit button opens it.
  const pick = useCallback(
    (key) => {
      select(key);
      if (key && !isTouchMode()) setEditorOpen(true);
    },
    [select]
  );

  const openSubtree = (id) => {
    if (id === subtreeId) return sub.refetch();
    setSelection(null);
    setFocusIdx(0);
    setSubtreeId(id);
  };

  const actions = useTreeActions({ subtreeId, tree, lib, setSelection, onRunProgram: (req) => setProgramReq({ name: "", ...req }) });
  const caps = useMemo(() => capabilities(tree, selected, lib), [tree, selected, lib]);

  /* ───── Search ───── */
  const dq = useDeferredValue(query.trim().toLowerCase());
  const matches = useMemo(() => (dq && tree ? flatten(tree.root).filter((n) => matchesQuery(n, dq)).map((n) => n.key) : []), [dq, tree]);
  const matchKeys = useMemo(() => new Set(matches), [matches]);
  const focusPos = matches.length ? ((focusIdx % matches.length) + matches.length) % matches.length : 0;
  const focusKey = matches.length ? matches[focusPos] : null;
  useEffect(() => setFocusIdx(0), [dq]);
  const step = (d) => matches.length && setFocusIdx((i) => i + d);
  const clearSearch = () => {
    setQuery("");
    setFocusIdx(0);
  };

  // Ladder view: make sure the focused match (or the selection) is visible.
  useEffect(() => {
    const key = focusKey || selection?.key;
    const n = key && tree?.byKey.get(key);
    if (!n) return;
    const anc = ancestorsOf(tree, n).filter((a) => collapsed.has(a.key));
    if (anc.length)
      setCollapsed((s) => {
        const next = new Set(s);
        anc.forEach((a) => next.delete(a.key));
        return next;
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusKey, selection?.key, tree]);

  const kbSel = useRef(null);
  kbSel.current = { tree, selection };
  const toggleCollapsed = useCallback(
    (key) => {
      const { tree: t, selection: sel } = kbSel.current;
      const closing = !collapsed.has(key);
      setCollapsed((s) => {
        const next = new Set(s);
        next.has(key) ? next.delete(key) : next.add(key);
        return next;
      });
      // Collapsing around the selected node: select the collapsed node instead.
      const n = sel?.key && t?.byKey.get(sel.key);
      if (closing && n && ancestorsOf(t, n).some((a) => a.key === key)) {
        const c = t.byKey.get(key);
        setSelection({ key: c.key, idx: c.idx });
      }
    },
    [collapsed, setCollapsed]
  );
  // Forget folded nodes that no longer exist (deleted, or the XML changed).
  useEffect(() => {
    if (!tree || !collapsed.size) return;
    const stale = [...collapsed].filter((k) => !tree.byKey.get(k)?.children.length);
    if (stale.length) setCollapsed((s) => new Set([...s].filter((k) => !stale.includes(k))));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tree]);

  /** Collapse (true) or expand (false) a node and every container inside it. */
  const foldSubtree = useCallback(
    (node, close) =>
      setCollapsed((s) => {
        const next = new Set(s);
        for (const n of flatten(node)) if (n.children.length) close ? next.add(n.key) : next.delete(n.key);
        return next;
      }),
    [setCollapsed]
  );
  const centerOn = useCallback((key) => canvasRef.current?.panTo(key), []);

  /* ───── Live program state (running node, failure, breakpoint) ───── */
  const { runningNames, failedName } = useLiveHighlight();
  const breakName = useBtDebug((s) => s.breakAt);
  const focusByName = (name) => {
    const n = tree && flatten(tree.root).find((x) => x.name === name);
    if (!n) {
      toast.info(`"${name}" is not in this subtree`);
      return;
    }
    select(n.key);
    if (view === "tree") setTimeout(() => centerOn(n.key), 50);
  };
  // Opened from the NexRoot runner: /tree?subtree=<id>&node=<name>
  const [params, setParams] = useSearchParams();
  const linkReq = useRef(null);
  useEffect(() => {
    const st = params.get("subtree");
    const nd = params.get("node");
    if (!st && !nd) return;
    linkReq.current = { subtree: st, node: nd };
    setParams({}, { replace: true });
  }, [params, setParams]);
  useEffect(() => {
    const r = linkReq.current;
    if (!r || !subtrees.data) return;
    if (r.subtree) {
      const id = r.subtree;
      r.subtree = null;
      if (id !== subtreeId) {
        if (subtrees.data.includes(id)) {
          openSubtree(id);
          return;
        }
        toast.info(`"${id}" is not a subtree of the editor's tree file; showing the current subtree`);
      }
    }
    if (r.node && tree && !sub.isFetching) {
      linkReq.current = null;
      focusByName(r.node);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subtrees.data, subtreeId, tree, sub.isFetching]);
  // Touch: keep the selected node clear of the action bar at the bottom.
  useEffect(() => {
    if (touch && view === "tree" && selected?.key) canvasRef.current?.reveal(selected.key, 110);
  }, [touch, view, selected?.key]);

  /* ───── Validate: the main program checked by the runner; problems marked in red ───── */
  const check = useValidation();
  const [showTick, setShowTick] = useState(0);
  const nIssues = check.issues.length;
  const curIssue = nIssues ? check.issues[((check.pos % nIssues) + nIssues) % nIssues] : null;
  const openable = (i) => i.inEditor && !!i.tree && (subtrees.data || []).includes(i.tree);
  const marks = useMemo(() => {
    if (!check.result || !tree) return null;
    const m = new Map();
    for (const i of check.issues) {
      if (!openable(i) || i.tree !== subtreeId) continue;
      const n = tree.byIdx.get(i.idx);
      if (n && m.get(n.key) !== "e") m.set(n.key, i.error ? "e" : "w");
    }
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [check.result, check.issues, tree, subtreeId, subtrees.data]);
  const curNode = curIssue && openable(curIssue) && curIssue.tree === subtreeId ? tree?.byIdx.get(curIssue.idx) : null;
  // Show the current problem once: open its subtree, then select and centre its node.
  const issueKey = check.result && curIssue ? `${showTick}|${check.pos}|${curIssue.tree}|${curIssue.idx}|${curIssue.text}` : "";
  const shownFor = useRef("");
  const switchedFor = useRef("");
  useEffect(() => {
    if (!issueKey || shownFor.current === issueKey || !openable(curIssue)) return;
    if (curIssue.tree !== subtreeId) {
      if (switchedFor.current !== issueKey) {
        switchedFor.current = issueKey;
        openSubtree(curIssue.tree);
      }
      return;
    }
    if (!tree || sub.isFetching) return;
    shownFor.current = issueKey;
    const n = tree.byIdx.get(curIssue.idx);
    if (!n) return;
    select(n.key);
    if (view === "tree") setTimeout(() => centerOn(n.key), 80);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [issueKey, subtreeId, tree, sub.isFetching]);
  const issueWhere = (i) => {
    if (!openable(i)) return i.tree && !i.inEditor ? "This part is not in the Robot Program trees (for example an IO tree)." : i.name ? "" : "This is about the whole program, not one node.";
    if (i.tree === subtreeId && tree && !sub.isFetching && !tree.byIdx.get(i.idx)) return "The program changed since this check: check again.";
    return "";
  };

  /* ───── Context menu & drag-drop ───── */
  const openMenu = useCallback(
    (key, x, y) => {
      select(key);
      setMenu({ key, x, y });
    },
    [select]
  );
  const closeMenu = useCallback(() => setMenu(null), []);
  // Touch action bar: open the menu (or one of its node pickers) above a button.
  const openBarMenu = useCallback((mode, x, y) => selected && setMenu({ key: selected.key, x, y, mode, above: true }), [selected]);
  const onDrop = useCallback(
    (srcKey, targetKey, swap) => {
      const a = tree?.byKey.get(srcKey);
      const b = targetKey && tree?.byKey.get(targetKey);
      if (!a) return;
      if (!b) return toast.info("Drop the node onto one of its siblings to move it.");
      select(srcKey);
      swap ? actions.swap(a, b) : actions.moveAfter(a, b);
    },
    [tree, actions, select]
  );

  /* ───── Library actions ───── */
  const createSubtree = async (name) => {
    if (!name) return false;
    if (subtrees.data?.includes(name)) {
      toast.warning(`A subtree called "${name}" already exists.`);
      return false;
    }
    try {
      await treeApi.addSubtree(name);
      toast.success(`Subtree "${name}" created`);
      await invalidate.tree();
      openSubtree(name);
      return true;
    } catch (err) {
      toast.error(errorMessage(err), { title: "Could not create the subtree" });
      return false;
    }
  };

  const deleteSubtree = async (id) => {
    const ok = await confirm({
      title: `Delete subtree "${id}"?`,
      message: "The subtree and all its nodes are removed. Links (<SubTreePlus>) to it in other subtrees will stop working.",
      tone: "danger",
      confirmLabel: "Delete subtree",
    });
    if (!ok) return;
    try {
      await treeApi.deleteSubtree(id);
      toast.success(`Subtree "${id}" deleted`);
      if (previewReq?.id === id) setPreviewReq(null);
      if (id === subtreeId) openSubtree("main_tree");
      queryClient.removeQueries({ queryKey: treeKeys.subtree(id) });
      invalidate.tree();
    } catch (err) {
      toast.error(errorMessage(err), { title: "Could not delete the subtree" });
    }
  };

  const reloadAll = async () => {
    setReloading(true);
    await Promise.all([invalidate.tree(), invalidate.points(), programs.refetch()]);
    setReloading(false);
    toast.success("Subtrees, motion programs, DO/DI subtrees and points reloaded");
  };

  /* ───── Keyboard shortcuts ───── */
  const kb = useRef({});
  kb.current = { selected, tree, actions, caps, matches, menu, toggleCollapsed, view };
  useEffect(() => {
    const onKey = (e) => {
      const { selected: sel, tree: t, actions: act, menu: m, toggleCollapsed: toggle, view: v } = kb.current;
      if (e.ctrlKey && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "s") {
        e.preventDefault();
        setKeysOpen((o) => !o);
        return;
      }
      if (dialogOpen() || m) return;
      if (e.ctrlKey && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "f") {
        e.preventDefault();
        searchRef.current?.querySelector("input")?.focus();
        return;
      }
      if (typing()) return;
      if (e.key === "Escape") return setSelection(null);
      const zKey = e.key.toLowerCase();
      if ((e.ctrlKey || e.metaKey) && !e.altKey && (zKey === "z" || zKey === "y")) {
        e.preventDefault();
        if (e.repeat) return;
        return zKey === "y" || e.shiftKey ? act.redo() : act.undo();
      }
      const plain = !e.ctrlKey && !e.altKey && !e.shiftKey && !e.metaKey;
      if (plain && e.key.toLowerCase() === "f" && v === "tree") {
        e.preventDefault();
        return canvasRef.current?.fit();
      }
      if (!sel || !t) return;
      const parent = sel.parentKey ? t.byKey.get(sel.parentKey) : null;
      const ctrl = (e.ctrlKey || e.metaKey) && !e.altKey;
      const k = e.key.toLowerCase();

      if (ctrl && !e.shiftKey && k === "d") {
        e.preventDefault();
        return act.copyNode(sel);
      }
      if (ctrl && !e.shiftKey && k === "c") {
        if (window.getSelection?.()?.toString()) return; // let the browser copy selected text
        e.preventDefault();
        return act.copyToClipboard(sel);
      }
      if (ctrl && !e.shiftKey && k === "x") {
        e.preventDefault();
        return act.cutNode(sel);
      }
      if (ctrl && k === "v") {
        e.preventDefault();
        return act.paste(sel, e.shiftKey ? "after" : "auto");
      }
      if (plain && e.key === " ") {
        e.preventDefault();
        if (sel.children.length) toggle(sel.key);
        return;
      }
      if (plain && e.key === "Enter") {
        e.preventDefault();
        setEditorOpen(true);
        setEditorFocus((n) => n + 1);
        return;
      }
      if (plain && k === "c" && v === "tree") {
        e.preventDefault();
        return canvasRef.current?.panTo(sel.key);
      }
      if (e.ctrlKey && !e.altKey && !e.shiftKey && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
        e.preventDefault();
        return act.moveBy(sel, e.key === "ArrowLeft" ? -1 : 1);
      }
      if (e.key === "Delete" && !e.ctrlKey && !e.altKey && !e.shiftKey && !e.metaKey) {
        e.preventDefault();
        return act.deleteNode(sel);
      }
      if (e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey && e.key.startsWith("Arrow")) {
        e.preventDefault();
        let target = null;
        if (e.key === "ArrowUp") target = parent;
        else if (e.key === "ArrowDown") target = sel.children[0];
        else if (parent) target = parent.children[sel.index + (e.key === "ArrowLeft" ? -1 : 1)];
        if (target) setSelection({ key: target.key, idx: target.idx });
        else toast.info(e.key === "ArrowUp" ? "Already at the root" : e.key === "ArrowDown" ? "This node has no children" : `Already the ${e.key === "ArrowLeft" ? "first" : "last"} sibling`, { duration: 1800 });
        return;
      }
      const sc = quickAddByCode(e.code);
      if (sc && !e.ctrlKey && !e.metaKey && e.shiftKey !== e.altKey) {
        e.preventDefault();
        act.quickAdd(e.shiftKey ? "child" : "after", sel, sc.nodeName);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Live state and a few actions for the tutorials (cheap: only read while a lesson runs).
  useBridge("tree", {
    subtreeId,
    subtrees: subtrees.data,
    tree,
    selected,
    lib,
    libraryOpen,
    view,
    collapsed,
    menuOpen: !!menu,
    editorOpen,
    keysOpen,
    query,
    busy: actions.busy,
    openSubtree,
    select: pick,
    centerOn,
    setLibraryOpen,
    setView,
  });

  const insertReason = caps.addChild.ok ? null : caps.addChild.reason;
  const quickReason = { child: insertReason, after: caps.addAfter.ok ? null : caps.addAfter.reason };
  const allWrappers = useMemo(() => (tree ? flatten(tree.root).filter((n) => n.children.length).map((n) => n.key) : []), [tree]);

  return (
    <div className="page page-fill bt-page">
      <Split id="tree.library" className={`bt-layout${libraryOpen ? " has-library" : ""}`} defaults={libraryOpen ? [1, 4] : [1]} min={libraryOpen ? [220, 480] : [0]} gap={12}>
        {libraryOpen && (
          <LibraryPanel
            key="library"
            subtrees={subtrees}
            programs={programs}
            doDis={doDis}
            currentId={subtreeId}
            insertReason={insertReason}
            onOpen={openSubtree}
            onPreview={(kind, id) => setPreviewReq({ kind, id })}
            onInsert={(kind, id) => setInsertReq({ kind, id })}
            onInsertProgram={(name) => setProgramReq({ name })}
            programReason={caps.addChild.ok || caps.addAfter.ok ? null : caps.addChild.reason}
            onDelete={deleteSubtree}
            onCreate={createSubtree}
            onReload={reloadAll}
            reloading={reloading}
            onXml={setXmlType}
            lib={lib}
            quickReason={quickReason}
            onQuickAdd={(mode, name) => selected && actions.quickAdd(mode, selected, name)}
            onShowShortcuts={() => setKeysOpen(true)}
            onNewType={() => setCustomOpen(true)}
            onHide={() => setLibraryOpen(false)}
          />
        )}

        <Card key="center" className="bt-center" bodyClassName="bt-center-body" flush>
          <div className="bt-toolbar" data-tut="bt-toolbar">
            <div className="bt-title">
              {!libraryOpen && (
                <Button data-tut="bt-library-btn" size="sm" icon={PanelLeftOpen} onClick={() => setLibraryOpen(true)} title="Show the library: subtrees, motion programs, DO/DI and quick add">
                  <span className="bt-narrow-hide">Library</span>
                </Button>
              )}
              <GitBranch size={17} />
              <SubtreePicker value={subtreeId} list={subtrees.data} onChange={openSubtree} />
              {subtreeId === "main_tree" && <Badge tone="primary" className="bt-narrow-hide">Main</Badge>}
              {tree && <span className="xs muted bt-narrow-hide">{tree.count} nodes</span>}
              {(sub.isFetching || actions.busy) && <Spinner />}
              <IconButton
                icon={Undo2}
                data-tut="bt-undo"
                size="sm"
                label={undoState.data?.undo ? `Undo: ${undoState.data.undo} (Ctrl+Z)` : "Nothing to undo (Ctrl+Z undoes the last change)"}
                disabled={!undoState.data?.undo || !!actions.busy}
                onClick={actions.undo}
              />
              <IconButton
                icon={Redo2}
                data-tut="bt-redo"
                size="sm"
                label={undoState.data?.redo ? `Redo: ${undoState.data.redo} (Ctrl+Y)` : "Nothing to redo (Ctrl+Y)"}
                disabled={!undoState.data?.redo || !!actions.busy}
                onClick={actions.redo}
              />
            </div>
            <div className="bt-search" ref={searchRef} data-tut="bt-search">
              <SearchInput size="sm" value={query} onChange={setQuery} placeholder="Search name, type or setting" />
              <span className="bt-search-count xs muted">{dq ? (matches.length ? `${focusPos + 1}/${matches.length}` : "0 found") : ""}</span>
              <IconButton icon={ChevronUp} size="sm" label="Previous match" disabled={!matches.length} onClick={() => step(-1)} />
              <IconButton icon={ChevronDown} size="sm" label="Next match" disabled={!matches.length} onClick={() => step(1)} />
              <IconButton icon={X} size="sm" label="Clear search" disabled={!query} onClick={clearSearch} />
            </div>
            <div className="bt-tools">
              <Button data-tut="bt-validate" size="sm" icon={ShieldCheck} loading={check.busy} onClick={check.run} title="Check the main program the robot runs: structure, settings and points. Nothing moves.">
                <span className="bt-narrow-hide">Validate</span>
              </Button>
              <LiveRunBar onFocusName={focusByName} />
              {clip && (
                <span className="bt-clip" data-tut="bt-clip" title={`On the clipboard: ${clip.type} "${clip.name}"${clip.count > 1 ? ` with ${clip.count - 1} nodes inside` : ""}${clip.from ? `, copied from ${clip.from}` : ""}`}>
                  <button type="button" className="bt-clip-main" disabled={!selected} onClick={() => selected && actions.paste(selected)} title={selected ? `Paste into / after "${selected.name}" (Ctrl+V)` : "Select where to paste"}>
                    <ClipboardPaste size={14} />
                    <span className="truncate">{clip.name}</span>
                    {clip.count > 1 && <span className="bt-clip-count">+{clip.count - 1}</span>}
                  </button>
                  <button type="button" className="bt-clip-x" onClick={() => useClipboard.setState({ clip: null })} aria-label="Clear the clipboard" title="Clear the clipboard">
                    <X size={12} />
                  </button>
                </span>
              )}
              <Segmented
                className="bt-view-seg"
                value={view}
                onChange={setView}
                options={[
                  { value: "tree", label: "Tree", icon: Network, title: "Diagram view" },
                  { value: "ladder", label: "Ladder", icon: ListTree, title: "Indented list view" },
                ]}
              />
              <IconButton data-tut="bt-expand-all" icon={ChevronsUpDown} size="sm" label="Expand all" onClick={() => setCollapsed(new Set())} />
              <IconButton data-tut="bt-collapse-all" icon={ChevronsDownUp} size="sm" label="Collapse all" onClick={() => setCollapsed(new Set(allWrappers.filter((k) => k !== "__root__")))} />
              {view === "tree" && (
                <>
                  <SpacingControl spacing={spacing} onChange={setSpacing} />
                  <IconButton icon={ZoomOut} size="sm" label="Zoom out" onClick={() => canvasRef.current?.zoomOut()} />
                  <IconButton data-tut="bt-zoom-in" icon={ZoomIn} size="sm" label="Zoom in" onClick={() => canvasRef.current?.zoomIn()} />
                  <IconButton icon={Crosshair} size="sm" label={selected ? "Centre on the selected node (C)" : "Select a node to centre on it"} disabled={!selected} onClick={() => selected && centerOn(selected.key)} />
                  <IconButton data-tut="bt-fit" icon={Maximize2} size="sm" label="Fit to view (F)" onClick={() => canvasRef.current?.fit()} />
                </>
              )}
            </div>
          </div>

          <div className={`bt-stage${touch && selected ? " has-touchbar" : ""}`} data-tut="bt-stage">
            {!subtreeId ? (
              <EmptyState icon={GitBranch} title="No subtree open" text="Open a subtree from the list at the top left." />
            ) : sub.isLoading ? (
              <Loading label={`Loading ${subtreeId}…`} />
            ) : sub.isError ? (
              <div style={{ padding: 16 }}>
                <Alert tone="danger" title={`Could not load "${subtreeId}"`} action={<Button size="sm" onClick={() => sub.refetch()}>Retry</Button>}>
                  {sub.error?.message}
                </Alert>
              </div>
            ) : !tree ? (
              <EmptyState icon={GitBranch} title="Subtree is empty" />
            ) : (
              <>
                {view === "tree" ? (
                  <TreeCanvas
                    ref={canvasRef}
                    tree={tree}
                    viewId={subtreeId}
                    lib={lib}
                    spacing={spacing}
                    labelTypes={labelTypes}
                    collapsed={collapsed}
                    selectedKey={selected?.key}
                    matchKeys={matchKeys}
                    focusKey={focusKey}
                    runningNames={runningNames}
                    failedName={failedName}
                    breakName={breakName}
                    marks={marks}
                    markFocus={curNode?.key}
                    onSelect={pick}
                    onToggle={toggleCollapsed}
                    onActivate={(key) => {
                      pick(key);
                      setEditorFocus((n) => n + 1);
                    }}
                    onContextMenu={openMenu}
                    onDrop={onDrop}
                  />
                ) : (
                  <LadderView
                    tree={tree}
                    lib={lib}
                    collapsed={collapsed}
                    onToggle={toggleCollapsed}
                    selectedKey={selected?.key}
                    matchKeys={matchKeys}
                    focusKey={focusKey}
                    marks={marks}
                    markFocus={curNode?.key}
                    onSelect={pick}
                    onContextMenu={openMenu}
                  />
                )}
                {view === "tree" && (
                  <Legend tree={tree} lib={lib} labelTypes={labelTypes} onLabelTypes={setLabelTypes} open={legendOpen} onOpen={setLegendOpen} />
                )}
                {view === "tree" && (
                  <div className="bt-hint xs muted">Click to edit · double-click to fold · right-click for actions · drag onto a sibling to move · Ctrl+S for keys</div>
                )}
                {touch && selected && (
                  <TouchActionBar
                    tree={tree}
                    node={selected}
                    lib={lib}
                    actions={actions}
                    view={view}
                    collapsed={collapsed}
                    onToggle={toggleCollapsed}
                    onMenu={openBarMenu}
                    onEdit={() => setEditorOpen(true)}
                    onClear={() => setSelection(null)}
                  />
                )}
                {touch && !selected && (
                  <div className="bt-touch-hint small">
                    {view === "tree"
                      ? "Tap a node for its actions · hold and drag onto a sibling to move · pinch to zoom"
                      : "Tap a node for its actions · hold a row for the menu"}
                  </div>
                )}
                {editorOpen && selected && (
                  <NodeEditorPanel
                    tree={tree}
                    node={selected}
                    lib={lib}
                    actions={actions}
                    focusToken={editorFocus}
                    onSelect={(key) => select(key)}
                    onClose={() => setEditorOpen(false)}
                  />
                )}
              </>
            )}
          </div>
        </Card>
      </Split>

      {nodeTypes.isError && (
        <Alert tone="warning" className="bt-libtypes-alert" action={<Button size="sm" onClick={() => nodeTypes.refetch()}>Retry</Button>}>
          The node library could not be loaded ({nodeTypes.error?.message}). Colours and the add-node lists are incomplete.
        </Alert>
      )}

      <NodeContextMenu
        menu={menu}
        tree={tree}
        lib={lib}
        actions={actions}
        onClose={closeMenu}
        collapsed={collapsed}
        onToggle={toggleCollapsed}
        onSubtreeFold={foldSubtree}
        onCenter={view === "tree" ? centerOn : null}
        breakName={breakName}
        onBreakAt={setBreakpoint}
      />
      <InsertSubtreeModal
        request={insertReq}
        parent={selected}
        onClose={() => setInsertReq(null)}
        onConfirm={(kind, id, mode, attrs) => actions.addSubtreeAsChild(kind, selected, id, mode, attrs)}
      />
      <RunProgramModal
        request={programReq}
        node={selected}
        lib={lib}
        tree={tree}
        programs={programs.data?.programs}
        onClose={() => setProgramReq(null)}
        onConfirm={(attrs, name, where) => actions.addRunProgram(programReq?.node || selected, attrs, name, where)}
      />
      <PreviewModal request={previewReq} lib={lib} labelTypes={labelTypes} onClose={() => setPreviewReq(null)} onOpen={openSubtree} />
      <XmlModal type={xmlType} onClose={() => setXmlType(null)} />
      <CustomNodeModal open={customOpen} onClose={() => setCustomOpen(false)} lib={lib} />
      <ShortcutsModal open={keysOpen} onClose={() => setKeysOpen(false)} />
      {check.result && (
        <ValidationPopup
          title="Program check"
          result={check.result}
          issues={check.issues}
          pos={check.pos}
          onPos={check.setPos}
          where={issueWhere}
          onShow={() => setShowTick((n) => n + 1)}
          onRecheck={check.run}
          rechecking={check.busy}
          showWarnings={check.showWarnings}
          onShowWarnings={check.setShowWarnings}
          onClose={check.close}
        />
      )}
    </div>
  );
}

/** Subtree name in the toolbar doubles as a switcher, so the library can stay hidden. */
function SubtreePicker({ value, list, onChange }) {
  const items = list || [];
  return (
    <select data-tut="bt-subtree-pick" className="bt-subtree-pick" value={value || ""} onChange={(e) => onChange(e.target.value)} title="Open another subtree" aria-label="Open subtree">
      {!items.includes(value) && <option value={value || ""}>{value || "No subtree"}</option>}
      {items.map((id) => (
        <option key={id} value={id}>
          {id === "main_tree" ? "main_tree (main)" : id}
        </option>
      ))}
    </select>
  );
}

function SpacingControl({ spacing, onChange }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const close = (e) => !ref.current?.contains(e.target) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);
  const set = (k) => (e) => onChange({ ...spacing, [k]: Number(e.target.value) });
  return (
    <div className="bt-pop-wrap" ref={ref}>
      <Button size="sm" icon={SlidersHorizontal} active={open} onClick={() => setOpen((o) => !o)} title="Node spacing">
        <span className="bt-narrow-hide">Spacing</span>
      </Button>
      {open && (
        <div className="menu bt-pop">
          <label className="bt-slider">
            <span className="small">Horizontal</span>
            <input type="range" min="10" max="250" step="1" value={spacing.x} onChange={set("x")} />
            <span className="xs muted">{spacing.x}px</span>
          </label>
          <label className="bt-slider">
            <span className="small">Vertical</span>
            <input type="range" min="20" max="250" step="1" value={spacing.y} onChange={set("y")} />
            <span className="xs muted">{spacing.y}px</span>
          </label>
          <Button size="sm" variant="ghost" onClick={() => onChange({ x: 30, y: 90 })}>
            Reset
          </Button>
        </div>
      )}
    </div>
  );
}
