// Move to typed joint values or a Cartesian pose (motion server goto_joints / goto_pose).
import { useEffect, useState } from "react";
import { Crosshair, FlaskConical, Navigation, Square } from "lucide-react";
import { Button, Checkbox, Field, Input, Modal, Segmented, Tabs } from "../ui";
import { robotApi } from "../../lib/robotApi";
import { MOTION_STATE_TEXT } from "../../lib/robotText";
import { toast } from "../../store/toast";
import { useRobot } from "../../store/robot";
import { useCloseWhenMoved } from "../../lib/useCloseWhenMoved";

const J = ["J1", "J2", "J3", "J4", "J5", "J6"];
const P = [["x", "X (cm)"], ["y", "Y (cm)"], ["z", "Z (cm)"], ["r", "R (°)"], ["p", "P (°)"], ["w", "W (°)"]];
const r1 = (v) => Math.round(Number(v) * 10) / 10;

export function GotoTargetModal({ open, onClose }) {
  const [tab, setTab] = useState("joints");
  const [joints, setJoints] = useState(["0", "0", "0", "0", "0", "0"]);
  const [pose, setPose] = useState({ x: 0, y: 0, z: 0, r: 0, p: 0, w: 0 });
  const [motionType, setMotionType] = useState("PTP");
  const [speed, setSpeed] = useState(0.2);
  const [keepOrientation, setKeepOrientation] = useState(false);
  const [busy, setBusy] = useState(null);
  const [motionId, setMotionId] = useState(null);
  const motion = useRobot((s) => s.motion);
  const mine = motionId && motion?.id === motionId ? motion : null;
  const [dry, setDry] = useState(false);
  useEffect(() => {
    if (!open) setMotionId(null);
  }, [open]);
  useCloseWhenMoved(open ? mine : null, dry, () => { setMotionId(null); onClose(); });

  const fillCurrent = () => {
    const st = useRobot.getState();
    if (tab === "joints") setJoints(st.jointValues.map((v) => String(r1(v))));
    else setPose(Object.fromEntries(P.map(([k], i) => [k, r1(st.cartesian[i])])));
  };

  const go = async (dryRun) => {
    setBusy(dryRun ? "test" : "move");
    try {
      const r =
        tab === "joints"
          ? await robotApi.gotoJoints({ joints: joints.map(Number), inDegrees: true, motionType, speed, dryRun })
          : await robotApi.gotoPose({ ...Object.fromEntries(P.map(([k]) => [k, Number(pose[k])])), motionType, speed, keepOrientation, dryRun });
      if (!r.ok) toast.error(r.message || "Refused");
      else {
        setDry(!!dryRun);
        setMotionId(r.motionId);
      }
    } catch (e) {
      toast.error(e.message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Go to a target"
      description="Typed joint values or a Cartesian pose, planned and checked by the motion server."
      footer={
        mine?.active ? (
          <>
            <Button onClick={onClose} title="Close this window; the robot keeps moving (the top bar shows the motion)">Close</Button>
            <span className="grow" />
            <Button variant="danger" icon={Square} onClick={() => robotApi.stop().catch(() => toast.error("Stop could not be sent. Use the E-STOP if needed."))}>Stop</Button>
          </>
        ) : (
          <>
            <Button icon={Crosshair} onClick={fillCurrent} title="Fill in the robot's current values">Use current</Button>
            <span className="grow" />
            <Button icon={FlaskConical} loading={busy === "test"} disabled={!!busy} onClick={() => go(true)}>Test</Button>
            <Button variant="primary" icon={Navigation} loading={busy === "move"} disabled={!!busy} onClick={() => go(false)}>Move</Button>
          </>
        )
      }
    >
      <div className="col" style={{ gap: 12 }}>
        <Tabs value={tab} onChange={setTab} tabs={[{ value: "joints", label: "Joint values" }, { value: "pose", label: "Cartesian pose" }]} />
        <div className="limits-grid">
          {tab === "joints"
            ? J.map((l, i) => (
                <Field key={l} label={`${l} (°)`}>
                  <Input type="number" step="0.1" value={joints[i]} onChange={(e) => setJoints(joints.map((v, k) => (k === i ? e.target.value : v)))} />
                </Field>
              ))
            : P.map(([k, l]) => (
                <Field key={k} label={l}>
                  <Input type="number" step="0.1" value={pose[k]} onChange={(e) => setPose({ ...pose, [k]: e.target.value })} />
                </Field>
              ))}
        </div>
        <div className="form-grid">
          <Segmented block value={motionType} onChange={setMotionType} options={[{ value: "PTP", label: "PTP" }, { value: "LIN", label: "LIN" }]} />
          <Field label={`Speed ${speed.toFixed(2)} m/s`}>
            <input className="range" type="range" min={0.02} max={1} step={0.01} value={speed} onChange={(e) => setSpeed(Number(e.target.value))} />
          </Field>
        </div>
        {tab === "pose" && <Checkbox label="Keep the current tool orientation" checked={keepOrientation} onChange={setKeepOrientation} />}
        {mine && (
          <div className="col" style={{ gap: 4 }}>
            <span className="small">
              <strong>{MOTION_STATE_TEXT[mine.state]}</strong> {mine.active ? `${Math.round(mine.progress * 100)} %` : mine.message}
            </span>
            <span className="progress"><span style={{ width: `${mine.state === "succeeded" ? 100 : Math.round(mine.progress * 100)}%` }} /></span>
          </div>
        )}
      </div>
    </Modal>
  );
}
