// NexRoot runner: Groot-like live view and debugger of the behaviour tree the
// robot runs (control_logic_bt + bt_debug_pkg). Separate from the editor: it
// shows the COMPLETE tree, every SubTree attached inline, coloured by status
// (green success, orange running, red failure), and drives the runner's
// state machine. Opens as a page or in its own window (/runner-window).
//
// CPU: live data comes at most 5 times per second, and only while this page
// is open (see backend ros/btMonitor.js); the canvas changes only the nodes
// whose status changed.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowDownUp, ArrowRightLeft, ChevronsDownUp, ChevronsUpDown, CircleSlash, Crosshair, ExternalLink, GitFork, ListTree, LocateFixed, Maximize2, Pencil, RefreshCw, Rows3, Rows4, Target, ZoomIn, ZoomOut,
} from "lucide-react";
import { Button, Card, EmptyState, IconButton, SearchInput, Segmented, Switch, cx } from "../../components/ui";
import { Split } from "../../components/ui/Split";
import { robotApi, robotCall } from "../../lib/robotApi";
import { useRobot } from "../../store/robot";
import { refreshBtStructure, startBtWatch, useBtRunner } from "../../store/btRunner";
import { toast } from "../../store/toast";
import { useNodeTypes } from "../tree/treeApi";
import RunnerCanvas from "./RunnerCanvas";
import RunnerList from "./RunnerList";
import RunnerControls from "./RunnerControls";
import RunnerSide from "./RunnerSide";
import { STATUS_LABEL, indexTree, pathTo } from "./runnerModel";
import ValidationPopup, { useValidation } from "../../components/robot/ValidationPopup";
import "./runner.css";

const PREF = (k) => `nextup.runner.${k}`;
const FOLLOW_PAUSE_MS = 6000; // after the operator pans, follow waits this long
const BIG_TREE = 160; // above this many nodes, nested subtrees start folded

function usePref(key, initial) {
  const [v, setV] = useState(() => {
    try {
      const raw = localStorage.getItem(PREF(key));
      return raw === null ? initial : JSON.parse(raw);
    } catch {
      return initial;
    }
  });
  const set = useCallback(
    (next) =>
      setV((cur) => {
        const val = typeof next === "function" ? next(cur) : next;
        try {
          localStorage.setItem(PREF(key), JSON.stringify(val));
        } catch {
          /* ignore */
        }
        return val;
      }),
    [key]
  );
  return [v, set];
}

