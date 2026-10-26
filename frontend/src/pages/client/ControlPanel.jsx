import { useCallback, useEffect, useRef, useState } from "react";
import { Activity, Flag, Hourglass, Minus, OctagonAlert, PauseCircle, Play, Plus, Power, Square } from "lucide-react";
import { Button, IconButton, Modal, cx } from "../../components/ui";
import { ProcessSwitch } from "../../components/robot/ProcessSwitch";
import { send } from "../../lib/ws";
import { useWsMessage } from "../../lib/useWs";
import { useSettings } from "../../lib/queries";
import { confirm } from "../../store/confirm";
import { toast } from "../../store/toast";
import { selectAllOperational, selectAnyEmergency, selectAnyFault, selectLatched, useRobot } from "../../store/robot";
import { CAUSE_TEXT, PROFILE_LABEL } from "../../lib/robotText";
import ProductionStrip from "./ProductionStrip";
import { initialSpeedRamp, publishSpeedOverride, publishSpeedScale, speedForSettings, useClientState } from "./clientState";

const START_SAFETY_MS = 8000;
const firstWord = (s) => String(s ?? "").trim().split(/\s+/)[0].toLowerCase();

/** 240° arc from `from` to `to` (0..1) on a circle of radius r around (60, 60). */
function arc(from, to, r = 48) {
  const ang = (t) => ((-210 + 240 * t) * Math.PI) / 180;
  const p = (t) => [60 + r * Math.cos(ang(t)), 60 + r * Math.sin(ang(t))];
  const [x1, y1] = p(from);
  const [x2, y2] = p(to);
  return `M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${r} ${r} 0 ${to - from > 0.75 ? 1 : 0} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`;
}

function SpeedOverride() {
  const value = useClientState((s) => s.speedOverride);
  const sup = useRobot((s) => s.supervisor);
  const cap = sup ? Math.min(100, Math.max(0, sup.speedScale)) : null;
  const capped = cap !== null && cap < value;
  const effective = capped ? cap : value;
  useEffect(() => {
    initialSpeedRamp();
  }, []);
  return (
    <div className="cc-speed" data-tut="cc-speed">
      <div className="cc-speed-top">
        <span className="cc-label">Speed override</span>
        <span className="cc-gauge-sub">{capped ? `limited to ${cap} %` : sup ? `effective ${effective} %` : ""}</span>
      </div>
      <div className="cc-speed-main">
        <div className="cc-gauge" title={capped ? `Capped to ${cap} % in ${PROFILE_LABEL[sup.profile] || "this mode"} by the supervisor` : "Applies immediately, also while running"}>
          <svg viewBox="0 0 120 104" aria-hidden>
            <path d={arc(0, 1)} className="cc-gauge-track" />
            {value > 0 && <path d={arc(0, Math.max(0.005, value / 100))} className={cx("cc-gauge-set", capped && "is-capped")} />}
            {effective > 0 && <path d={arc(0, Math.max(0.005, effective / 100))} className="cc-gauge-value" />}
            {capped && <path d={arc(cap / 100, Math.min(1, cap / 100 + 0.006), 48)} className="cc-gauge-cap" />}
          </svg>
          <div className="cc-gauge-num">
            <span className="tabular">{value}</span>
            <small>%</small>
          </div>
        </div>
        <div className="cc-speed-row">
          <IconButton icon={Minus} label="Slower (−5 %)" variant="default" size="sm" onClick={() => publishSpeedOverride(value - 5)} disabled={value <= 0} />
          <input
            type="range"
            className="cc-range"
            min={0}
            max={100}
            step={1}
            value={value}
            style={{ "--fill": `${value}%` }}
            aria-label="Speed override in percent"
            onChange={(e) => publishSpeedOverride(Number(e.target.value))}
          />
          <IconButton icon={Plus} label="Faster (+5 %)" variant="default" size="sm" onClick={() => publishSpeedOverride(value + 5)} disabled={value >= 100} />
        </div>
      </div>
    </div>
  );
}

