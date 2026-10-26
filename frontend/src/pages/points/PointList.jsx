import { useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Crosshair,
  GripVertical,
  Home,
  Lock,
  LockOpen,
  MapPin,
  MoreVertical,
  RefreshCw,
  Navigation,
  Pencil,
  Plus,
  ShieldCheck,
  Trash2,
  Undo2,
} from "lucide-react";
import { Alert, Badge, Button, Card, EmptyState, IconButton, Loading, Menu, cx } from "../../components/ui";
import { errorMessage } from "../../lib/api";
import { send } from "../../lib/ws";
import { confirm, prompt } from "../../store/confirm";
import { toast } from "../../store/toast";
import { useRobot } from "../../store/robot";
import { robotApi, robotCall } from "../../lib/robotApi";
import { isEditable, pointsApi, refreshPoints, useCanUndo } from "./pointsApi";

async function teachHomeFromPoint(pointName) {
  const name = await prompt({
    title: `Save "${pointName}" as a home`,
    message: "The HOME menu in the top bar can then move to it.",
    input: { label: "Home name", defaultValue: `home_${pointName}`.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 64) },
    confirmLabel: "Save home",
  });
  if (!name) return;
  const setActive = await confirm({ title: `Make "${name}" the active home?`, message: "The HOME button moves to the active home.", confirmLabel: "Make active", cancelLabel: "Keep current" });
  robotCall(() => robotApi.teachHome({ name, source: "point", point: pointName, setActive }));
}

function PointRow({ point, index, total, locked, isCurrent, isFrame, onEdit, onDetails, onMove, onReorder, drag }) {
  const editable = isEditable(point);
  const lockedTitle = "This point is locked. Unlock it in Manage access to change it.";

  const remove = async () => {
    if (!(await confirm({ title: `Delete point "${point.name}"?`, message: "You can undo this with Undo.", tone: "danger", confirmLabel: "Delete" }))) return;
    try {
      const res = await pointsApi.remove(point.name);
      toast.success(res?.message || `Deleted ${point.name}`);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      refreshPoints();
    }
  };

  const toggleLock = async () => {
    try {
      await pointsApi.update(point.name, { ...point, is_editable: !editable });
      toast.success(`${point.name} ${editable ? "locked" : "unlocked"}`);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      refreshPoints();
    }
  };

  const useAsFrame = () => {
    send("SET_SERVO_FRAME", { frame: point.name });
    useRobot.setState({ servoFrame: point.name });
    toast.success(`Jog frame set to ${point.name}`);
  };

  return (
    <div
      className={cx(
        "list-item pp-point",
        !editable && "is-locked",
        isCurrent && "is-current",
        drag.dragging === point.name && "is-dragging",
        drag.over === point.name && drag.dragging !== point.name && "is-drop-target"
      )}
      data-tut="pp-row"
      data-tut-point={point.name}
      draggable={!locked}
      onDragStart={(e) => {
        if (locked) return e.preventDefault();
        e.dataTransfer.setData("text/plain", point.name);
        e.dataTransfer.effectAllowed = "move";
        drag.setDragging(point.name);
      }}
      onDragEnd={() => {
        drag.setDragging(null);
        drag.setOver(null);
      }}
      onDragOver={(e) => {
        if (locked || !drag.dragging) return;
        e.preventDefault();
        drag.setOver(point.name);
      }}
      onDrop={(e) => {
        if (locked) return;
        e.preventDefault();
        const from = e.dataTransfer.getData("text/plain");
        drag.setDragging(null);
        drag.setOver(null);
        if (from && from !== point.name) onReorder(from, point.name);
      }}
    >
      {!locked ? (
        <span className="drag-handle" title="Drag to reorder">
          <GripVertical size={16} />
        </span>
      ) : null}
      <span className="list-index">{index + 1}</span>
      <button type="button" className="pp-point-main" onClick={() => onDetails(point)} title="Show point details">
        <span className="pp-point-title">
          <span className="pp-point-name truncate">{point.name}</span>
          {isCurrent && <Badge tone="primary">Last target</Badge>}
          {point.is_tf && <Badge tone="info">TF</Badge>}
          {isFrame && <Badge tone="success">Jog frame</Badge>}
          {!editable && (
            <Badge tone="warning">
              <Lock size={11} /> Locked
            </Badge>
          )}
        </span>
        {point.nature && point.nature !== point.name && <span className="pp-point-meta xs muted truncate">{point.nature}</span>}
      </button>

      <div className="pp-point-actions">
        {!locked && (
          <>
            <IconButton icon={ArrowUp} label="Move up" size="sm" disabled={index === 0} onClick={() => onReorder(point.name, null, -1)} />
            <IconButton icon={ArrowDown} label="Move down" size="sm" disabled={index === total - 1} onClick={() => onReorder(point.name, null, 1)} />
          </>
        )}
        {point.is_tf && (
          <IconButton icon={Crosshair} label={`Use "${point.name}" as jog frame`} size="sm" variant={isFrame ? "soft" : "ghost"} onClick={useAsFrame} />
        )}
        <Button data-tut="pp-go" size="sm" variant="soft" icon={Navigation} onClick={() => onMove(point)} title={`Move the robot to ${point.name}`}>
          Go
        </Button>
        <IconButton data-tut="pp-edit" icon={Pencil} label={editable ? "Edit point" : lockedTitle} size="sm" disabled={!editable} onClick={() => onEdit(point)} />
        <Menu
          trigger={({ toggle }) => <IconButton data-tut="pp-row-more" icon={MoreVertical} label="More actions" size="sm" onClick={toggle} />}
          items={[
            { label: "Details & history", icon: MapPin, onClick: () => onDetails(point) },
            { label: editable ? "Lock point" : "Unlock point", icon: editable ? Lock : LockOpen, onClick: toggleLock },
            { label: "Save as a home…", icon: Home, onClick: () => teachHomeFromPoint(point.name), title: "Teach a motion-server home with this point's joint values" },
            "-",
            { label: editable ? "Delete point" : "Delete (locked)", icon: Trash2, danger: true, disabled: !editable, onClick: remove },
          ]}
        />
      </div>
    </div>
  );
}

