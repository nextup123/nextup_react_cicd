// Touch only: a row of finger-sized buttons for the selected node, docked at
// the bottom of the tree view. Every keyboard shortcut has a button here, so
// a tablet or teach pendant never needs a keyboard. Disabled actions stay
// tappable and say why (there is no hover tooltip on a touch screen).
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ChevronsDownUp,
  ChevronsUpDown,
  ClipboardPaste,
  Copy,
  CopyPlus,
  CornerDownRight,
  Ellipsis,
  ListPlus,
  Pencil,
  Scissors,
  Trash2,
  X,
} from "lucide-react";
import { useMemo } from "react";
import { cx } from "../../components/ui";
import { toast } from "../../store/toast";
import { useClipboard } from "./shortcuts";
import { capabilities, colorOf } from "./treeModel";

export default function TouchActionBar({ tree, node, lib, actions, view, collapsed, onToggle, onMenu, onEdit, onClear }) {
  const clip = useClipboard((s) => s.clip);
  const caps = useMemo(() => capabilities(tree, node, lib), [tree, node, lib]);
  if (!node) return null;
  const hasKids = node.children.length > 0;
  const isClosed = collapsed.has(node.key);
  const ladder = view === "ladder";
  const noClip = { reason: "Nothing copied yet: tap Copy or Cut on a node first" };
  const menuAt = (mode) => (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    onMenu(mode, r.left, r.top);
  };

  const items = [
    { icon: CornerDownRight, label: "Add inside", cap: caps.addChild, onClick: menuAt("child") },
    { icon: ListPlus, label: "Add after", cap: caps.addAfter, onClick: menuAt("after") },
    "sep",
    { icon: Copy, label: "Copy", cap: caps.copy, onClick: () => actions.copyToClipboard(node) },
    { icon: Scissors, label: "Cut", cap: caps.del, onClick: () => actions.cutNode(node) },
    { icon: ClipboardPaste, label: "Paste", cap: clip ? { ok: true } : noClip, onClick: () => actions.paste(node), hot: !!clip },
    { icon: CopyPlus, label: "Duplicate", cap: caps.copy, onClick: () => actions.copyNode(node) },
    "sep",
    { icon: ladder ? ArrowUp : ArrowLeft, label: ladder ? "Move up" : "Move left", cap: caps.moveLeft, onClick: () => actions.moveBy(node, -1) },
    { icon: ladder ? ArrowDown : ArrowRight, label: ladder ? "Move down" : "Move right", cap: caps.moveRight, onClick: () => actions.moveBy(node, 1) },
    "sep",
    hasKids && { icon: isClosed ? ChevronsUpDown : ChevronsDownUp, label: isClosed ? "Expand" : "Collapse", onClick: () => onToggle(node.key) },
    { icon: Pencil, label: "Edit", onClick: onEdit },
    { icon: Ellipsis, label: "More", onClick: menuAt("main") },
    { icon: Trash2, label: "Delete", cap: caps.del, onClick: () => actions.deleteNode(node), danger: true },
  ].filter(Boolean);

  return (
    <div className="bt-touchbar" role="toolbar" aria-label={`Actions for ${node.name}`} onClick={(e) => e.stopPropagation()}>
      <div className="bt-touchbar-node">
        <span className="bt-swatch" style={{ background: colorOf(node.type, lib) }} />
        <span className="truncate">{node.name}</span>
        <button type="button" className="bt-touchbar-x" onClick={onClear} aria-label="Clear the selection">
          <X size={16} />
        </button>
      </div>
      <div className="bt-touchbar-row">
        {items.map((it, i) =>
          it === "sep" ? (
            <span key={`s${i}`} className="bt-touchbar-sep" />
          ) : (
            <button
              key={it.label}
              type="button"
              className={cx("bt-touchbtn", it.danger && "is-danger", it.hot && "is-hot", it.cap && !it.cap.ok && "is-off")}
              aria-disabled={it.cap && !it.cap.ok ? true : undefined}
              onClick={(e) => (it.cap && !it.cap.ok ? toast.info(it.cap.reason, { duration: 2200 }) : it.onClick(e))}
            >
              <it.icon size={20} />
              <span>{it.label}</span>
            </button>
          )
        )}
      </div>
    </div>
  );
}