/** START / STOP / FINISH, process switch, robot state, speed override and the production figures. */
export default function ControlPanel() {
  const processStatus = useRobot((s) => s.processStatus);
  const controlActive = useRobot((s) => s.controlActive);
  const emergency = useRobot(selectAnyEmergency);
  const fault = useRobot(selectAnyFault);
  const allOperational = useRobot(selectAllOperational);
  const hasDriverStatus = useRobot((s) => s.hasDriverStatus);
  const latched = useRobot(selectLatched);
  const sup = useRobot((s) => s.supervisor);
  const bt = useRobot((s) => s.btActive);
  const { data: settings } = useSettings();

  const word = firstWord(processStatus);
  const [ready, setReady] = useState(controlActive);
  const [starting, setStarting] = useState(false);
  const [blocked, setBlocked] = useState(null); // string[] | null
  const safetyTimer = useRef(null);
  const stoppedTimer = useRef(null);

  useEffect(() => () => {
    clearTimeout(safetyTimer.current);
    clearTimeout(stoppedTimer.current);
  }, []);

  // START is enabled while the robot program reports ready (/control_start_bt_active).
  useWsMessage("CONTROL_ACTIVE", (p) => {
    clearTimeout(stoppedTimer.current);
    setReady(Boolean(p));
  });

  useWsMessage("PROCESS_STATUS", (p) => {
    const w = firstWord(typeof p === "string" ? p : JSON.stringify(p || ""));
    if (w === "stopped") {
      clearTimeout(stoppedTimer.current);
      stoppedTimer.current = setTimeout(() => setReady(false), 1000);
    }
  });

  const finishStart = useCallback(() => {
    clearTimeout(safetyTimer.current);
    setStarting(false);
  }, []);

  useWsMessage("ACTION_RESULT", (p) => {
    if (p?.action !== "start_bt") return;
    finishStart();
    if (!p.ok) {
      setBlocked([`Start failed: ${p.message || "Auto mode switch failed"}`]);
    } else if (p.modeOk === false) toast.warning(p.message || "Started, but the Auto mode switch was incomplete");
    else toast.success(p.message || "Robot program started");
  });

  const stop = () => {
    send("UI_COMMANDS", { command: "control_reset_bt", value: true });
    finishStart();
    toast.info("Stop sent to the robot program");
  };

  // control_logic_bt maps the old /control_exit_bt topic to "finish cycle":
  // the program completes the cycle it is in, then stops.
  const finishCycle = () => {
    send("UI_COMMANDS", { command: "control_exit_bt", value: true });
    finishStart();
    toast.info("The program stops after the current cycle");
  };

  const start = async () => {
    if (!ready || starting) return;
    const issues = [];
    if (latched) issues.push(`Emergency is latched (${CAUSE_TEXT[sup?.cause] || "unknown cause"}). Press Reset in the top bar.`);
    else if (emergency) issues.push("Emergency stop is active. Release it and press Reset.");
    if (fault) issues.push("A drive reports a fault. Press Reset to clear it.");
    if (issues.length) return setBlocked(issues);
    if (hasDriverStatus && !allOperational) {
      const ok = await confirm({
        title: "Some drives are not enabled",
        message: "Not every joint drive reports “operational”. The program may not be able to move.\nStart anyway?",
        tone: "warning",
        confirmLabel: "Start anyway",
      });
      if (!ok) return;
    }
    // Same order as before: send the speed scale of the selected mode, then start.
    publishSpeedScale(speedForSettings(settings));
    setStarting(true);
    clearTimeout(safetyTimer.current);
    safetyTimer.current = setTimeout(() => setStarting(false), START_SAFETY_MS);
    send("UI_COMMANDS", { command: "start_bt" });
  };

  const running = word === "running";
  let state;
  if (latched) state = { icon: OctagonAlert, tone: "danger", title: "Emergency stop", text: `${CAUSE_TEXT[sup?.cause] || "Emergency latched"}${sup?.causeJoint ? ` (${sup.causeJoint})` : ""}. ${sup?.estop ? "Release the button, then press Reset." : "Press Reset in the top bar."}` };
  else if (emergency) state = { icon: OctagonAlert, tone: "danger", title: "E-STOP active", text: "Release the emergency stop, then press Reset." };
  else if (fault) state = { icon: OctagonAlert, tone: "danger", title: "Drive fault", text: "Press Reset in the top bar to clear the fault." };
  else if (starting) state = { icon: Hourglass, tone: "primary", title: "Starting…", text: "Switching to Auto and starting the program." };
  else if (controlActive && bt?.paused) state = { icon: PauseCircle, tone: "primary", title: "Paused", text: `Step mode${bt.running?.[0] ? ` at ${bt.running[0].name}` : ""}. Continue from the banner at the top.` };
  else if (running) state = { icon: Activity, tone: "success", title: "Running", text: "The robot program is running." };
  else if (ready) state = { icon: Play, tone: "primary", title: "Ready to start", text: "Press Start to run the program." };
  else state = { icon: Power, tone: "off", title: "Not ready", text: "Turn on Process and wait for the program to report ready." };

  const startTitle = starting
    ? "Start in progress…"
    : !ready
      ? "Not ready: the robot program has not reported ready. Turn on Process and wait."
      : "Start the robot program (switches to Auto first)";

  const StateIcon = state.icon;
  return (
    <section className={cx("cc-deck", `is-${state.tone}`)} data-tut="cc-deck">
      <div className="cc-state" data-tut="cc-state">
        <div className="cc-state-head">
          <span className="cc-state-icon">
            <StateIcon size={22} />
          </span>
          <div className="col" style={{ gap: 2, minWidth: 0 }}>
            <span className="cc-state-title">{state.title}</span>
            <span className="cc-state-text">{state.text}</span>
          </div>
        </div>
        <div className="cc-facts" data-tut="cc-facts">
          <ProcessSwitch />
          <span className="cc-fact" title="Process status reported by the robot">
            <small>Status</small>
            <b>{processStatus || "—"}</b>
          </span>
          {sup?.profile && (
            <span className="cc-fact" title="Mode of operation (supervisor)">
              <small>Mode</small>
              <b>{PROFILE_LABEL[sup.profile] || sup.profile}</b>
            </span>
          )}
          {controlActive && bt && (
            <span className="cc-fact" title={bt.lastEvent || undefined}>
              <small>Cycle</small>
              <b className="tabular">{bt.cycle}</b>
            </span>
          )}
        </div>
        {controlActive && bt?.running?.[0] && (
          <div className="cc-now" title={bt.lastEvent || undefined}>
            <span className="cc-now-dot" />
            Now <b>{bt.running[0].name}</b>
            {bt.running[0].ms > 1500 ? <span className="muted"> · {(bt.running[0].ms / 1000).toFixed(0)} s</span> : null}
          </div>
        )}
      </div>

      <div className="cc-buttons" data-tut="cc-buttons">
        <button type="button" className="cc-big is-start" data-tut="cc-start" onClick={start} disabled={!ready || starting} title={startTitle}>
          <span className="cc-big-icon"><Play size={18} fill="currentColor" /></span>
          <span className="cc-big-text"><span className="cc-big-label">{starting ? "Starting" : "Start"}</span>
          <span className="cc-big-hint">{starting ? "Switching to Auto…" : ready ? "Run the program" : "Waiting for ready"}</span></span>
        </button>
        <button type="button" className="cc-big is-stop" data-tut="cc-stop" onClick={stop} title="Stop and reset the robot program">
          <span className="cc-big-icon"><Square size={15} fill="currentColor" /></span>
          <span className="cc-big-text"><span className="cc-big-label">Stop</span>
          <span className="cc-big-hint">Stop and reset</span></span>
        </button>
        <button type="button" className="cc-big is-exit" data-tut="cc-finish" onClick={finishCycle} title="Let the program finish the cycle it is in, then stop (no abrupt stop)">
          <span className="cc-big-icon"><Flag size={17} /></span>
          <span className="cc-big-text"><span className="cc-big-label">Finish Cycle</span>
          <span className="cc-big-hint">Stop after this cycle</span></span>
        </button>
      </div>

      <SpeedOverride />

      <ProductionStrip />

      <Modal
        tut="cc-blocked"
        open={Boolean(blocked)}
        onClose={() => setBlocked(null)}
        size="sm"
        title="Robot cannot start"
        footer={
          <Button variant="primary" onClick={() => setBlocked(null)}>
            OK
          </Button>
        }
      >
        <ul className="cc-blocked">
          {(blocked || []).map((b) => (
            <li key={b}>{b}</li>
          ))}
        </ul>
      </Modal>
    </section>
  );
}
