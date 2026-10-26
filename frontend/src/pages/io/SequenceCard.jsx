import { useState } from "react";
import {
  ArrowDownUp,
  ChevronDown,
  Code2,
  GripVertical,
  ListOrdered,
  MoreHorizontal,
  Pencil,
  Pin,
  PinOff,
  Plus,
  RefreshCw,
  Trash2,
  Undo2,
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { Alert, Badge, Button, Card, EmptyState, IconButton, Loading, Menu, cx } from "../../components/ui";
import { errorMessage } from "../../lib/api";
import { confirm } from "../../store/confirm";
import { toast } from "../../store/toast";
import { ioAction, ioKeys, isGpio, isOutput, sortSequences, useCanUndo, useSequences } from "./ioApi";
import { IoLiveControl } from "./IoLiveControl";
import { togglePin, unpinControl, useFloating } from "../../store/floating";

function describe(seq) {
  const out = isOutput(seq);
  const id = out ? seq.doId : seq.diId;
  const idLabel = String(id).toLowerCase() === "pi_p" ? "PI_P" : `${out ? "DO" : "DI"}${id ?? "?"}`;
  const where = isGpio(seq) ? `GPIO ${seq.gpioId ?? "?"}` : `Driver ${seq.driverId ?? "?"}`;
  const extras = [];
  if (out) extras.push(seq.controlType === "push" ? `Push ${seq.pushWait || 250} ms` : "Switch");
  if (!out && seq.waitTime) extras.push(`Wait ${seq.waitTime} ms`);
  if (!out && seq.with_fallback) extras.push("Failure popup");
  return { out, where: `${where} · ${idLabel}`, extras };
}

/** The ordered list of IO sequences (do_di_tree.xml) with all list tools. */
export default function SequenceCard({ onAdd, onEdit, onShowXml }) {
  const qc = useQueryClient();
  const { data: sequences = [], isLoading, error, refetch, isFetching } = useSequences();
  const { data: canUndo } = useCanUndo();
  const [busy, setBusy] = useState("");
  const [drag, setDrag] = useState(null); // { from, over }
  const pinned = useFloating((s) => s.pins);
  const pinnedNames = new Set(pinned.map((p) => p.name));

  const run = async (key, fn) => {
    setBusy(key);
    try {
      const msg = await fn();
      if (msg) toast.success(msg);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy("");
    }
  };

  const remove = async (name) => {
    if (!(await confirm({ title: `Delete ${name}?`, message: "This step is removed from the IO sequences.", tone: "danger", confirmLabel: "Delete" }))) return;
    unpinControl(name);
    run(`del:${name}`, () => ioAction("deleteControl", { name }));
  };

  const removeAll = async () => {
    if (!sequences.length) return;
    if (
      !(await confirm({
        title: "Delete all IO sequences?",
        message: `All ${sequences.length} steps are removed. You can bring them back with Undo right after.`,
        tone: "danger",
        confirmLabel: "Delete all",
      }))
    )
      return;
    run("all", () => ioAction("deleteAll"));
  };

  const undo = () => run("undo", () => ioAction("undo").then(() => "Last change undone"));
  const sort = (order) => run(order, () => sortSequences(order).then(() => (order === "diFirst" ? "Inputs moved first" : "Outputs moved first")));

  const reorder = (from, to) => {
    if (from === to || from == null || to == null) return;
    const next = [...sequences];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    qc.setQueryData(ioKeys.sequences, next); // optimistic
    run("reorder", () => ioAction("reorderSequences", { sequenceNames: next.map((s) => s.name) }).then(() => null));
  };

  const addItems = [
    { label: "Driver output (DO)", tut: "io-add-driver-do", onClick: () => onAdd({ source: "driver", kind: "do" }) },
    { label: "Driver input (DI)", tut: "io-add-driver-di", onClick: () => onAdd({ source: "driver", kind: "di" }) },
    "-",
    { label: "GPIO output (DO)", tut: "io-add-gpio-do", onClick: () => onAdd({ source: "gpio", kind: "do" }) },
    { label: "GPIO input (DI)", onClick: () => onAdd({ source: "gpio", kind: "di" }) },
  ];

  const moreItems = [
    { label: "Inputs first", icon: ArrowDownUp, onClick: () => sort("diFirst"), disabled: sequences.length < 2 },
    { label: "Outputs first", icon: ArrowDownUp, onClick: () => sort("doFirst"), disabled: sequences.length < 2 },
    "-",
    { label: "View source", icon: Code2, onClick: onShowXml },
    "-",
    { label: "Delete all…", icon: Trash2, danger: true, onClick: removeAll, disabled: !sequences.length },
  ];

  return (
    <Card
      className="io-seq-card"
      tut="io-seq"
      title="IO sequences"
      subtitle={isLoading ? "Loading…" : `${sequences.length} step${sequences.length === 1 ? "" : "s"} · drag to reorder`}
      icon={ListOrdered}
      flush
      bodyClassName="card-scroll"
      actions={
        <>
          <Menu
            trigger={({ toggle }) => (
              <Button data-tut="io-add" variant="primary" size="sm" icon={Plus} iconRight={ChevronDown} onClick={toggle}>
                Add
              </Button>
            )}
            items={addItems}
          />
          <IconButton
            icon={Undo2}
            size="sm"
            variant="default"
            data-tut="io-undo"
            onClick={undo}
            loading={busy === "undo"}
            disabled={!canUndo || Boolean(busy)}
            label={canUndo ? "Undo the last change (press again to redo)" : "Nothing to undo"}
          />
          <IconButton icon={RefreshCw} label="Reload" size="sm" variant="default" onClick={() => refetch()} disabled={isFetching} />
          <Menu trigger={({ toggle }) => <IconButton icon={MoreHorizontal} label="More actions" size="sm" variant="default" onClick={toggle} />} items={moreItems} />
        </>
      }
    >
      {isLoading ? (
        <Loading label="Loading sequences…" />
      ) : error ? (
        <div style={{ padding: 16 }}>
          <Alert tone="danger" title="Could not load the IO sequences" action={<Button size="sm" onClick={() => refetch()}>Retry</Button>}>
            {errorMessage(error)}
          </Alert>
        </div>
      ) : sequences.length === 0 ? (
        <EmptyState
          icon={ListOrdered}
          title="No IO steps yet"
          text="Add an output or input step. Steps are used by the robot program in this order."
          action={
            <Button data-tut="io-add-first" variant="primary" icon={Plus} onClick={() => onAdd({ source: "driver", kind: "do" })}>
              Add step
            </Button>
          }
        />
      ) : (
        <div className="list">
          {sequences.map((seq, i) => {
            const d = describe(seq);
            return (
              <div
                key={seq.name}
                className={cx(
                  "list-item io-seq",
                  d.out ? "is-out" : "is-in",
                  drag?.from === i && "is-dragging",
                  drag && drag.over === i && drag.from !== i && "is-drop-target"
                )}
                data-tut="io-row"
                data-tut-io={seq.name}
                draggable={!busy}
                onDragStart={(e) => {
                  e.dataTransfer.effectAllowed = "move";
                  e.dataTransfer.setData("text/plain", seq.name);
                  setDrag({ from: i, over: i });
                }}
                onDragOver={(e) => {
                  if (!drag) return;
                  e.preventDefault();
                  if (drag.over !== i) setDrag({ ...drag, over: i });
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  if (drag) reorder(drag.from, i);
                  setDrag(null);
                }}
                onDragEnd={() => setDrag(null)}
              >
                <span className="drag-handle" title="Drag to reorder">
                  <GripVertical size={16} />
                </span>
                <span className="list-index">{i + 1}</span>
                <div className="grow io-seq-body">
                  <div className="row" style={{ gap: 8, minWidth: 0 }}>
                    <span className="strong truncate" title={seq.name}>
                      {seq.name}
                    </span>
                    <Badge tone={d.out ? "primary" : "info"}>{d.out ? "Output" : "Input"}</Badge>
                  </div>
                  <div className="xs muted io-seq-meta">
                    <span>{d.where}</span>
                    {d.extras.map((x) => (
                      <span key={x}>{x}</span>
                    ))}
                    {seq.responseMsg && <span className="truncate" title={`Log message: ${seq.responseMsg}`}>“{seq.responseMsg}”</span>}
                  </div>
                </div>
                <div className="io-seq-live" data-tut="io-live">
                  <IoLiveControl seq={seq} />
                </div>
                <IconButton
                  data-tut="io-pin"
                  icon={pinnedNames.has(seq.name) ? PinOff : Pin}
                  label={pinnedNames.has(seq.name) ? `Stop floating ${seq.name}` : `Float ${seq.name} over every page`}
                  size="sm"
                  variant={pinnedNames.has(seq.name) ? "soft" : "ghost"}
                  onClick={() => togglePin(seq)}
                />
                <IconButton data-tut="io-edit" icon={Pencil} label={`Edit ${seq.name}`} size="sm" onClick={() => onEdit(seq)} />
                <IconButton
                  data-tut="io-del"
                  icon={Trash2}
                  label={`Delete ${seq.name}`}
                  size="sm"
                  variant="ghost-danger"
                  loading={busy === `del:${seq.name}`}
                  onClick={() => remove(seq.name)}
                />
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}
