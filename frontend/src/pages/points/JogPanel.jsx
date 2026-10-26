import { useEffect, useRef, useState } from "react";
import { Crosshair, Gamepad2, Gauge, Keyboard, Minus, Move3d, Navigation, Play, Plus, RotateCw, Settings, Settings2, Wrench } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Alert, Badge, Button, Card, Menu, Select, cx } from "../../components/ui";
import { send, useConnection } from "../../lib/ws";
import { useWsMessage } from "../../lib/useWs";
import { useRobot } from "../../store/robot";
import { toast } from "../../store/toast";
import { JOG_AXES, onJogChange, setJogMethod, startJog, stopJog } from "./jogEngine";
import { nexsimClearPreview, nexsimPreview } from "./nexsimStore";
import { SPECIAL_FRAMES, fmt, rad2deg } from "./pointsApi";
import { GotoTargetModal } from "../../components/robot/GotoTargetModal";

const MODES = [
  { value: "safeauto", label: "SafeAuto", hint: "Reduced-speed automatic" },
  { value: "jog", label: "Jog", hint: "Manual jogging" },
  { value: "auto", label: "Auto", hint: "Full-speed automatic" },
];
const MODE_LABEL = { safeauto: "SafeAuto", jog: "Jog", auto: "Auto" };
const JOG_METHOD_KEY = "nextup.pp.jogMethod"; // chosen in Settings › Point teach

/* ───────────── Mode of operation (3-mode switch with live progress) ───────────── */
function ModeSwitch({ disabled }) {
  const liveMode = useRobot((s) => s.mode);
  const [frozenMode, setFrozenMode] = useState(null);
  const modeSwitch = useRobot((s) => s.modeSwitch);
  const latched = useRobot((s) => Boolean(s.supervisor?.latched));
  const [pending, setPending] = useState(null);
  const [error, setError] = useState(null);
  const [settled, setSettled] = useState(false); // briefly show the full bar after success
  const safety = useRef(null);
  const pendingRef = useRef(null);
  pendingRef.current = pending;
  // While our own switch runs, keep showing the last confirmed mode (the old
  // control ignored MODE_STATE while busy; the thumb moves on the result).
  const mode = pending ? frozenMode : liveMode;

  const finish = () => {
    clearTimeout(safety.current);
    safety.current = null;
    setPending(null);
  };

  useEffect(() => () => clearTimeout(safety.current), []);

  useWsMessage("MODE_SWITCH_PROGRESS", (evt) => {
    if (!pendingRef.current || !evt) return;
    if (evt.phase === "error" || evt.failed) {
      setError(evt.message || "Mode switch failed");
      toast.error(`Mode switch failed: ${evt.message || "unknown error"}`);
      finish();
    }
  });

  useWsMessage("MODE_SWITCH_RESULT", (res) => {
    if (!pendingRef.current || !res) return;
    if (res.ok) {
      setError(null);
      setSettled(true);
      setTimeout(() => setSettled(false), 450);
      toast.success(`Mode: ${MODE_LABEL[res.mode] || res.mode}`);
    } else {
      setError(res.message || "Mode switch failed");
      toast.error(res.message || "Mode switch failed");
    }
    finish();
  });

  const request = (next) => {
    if (pending || next === mode) return;
    setError(null);
    setFrozenMode(mode);
    setPending(next);
    // Hard safety: re-enable if the backend never answers (the supervisor
    // itself gives up after settle + confirm + rollback, about 8 s).
    clearTimeout(safety.current);
    safety.current = setTimeout(() => {
      setError("Mode switch timed out");
      toast.error("Mode switch timed out");
      finish();
    }, 11000);
    send("SWITCH_MODE", { mode: next, fromMode: mode || undefined });
  };

  const progress = pending ? Math.max(0, Math.min(100, modeSwitch?.progress ?? 0)) : settled ? 100 : error ? 100 : 0;
  const showBar = pending || settled || error;

  return (
    <div className="pp-mode">
      <div className="pp-mode-seg" role="tablist" aria-label="Mode of operation" data-tut="pp-modes">
        {MODES.map((m) => (
          <button
            key={m.value}
            type="button"
            role="tab"
            data-tut={`pp-mode-${m.value}`}
            aria-selected={mode === m.value}
            className={cx(mode === m.value && "is-active", pending === m.value && "is-pending")}
            disabled={disabled || !!pending || (latched && m.value !== "jog")}
            title={disabled ? "Robot server not connected" : pending ? "A mode switch is in progress" : latched && m.value !== "jog" ? "Emergency is latched: press Reset first" : m.hint}
            onClick={() => request(m.value)}
          >
            {m.label}
          </button>
        ))}
      </div>
      <div className={cx("pp-mode-bar", error && "is-error", !showBar && "is-hidden")}>
        <div className="pp-mode-bar-fill" style={{ width: `${progress}%` }} />
      </div>
      <div className="pp-mode-status xs">
        {pending ? (
          <span className="muted">
            Switching to {MODE_LABEL[pending]}: {modeSwitch?.message || "requesting"}… {Math.round(progress)}%
          </span>
        ) : error ? (
          <span className="text-danger">{error}</span>
        ) : latched ? (
          <span className="text-danger">Emergency latched. Press Reset in the top bar, then jog.</span>
        ) : mode === "jog" ? (
          <span className="muted">Mode: Jog. Hold the buttons below to move the robot.</span>
        ) : mode ? (
          <span className="text-warning">Mode: {MODE_LABEL[mode]}. Switch to Jog to move by hand.</span>
        ) : (
          <span className="muted">Detecting mode…</span>
        )}
      </div>
    </div>
  );
}

