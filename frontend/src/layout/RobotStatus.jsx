import { useRobot } from "../store/robot";
import { useConnection } from "../lib/ws";
import { useBridgeInfo } from "../lib/queries";
import { cx } from "../components/ui";
import { PHASE_TEXT, PROFILE_LABEL } from "../lib/robotText";
import { toggleDockPanel, useDockOpen } from "../store/statusDock";

const JOINTS = [1, 2, 3, 4, 5, 6];

/**
 * The four robot signals. `good[i]` is true when joint i is in the active
 * (healthy) state: drive operational, no fault, at home, E-stop released.
 */
function useSignals() {
  const operational = useRobot((s) => s.operational);
  const fault = useRobot((s) => s.fault);
  const homed = useRobot((s) => s.homed);
  const emergency = useRobot((s) => s.emergency);
  const latched = useRobot((s) => Boolean(s.supervisor?.latched || s.supervisor?.estop));
  const isolated = useRobot((s) => s.supervisor?.isolated);
  const hasSup = useRobot((s) => Boolean(s.supervisor));
  return [
    { key: "drives", short: "D", label: "Drives", good: operational, okText: "operational", badText: "not operational" },
    { key: "faults", short: "F", label: "Faults", good: fault.map((f) => !f), okText: "no fault", badText: "FAULT" },
    { key: "homed", short: "H", label: "Homed", good: homed, okText: "at home", badText: "not at home" },
    { key: "estop", short: "E", label: "E-Stop", good: emergency.map((e) => !e && !latched), okText: "released", badText: "EMERGENCY" },
    {
      key: "isolated",
      short: "I",
      label: "Isolation",
      good: JOINTS.map((_, i) => !isolated?.[i]),
      none: !hasSup,
      okText: "in use (not isolated)",
      badText: "ISOLATED: left out after its fault (relaxed latching, JOG only) until Reset",
    },
  ];
}

/** ok: every joint active · warn: some · bad: none. */
const levelOf = (good) => (good.every(Boolean) ? "ok" : good.some(Boolean) ? "warn" : "bad");
const yes = (v) => (v === undefined || v === null ? "–" : v ? "Yes" : "No");

