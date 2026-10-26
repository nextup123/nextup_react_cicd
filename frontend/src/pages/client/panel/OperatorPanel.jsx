// The operator panel under the control deck: a 12-column grid of widgets the integrator builds
// for the cell (Edit). In edit mode widgets drag by their body, resize by the corner handle and
// snap to the grid; whatever they cover moves down, gaps close upwards. Auto-arrange packs them
// in reading order. The panel belongs to the project (saved and versioned with it).
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  Check, Copy, Gauge, Hash, Heading, LayoutGrid, ListChecks, Lightbulb, Pencil, Plus, RotateCcw, SlidersHorizontal, SquareMousePointer, TextCursorInput, ToggleRight, Type, ChevronDownSquare, Wand2,
} from "lucide-react";
import { Button, Modal, cx } from "../../../components/ui";
import { confirm } from "../../../store/confirm";
import { useActiveProject } from "../../../lib/queries";
import { usePlcWatch } from "../../nextplc/store/plc";
import { COLS, GAP, ROW_H, WIDGETS, autoArrange, clampItem, freeSpot, newId, placeItem, usePanel } from "./panelModel";
import { watchTopics } from "./bindings";
import WidgetView from "./WidgetView";
import WidgetEditor from "./WidgetEditor";
import "./panel.css";

const ICONS = {
  button: SquareMousePointer, toggle: ToggleRight, indicator: Lightbulb, radio: ListChecks, dropdown: ChevronDownSquare,
  number: Hash, slider: SlidersHorizontal, text: TextCursorInput, display: Gauge, group: LayoutGrid, label: Heading,
};
const MOBILE_W = 640;

/** Keeps the PLC image coming only while a widget shows a PLC value (CPU). */
function PlcWatch() {
  usePlcWatch();
  return null;
}

function useWidth(ref) {
  const [w, setW] = useState(0);
  useLayoutEffect(() => {
    if (!ref.current) return undefined;
    const ro = new ResizeObserver(([e]) => setW(e.contentRect.width));
    ro.observe(ref.current);
    setW(ref.current.getBoundingClientRect().width);
    return () => ro.disconnect();
  }, [ref]);
  return w;
}

function Palette({ onPick, onClose }) {
  return (
    <Modal open size="lg" onClose={onClose} title="Add to the panel" description="Pick what to add; you choose what it is wired to next.">
      <div className="op-palette">
        {Object.entries(WIDGETS).map(([type, d]) => {
          const Icon = ICONS[type] || Type;
          return (
            <button key={type} type="button" className="op-pal-item" onClick={() => onPick(type)}>
              <span className="op-pal-icon"><Icon size={20} /></span>
              <b>{d.label}</b>
              <span className="xs muted">{d.hint}</span>
            </button>
          );
        })}
      </div>
    </Modal>
  );
}