/* ───────────── Start servo ───────────── */
function StartServoButton({ disabled }) {
  const [state, setState] = useState("idle"); // idle | busy | ok | error
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);

  useWsMessage("SERVO_RESPONSE", (res) => {
    if (state !== "busy") return;
    const ok = Boolean(res?.success);
    setState(ok ? "ok" : "error");
    if (ok) toast.success(res?.message || "Servo started");
    else toast.error(res?.message || "Failed to start servo");
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setState("idle"), 2000);
  });

  const start = () => {
    setState("busy");
    send("START_SERVO", {});
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      setState("idle");
      toast.warning("No answer from the robot to Start servo");
    }, 6000);
  };

  return (
    <Button
      variant={state === "error" ? "danger" : "success"}
      icon={Play}
      loading={state === "busy"}
      disabled={disabled}
      title={disabled ? "Robot server not connected" : "Start the servo node so the jog buttons can move the robot"}
      onClick={start}
    >
      {state === "ok" ? "Servo running" : "Start servo"}
    </Button>
  );
}

/* ───────────── Servo / jog frame ───────────── */
function FrameSelect({ points, disabled }) {
  const servoFrame = useRobot((s) => s.servoFrame);
  const tfPoints = (points || []).filter((p) => p.is_tf);
  const known = SPECIAL_FRAMES.some((f) => f.value === servoFrame) || tfPoints.some((p) => p.name === servoFrame);

  const change = (frame) => {
    if (!frame) return;
    send("SET_SERVO_FRAME", { frame });
    useRobot.setState({ servoFrame: frame }); // optimistic; SERVO_FRAME_CHANGED confirms
    toast.success(`Jog frame set to ${frame}`);
  };

  return (
    <label className="pp-frame" title="Reference frame for Cartesian jogging" data-tut="pp-frame">
      <span className="xs muted">Frame</span>
      <Select size="sm" value={servoFrame || ""} onChange={(e) => change(e.target.value)} disabled={disabled} title={disabled ? "Robot server not connected" : "Reference frame for Cartesian jogging"}>
        <option value="" disabled>
          Select frame…
        </option>
        {servoFrame && !known && <option value={servoFrame}>{servoFrame}</option>}
        <optgroup label="Special frames">
          {SPECIAL_FRAMES.map((f) => (
            <option key={f.value} value={f.value}>
              {f.label}
            </option>
          ))}
        </optgroup>
        <optgroup label="TF points">
          {tfPoints.length === 0 ? (
            <option disabled value="__none">
              No TF points
            </option>
          ) : (
            tfPoints.map((p) => (
              <option key={p.name} value={p.name}>
                {p.name}
              </option>
            ))
          )}
        </optgroup>
      </Select>
    </label>
  );
}

/* ───────────── Jog buttons ───────────── */
function useActiveJog() {
  const [active, setActive] = useState(null);
  useEffect(() => onJogChange(setActive), []);
  return active;
}

function JogButton({ axis, dir, label, disabled, active }) {
  const Icon = dir === "+" ? Plus : Minus;
  return (
    <button
      type="button"
      className={cx("pp-jog-btn", dir === "+" ? "is-plus" : "is-minus", active && "is-active")}
      data-tut={`jog-${axis}-${dir === "+" ? "plus" : "minus"}`}
      disabled={disabled}
      aria-label={label}
      title={disabled ? "Robot server not connected" : `Hold to jog ${label}`}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        startJog(axis, dir);
      }}
      onPointerUp={stopJog}
      onPointerCancel={stopJog}
      onPointerLeave={() => {
        stopJog();
        nexsimClearPreview();
      }}
      onPointerEnter={() => nexsimPreview(axis, dir)}
      onContextMenu={(e) => {
        e.preventDefault();
        stopJog();
      }}
      onKeyDown={(e) => e.key === "Enter" && e.preventDefault()}
    >
      <Icon size={22} strokeWidth={2.5} />
    </button>
  );
}

