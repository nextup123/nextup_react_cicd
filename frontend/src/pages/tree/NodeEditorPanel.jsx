// Floating node editor: the settings of the selected node, docked at the
// top-right corner of the tree view. Drag it by its header, close it with ×;
// clicking a node brings it back, docked again.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, ChevronDown, ChevronUp, Copy, CopyPlus, GripVertical, Pin, Save, Trash2, Undo2, X } from "lucide-react";
import { Badge, Button, IconButton, cx } from "../../components/ui";
import AttrField from "./AttrField";
import { KINDS, RUN_PROGRAM, RUN_PROGRAM_ATTRS, capabilities, colorOf, colourGroupOf, defaultAttributes, kindOf, shapePath, visibleAttrs } from "./treeModel";

const why = (cap) => (cap.ok ? undefined : cap.reason);
const MARGIN = 12;

export default function NodeEditorPanel({ tree, node, lib, actions, onClose, onSelect, focusToken }) {
  const caps = useMemo(() => capabilities(tree, node, lib), [tree, node, lib]);
  const ref = useRef(null);
  const [pos, setPos] = useState(null); // null = docked top-right
  const [min, setMin] = useState(false);

  // Keep a dragged panel inside the tree view when the view shrinks.
  useLayoutEffect(() => {
    if (!pos) return;
    const host = ref.current?.offsetParent;
    if (!host || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => setPos((p) => (p ? clamp(p, ref.current, host) : p)));
    ro.observe(host);
    return () => ro.disconnect();
  }, [pos == null]); // eslint-disable-line react-hooks/exhaustive-deps

  const startDrag = (e) => {
    if (e.button !== 0 || e.target.closest("button")) return;
    const el = ref.current;
    const host = el?.offsetParent;
    if (!el || !host) return;
    e.preventDefault();
    const r = el.getBoundingClientRect();
    const dx = e.clientX - r.left;
    const dy = e.clientY - r.top;
    const move = (ev) => {
      const h = host.getBoundingClientRect();
      setPos(clamp({ x: ev.clientX - h.left - dx, y: ev.clientY - h.top - dy }, el, host));
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      document.body.classList.remove("is-dragging-panel");
    };
    document.body.classList.add("is-dragging-panel");
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  if (!node) return null;
  const kind = kindOf(node.type, lib);
  const group = colourGroupOf(node.type, lib);
  const parent = node.parentKey ? tree.byKey.get(node.parentKey) : null;
  const shape = node.depth === 0 ? "root" : KINDS[kind].shape;

  return (
    <div
      ref={ref}
      data-tut="bt-editor"
      className={cx("bt-editor", pos && "is-moved", min && "is-min")}
      style={pos ? { left: pos.x, top: pos.y, right: "auto" } : undefined}
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.stopPropagation()}
      role="dialog"
      aria-label={`Edit ${node.name}`}
    >
      <div className="bt-editor-head" onPointerDown={startDrag} onDoubleClick={(e) => !e.target.closest("button") && setPos(null)} title="Drag to move · double-click to dock">
        <GripVertical size={14} className="bt-editor-grip" />
        <svg width="18" height="18" viewBox="-12 -12 24 24" className="bt-editor-shape" aria-hidden>
          <path d={shapePath(shape, 8)} fill={colorOf(node.type, lib)} />
        </svg>
        <div className="bt-editor-title">
          <strong className="truncate" title={node.name}>{node.name}</strong>
          <span className="xs muted truncate">
            {KINDS[kind].label} ·{" "}
            {parent ? (
              <>
                inside{" "}
                <button type="button" className="bt-crumb" onClick={() => onSelect(parent.key)} title="Select the parent (Shift+↑)">
                  {parent.name}
                </button>
              </>
            ) : (
              "Tree root"
            )}
          </span>
        </div>
        {pos && <IconButton icon={Pin} size="sm" label="Dock to the top-right corner" onClick={() => setPos(null)} />}
        <IconButton icon={min ? ChevronDown : ChevronUp} size="sm" label={min ? "Show settings" : "Fold to the title"} onClick={() => setMin((m) => !m)} />
        <IconButton icon={X} size="sm" label="Close (click a node to open again)" onClick={onClose} />
      </div>
      {!min && (
        <>
          <div className="bt-editor-tools">
            <Badge title={`${group.label} · ${KINDS[kind].hint}`}>
              <span className="bt-swatch" style={{ background: group.color }} />
              {node.type}
            </Badge>
            {node.children.length > 0 && <Badge>{node.children.length} inside</Badge>}
            <span className="grow" />
            <IconButton icon={ArrowLeft} label={why(caps.moveLeft) || "Move left (Ctrl+←)"} size="sm" disabled={!caps.moveLeft.ok} onClick={() => actions.moveBy(node, -1)} />
            <IconButton icon={ArrowRight} label={why(caps.moveRight) || "Move right (Ctrl+→)"} size="sm" disabled={!caps.moveRight.ok} onClick={() => actions.moveBy(node, 1)} />
            <IconButton icon={Copy} label={why(caps.copy) || "Copy (Ctrl+C)"} size="sm" disabled={!caps.copy.ok} onClick={() => actions.copyToClipboard(node)} />
            <IconButton icon={CopyPlus} label={why(caps.copy) || "Duplicate (Ctrl+D)"} size="sm" disabled={!caps.copy.ok} onClick={() => actions.copyNode(node)} />
            <IconButton icon={Trash2} variant="ghost-danger" label={why(caps.del) || "Delete node (Del)"} size="sm" disabled={!caps.del.ok} onClick={() => actions.deleteNode(node)} />
          </div>
          <div className="bt-editor-body">
            <NodeEditor key={node.key + "|" + JSON.stringify(node.attributes)} node={node} lib={lib} actions={actions} focusToken={focusToken} />
          </div>
        </>
      )}
    </div>
  );
}