export default function OperatorPanel() {
  const { layout, loaded, editing, custom, load, update, setEditing, resetToDefault, save } = usePanel();
  const gridRef = useRef(null);
  const width = useWidth(gridRef);
  const [palette, setPalette] = useState(false);
  const [edit, setEdit] = useState(null); // widget being edited (or a new one: isNew)
  const [drag, setDrag] = useState(null); // { id, mode, start, orig, cur }

  const project = useActiveProject().data?.active_project;
  useEffect(() => { load(); }, [load, project]); // each project has its own panel
  useEffect(() => () => { if (usePanel.getState().editing) setEditing(false); }, [setEditing]);

  const widgets = layout?.widgets || [];
  const mobile = width > 0 && width < MOBILE_W;
  const colW = width > 0 ? (width - GAP * (COLS - 1)) / COLS : 0;

  // what the panel needs live: PLC image, topics
  const needsPlc = useMemo(() => widgets.some((w) => w.binding?.kind === "plc" || (w.binding?.items || []).some((i) => i.binding?.kind === "plc")), [widgets]);
  const topicKey = useMemo(() => {
    const list = [];
    const add = (b) => b?.kind === "topic" && b.name && list.push({ name: b.name.startsWith("/") ? b.name : `/${b.name}`, type: b.type || "string" });
    widgets.forEach((w) => { add(w.binding); (w.binding?.items || []).forEach((i) => add(i.binding)); });
    return JSON.stringify(list);
  }, [widgets]);
  useEffect(() => {
    watchTopics(JSON.parse(topicKey));
    return () => watchTopics([]);
  }, [topicKey]);

  // drag / resize preview: the moved widget follows the pointer, the rest reflows live
  const shown = useMemo(() => {
    if (!drag?.cur) return widgets;
    return placeItem(widgets, drag.cur);
  }, [widgets, drag]);

  const onPointerDown = (e, w, mode) => {
    if (!editing || mobile || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    setDrag({ id: w.id, mode, sx: e.clientX, sy: e.clientY, orig: w, cur: w });
  };
  const onPointerMove = (e) => {
    if (!drag) return;
    const dx = (e.clientX - drag.sx) / (colW + GAP);
    const dy = (e.clientY - drag.sy) / (ROW_H + GAP);
    const o = drag.orig;
    const cur = drag.mode === "move" ? clampItem({ ...o, x: o.x + Math.round(dx), y: o.y + Math.round(dy) }) : clampItem({ ...o, w: o.w + Math.round(dx), h: o.h + Math.round(dy) });
    if (cur.x !== drag.cur.x || cur.y !== drag.cur.y || cur.w !== drag.cur.w || cur.h !== drag.cur.h) setDrag({ ...drag, cur });
  };
  const onPointerUp = () => {
    if (!drag) return;
    const { cur, orig } = drag;
    setDrag(null);
    if (cur.x !== orig.x || cur.y !== orig.y || cur.w !== orig.w || cur.h !== orig.h) update((list) => placeItem(list, cur));
  };

  const addWidget = (type) => {
    setPalette(false);
    const d = WIDGETS[type];
    const spot = freeSpot(widgets, d.w, d.h);
    const w = { id: newId(), type, x: spot.x, y: spot.y, w: d.w, h: d.h, label: "", color: "auto", binding: type === "group" ? { kind: "group", source: "custom", dir: "di", items: [] } : {} };
    setEdit({ ...w, isNew: true });
  };
  const saveWidget = (w) => {
    const { isNew, ...clean } = w;
    update((list) => placeItem(isNew ? [...list, clean] : list.map((x) => (x.id === clean.id ? clean : x)), clean));
    setEdit(null);
  };
  const duplicate = (w) => {
    const spot = freeSpot(widgets, w.w, w.h);
    const copy = { ...w, id: newId(), x: spot.x, y: spot.y, label: w.label ? `${w.label} (copy)` : "" };
    update((list) => [...list, copy]);
  };
  const remove = (id) => update((list) => list.filter((x) => x.id !== id));
  const arrange = () => update((list) => autoArrange(list));
  const reset = async () => {
    if (await confirm({ title: "Back to the default panel?", message: "Every widget of this project's panel is removed and the default panel (run mode, CNC, reset, stop motion, inputs, outputs) comes back.", tone: "danger", confirmLabel: "Reset panel" })) resetToDefault();
  };
  const done = () => { setEditing(false); save(); };

  const rows = shown.reduce((m, w) => Math.max(m, w.y + w.h), 0);
  const height = Math.max(rows, editing ? rows + 2 : 1) * (ROW_H + GAP) - GAP;

  return (
    <section className={cx("op-panel", editing && "is-editing")} data-tut="cc-panel">
      {needsPlc && <PlcWatch />}
      <header className="op-bar">
        <div className="col" style={{ gap: 0, minWidth: 0 }}>
          <span className="op-bar-title">Operator panel</span>
          <span className="xs muted truncate">{editing ? "Drag to move, drag the corner to resize. Changes are saved with this project." : custom ? "This project's controls" : "Default controls: press Edit to build this project's panel"}</span>
        </div>
        <span className="grow" />
        {editing ? (
          <>
            <Button size="sm" icon={Plus} variant="primary" onClick={() => setPalette(true)} data-tut="cc-panel-add">Add</Button>
            <Button size="sm" icon={Wand2} onClick={arrange} title="Pack the widgets row by row in reading order, edges aligned">Auto-arrange</Button>
            <Button size="sm" icon={RotateCcw} variant="ghost" onClick={reset} title="Remove this project's panel and show the default one">Default</Button>
            <Button size="sm" icon={Check} variant="success" onClick={done}>Done</Button>
          </>
        ) : (
          <Button size="sm" icon={Pencil} onClick={() => setEditing(true)} data-tut="cc-panel-edit" title="Add, move, resize and wire widgets">Edit</Button>
        )}
      </header>

      <div
        ref={gridRef}
        className={cx("op-grid", mobile && "is-mobile")}
        style={mobile ? undefined : { height: loaded ? height : 120 }}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        {editing && !mobile && colW > 0 && (
          <div className="op-cells" aria-hidden style={{ backgroundSize: `${colW + GAP}px ${ROW_H + GAP}px` }} />
        )}
        {colW > 0 && shown.map((w) => {
          const moving = drag?.id === w.id;
          const style = mobile
            ? { minHeight: w.h * ROW_H + (w.h - 1) * GAP }
            : { left: w.x * (colW + GAP), top: w.y * (ROW_H + GAP), width: w.w * colW + (w.w - 1) * GAP, height: w.h * ROW_H + (w.h - 1) * GAP };
          return (
            <div
              key={w.id}
              className={cx("op-w", `op-t-${w.type}`, `op-c-${w.color || "auto"}`, moving && "is-moving", w.h === 1 && "is-row")}
              style={style}
              data-tut={w.id === "def-runmode" ? "cc-runmode" : w.id === "def-cnc" ? "cc-cnc" : w.id === "def-inputs" ? "cc-inputs" : w.id === "def-outputs" ? "cc-outputs" : undefined}
              onPointerDown={(e) => onPointerDown(e, w, "move")}
              onDoubleClick={() => editing && setEdit(w)}
            >
              <div className="op-body"><WidgetView w={w} /></div>
              {editing && (
                <>
                  <div className="op-tools" onPointerDown={(e) => e.stopPropagation()}>
                    <button type="button" title="Settings" onClick={() => setEdit(w)}><Pencil size={13} /></button>
                    <button type="button" title="Duplicate" onClick={() => duplicate(w)}><Copy size={13} /></button>
                  </div>
                  {!mobile && <div className="op-resize" title="Drag to resize" onPointerDown={(e) => onPointerDown(e, w, "resize")} />}
                </>
              )}
            </div>
          );
        })}
        {loaded && !widgets.length && (
          <div className="op-empty-panel">
            <b>The panel is empty</b>
            <span className="small muted">Press Edit, then Add to put buttons, lamps, switches and values here.</span>
          </div>
        )}
      </div>

      {palette && <Palette onPick={addWidget} onClose={() => setPalette(false)} />}
      {edit && <WidgetEditor widget={edit} onClose={() => setEdit(null)} onSave={saveWidget} onDelete={edit.isNew ? null : () => { remove(edit.id); setEdit(null); }} />}
    </section>
  );
}