export default function RunnerPage({ standalone = false }) {
  const navigate = useNavigate();
  useEffect(() => startBtWatch(), []);
  const lib = useNodeTypes().data;
  const structure = useBtRunner((s) => s.structure);
  const structureError = useBtRunner((s) => s.structureError);
  const runner = useBtRunner((s) => s.runner);
  const live = useBtRunner((s) => s.live);
  const sup = useRobot((s) => s.supervisor);
  const robot = { latched: Boolean(sup?.latched), profile: sup?.profile || null };

  const index = useMemo(() => (structure ? indexTree(structure, lib) : null), [structure, lib]);
  const fresh = Boolean(index && live && live.hash === structure?.hash);
  const st = fresh ? live.st : "";
  const run = fresh ? live.run : [];

  const [follow, setFollow] = usePref("follow", true);
  const [autoFocusFail, setAutoFocusFail] = usePref("focusFailure", true);
  const [orientation, setOrientation] = usePref("orientation", "TB");
  const [view, setView] = usePref("view", "list"); // list: compact terminal-style tree · graph: d3 canvas
  const [density, setDensity] = usePref("density", "normal");
  const [tab, setTab] = usePref("tab", "run");
  const [selectedUid, setSelectedUid] = useState(0);
  const [collapsed, setCollapsed] = useState(() => new Set());
  const [menu, setMenu] = useState(null); // { uid, x, y }
  const [query, setQuery] = useState("");
  const check = useValidation();
  const canvasRef = useRef(null);
  const movedAt = useRef(0);
  const pendingFocus = useRef(null);

  // a new tree: fold nested subtrees of big trees, clear the selection
  const hash = structure?.hash;
  useEffect(() => {
    if (!index) return;
    const fold = new Set();
    if (index.nodes.length > BIG_TREE) for (const n of index.nodes) if (index.kind.get(n.uid) === "subtree" && n.subtree) fold.add(n.uid);
    setCollapsed(fold);
    setSelectedUid(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hash]);

  /** The node itself, or its nearest folded ancestor when it is hidden. */
  const visibleUid = useCallback(
    (uid) => {
      if (!index) return 0;
      const p = pathTo(index, uid);
      for (const u of p) if (collapsed.has(u) && u !== uid) return u;
      return uid;
    },
    [index, collapsed]
  );

  /** Unfold its ancestors, select it and centre it (after the redraw). */
  const focusNode = useCallback(
    (uid, { select = true } = {}) => {
      if (!index?.byUid.has(uid)) return;
      const p = pathTo(index, uid).slice(0, -1);
      if (p.some((u) => collapsed.has(u))) {
        setCollapsed((c) => {
          const n = new Set(c);
          p.forEach((u) => n.delete(u));
          return n;
        });
      }
      if (select) setSelectedUid(uid);
      pendingFocus.current = uid;
      requestAnimationFrame(() => {
        if (pendingFocus.current === uid && canvasRef.current?.focus(uid)) pendingFocus.current = null;
      });
    },
    [index, collapsed]
  );
  useEffect(() => {
    const uid = pendingFocus.current;
    if (uid && canvasRef.current?.focus(uid)) pendingFocus.current = null;
  }, [collapsed, orientation, view]);

  /* ───── validation: every problem node marked, the shown one focused ───── */
  const uidsOf = useCallback((issue) => (index ? issueUids(index, issue) : []), [index]);
  const marks = useMemo(() => {
    if (!check.result || !index) return null;
    const m = new Map();
    const mark = (u, e) => m.get(u) !== "e" && m.set(u, e ? "e" : "w");
    for (const i of check.issues) {
      for (const u of uidsOf(i)) {
        mark(u, i.error);
        const shown = visibleUid(u); // a folded subtree holding a problem is marked too
        if (shown !== u) mark(shown, i.error);
      }
    }
    return m;
  }, [check.result, check.issues, index, uidsOf, visibleUid]);
  const curIssue = check.issues.length ? check.issues[((check.pos % check.issues.length) + check.issues.length) % check.issues.length] : null;
  const curUids = useMemo(() => (curIssue ? uidsOf(curIssue) : []), [curIssue, uidsOf]);
  const markFocus = curUids[0] || 0;
  const showIssue = useCallback(() => {
    if (markFocus) focusNode(markFocus);
  }, [markFocus, focusNode]);
  useEffect(() => {
    if (check.result) showIssue();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [check.result, check.pos, check.showWarnings, view]);
  const issueWhere = (i) => (uidsOf(i).length ? "" : !index ? "No program is loaded in the runner." : i.paths?.length || i.tree === structure?.treeId ? "Load the program to see this node." : "The main program does not use this part.");

  // follow the running action (pan only as much as needed)
  const runUid = run?.[0]?.[0] || 0;
  useEffect(() => {
    if (!follow || !runUid || Date.now() - movedAt.current < FOLLOW_PAUSE_MS) return;
    canvasRef.current?.reveal(visibleUid(runUid));
  }, [follow, runUid, visibleUid]);

  // a failed cycle: show the node that stopped the run
  const failKey = live?.runFail ? `${live.runFail.node}|${live.runFail.cycle}|${live.runFail.time}|${live.runFail.uid}` : "";
  const lastFailKey = useRef("");
  useEffect(() => {
    if (!failKey || failKey === lastFailKey.current || runner?.state !== "FAILED") return;
    lastFailKey.current = failKey;
    if (!autoFocusFail) return;
    if (live.runFail.uid) focusNode(live.runFail.uid);
    setTab("failure");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [failKey, runner?.state, autoFocusFail]);

  const toggle = useCallback((uid) => {
    setCollapsed((c) => {
      const n = new Set(c);
      if (n.has(uid)) n.delete(uid);
      else n.add(uid);
      return n;
    });
  }, []);

  const foldAll = () => index && setCollapsed(new Set(index.nodes.filter((n) => index.kind.get(n.uid) === "subtree").map((n) => n.uid)));
  const unfoldAll = () => setCollapsed(new Set());

  const setBreak = async (name, onFailureOnly = false) => {
    await robotCall(() => robotApi.btBreak(name || "", onFailureOnly), { success: name ? `Breakpoint: ${name}${onFailureOnly ? " (on failure)" : ""}` : "Breakpoint cleared" });
  };

  /** Open the node in the Robot Program editor (its enclosing subtree). */
  const editNode = (uid) => {
    const n = index?.byUid.get(uid);
    if (!n) return;
    let sub = "";
    for (const u of pathTo(index, uid).slice(0, -1).reverse()) {
      if (index.kind.get(u) === "subtree") {
        sub = index.byUid.get(u).name;
        break;
      }
    }
    const url = `/tree?${new URLSearchParams({ ...(sub ? { subtree: sub } : {}), node: n.name })}`;
    if (standalone) window.open(url, "nextup-main");
    else navigate(url);
  };

  const search = () => {
    const q = query.trim().toLowerCase();
    if (!q || !index) return;
    const hits = index.nodes.filter((n) => n.name.toLowerCase().includes(q) || n.type.toLowerCase().includes(q));
    if (!hits.length) return toast.info(`Nothing matches "${query}"`);
    const cur = hits.findIndex((n) => n.uid === selectedUid);
    focusNode(hits[(cur + 1) % hits.length].uid);
  };

  const popOut = () => {
    window.open("/runner-window", "nexroot-runner", "width=1440,height=900");
  };

  const ctxNode = menu && index?.byUid.get(menu.uid);
  const ctxIsBp = ctxNode && live?.bp?.name === ctxNode.name;

  return (
    <div className={cx("page page-fill nr-page", standalone && "is-standalone")}>
      <RunnerControls runner={runner} live={live} robot={robot} onValidate={check.run} validating={check.busy} />
      <Split id="runner.main" className="nr-layout" defaults={[3, 1]} min={[360, 280]} gap={12}>
        <Card key="tree" className="nr-tree-card" bodyClassName="nr-tree-body" flush tut="rn-tree">
          <div className="nr-toolbar" data-tut="rn-toolbar">
            <div className="nr-title" data-tut="rn-title">
              <strong className="truncate">{structure?.treeId || "Behaviour tree"}</strong>
              {index && <span className="xs muted">{index.nodes.length} nodes</span>}
              {live && !live.events && fresh && (
                <span className="xs muted" title="The runner sends no step events: only the running chain and the last failure are coloured">
                  · running steps only
                </span>
              )}
            </div>
            <form
              className="nr-search"
              data-tut="rn-search"
              onSubmit={(e) => {
                e.preventDefault();
                search();
              }}
            >
              <SearchInput size="sm" value={query} onChange={setQuery} placeholder="Find node (Enter: next)" />
            </form>
            <div className="nr-tools" data-tut="rn-tools">
              <Switch size="sm" className="nr-follow" checked={follow} onChange={setFollow} label="Follow" title="Keep the running action in view" />
              <Switch size="sm" className="nr-jumpfail" checked={autoFocusFail} onChange={setAutoFocusFail} label="Jump to failure" title="When a cycle fails, show the node that failed" />
              <IconButton icon={LocateFixed} size="sm" label="Show the running action" data-tut="rn-show-running" disabled={!runUid} onClick={() => focusNode(runUid, { select: false })} />
              {live?.runFail?.uid > 0 && <IconButton icon={Target} size="sm" label={`Show the failure: ${live.runFail.node}`} data-tut="rn-show-failure" onClick={() => focusNode(live.runFail.uid)} />}
              <Segmented
                size="sm"
                className="nr-view"
                ariaLabel="Tree view"
                value={view}
                onChange={setView}
                options={[
                  { value: "list", label: "Compact", icon: ListTree, title: "One line per node, like a terminal tree: fits many nodes at once" },
                  { value: "graph", label: "Graph", icon: GitFork, title: "Groot-style boxes and links" },
                ]}
              />
              {view === "graph" && (
                <IconButton icon={orientation === "TB" ? ArrowRightLeft : ArrowDownUp} size="sm" data-tut="rn-orient" label={orientation === "TB" ? "Lay out left to right" : "Lay out top to bottom"} onClick={() => setOrientation((o) => (o === "TB" ? "LR" : "TB"))} />
              )}
              <IconButton icon={ChevronsDownUp} size="sm" label="Fold every subtree" data-tut="rn-fold-all" onClick={foldAll} />
              <IconButton icon={ChevronsUpDown} size="sm" label="Unfold everything" data-tut="rn-unfold-all" onClick={unfoldAll} />
              {view === "graph" ? (
                <>
                  <IconButton icon={ZoomOut} size="sm" label="Zoom out" data-tut="rn-zoom-out" onClick={() => canvasRef.current?.zoomOut()} />
                  <IconButton icon={ZoomIn} size="sm" label="Zoom in" data-tut="rn-zoom-in" onClick={() => canvasRef.current?.zoomIn()} />
                  <IconButton icon={Maximize2} size="sm" label="Fit the tree" data-tut="rn-fit" onClick={() => canvasRef.current?.fit()} />
                </>
              ) : (
                <>
                  <IconButton icon={Rows4} size="sm" label="Tighter rows (more nodes on screen)" data-tut="rn-tighter" disabled={density === "tight"} onClick={() => canvasRef.current?.zoomOut()} />
                  <IconButton icon={Rows3} size="sm" label="Roomier rows" data-tut="rn-roomier" disabled={density === "roomy"} onClick={() => canvasRef.current?.zoomIn()} />
                </>
              )}
              <IconButton icon={RefreshCw} size="sm" label="Reload the tree structure" data-tut="rn-reload" onClick={refreshBtStructure} />
              {!standalone && <IconButton icon={ExternalLink} size="sm" label="Open in its own window" data-tut="rn-popout" onClick={popOut} />}
            </div>
          </div>
          <div className="nr-canvas-wrap" data-tut="rn-canvas">
            {index && view === "list" ? (
              <RunnerList
                ref={canvasRef}
                index={index}
                st={st}
                run={run}
                bp={live?.bp}
                marks={marks}
                markFocus={markFocus}
                selectedUid={selectedUid}
                collapsed={collapsed}
                density={density}
                onDensity={setDensity}
                lastEvent={fresh ? live?.lastEvent : ""}
                onSelect={(uid) => {
                  setSelectedUid(uid);
                  setMenu(null);
                  if (tab !== "failure") setTab("node");
                }}
                onToggle={toggle}
                onContext={(uid, x, y) => {
                  setSelectedUid(uid);
                  setMenu({ uid, x, y });
                }}
                onUserMove={() => {
                  movedAt.current = Date.now();
                  setMenu(null);
                }}
              />
            ) : index ? (
              <RunnerCanvas
                ref={canvasRef}
                index={index}
                st={st}
                run={run}
                bp={live?.bp}
                marks={marks}
                markFocus={markFocus}
                selectedUid={selectedUid}
                collapsed={collapsed}
                orientation={orientation}
                onSelect={(uid) => {
                  setSelectedUid(uid);
                  setMenu(null);
                  if (tab !== "failure") setTab("node");
                }}
                onToggle={toggle}
                onContext={(uid, x, y) => {
                  setSelectedUid(uid);
                  setMenu({ uid, x, y });
                }}
                onUserMove={() => {
                  movedAt.current = Date.now();
                  setMenu(null);
                }}
              />
            ) : (
              <EmptyState
                title="No tree from the runner"
                text={structureError || "Waiting for the program tree. It appears when the program runner loads a tree."}
                action={<Button size="sm" icon={RefreshCw} onClick={refreshBtStructure}>Try again</Button>}
              />
            )}
            {menu && ctxNode && (
              <div className="menu nr-menu" data-tut="rn-ctx-menu" style={{ left: menu.x, top: menu.y }} onMouseLeave={() => setMenu(null)}>
                <div className="menu-header">{ctxNode.name}</div>
                <button className="menu-item" onClick={() => { setMenu(null); focusNode(ctxNode.uid); }}>
                  <Crosshair size={15} /> <span className="grow">Centre</span>
                </button>
                {(index.children.get(ctxNode.uid)?.length || 0) > 0 && (
                  <button className="menu-item" onClick={() => { setMenu(null); toggle(ctxNode.uid); }}>
                    <ChevronsDownUp size={15} /> <span className="grow">{collapsed.has(ctxNode.uid) ? "Unfold" : "Fold"}</span>
                  </button>
                )}
                <div className="menu-sep" />
                {ctxIsBp ? (
                  <button className="menu-item" onClick={() => { setMenu(null); setBreak(""); }}>
                    <CircleSlash size={15} /> <span className="grow">Clear breakpoint</span>
                  </button>
                ) : (
                  <>
                    <button className="menu-item" onClick={() => { setMenu(null); setBreak(ctxNode.name); }}>
                      <span className="nr-bp-dot" /> <span className="grow">Break when it starts</span>
                    </button>
                    <button className="menu-item" onClick={() => { setMenu(null); setBreak(ctxNode.name, true); }}>
                      <span className="nr-bp-dot" /> <span className="grow">Break when it fails</span>
                    </button>
                  </>
                )}
                <div className="menu-sep" />
                <button className="menu-item" onClick={() => { setMenu(null); editNode(ctxNode.uid); }}>
                  <Pencil size={15} /> <span className="grow">Open in the editor</span>
                </button>
              </div>
            )}
            {view !== "list" && <Legend />}
          </div>
        </Card>
        <Card key="side" className="nr-side" bodyClassName="nr-side-card" flush tut="rn-side">
          <RunnerSide
            tab={tab}
            setTab={setTab}
            index={index}
            selectedUid={selectedUid}
            onFocus={(uid) => focusNode(uid)}
            onBreak={setBreak}
            onEdit={editNode}
          />
        </Card>
      </Split>
      {check.result && (
        <ValidationPopup
          title="Program check"
          result={check.result}
          issues={check.issues}
          pos={check.pos}
          onPos={check.setPos}
          where={issueWhere}
          onShow={showIssue}
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

/**
 * Runner nodes of a validation issue: its child-index paths in the running
 * tree (backend btIssues.js), each checked against the node's name so an
 * older loaded tree is not marked wrongly; by name when no path fits.
 */
function issueUids(index, issue) {
  const out = [];
  const fits = (n) => !issue.name || n.name === issue.name || n.type === issue.name;
  for (const p of issue.paths || []) {
    let uid = index.root?.uid;
    for (const seg of p === "" ? [] : p.split(".")) {
      uid = (index.children.get(uid) || [])[Number(seg)];
      if (!uid) break;
    }
    const n = uid && index.byUid.get(uid);
    if (n && fits(n)) out.push(uid);
  }
  if (!out.length && issue.name && issue.type !== "BehaviorTree") {
    for (const n of index.nodes) if (n.name === issue.name && (!issue.type || n.type === issue.type)) out.push(n.uid);
  }
  return out;
}

function Legend() {
  return (
    <div className="nr-legend" aria-label="Colours" data-tut="rn-legend">
      {["R", "S", "F", "s", "f"].map((c) => (
        <span key={c} className="nr-legend-item">
          <span className={cx("nr-swatch", `sw-${c === c.toUpperCase() ? c : `was-${c}`}`)} />
          {c === "s" ? "done this cycle" : c === "f" ? "failed this cycle" : STATUS_LABEL[c]}
        </span>
      ))}
    </div>
  );
}