const portHint = (type, k) => (type === RUN_PROGRAM ? RUN_PROGRAM_ATTRS[k]?.hint : undefined);

function clamp(p, el, host) {
  const maxX = Math.max(MARGIN, host.clientWidth - (el?.offsetWidth || 320) - MARGIN);
  const maxY = Math.max(MARGIN, host.clientHeight - 48);
  return { x: Math.min(Math.max(MARGIN, p.x), maxX), y: Math.min(Math.max(MARGIN, p.y), maxY) };
}

function NodeEditor({ node, lib, actions, focusToken }) {
  const formRef = useRef(null);
  useEffect(() => {
    if (!focusToken) return;
    const el = formRef.current?.querySelector("input:not([readonly]), select");
    el?.focus();
    el?.select?.();
  }, [focusToken]);
  const isRoot = node.type === "BehaviorTree";
  const libDefaults = useMemo(() => defaultAttributes(lib?.byName.get(node.type)), [lib, node.type]);
  const initial = useMemo(() => {
    const v = {};
    visibleAttrs(node.attributes).forEach(([k, val]) => (v[k] = String(val ?? "")));
    return v;
  }, [node.attributes]);
  // Attributes the node type defines but this node does not have yet.
  const missing = Object.keys(libDefaults).filter((k) => !(k in initial));
  const [vals, setVals] = useState(() => ({ ...initial, ...Object.fromEntries(missing.map((k) => [k, ""])) }));
  const [saving, setSaving] = useState(false);

  const existingKeys = Object.keys(initial);
  const dirty =
    existingKeys.some((k) => vals[k] !== initial[k]) || missing.some((k) => (vals[k] || "").trim() !== "");
  const set = (k) => (v) => setVals((s) => ({ ...s, [k]: v }));

  const save = async (e) => {
    e.preventDefault();
    if (!dirty || isRoot) return;
    const out = {};
    existingKeys.forEach((k) => (out[k] = vals[k]));
    missing.forEach((k) => (vals[k] || "").trim() !== "" && (out[k] = vals[k].trim()));
    setSaving(true);
    await actions.updateNode(node, out);
    setSaving(false);
  };

  const order = (k) => (k === "name" ? 0 : k === "ID" ? 1 : 2);
  const keys = [...existingKeys].sort((a, b) => order(a) - order(b));

  return (
    <form className="bt-form" onSubmit={save} ref={formRef}>
      <div className="section-label">Settings</div>
      {keys.map((k) => (
        <AttrField
          key={k}
          name={k}
          value={vals[k] ?? ""}
          defaultValue={libDefaults[k]}
          onChange={set(k)}
          readOnly={isRoot}
          hint={
            isRoot && k === "ID"
              ? "Subtree name. Subtrees cannot be renamed here."
              : k === "ID" && node.type === "SubTreePlus"
                ? "Name of the linked subtree"
                : k === "ID"
                  ? "Internal identifier, normally left as is"
                  : portHint(node.type, k)
          }
        />
      ))}
      {missing.length > 0 && (
        <>
          <div className="section-label" style={{ marginTop: 4 }}>
            Not set yet
          </div>
          {missing.map((k) => (
            <AttrField key={k} name={k} value={vals[k] ?? ""} defaultValue={libDefaults[k]} onChange={set(k)} hint={portHint(node.type, k)} />
          ))}
        </>
      )}
      {keys.length === 0 && missing.length === 0 && <div className="small muted">This node has no settings.</div>}
      {!isRoot && (
        <div className="bt-form-actions">
          <Button size="sm" icon={Undo2} variant="ghost" disabled={!dirty || saving} onClick={() => setVals({ ...initial, ...Object.fromEntries(missing.map((k) => [k, ""])) })}>
            Reset
          </Button>
          <Button data-tut="bt-editor-save" size="sm" type="submit" variant="primary" icon={Save} loading={saving} disabled={!dirty} title={dirty ? undefined : "Nothing changed yet"}>
            Save changes
          </Button>
        </div>
      )}
    </form>
  );
}

