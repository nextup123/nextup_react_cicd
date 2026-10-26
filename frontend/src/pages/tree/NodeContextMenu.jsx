// Right-click menu for a node (tree and ladder views).
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ArrowLeft,
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  ClipboardPaste,
  Copy,
  CopyPlus,
  CornerDownRight,
  Crosshair,
  OctagonPause,
  PackageOpen,
  PackagePlus,
  Scissors,
  Search,
  Trash2,
} from "lucide-react";
import { cx } from "../../components/ui";
import { useClipboard, useQuickAdd } from "./shortcuts";
import { useInputMode } from "./touch";
import { WRAPPER_CHOICES, capabilities, childSlotProblem, colorOf, isWrapperType } from "./treeModel";

export default function NodeContextMenu({ menu, tree, lib, actions, onClose, collapsed, onToggle, onSubtreeFold, onCenter, breakName, onBreakAt }) {
  const clip = useClipboard((s) => s.clip);
  const touch = useInputMode((s) => s.mode === "touch");
  const quickItems = useQuickAdd((s) => s.items);
  const node = menu ? tree?.byKey.get(menu.key) : null;
  const [mode, setMode] = useState("main"); // main | child | after | wrap
  const [q, setQ] = useState("");
  const [pos, setPos] = useState(null);
  const ref = useRef(null);

  useLayoutEffect(() => {
    setMode(menu?.mode || "main");
    setQ("");
  }, [menu]);

  useEffect(() => {
    if (!menu) return;
    const close = (e) => !ref.current?.contains(e.target) && onClose();
    const key = (e) => e.key === "Escape" && (e.stopPropagation(), onClose());
    // Close when the window is resized, but not when a tablet's on-screen
    // keyboard only changes its height (typing in the search field).
    let width = window.innerWidth;
    const resize = () => window.innerWidth !== width && onClose();
    document.addEventListener("pointerdown", close);
    window.addEventListener("keydown", key, true);
    window.addEventListener("resize", resize);
    return () => {
      document.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", key, true);
      window.removeEventListener("resize", resize);
    };
  }, [menu, onClose]);

  // Keep the menu inside the window.
  useLayoutEffect(() => {
    if (!menu || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    const x = Math.min(menu.x, window.innerWidth - r.width - 8);
    // Opened from the touch action bar: sit above the button that opened it.
    const y = menu.above ? menu.y - r.height - 8 : Math.min(menu.y, window.innerHeight - r.height - 8);
    setPos({ x: Math.max(8, x), y: Math.max(8, y) });
  }, [menu, mode]);

  const caps = useMemo(() => capabilities(tree, node, lib), [tree, node, lib]);
  const groups = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (lib?.categories || [])
      .map((c) => ({ ...c, nodes: c.nodes.filter((n) => !s || n.name.toLowerCase().includes(s) || c.label.toLowerCase().includes(s)) }))
      .filter((c) => c.nodes.length);
  }, [lib, q]);

  if (!menu || !node) return null;
  const noClip = { reason: "Nothing copied yet: use Copy (Ctrl+C) on a node first" };
  const pasteIn = !clip ? noClip : isWrapperType(node.type, lib) && !childSlotProblem(node, lib) ? { ok: true } : { reason: childSlotProblem(node, lib) };
  const pasteAfter = !clip ? noClip : caps.addAfter;
  const hasKids = node.children.length > 0;
  const isClosed = !!collapsed?.has(node.key);
  const run = (fn) => () => {
    onClose();
    fn();
  };
  const Item = ({ icon: Icon, label, cap, onClick, danger, sub, hint, tut }) => (
    <button
      type="button"
      data-tut={tut}
      className={cx("menu-item", danger && "is-danger")}
      disabled={cap && !cap.ok}
      title={cap && !cap.ok ? cap.reason : undefined}
      onClick={onClick}
    >
      {Icon && <Icon size={15} />}
      <span className="grow">{label}</span>
      {hint && <span className="xs muted bt-ctx-hint">{hint}</span>}
      {sub && <ChevronRight size={14} className="muted" />}
    </button>
  );

  return createPortal(
    <div
      ref={ref}
      data-tut="ctx-menu"
      className={cx("menu", "bt-ctx", mode !== "main" && mode !== "wrap" && "is-picker", touch && "is-touch")}
      style={{ position: "fixed", left: (pos || menu).x, top: (pos || menu).y, visibility: pos ? "visible" : "hidden" }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="bt-ctx-head">
        <span className="bt-swatch" style={{ background: colorOf(node.type, lib) }} />
        <span className="truncate">{node.name}</span>
      </div>
      {mode === "main" && (
        <>
          <Item tut="ctx-add-inside" icon={CornerDownRight} label="Add inside…" cap={caps.addChild} sub onClick={() => setMode("child")} />
          <Item tut="ctx-add-after" icon={ArrowRight} label="Add after…" cap={caps.addAfter} sub onClick={() => setMode("after")} />
          <Item tut="ctx-wrap" icon={PackagePlus} label="Wrap in…" cap={caps.wrap} sub onClick={() => setMode("wrap")} />
          <div className="menu-sep" />
          <Item tut="ctx-copy" icon={Copy} label="Copy" hint="Ctrl+C" cap={caps.copy} onClick={run(() => actions.copyToClipboard(node))} />
          <Item tut="ctx-cut" icon={Scissors} label="Cut" hint="Ctrl+X" cap={caps.del} onClick={run(() => actions.cutNode(node))} />
          <Item tut="ctx-paste-inside" icon={ClipboardPaste} label={clip ? `Paste "${clip.name}" inside` : "Paste inside"} hint="Ctrl+V" cap={pasteIn} onClick={run(() => actions.paste(node, "child"))} />
          <Item tut="ctx-paste-after" icon={ClipboardPaste} label="Paste after" hint="Ctrl+Shift+V" cap={pasteAfter} onClick={run(() => actions.paste(node, "after"))} />
          <Item tut="ctx-duplicate" icon={CopyPlus} label="Duplicate" hint="Ctrl+D" cap={caps.copy} onClick={run(() => actions.copyNode(node))} />
          <div className="menu-sep" />
          {hasKids && (
            <Item icon={isClosed ? ChevronsUpDown : ChevronsDownUp} label={isClosed ? "Expand" : "Collapse"} hint="Space" onClick={run(() => onToggle(node.key))} />
          )}
          {hasKids && <Item icon={ChevronsUpDown} label="Expand everything inside" onClick={run(() => onSubtreeFold(node, false))} />}
          {hasKids && <Item icon={ChevronsDownUp} label="Collapse everything inside" onClick={run(() => onSubtreeFold(node, true))} />}
          {onCenter && <Item icon={Crosshair} label="Centre in view" hint="C" onClick={run(() => onCenter(node.key))} />}
          {onBreakAt && (
            <Item
              icon={OctagonPause}
              label={breakName === node.name ? "Clear breakpoint" : "Pause the program before this node"}
              onClick={run(() => onBreakAt(breakName === node.name ? "" : node.name))}
            />
          )}
          <Item tut="ctx-move-left" icon={ArrowLeft} label="Move left" hint="Ctrl+←" cap={caps.moveLeft} onClick={run(() => actions.moveBy(node, -1))} />
          <Item tut="ctx-move-right" icon={ArrowRight} label="Move right" hint="Ctrl+→" cap={caps.moveRight} onClick={run(() => actions.moveBy(node, 1))} />
          <div className="menu-sep" />
          <Item tut="ctx-unwrap" icon={PackageOpen} label="Remove container only" cap={caps.delWrapper} danger onClick={run(() => actions.deleteWrapperOnly(node))} />
          <Item tut="ctx-delete" icon={Trash2} label="Delete" hint="Del" cap={caps.del} danger onClick={run(() => actions.deleteNode(node))} />
        </>
      )}
      {mode === "wrap" && (
        <>
          <Item icon={ChevronLeft} label="Back" onClick={() => setMode("main")} />
          <div className="menu-sep" />
          {WRAPPER_CHOICES.map((w) => (
            <Item key={w} tut={`ctx-wrap-${w}`} icon={PackagePlus} label={w} onClick={run(() => actions.addWrapper(node, w))} />
          ))}
        </>
      )}
      {(mode === "child" || mode === "after") && (
        <>
          <div className="bt-ctx-search" data-tut="ctx-search">
            <button type="button" className="bt-ctx-back" onClick={() => setMode("main")} aria-label="Back" title="Back">
              <ChevronLeft size={16} />
            </button>
            <Search size={14} className="muted" />
            <input
              autoFocus={!touch}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={mode === "child" ? "Add inside: search node type" : "Add after: search node type"}
              onKeyDown={(e) => {
                if (e.key === "Enter" && groups[0]?.nodes[0]) {
                  const n = groups[0].nodes[0];
                  onClose();
                  actions.quickAdd(mode, node, n.name);
                }
              }}
            />
          </div>
          <div className="bt-ctx-list">
            {touch && !q && quickItems.length > 0 && (
              <div className="bt-ctx-quick">
                {quickItems.map((it) => (
                  <button key={it.nodeName} type="button" className="bt-ctx-chip" onClick={run(() => actions.quickAdd(mode, node, it.nodeName))}>
                    <span className="bt-swatch" style={{ background: colorOf(it.nodeName, lib) }} />
                    {it.label}
                  </button>
                ))}
              </div>
            )}
            {groups.length === 0 && <div className="small muted" style={{ padding: 10 }}>No matching node types</div>}
            {groups.map((c) => (
              <div key={c.key}>
                <div className="bt-ctx-group">{c.label}</div>
                {c.nodes.map((n) => (
                  <button
                    key={`${n.group}:${n.name}`}
                    type="button"
                    data-tut={`ctx-type-${n.name}`}
                    className="menu-item"
                    onClick={run(() => actions.quickAdd(mode, node, n.name))}
                  >
                    <span className="bt-swatch" style={{ background: colorOf(n.name, lib) }} />
                    <span className="grow">{n.name}</span>
                    <span className="xs muted">{n.group}</span>
                  </button>
                ))}
              </div>
            ))}
          </div>
        </>
      )}
    </div>,
    document.body
  );
}
