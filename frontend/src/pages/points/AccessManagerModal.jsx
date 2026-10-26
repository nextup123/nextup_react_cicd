import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, ArrowRight, Lock, LockOpen } from "lucide-react";
import { Badge, Button, Checkbox, EmptyState, IconButton, Modal, SearchInput, cx } from "../../components/ui";
import { errorMessage } from "../../lib/api";
import { toast } from "../../store/toast";
import { isEditable, pointsApi, refreshPoints } from "./pointsApi";

function Column({ type, points, filter, setFilter, selected, toggle, selectAll, selectNone, onDropPoint, dragSrc, setDragSrc }) {
  const [over, setOver] = useState(false);
  const shown = points.filter((p) => {
    const f = filter.toLowerCase();
    return p.name.toLowerCase().includes(f) || (p.nature || "").toLowerCase().includes(f);
  });
  const isEd = type === "editable";
  return (
    <div className="pp-am-col">
      <div className="pp-am-col-head">
        <span className="row strong">
          {isEd ? <LockOpen size={15} className="text-success" /> : <Lock size={15} className="text-warning" />}
          {isEd ? "Editable" : "Locked"}
          <Badge tone={isEd ? "success" : "warning"}>{points.length}</Badge>
        </span>
        <span className="spacer" />
        <Button size="sm" variant="ghost" onClick={selectAll}>
          All
        </Button>
        <Button size="sm" variant="ghost" onClick={selectNone}>
          None
        </Button>
      </div>
      <SearchInput size="sm" value={filter} onChange={setFilter} placeholder={isEd ? "Filter editable…" : "Filter locked…"} />
      <div
        className={cx("pp-am-zone", over && "is-over")}
        onDragOver={(e) => {
          if (!dragSrc || dragSrc.from === type) return;
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          if (dragSrc && dragSrc.from !== type) onDropPoint(dragSrc.name, type);
          setDragSrc(null);
        }}
      >
        {shown.length === 0 ? (
          <EmptyState compact title={filter ? "No matches" : "Drop points here"} />
        ) : (
          shown.map((p) => (
            <div
              key={p.name}
              className={cx("pp-am-row", selected.has(p.name) && "is-selected")}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.effectAllowed = "move";
                setDragSrc({ name: p.name, from: type });
              }}
              onDragEnd={() => setDragSrc(null)}
            >
              <Checkbox checked={selected.has(p.name)} onChange={() => toggle(p.name)} />
              <span className="strong truncate">{p.name}</span>
              {p.is_tf && <Badge tone="info">TF</Badge>}
              <span className="xs muted truncate grow">{p.nature || ""}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

/** Two-column editor for the is_editable flag of many points at once; changes apply on Save. */
export function AccessManagerModal({ open, onClose, points }) {
  const [working, setWorking] = useState([]);
  const [sel, setSel] = useState({ editable: new Set(), locked: new Set() });
  const [filters, setFilters] = useState({ editable: "", locked: "" });
  const [dragSrc, setDragSrc] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setWorking((points || []).map((p) => ({ ...p, is_editable: isEditable(p) })));
    setSel({ editable: new Set(), locked: new Set() });
    setFilters({ editable: "", locked: "" });
    // Snapshot only when opening, so a background refetch can't wipe unsaved moves.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const editablePts = working.filter((p) => p.is_editable);
  const lockedPts = working.filter((p) => !p.is_editable);

  const changed = useMemo(
    () => working.filter((w) => {
      const orig = (points || []).find((p) => p.name === w.name);
      return orig && isEditable(orig) !== w.is_editable;
    }),
    [working, points]
  );

  const setEditable = (names, editable) =>
    setWorking((ws) => ws.map((w) => (names.includes(w.name) ? { ...w, is_editable: editable } : w)));

  const toggle = (col) => (name) =>
    setSel((s) => {
      const next = new Set(s[col]);
      next.has(name) ? next.delete(name) : next.add(name);
      return { ...s, [col]: next };
    });

  const moveSelected = (to) => {
    const from = to === "locked" ? "editable" : "locked";
    const names = [...sel[from]];
    if (!names.length) return;
    setEditable(names, to === "editable");
    setSel((s) => ({ ...s, [from]: new Set() }));
  };

  const drop = (name, to) => {
    setEditable([name], to === "editable");
    setSel((s) => {
      const from = to === "editable" ? "locked" : "editable";
      const next = new Set(s[from]);
      next.delete(name);
      return { ...s, [from]: next };
    });
  };

  const save = async () => {
    if (!changed.length) return onClose();
    setSaving(true);
    let ok = 0;
    for (const w of changed) {
      try {
        await pointsApi.update(w.name, w);
        ok += 1;
      } catch (err) {
        toast.error(`${w.name}: ${errorMessage(err)}`);
      }
    }
    setSaving(false);
    refreshPoints();
    if (ok) toast.success(`${ok} point${ok > 1 ? "s" : ""} updated`);
    onClose();
  };

  const total = sel.editable.size + sel.locked.size;
  const colProps = (type, list) => ({
    type,
    points: list,
    filter: filters[type],
    setFilter: (v) => setFilters((f) => ({ ...f, [type]: v })),
    selected: sel[type],
    toggle: toggle(type),
    selectAll: () => setSel((s) => ({ ...s, [type]: new Set(list.map((p) => p.name)) })),
    selectNone: () => setSel((s) => ({ ...s, [type]: new Set() })),
    onDropPoint: drop,
    dragSrc,
    setDragSrc,
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="xl"
      title="Manage access"
      description="Locked points cannot be edited or deleted. Drag points between the columns or select them and use the arrows. Changes apply when you save."
      footer={
        <>
          <span className="small muted grow">
            {total ? `${total} selected` : changed.length ? `${changed.length} unsaved change${changed.length > 1 ? "s" : ""}` : "Select points to move, or drag them"}
          </span>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={saving} onClick={save}>
            Save changes
          </Button>
        </>
      }
    >
      <div className="pp-am">
        <Column {...colProps("editable", editablePts)} />
        <div className="pp-am-arrows">
          <IconButton icon={ArrowRight} label="Lock selected" variant="default" disabled={!sel.editable.size} onClick={() => moveSelected("locked")} />
          <IconButton icon={ArrowLeft} label="Unlock selected" variant="default" disabled={!sel.locked.size} onClick={() => moveSelected("editable")} />
        </div>
        <Column {...colProps("locked", lockedPts)} />
      </div>
    </Modal>
  );
}