export function PointListCard({ query, onAdd, onEdit, onDetails, onMove, onAccess, onReload, reloading, currentPoint }) {
  const { data: points = [], isLoading, isError, error, refetch } = query;
  const { data: canUndo } = useCanUndo();
  const servoFrame = useRobot((s) => s.servoFrame);
  const [locked, setLocked] = useState(true);
  const [dragging, setDragging] = useState(null);
  const [over, setOver] = useState(null);
  const [undoing, setUndoing] = useState(false);

  const reorder = async (name, targetName, step) => {
    const names = points.map((p) => p.name);
    const from = names.indexOf(name);
    if (from < 0) return;
    let to = targetName ? names.indexOf(targetName) : from + step;
    if (to < 0 || to >= names.length || to === from) return;
    names.splice(from, 1);
    names.splice(to, 0, name);
    try {
      await pointsApi.reorder(names);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      refreshPoints();
    }
  };

  const undo = async () => {
    setUndoing(true);
    try {
      const res = await pointsApi.undo();
      toast.success(res?.message || "Undo successful");
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setUndoing(false);
      refreshPoints();
    }
  };

  const deleteAll = async () => {
    if (!points.length) return;
    const ok = await confirm({
      title: "Delete all points?",
      message: `All ${points.length} points in this file will be removed, including locked ones. You can undo the last change with Undo.`,
      tone: "danger",
      confirmLabel: "Delete all",
    });
    if (!ok) return;
    try {
      const res = await pointsApi.removeAll();
      toast.success(res?.message || "Deleted all points");
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      refreshPoints();
    }
  };

  return (
    <Card
      className="pp-list-card"
      tut="pp-points"
      title="Points"
      subtitle={isLoading ? "Loading…" : `${points.length} point${points.length === 1 ? "" : "s"}`}
      icon={MapPin}
      flush
      bodyClassName="pp-list-body"
      actions={
        <>
          <IconButton
            size="sm"
            variant="default"
            data-tut="pp-undo"
            icon={Undo2}
            loading={undoing}
            disabled={!canUndo}
            label={canUndo ? "Undo the last change to the points" : "Nothing to undo"}
            onClick={undo}
          />
          <IconButton
            size="sm"
            variant={locked ? "default" : "soft"}
            data-tut="pp-lock"
            icon={locked ? Lock : LockOpen}
            label={locked ? "Order is locked. Click to allow reordering." : "Reordering is on. Click to lock the order."}
            onClick={() => {
              setLocked((l) => !l);
              toast.info(locked ? "Reordering unlocked: drag rows or use the arrows" : "Reordering locked");
            }}
          />
          <Menu
            trigger={({ toggle }) => <IconButton icon={MoreVertical} label="More point actions" size="sm" variant="default" onClick={toggle} />}
            items={[
              { label: reloading ? "Reloading points…" : "Reload points", icon: RefreshCw, onClick: onReload, disabled: !onReload || reloading },
              { label: "Manage access (lock / unlock)", icon: ShieldCheck, onClick: onAccess, disabled: !points.length },
              "-",
              { label: "Delete all points", icon: Trash2, danger: true, onClick: deleteAll, disabled: !points.length },
            ]}
          />
          <Button data-tut="pp-teach" size="sm" variant="primary" icon={Plus} onClick={onAdd} title="Save the robot's current position as a new point">
            Teach point
          </Button>
        </>
      }
    >
      {isLoading ? (
        <Loading label="Loading points…" />
      ) : isError ? (
        <div style={{ padding: 16 }}>
          <Alert tone="danger" title="Could not load points" action={<Button size="sm" onClick={() => refetch()}>Retry</Button>}>
            {errorMessage(error)}
          </Alert>
        </div>
      ) : points.length === 0 ? (
        <EmptyState
          icon={MapPin}
          title="No points yet"
          text="Jog the robot to a position, then press Teach point to save it."
          action={
            <Button data-tut="pp-teach" variant="primary" icon={Plus} onClick={onAdd}>
              Teach point
            </Button>
          }
        />
      ) : (
        <div className="list pp-list">
          {points.map((p, i) => (
            <PointRow
              key={p.name}
              point={p}
              index={i}
              total={points.length}
              locked={locked}
              isCurrent={currentPoint === p.name}
              isFrame={servoFrame === p.name}
              onEdit={onEdit}
              onDetails={onDetails}
              onMove={onMove}
              onReorder={reorder}
              drag={{ dragging, setDragging, over, setOver }}
            />
          ))}
        </div>
      )}
    </Card>
  );
}