function JogGroup({ title, icon: Icon, axes, values, disabled, active, extra, tut }) {
  return (
    <div className="pp-jog-group" data-tut={tut}>
      <div className="pp-jog-group-title">
        <Icon size={15} />
        <span className="pp-jog-group-name">{title}</span>
        {extra}
      </div>
      {axes.map((a, i) => (
        <div className="pp-jog-row" key={a.id} title={a.hint}>
          <span className="pp-jog-axis">{a.label}</span>
          <JogButton axis={a.id} dir="-" label={`${a.label} minus`} disabled={disabled} active={active === `${a.id}-`} />
          <span className="pp-jog-value tabular">
            {fmt(values[i])}
            <span className="pp-jog-unit">{a.unit}</span>
          </span>
          <JogButton axis={a.id} dir="+" label={`${a.label} plus`} disabled={disabled} active={active === `${a.id}+`} />
        </div>
      ))}
    </div>
  );
}

function readJogMethod() {
  try {
    return localStorage.getItem(JOG_METHOD_KEY) === "servo" ? "servo" : "step";
  } catch {
    return "step";
  }
}

export function JogPanel({ points, onTool }) {
  const connected = useConnection((s) => s.status === "open");
  const positions = useRobot((s) => s.positions);
  const cartesian = useRobot((s) => s.cartesian);
  const tcp = useRobot((s) => s.tcp);
  const active = useActiveJog();
  const [jogMethod] = useState(readJogMethod);
  const [dialog, setDialog] = useState(null); // "goto"
  const navigate = useNavigate();

  useEffect(() => {
    setJogMethod(jogMethod);
  }, [jogMethod]);

  // Losing the connection while a button is held must stop the jog.
  useEffect(() => {
    if (!connected) stopJog();
  }, [connected]);

  const jointDeg = (positions || []).map(rad2deg);
  const disabled = !connected;

  return (
    <Card
      className="pp-jog-card"
      tut="pp-jog"
      title="Robot motion"
      icon={Gauge}
      bodyClassName="pp-jog-body"
      actions={
        <>
          {tcp && (
            <Badge tone={tcp.speed > 0.002 ? "primary" : undefined} title={`Measured tool speed${tcp.frame ? ` (${tcp.frame})` : ""}`}>
              TCP {fmt(tcp.speed * 1000, 0)} mm/s
            </Badge>
          )}
          {onTool && (
            <Menu
              trigger={({ toggle }) => (
                <Button data-tut="pp-tools" size="sm" icon={Wrench} onClick={toggle}>
                  Tools
                </Button>
              )}
              items={[
                { label: "Keyboard pendant", icon: Keyboard, onClick: () => onTool("keyboard") },
                { label: "Gamepad jog", icon: Gamepad2, onClick: () => onTool("gamepad") },
              ]}
            />
          )}
          {jogMethod === "servo" && (
            <Badge tone="warning" title="Jog buttons stream ramped velocity commands (SERVO_JOG)">
              Servo velocity jog
            </Badge>
          )}
          <Menu
            trigger={({ toggle }) => <Button data-tut="pp-jog-settings" size="sm" variant="ghost" icon={Settings2} onClick={toggle} aria-label="Jog settings" title="Jog settings" />}
            items={[
              { header: "Robot" },
              { label: "Go to joint values or a pose…", icon: Navigation, onClick: () => setDialog("goto") },
              "-",
              { label: "Homes, tool offset, jog method…", icon: Settings, onClick: () => navigate("/setup/point-teach"), title: "One-time setup lives in Settings › Point teach" },
            ]}
          />
        </>
      }
    >
      <div className="pp-jog-controls">
        <div className="pp-jog-control">
          <span className="section-label" data-tut="pp-mode-label">Mode of operation</span>
          <ModeSwitch disabled={disabled} />
        </div>
        <div className="pp-jog-control pp-jog-control-end" data-tut="pp-servo">
          <span className="section-label">Servo</span>
          <StartServoButton disabled={disabled} />
        </div>
      </div>

      {!connected && <Alert tone="warning">Robot server not connected. Jogging is disabled until the connection is back.</Alert>}

      <div className="pp-jog-groups">
        <JogGroup tut="pp-joints" title="Joints" icon={RotateCw} axes={JOG_AXES.joint} values={jointDeg} disabled={disabled} active={active} />
        <JogGroup
          title="Cartesian"
          tut="pp-cart"
          icon={Move3d}
          axes={JOG_AXES.cart}
          values={cartesian || []}
          disabled={disabled}
          active={active}
          extra={<FrameSelect points={points} disabled={disabled} />}
        />
      </div>
      <div className="xs muted pp-jog-hint">
        <Crosshair size={12} /> Press and hold a button to move; release to stop.
      </div>
      <GotoTargetModal open={dialog === "goto"} onClose={() => setDialog(null)} />
    </Card>
  );
}
