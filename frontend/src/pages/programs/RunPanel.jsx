// Run a saved program on the motion server: dry run (plans every part, moves
// nothing) or a real run, with the optional overrides of run_program (loops,
// speed, call offset). Shows the live status of this program's motion.
import { useState } from "react";
import { Copy, FlaskConical, Flag, Move3d, Play, Square } from "lucide-react";
import { Badge, Button, cx } from "../../components/ui";
import { useRobot } from "../../store/robot";
import { toast } from "../../store/toast";
import { confirm } from "../../store/confirm";
import { errorMessage } from "../../lib/api";
import { programsApi } from "./programsApi";
import { NumField } from "./fields";
import { InfoTip, TipLabel } from "./Tip";

const STATE_TONE = { checking: "info", planning: "info", executing: "primary", verifying: "info", succeeded: "success", failed: "danger", canceled: "warning", aborted: "danger" };

/** "loop 2 / step 3 of 5: ..." -> 2 (0-based step). Real server labels say "part": no step then. */
export function runningStepOf(motion, name) {
  if (!motion || motion.kind !== "program" || motion.target !== name || !motion.active) return null;
  const m = /step (\d+) of/.exec(motion.stageLabel || "");
  return m ? Number(m[1]) - 1 : null;
}

export default function RunPanel({ program, savedName, dirty, hasErrors, canRun, canFinish, onSave, offset, setOffset }) {
  const motion = useRobot((s) => s.motion);
  const [repeat, setRepeat] = useState("");
  const [speed, setSpeed] = useState(0);
  const [busy, setBusy] = useState(null);
  const [showShift, setShowShift] = useState(Boolean(offset && Object.values(offset).some(Boolean)));
  const mine = motion && motion.kind === "program" && motion.target === savedName;
  const active = Boolean(motion?.active);

  const run = async (dryRun) => {
    let name = savedName;
    if (dirty || !savedName) {
      const ok = await confirm({ title: "Save first?", message: "The motion server runs the saved file. Save the changes and run?", confirmLabel: "Save and run" });
      if (!ok) return;
      name = await onSave();
      if (!name) return;
    }
    if (!dryRun) {
      const ok = await confirm({
        title: `Run ${name}?`,
        message: "The robot will move through every step of the program. Keep the cell clear and a hand on the stop.",
        tone: "warning",
        confirmLabel: "Run",
      });
      if (!ok) return;
    }
    setBusy(dryRun ? "dry" : "run");
    try {
      const r = await programsApi.run({ name, dryRun, repeat: repeat === "" ? -1 : Number(repeat), speed, offset: showShift ? offset : null });
      if (!r.ok) toast.error(r.message || "Refused", { title: "Motion server" });
    } catch (err) {
      toast.error(errorMessage(err), { title: "Motion server" });
    } finally {
      setBusy(null);
    }
  };
  const call = async (fn, label) => {
    try {
      const r = await fn();
      if (r && r.ok === false) toast.warning(r.message || `${label} refused`);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };
  const snippet = `<RunProgram program="${savedName || program.name}"${repeat !== "" ? ` repeat="${repeat}"` : ""}${speed ? ` speed="${speed}"` : ""}${showShift && offset ? ["x", "y", "z", "rx", "ry", "rz"].filter((k) => Number(offset[k])).map((k) => ` offset_${k}="${offset[k]}"`).join("") : ""}/>`;

  return (
    <div className="mp-run" data-tut="mp-run">
      {!canRun && <div className="mp-note">The motion server's run_program is not available right now: you can edit and save, running comes back when the server is up.</div>}
      {hasErrors && <div className="mp-note is-danger">Fix the problems first: the motion server refuses a program that does not pass its checks.</div>}
      <div className="mp-grid2" data-tut="mp-run-overrides">
        <div className="field mp-field">
          <TipLabel label="Loops" tip="Override the program's repeat for this run. Empty = as in the program; 0 = until 'Finish' or stop." />
          <div className="mp-num">
            <input className="mp-num-input" inputMode="numeric" value={repeat} placeholder={`${program.repeat ?? 1} (program)`} onChange={(e) => setRepeat(e.target.value.replace(/[^0-9]/g, ""))} />
          </div>
        </div>
        <NumField label="Speed" tip="Replaces the program's default speed for this run (never a step's own speed). Empty = as in the program." value={speed} onChange={setSpeed} unit="m/s" min={0} max={10} placeholder="as programmed" />
      </div>
      <button type="button" className="mp-link" data-tut="mp-shift-toggle" onClick={() => setShowShift((v) => !v)}>
        <Move3d size={13} /> {showShift ? "Hide the shift" : "Shift the whole program (palletizing offset)"}
      </button>
      {showShift && (
        <div className="mp-shift" data-tut="mp-shift">
          <div className="mp-grid3">
            {["x", "y", "z"].map((k) => (
              <NumField key={k} label={k} tip={`Every taught point, via and centre moves by ${k} in the robot base axes (mm). Relative steps stay relative.`} value={offset?.[k]} onChange={(v) => setOffset({ ...offset, [k]: v })} unit="mm" min={-5000} max={5000} />
            ))}
            {["rx", "ry", "rz"].map((k) => (
              <NumField key={k} label={k} tip="The tool turns about this base axis at every point (deg)." value={offset?.[k]} onChange={(v) => setOffset({ ...offset, [k]: v })} unit="°" min={-360} max={360} />
            ))}
          </div>
          <div className="small muted">The preview shows the shifted path.</div>
        </div>
      )}
      <div className="mp-run-buttons">
        <Button icon={FlaskConical} data-tut="mp-dry" loading={busy === "dry"} disabled={!canRun || active || hasErrors} onClick={() => run(true)} title="Plans every part once and moves nothing">
          Dry run
        </Button>
        <Button variant="primary" icon={Play} data-tut="mp-run-go" loading={busy === "run"} disabled={!canRun || active || hasErrors} onClick={() => run(false)}>
          Run
        </Button>
        <Button icon={Flag} data-tut="mp-finish" disabled={!mine || !active || !canFinish} onClick={() => call(programsApi.finish, "Finish")} title="End the loop cleanly at the end of the current part">
          Finish
        </Button>
        <Button variant="danger" icon={Square} data-tut="mp-stop" disabled={!active} onClick={() => call(programsApi.stop, "Stop")} title="Controlled stop of the running motion">
          Stop
        </Button>
      </div>

      {mine && (
        <div className={cx("mp-live", motion.active && "is-active")} data-tut="mp-live">
          <div className="mp-live-head">
            <Badge tone={STATE_TONE[motion.state] || "info"}>{motion.dryRun ? `dry run · ${motion.state}` : motion.state}</Badge>
            <span className="grow truncate small">{motion.stageLabel}</span>
            <span className="small muted">{motion.elapsed ? `${motion.elapsed} s` : ""}</span>
          </div>
          <div className="progress">
            <div className="progress-bar" style={{ width: `${Math.round((motion.progress || 0) * 100)}%` }} />
          </div>
          {motion.message && <div className={cx("small", motion.error ? "mp-bad-text" : "muted")}>{motion.error ? `${motion.error}: ` : ""}{motion.message}</div>}
          {motion.achievedSpeed > 0 && <div className="xs muted">tool {motion.achievedSpeed} m/s · scale {motion.speedScale} %{motion.cached ? " · cached plan" : ""}</div>}
        </div>
      )}

      <div className="mp-snippet" data-tut="mp-snippet">
        <div className="mp-label field-label">
          <span>Use it in a tree</span>
          <InfoTip title="RunProgram" text="Behaviour tree node of the motion server. The tree does the logic and I/O (gripper, torch …) between RunProgram calls; offset_x / y / z shift the program per call (palletizing)." />
        </div>
        <div className="mp-code">
          <code>{snippet}</code>
          <button
            type="button"
            className="mp-icon-btn"
            title="Copy"
            onClick={() => {
              navigator.clipboard?.writeText(snippet).then(() => toast.success("Copied"), () => toast.warning("Copy is blocked by the browser"));
            }}
          >
            <Copy size={13} />
          </button>
        </div>
      </div>
    </div>
  );
}
