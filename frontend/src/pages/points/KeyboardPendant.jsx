// Keyboard jog pendant: Shift+key jogs joints, Alt+key jogs Cartesian axes,
// publishing UI_COMMANDS while the key is held (port of keyboard_pendant.js:
// 100 ms repeat, 200 ms watchdog, stops when focus leaves the jog pad window).
// Lives inside JogPadWindow, which says through `live()` whether it has focus.
import { useEffect, useRef, useState } from "react";
import { ShieldCheck } from "lucide-react";
import { cx } from "../../components/ui";
import { publishUiCommand } from "./jogEngine";

const CMD = {
  "shift+q": "+j1", "shift+w": "-j1",
  "shift+a": "+j2", "shift+s": "-j2",
  "shift+z": "+j3", "shift+x": "-j3",
  "shift+e": "+j4", "shift+r": "-j4",
  "shift+d": "+j5", "shift+f": "-j5",
  "shift+c": "+j6", "shift+v": "-j6",
  "alt+q": "+cx", "alt+w": "-cx",
  "alt+a": "+cy", "alt+s": "-cy",
  "alt+z": "+cz", "alt+x": "-cz",
  "alt+e": "+cr", "alt+r": "-cr",
  "alt+d": "+cp", "alt+f": "-cp",
  "alt+c": "+cw", "alt+v": "-cw",
};
const OWNED_KEYS = new Set(["q", "w", "a", "s", "z", "x", "e", "r", "d", "f", "c", "v"]);
const ROWS = [
  ["Joint 1 / X", "q", "w"],
  ["Joint 2 / Y", "a", "s"],
  ["Joint 3 / Z", "z", "x"],
  ["Joint 4 / R", "e", "r"],
  ["Joint 5 / P", "d", "f"],
  ["Joint 6 / W", "c", "v"],
];

/** Letter from a key event, independent of Alt/Shift producing other characters. */
function letterOf(e) {
  if (e.code && /^Key[A-Z]$/.test(e.code)) return e.code.slice(3).toLowerCase();
  return (e.key || "").toLowerCase();
}

function getCombo(e) {
  if (e.metaKey || e.ctrlKey) return null;
  if (e.shiftKey && e.altKey) return null;
  const k = letterOf(e);
  if (k.length !== 1) return null;
  if (e.shiftKey) return `shift+${k}`;
  if (e.altKey) return `alt+${k}`;
  return null;
}

export function KeyboardPendant({ live: isLive }) {
  const liveRef = useRef(isLive);
  liveRef.current = isLive;
  const st = useRef({ cmd: null, combo: null, heartbeat: 0, repeat: null, watch: null });
  const [status, setStatus] = useState({ text: "Ready: hold Shift+key (joint) or Alt+key (Cartesian)", tone: "idle" });
  const [lastCmd, setLastCmd] = useState("—");
  const [activeCombo, setActiveCombo] = useState(null);

  useEffect(() => {
    const s = st.current;
    const live = () => Boolean(liveRef.current?.());
    const stopJog = (reason) => {
      clearInterval(s.repeat);
      s.repeat = null;
      if (!s.cmd) return;
      const stop = `0${s.cmd.slice(1)}`;
      publishUiCommand(stop);
      setLastCmd(stop);
      setStatus(reason ? { text: reason, tone: "warn" } : { text: `Stopped (${stop})`, tone: "stop" });
      s.cmd = null;
      s.combo = null;
      setActiveCombo(null);
    };
    const startJog = (combo, cmd) => {
      if (s.cmd && s.combo !== combo) stopJog();
      s.cmd = cmd;
      s.combo = combo;
      s.heartbeat = Date.now();
      publishUiCommand(cmd);
      setStatus({ text: `Jogging ${cmd}`, tone: "active" });
      setLastCmd(cmd);
      setActiveCombo(combo);
      clearInterval(s.repeat);
      s.repeat = setInterval(() => {
        if (!live()) return stopJog("Stopped: click the pad to resume");
        publishUiCommand(cmd);
        s.heartbeat = Date.now();
      }, 100);
    };

    const onKeyDown = (e) => {
      const k = letterOf(e);
      if (!live()) return;
      if (OWNED_KEYS.has(k) && !e.ctrlKey && !e.metaKey && (e.shiftKey || e.altKey)) {
        e.preventDefault();
        e.stopPropagation();
      }
      const c = getCombo(e);
      if (!c || !CMD[c]) return;
      if (c === s.combo) return; // still held; the repeat timer keeps publishing
      startJog(c, CMD[c]);
    };
    const onKeyUp = (e) => {
      if (!s.combo) return;
      const k = e.key === "Shift" || e.key === "Alt" ? e.key.toLowerCase() : letterOf(e);
      if (s.combo.split("+").includes(k)) stopJog();
    };
    const watchdog = () => {
      if (!s.cmd) return;
      if (!live() || Date.now() - s.heartbeat > 200) stopJog("Auto-stopped (200 ms failsafe)");
    };
    const onBlur = () => s.cmd && stopJog("Stopped: window lost focus");
    const onFocusIn = () => s.cmd && !live() && stopJog("Stopped: click the pad to resume");
    const onVis = () => document.hidden && s.cmd && stopJog("Stopped: page hidden");

    stopJog();
    setStatus({ text: "Ready: hold Shift+key (joint) or Alt+key (Cartesian)", tone: "idle" });
    setLastCmd("—");
    s.watch = setInterval(watchdog, 50);
    document.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("keyup", onKeyUp, true);
    window.addEventListener("blur", onBlur);
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("pagehide", onBlur);

    return () => {
      stopJog();
      clearInterval(s.watch);
      s.watch = null;
      document.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("keyup", onKeyUp, true);
      window.removeEventListener("blur", onBlur);
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("pagehide", onBlur);
    };
  }, []);

  const key = (k, mod) => (
    <span className={cx("kbd pp-kp-key", mod === "shift" ? "is-joint" : "is-cart", activeCombo === `${mod}+${k}` && "is-active")}>{k.toUpperCase()}</span>
  );

  return (
    <div className="pp-kp">
      <div className="pp-kp-status">
        <div className="row">
          <span className="section-label pp-kp-lbl">Status</span>
          <span className={cx("pp-kp-pill", `is-${status.tone}`)}>{status.text}</span>
        </div>
        <div className="row">
          <span className="section-label pp-kp-lbl">Last command</span>
          <code className="pp-kp-cmd">{lastCmd}</code>
        </div>
        <div className="xs muted row">
          <ShieldCheck size={12} /> Failsafe: stops automatically after 200 ms without a key repeat.
        </div>
      </div>
      <table className="table compact pp-kp-table">
        <thead>
          <tr>
            <th>Axis</th>
            <th>Joint (hold Shift)</th>
            <th>Cartesian (hold Alt)</th>
          </tr>
        </thead>
        <tbody>
          {ROWS.map(([label, pk, nk]) => (
            <tr key={label} className={cx(activeCombo && [pk, nk].includes(activeCombo.split("+")[1]) && "is-active")}>
              <td className="strong">{label}</td>
              <td>
                <span className="row" style={{ gap: 6 }}>
                  {key(pk, "shift")} <span className="xs muted">+</span> {key(nk, "shift")} <span className="xs muted">−</span>
                </span>
              </td>
              <td>
                <span className="row" style={{ gap: 6 }}>
                  {key(pk, "alt")} <span className="xs muted">+</span> {key(nk, "alt")} <span className="xs muted">−</span>
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
