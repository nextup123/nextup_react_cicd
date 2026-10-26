import { useEffect, useState } from "react";
import { AlertTriangle, FlaskConical, History, Move, Navigation, Spline, Square } from "lucide-react";
import { Alert, Badge, Button, EmptyState, Field, Input, Modal, Segmented } from "../../components/ui";
import { errorMessage } from "../../lib/api";
import { robotApi } from "../../lib/robotApi";
import { MOTION_STATE_TEXT } from "../../lib/robotText";
import { useRobot } from "../../store/robot";
import { useCloseWhenMoved } from "../../lib/useCloseWhenMoved";
import { toast } from "../../store/toast";
import { fmt, isEditable, rad2deg } from "./pointsApi";

/* ───────────── Details + history ───────────── */
export function PointDetailsModal({ point, onClose, onEdit }) {
  if (!point) return null;
  const editable = isEditable(point);
  const j = point.joints_values || {};
  const c = point.coordinate || {};
  const history = point.history;
  const keys = history
    ? Object.keys(history)
        .filter((k) => k !== "Serial" && !isNaN(k))
        .map(Number)
        .sort((a, b) => a - b)
    : [];

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={point.name}
      description={point.nature}
      footer={
        <>
          <Button onClick={onClose}>Close</Button>
          <Button variant="primary" disabled={!editable} title={editable ? undefined : "Locked points cannot be edited"} onClick={() => onEdit(point)}>
            Edit point
          </Button>
        </>
      }
    >
      <div className="col" style={{ gap: 16 }}>
        <div className="pp-detail-grid">
          <div>
            <span className="section-label">Saved</span>
            <div>{point.date_time || "—"}</div>
          </div>
          <div>
            <span className="section-label">Sequence</span>
            <div>{point.sequence}</div>
          </div>
          <div>
            <span className="section-label">Access</span>
            <div>{editable ? <Badge tone="success">Editable</Badge> : <Badge tone="warning">Locked</Badge>}</div>
          </div>
          <div>
            <span className="section-label">Type</span>
            <div>{point.is_tf ? <Badge tone="info">TF frame</Badge> : "Normal point"}</div>
          </div>
        </div>

        <div className="table-wrap">
          <table className="table compact tabular">
            <thead>
              <tr>
                <th />
                {["J1", "J2", "J3", "J4", "J5", "J6"].map((l) => (
                  <th key={l}>{l}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="muted">rad</td>
                {[1, 2, 3, 4, 5, 6].map((i) => (
                  <td key={i}>{fmt(j[`joint${i}`], 5)}</td>
                ))}
              </tr>
              <tr>
                <td className="muted">deg</td>
                {[1, 2, 3, 4, 5, 6].map((i) => (
                  <td key={i}>{fmt(rad2deg(j[`joint${i}`]))}</td>
                ))}
              </tr>
            </tbody>
            <thead>
              <tr>
                <th />
                {["X cm", "Y cm", "Z cm", "R °", "P °", "W °"].map((l) => (
                  <th key={l}>{l}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                <td />
                {["x", "y", "z", "r", "p", "w"].map((k) => (
                  <td key={k}>{fmt(c[k], 5)}</td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>

        <div className="col" style={{ gap: 6 }}>
          <span className="section-label row">
            <History size={13} /> History
          </span>
          {!history ? (
            <EmptyState compact title="No history" text="Updates to this point are recorded here." />
          ) : (
            <div className="pp-history">
              <div className="pp-history-entry">
                <strong>Latest:</strong> {history.Serial}
              </div>
              {keys.map((k) => (
                <div key={k} className="pp-history-entry">
                  <strong>{k}:</strong> {history[k]}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}

/* ───────────── Move robot to a point (motion server goto_point) ───────────── */
const MOVE_PREFS_KEY = "nextup.pp.movePrefs";
function readMovePrefs() {
  try {
    return { motionType: "PTP", speed: 0.25, approachMm: 0, retractMm: 0, ...JSON.parse(localStorage.getItem(MOVE_PREFS_KEY) || "{}") };
  } catch {
    return { motionType: "PTP", speed: 0.25, approachMm: 0, retractMm: 0 };
  }
}

export function MoveToPointModal({ point, onClose, onMoved }) {
  const [prefs, setPrefs] = useState(readMovePrefs);
  const [busy, setBusy] = useState(null); // "move" | "test" while the request is sent
  const [motionId, setMotionId] = useState(null);
  const [dry, setDry] = useState(false);
  const motion = useRobot((s) => s.motion);
  const sup = useRobot((s) => s.supervisor);
  const mine = motionId && motion?.id === motionId ? motion : null;
  // A new point starts clean; the old motion's result is not shown again.
  useEffect(() => setMotionId(null), [point?.name]);
  useCloseWhenMoved(point ? mine : null, dry, () => {
    setMotionId(null);
    onClose();
  });
  if (!point) return null;

  const running = mine?.active;
  const set = (k, v) => {
    const next = { ...prefs, [k]: v };
    setPrefs(next);
    try {
      localStorage.setItem(MOVE_PREFS_KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  };

  const go = async (dryRun) => {
    setBusy(dryRun ? "test" : "move");
    try {
      const r = await robotApi.gotoPoint({ point: point.name, ...prefs, dryRun });
      if (!r.ok) {
        toast.error(r.message || "Refused", { title: `Move to ${point.name}` });
        return;
      }
      setDry(!!dryRun);
      setMotionId(r.motionId);
      if (r.switched) toast.info("Switched to SAFEAUTO to move");
      if (!dryRun) onMoved(point.name);
    } catch (err) {
      toast.error(`Could not move to ${point.name}: ${errorMessage(err)}`);
    } finally {
      setBusy(null);
    }
  };

  const pct = Math.round((mine?.progress || 0) * 100);
  const cap = sup?.speedScale;
  return (
    <Modal
      open
      tut="move-point"
      onClose={onClose}
      size="sm"
      title={`Move robot to "${point.name}"`}
      description="The motion server plans the path, checks it, then moves."
      footer={
        running ? (
          <>
            <Button onClick={onClose} title="Close this window; the robot keeps moving (the top bar shows the motion)">Close</Button>
            <span className="grow" />
            <Button variant="danger" icon={Square} onClick={() => robotApi.stop().catch(() => toast.error("Stop could not be sent. Use the E-STOP if needed."))}>
              Stop
            </Button>
          </>
        ) : (
          <>
            <Button onClick={onClose}>Close</Button>
            <span className="grow" />
            <Button data-tut="move-test" icon={FlaskConical} loading={busy === "test"} disabled={!!busy} onClick={() => go(true)} title="Plan and check the motion without moving">
              Test
            </Button>
            <Button data-tut="move-go" variant="primary" icon={Navigation} loading={busy === "move"} disabled={!!busy} onClick={() => go(false)}>
              Move
            </Button>
          </>
        )
      }
    >
      <div className="col" style={{ gap: 12 }}>
        <Segmented
          block
          value={prefs.motionType}
          onChange={(v) => set("motionType", v)}
          disabled={running}
          options={[
            { value: "PTP", label: "Joint move (PTP)", icon: Spline },
            { value: "LIN", label: "Straight line (LIN)", icon: Move },
          ]}
        />
        <div className="form-grid">
          <Field label={`Speed ${Number(prefs.speed).toFixed(2)} m/s`} hint={cap !== undefined ? `Supervisor scale ${cap} %` : undefined}>
            <input className="range" type="range" min={0.02} max={1} step={0.01} value={prefs.speed} disabled={running} onChange={(e) => set("speed", Number(e.target.value))} />
          </Field>
          <div className="row" style={{ gap: 8, alignItems: "flex-end" }}>
            <Field label="Approach mm" hint="Stop above first">
              <Input size="sm" type="number" min={0} value={prefs.approachMm} disabled={running} onChange={(e) => set("approachMm", Number(e.target.value))} />
            </Field>
            <Field label="Retract mm">
              <Input size="sm" type="number" min={0} value={prefs.retractMm} disabled={running} onChange={(e) => set("retractMm", Number(e.target.value))} />
            </Field>
          </div>
        </div>
        {mine ? (
          <div className="col" style={{ gap: 6 }}>
            <div className="row small">
              <strong>{MOTION_STATE_TEXT[mine.state] || mine.state}</strong>
              {mine.stageCount > 1 && <span className="muted">stage {mine.stage}/{mine.stageCount}</span>}
              <span className="grow" />
              {mine.active && <span className="mono">{pct} %</span>}
            </div>
            <span className={`progress ${mine.state === "succeeded" ? "is-success" : mine.final && mine.state !== "canceled" ? "is-danger" : ""}`}>
              <span style={{ width: `${mine.state === "succeeded" ? 100 : pct}%` }} />
            </span>
            {(mine.stageLabel || mine.message) && <span className="xs muted">{mine.final ? mine.message : mine.stageLabel || mine.message}</span>}
          </div>
        ) : (
          <Alert tone="warning">
            The robot will start moving. Keep the work area clear.
          </Alert>
        )}
      </div>
    </Modal>
  );
}
