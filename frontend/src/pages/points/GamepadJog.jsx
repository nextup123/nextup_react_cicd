// Gamepad jog (port of gamepad.html / gamepad.js). Uses the browser Gamepad
// API and publishes UI_COMMANDS over the app WebSocket, so it works offline
// (the old page needed roslib from a CDN and a direct rosbridge socket).
// Hold LT for joint mode, RT for Cartesian mode (dead-man triggers).
// Lives inside JogPadWindow: it only publishes while `live()` says the
// window has focus.
import { useEffect, useRef, useState } from "react";
import { Badge, cx } from "../../components/ui";
import { useConnection } from "../../lib/ws";
import { publishUiCommand } from "./jogEngine";
import { BTN, GamepadGraphic } from "./GamepadGraphic";

const DEADMAN = 0.2;
const DEADZONE = 0.12;
const dir = (v) => (Math.abs(v) < DEADZONE ? null : v > 0 ? "+" : "-");

const JOINT_MAP = ["j1", "j2", "j3", "j4", "j5", "j6"];
const CART_MAP = ["cx", "cy", "cr", "cp", "cz", "cw"];
// One row per entry of the maps above, in the same order.
const GUIDE = [
  { ctrl: "Left stick", minus: "←", plus: "→", stick: "L", joint: "Joint 1", cart: "X" },
  { ctrl: "Left stick", minus: "↓", plus: "↑", stick: "L", joint: "Joint 2", cart: "Y" },
  { ctrl: "Right stick", minus: "←", plus: "→", stick: "R", joint: "Joint 3", cart: "R (roll)" },
  { ctrl: "Right stick", minus: "↓", plus: "↑", stick: "R", joint: "Joint 4", cart: "P (pitch)" },
  { ctrl: "D-pad", minus: "↓", plus: "↑", stick: "D", joint: "Joint 5", cart: "Z" },
  { ctrl: "D-pad", minus: "←", plus: "→", stick: "D", joint: "Joint 6", cart: "W (yaw)" },
];
const IDLE = { connected: false, name: "", mode: "idle", axes: [0, 0, 0, 0], pressed: new Set(), command: null, row: -1, dir: null };