/** Detail panel: every signal per joint plus the supervisor's view of the robot. */
export function JointsDetail() {
  const signals = useSignals();
  const sup = useRobot((s) => s.supervisor);
  const driveStates = useRobot((s) => s.driveStates);
  const lastError = useRobot((s) => s.lastError);
  const jointValues = useRobot((s) => s.jointValues);
  const followingError = useRobot((s) => s.followingError);
  const hasData = useRobot((s) => s.hasDriverStatus);
  const rows = signals;
  const facts = sup
    ? [
        ["Armed", yes(sup.armed), sup.armed ? "ok" : "bad"],
        ["Standstill", yes(sup.standstill), sup.standstill ? "" : "info"],
        ["All enabled", yes(sup.allEnabled), sup.allEnabled ? "ok" : "bad"],
        ["Any fault", yes(sup.anyFault), sup.anyFault ? "bad" : "ok"],
        ["Mode", `${PROFILE_LABEL[sup.profile] || sup.profile || "–"}${sup.driveMode ? ` · drive ${sup.driveMode}` : ""}`, ""],
        ["Phase", PHASE_TEXT[sup.phase] || sup.phase || "–", sup.phase === "running" ? "" : "warn"],
        ["Latching", sup.strict ? "Strict" : "Relaxed", sup.strict ? "" : "warn"],
        ["Speed", `${sup.speedOverride} % · scale ${sup.speedScale} %`, ""],
      ]
    : null;
  return (
    <div className="sd">
      <table className="sd-grid">
        <thead>
          <tr>
            <th />
            {JOINTS.map((j) => (
              <th key={j}>J{j}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key}>
              <th>{r.label}</th>
              {r.good.map((g, i) => (
                <td key={i} title={r.none ? `J${i + 1}: no data` : `J${i + 1}: ${g ? r.okText : r.badText}`}>
                  <span className={cx("sd-dot", r.none || (!hasData && r.key !== "isolated") ? "is-none" : g ? "is-ok" : r.key === "isolated" ? "is-warn" : "is-bad")} />
                </td>
              ))}
            </tr>
          ))}
          <tr className="sd-text sd-num">
            <th title="Joint position in degrees (5 Hz)">Position °</th>
            {jointValues.map((v, i) => (
              <td key={i} className="mono">{Number.isFinite(Number(v)) ? Number(v).toFixed(1) : "–"}</td>
            ))}
          </tr>
          {followingError.some((v) => v !== null && v !== undefined) && (
            <tr className="sd-text sd-num">
              <th title="Position following error reported by the drive">Follow err.</th>
              {followingError.map((v, i) => (
                <td key={i} className="mono">{v === null || v === undefined ? "–" : v}</td>
              ))}
            </tr>
          )}
          {driveStates.some(Boolean) && (
            <tr className="sd-text">
              <th>State</th>
              {driveStates.map((st, i) => (
                <td key={i} title={st}>{String(st || "–").replace(/_/g, " ").toLowerCase().replace("operation enabled", "op. en.").slice(0, 9)}</td>
              ))}
            </tr>
          )}
          {lastError.some(Boolean) && (
            <tr className="sd-text">
              <th>Last error</th>
              {lastError.map((c, i) => (
                <td key={i} className="mono">{c ? `0x${Number(c).toString(16).toUpperCase()}` : "–"}</td>
              ))}
            </tr>
          )}
        </tbody>
      </table>
      {facts ? (
        <dl className="sd-facts">
          {facts.map(([k, v, tone]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd className={tone ? `is-${tone}` : undefined}>{v}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="xs muted" style={{ padding: "6px 4px 2px" }}>The motion supervisor is not reporting.</p>
      )}
    </div>
  );
}

/**
 * Compact robot status: one lamp with a short verdict, a 5 × 6 matrix
 * (drives, faults, homed, E-stop, isolation per joint) and the supervisor's
 * armed and standstill flags. Click to open the joints panel (it stays open
 * next to the motion and program panels until closed).
 */
export function RobotStatus() {
  const signals = useSignals();
  const hasData = useRobot((s) => s.hasDriverStatus);
  const sup = useRobot((s) => s.supervisor);
  const open = useDockOpen("joints");

  const counted = signals.filter((s) => !s.none);
  const active = counted.filter((s) => s.good.every(Boolean));
  const allOk = active.length === counted.length;
  const latched = sup?.latched || sup?.estop;
  const level = !hasData && !sup ? "none" : latched ? "bad" : allOk && sup?.armed !== false ? "ok" : active.length === 0 ? "bad" : "warn";
  const text = !hasData && !sup
    ? "No data"
    : latched
      ? sup.estop ? "E-stop" : "Emergency"
      : allOk
        ? sup && !sup.armed ? "Not armed" : "Ready"
        : `${active.length}/${counted.length} OK`;
  const summary = counted.map((s) => `${s.label}: ${s.good.every(Boolean) ? "active" : s.good.some(Boolean) ? "partly" : "inactive"}`).join("\n");

  return (
    <div className="rs-wrap">
      <button
        type="button"
        className={cx("rs", `is-${level}`, open && "is-open")}
        onClick={() => toggleDockPanel("joints")}
        aria-expanded={open}
        title={hasData ? `${summary}${sup ? `\nArmed: ${yes(sup.armed)}\nStandstill: ${yes(sup.standstill)}` : ""}\n\nClick for the joints panel` : "Waiting for the robot to report its status"}
      >
        <span className="rs-lamp" />
        <span className="rs-value">{text}</span>
        <span className="rs-matrix" aria-hidden>
          {signals.map((s) => (
            <span key={s.key} className="rs-row">
              <span className="rs-k">{s.short}</span>
              {s.good.map((g, i) => (
                <span key={i} className={cx("rs-cell", s.none || (!hasData && s.key !== "isolated") ? "is-none" : g ? "is-ok" : s.key === "isolated" ? "is-warn" : "is-bad")} />
              ))}
            </span>
          ))}
        </span>
        {sup && (
          <span className="rs-flags">
            <span className={cx("rs-flag", sup.armed ? "is-ok" : "is-off")}>{sup.armed ? "Armed" : "Disarmed"}</span>
            <span className={cx("rs-flag", sup.standstill ? "is-still" : "is-moving")}>{sup.standstill ? "Still" : "Moving"}</span>
          </span>
        )}
      </button>
    </div>
  );
}

export function ConnectionPill() {
  const status = useConnection((s) => s.status);
  const { data: bridge } = useBridgeInfo();
  if (status !== "open") {
    return (
      <span className="conn-pill is-down" title="The browser has lost its live connection to the robot server. Retrying automatically.">
        <span className="dot dot-danger" /> {status === "connecting" ? "Connecting" : "Offline"}
      </span>
    );
  }
  if (bridge?.simulated) {
    return (
      <span className="conn-pill is-sim" title="ROS 2 is not available on the server, so a simulated robot is running. No hardware is moving.">
        <span className="dot dot-warning" /> Simulation
      </span>
    );
  }
  return (
    <span className="conn-pill is-live" title="Live connection to the robot">
      <span className="dot dot-success dot-pulse" /> Live
    </span>
  );
}