export function GamepadJog({ live }) {
  const connected = useConnection((s) => s.status === "open");
  const [rate, setRate] = useState(30); // ms between repeats
  const rateRef = useRef(rate);
  rateRef.current = rate;
  const liveRef = useRef(live);
  liveRef.current = live;
  const stateRef = useRef(null);
  const [pad, setPad] = useState(IDLE);

  useEffect(() => {
    const s = { active: null, last: null, timer: null, raf: 0, uiAt: 0, sig: "" };

    const stop = () => {
      if (!s.active) return;
      clearInterval(s.timer);
      s.timer = null;
      const stopCmd = `0${s.active}`;
      if (s.last !== stopCmd) {
        publishUiCommand(stopCmd);
        s.last = stopCmd;
      }
      s.active = null;
    };
    const start = (direction, joint) => {
      if (s.active === joint) return;
      if (s.active) stop();
      s.active = joint;
      const cmd = `${direction}${joint}`;
      if (s.last !== cmd) {
        publishUiCommand(cmd);
        s.last = cmd;
      }
      s.timer = setInterval(() => s.last && publishUiCommand(s.last), rateRef.current);
    };
    s.restart = () => {
      if (!s.timer) return;
      clearInterval(s.timer);
      s.timer = setInterval(() => s.last && publishUiCommand(s.last), rateRef.current);
    };

    const loop = () => {
      const pads = navigator.getGamepads ? navigator.getGamepads() : [];
      const gp = Array.from(pads || []).find(Boolean) || null;
      let mode = "idle";
      let axes = [0, 0, 0, 0];
      let row = -1;
      let direction = null;
      const pressed = new Set();
      if (gp) {
        gp.buttons.forEach((b, i) => (b.pressed || b.value > 0.5) && pressed.add(i));
        const lt = gp.buttons[BTN.LT]?.value || 0;
        const rt = gp.buttons[BTN.RT]?.value || 0;
        if (lt >= DEADMAN && rt < DEADMAN) mode = "joint";
        else if (rt >= DEADMAN && lt < DEADMAN) mode = "cart";
        const [lx = 0, ly = 0, rx = 0, ry = 0] = gp.axes;
        axes = [lx, ly, rx, ry];
        if (mode !== "idle") {
          if (dir(lx)) [row, direction] = [0, dir(lx)];
          else if (dir(ly)) [row, direction] = [1, dir(-ly)];
          else if (dir(rx)) [row, direction] = [2, dir(rx)];
          else if (dir(ry)) [row, direction] = [3, dir(-ry)];
          else if (pressed.has(BTN.UP)) [row, direction] = [4, "+"];
          else if (pressed.has(BTN.DOWN)) [row, direction] = [4, "-"];
          else if (pressed.has(BTN.RIGHT)) [row, direction] = [5, "+"];
          else if (pressed.has(BTN.LEFT)) [row, direction] = [5, "-"];
        }
      }
      const map = mode === "joint" ? JOINT_MAP : CART_MAP;
      if (row >= 0 && liveRef.current?.()) start(direction, map[row]);
      else stop();

      const now = performance.now();
      if (now - s.uiAt > 60) {
        s.uiAt = now;
        const sig = `${Boolean(gp)}|${mode}|${axes.map((a) => a.toFixed(2)).join(",")}|${[...pressed].join(",")}|${s.active ? s.last : ""}|${row}`;
        if (sig !== s.sig) {
          s.sig = sig;
          setPad({ connected: Boolean(gp), name: gp?.id || "", mode, axes, pressed, command: s.active ? s.last : null, row: s.active ? row : -1, dir: s.active ? direction : null });
        }
      }
      s.raf = requestAnimationFrame(loop);
    };
    s.raf = requestAnimationFrame(loop);
    stateRef.current = s;

    return () => {
      cancelAnimationFrame(s.raf);
      stop();
      stateRef.current = null;
    };
  }, []);

  useEffect(() => {
    stateRef.current?.restart?.();
  }, [rate]);

  const activeRow = pad.row >= 0 ? GUIDE[pad.row] : null;
  const hint =
    pad.mode === "idle"
      ? "Hold LT to jog joints or RT to jog in Cartesian, then move a stick or the D-pad."
      : activeRow
        ? `${pad.mode === "joint" ? activeRow.joint : activeRow.cart} ${pad.dir === "+" ? "plus" : "minus"}`
        : pad.mode === "joint"
          ? "Joint mode: move a stick or the D-pad."
          : "Cartesian mode: move a stick or the D-pad.";

  return (
    <div className="col pp-gp" style={{ gap: 12 }}>
      <div className="pp-gp-grid">
        <div className="stat">
          <span className="stat-label">Robot server</span>
          <Badge tone={connected ? "success" : "danger"}>{connected ? "Connected" : "Disconnected"}</Badge>
        </div>
        <div className="stat">
          <span className="stat-label">Gamepad</span>
          <Badge tone={pad.connected ? "success" : "warning"} title={pad.name || undefined}>
            {pad.connected ? "Connected" : "Press any button"}
          </Badge>
        </div>
        <div className="stat">
          <span className="stat-label">Command</span>
          <code className="pp-kp-cmd">{pad.command || "—"}</code>
        </div>
      </div>

      <div className="pp-gp-stage">
        <GamepadGraphic pressed={pad.pressed} axes={pad.axes} mode={pad.mode} active={activeRow} dead={DEADZONE} />
        <div className={cx("pp-gp-hint", pad.mode !== "idle" && "is-mode", activeRow && "is-moving")}>{hint}</div>
      </div>

      <table className="table compact pp-kp-table pp-gp-table">
        <thead>
          <tr>
            <th>Control</th>
            <th className={cx(pad.mode === "joint" && "is-mode")}>Joint (hold LT)</th>
            <th className={cx(pad.mode === "cart" && "is-mode")}>Cartesian (hold RT)</th>
          </tr>
        </thead>
        <tbody>
          {GUIDE.map((g, i) => (
            <tr key={i} className={cx(pad.row === i && "is-active")}>
              <td>
                <span className="strong">{g.ctrl}</span>{" "}
                <span className="pp-gp-dirs">
                  <span className={cx(pad.row === i && pad.dir === "-" && "is-on")}>{g.minus} −</span>
                  <span className={cx(pad.row === i && pad.dir === "+" && "is-on")}>{g.plus} +</span>
                </span>
              </td>
              <td className={cx(pad.mode === "joint" && "is-mode")}>{g.joint}</td>
              <td className={cx(pad.mode === "cart" && "is-mode")}>{g.cart}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <label className="col" style={{ gap: 4 }}>
        <span className="row small">
          <span className="grow strong">Repeat rate</span>
          <span className="tabular muted">{(1000 / rate).toFixed(1)} Hz</span>
        </span>
        <input type="range" min={30} max={1000} value={rate} onChange={(e) => setRate(Number(e.target.value))} className="pp-range" />
      </label>
    </div>
  );
}
