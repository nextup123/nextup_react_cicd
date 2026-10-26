// Status dock: the joints, motion and program panels opened from the top-bar
// chips. Any of them can be open at the same time. They float over the page:
// each one, open or folded to its header, is dragged anywhere in the window
// by its header (kept inside the window, the spot is remembered per panel),
// folds and closes. A newly opened panel starts under the top bar, beside the
// others. They only read the live store: no extra subscriptions, no timers.
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Activity, ChevronDown, ChevronUp, Cpu, ExternalLink, GripVertical, Square, Workflow, X } from "lucide-react";
import { Button, cx } from "../components/ui";
import { send } from "../lib/ws";
import { MOTION_KIND, MOTION_STATE_TEXT, PHASE_TEXT, motionTitle } from "../lib/robotText";
import { useRobot } from "../store/robot";
import { clampDockPos, closeDockPanel, ensureDockSpots, dockWidth, raiseDockPanel, setDockPos, toggleDockFold, useStatusDock } from "../store/statusDock";
import { motionReadiness } from "../lib/motionReady";
import { plainText } from "../lib/plainText";
import { STATE_LABEL, fmtMs, fmtS, guide, isActiveState } from "../pages/runner/runnerModel";
import { JointsDetail } from "./RobotStatus";
import { useProgramSummary } from "./ProgramChip";
import { ProcessSwitch } from "../components/robot/ProcessSwitch";
import "./statusDock.css";

// motion_server error codes (MotionStatus.msg) in plain words
const MOTION_ERROR_TEXT = {
  E_BUSY: "Another motion is running",
  E_NOT_READY: "The motion planner is not ready yet",
  E_NO_JOINT_STATE: "No fresh joint positions from the robot",
  E_EMERGENCY_ACTIVE: "Emergency is active",
  E_JOG_MODE_ACTIVE: "The robot is in JOG mode",
  E_DRIVES_NOT_READY: "Drives not ready (not armed, not enabled, or a joint is isolated)",
  E_CONTROLLER_INACTIVE: "The trajectory controller is not active",
  E_UNKNOWN_TARGET: "Unknown point, home or frame",
  E_INVALID_TARGET: "Invalid target (missing joint, out of limits)",
  E_TARGET_IN_COLLISION: "The target is in collision",
  E_PLANNING_FAILED: "Planning failed",
  E_LIN_NOT_FEASIBLE: "No straight-line path to the target",
  E_EXECUTION_FAILED: "Execution failed",
  E_TARGET_NOT_REACHED: "Target not reached within tolerance",
  E_STALLED: "The robot stalled while moving",
  E_CANCELED: "Stopped",
  E_FILE_ERROR: "A configuration file could not be read or written",
  E_HOME_LOCKED: "This home is locked",
  E_SUPERVISOR_UNAVAILABLE: "No status from the motion supervisor",
  E_UNREACHABLE: "The pose cannot be reached",
};

const deg = (rad) => (Number.isFinite(Number(rad)) ? ((Number(rad) * 180) / Math.PI).toFixed(1) : "–");
const time = (at) => (at ? new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "");

function Facts({ rows }) {
  return (
    <dl className="sd-facts dk-facts">
      {rows.filter(Boolean).map(([k, v, tone, tip]) => (
        <div key={k} title={tip}>
          <dt>{k}</dt>
          <dd className={tone ? `is-${tone}` : undefined}>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

const STEP = 10; // px per arrow key on the grip (Shift: 4x)

function Panel({ id, icon: Icon, title, summary, tone, children }) {
  const folded = useStatusDock((s) => s.folded.includes(id));
  const z = useStatusDock((s) => s.z.indexOf(id));
  const saved = useStatusDock((s) => s.pos[id]);
  useViewport(); // re-clamp when the window is resized
  const ref = useRef(null);
  const drag = useRef(null);
  const [dragging, setDragging] = useState(false);
  const width = dockWidth(id, folded);
  const pos = clampDockPos(saved || { x: window.innerWidth - width - 16, y: 70 }, width);

  // Drag by the header (not its buttons). Moves the element directly while
  // dragging, so nothing re-renders until the drop.
  const onDown = (e) => {
    if (e.button !== 0 || e.target.closest("button")) return;
    drag.current = { px: e.clientX, py: e.clientY, x: pos.x, y: pos.y, moved: false, at: pos };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onMove = (e) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.px;
    const dy = e.clientY - d.py;
    if (!d.moved && Math.hypot(dx, dy) < 4) return;
    if (!d.moved) setDragging(true);
    d.moved = true;
    d.at = clampDockPos({ x: d.x + dx, y: d.y + dy }, width);
    if (ref.current) {
      ref.current.style.left = `${d.at.x}px`;
      ref.current.style.top = `${d.at.y}px`;
    }
  };
  const onUp = (e) => {
    const d = drag.current;
    drag.current = null;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    if (d?.moved) {
      setDragging(false);
      setDockPos(id, d.at);
    }
  };
  const onKey = (e) => {
    const k = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
    if (!k) return;
    e.preventDefault();
    const step = e.shiftKey ? STEP * 4 : STEP;
    setDockPos(id, clampDockPos({ x: pos.x + k[0] * step, y: pos.y + k[1] * step }, width));
  };

  return (
    <section
      ref={ref}
      style={{ left: pos.x, top: pos.y, width, zIndex: 1 + z, maxHeight: Math.max(DOCK_MIN_BODY, window.innerHeight - pos.y - 8) }}
      className={cx("dk-panel", `dk-${id}`, tone && `tone-${tone}`, folded && "is-folded", dragging && "is-dragging")}
      aria-label={title}
      onPointerDownCapture={() => raiseDockPanel(id)}
    >
      <header
        className="dk-head"
        onDoubleClick={(e) => !e.target.closest("button") && toggleDockFold(id)}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        title="Drag to move this panel anywhere · double-click to fold"
      >
        <span className="dk-grip" tabIndex={0} onKeyDown={onKey} aria-label={`Move the ${title} panel (arrow keys)`}>
          <GripVertical size={14} />
          <Icon size={15} className="dk-head-icon" />
          <strong>{title}</strong>
        </span>
        <span className="dk-summary truncate">{summary}</span>
        <button type="button" className="dk-btn" onClick={() => toggleDockFold(id)} title={folded ? "Unfold" : "Fold to the header"} aria-label={folded ? "Unfold" : "Fold"}>
          {folded ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
        </button>
        <button type="button" className="dk-btn" onClick={() => closeDockPanel(id)} title="Close (the top-bar chip opens it again)" aria-label="Close">
          <X size={14} />
        </button>
      </header>
      {!folded && <div className="dk-body">{children}</div>}
    </section>
  );
}

const DOCK_MIN_BODY = 160;

/** Re-render on window resize (throttled to one frame) so panels stay inside the window. */
function useViewport() {
  const [, setTick] = useState(0);
  useEffect(() => {
    let raf = 0;
    const on = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => setTick((t) => t + 1));
    };
    window.addEventListener("resize", on);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", on);
    };
  }, []);
}

/* ───────────── joints ───────────── */

function JointsPanel() {
  const sup = useRobot((s) => s.supervisor);
  const iso = sup?.isolated?.filter(Boolean).length || 0;
  const summary = !sup
    ? "supervisor silent"
    : [
        sup.estop ? "E-stop" : sup.latched ? "emergency" : sup.armed ? (sup.allEnabled ? "armed · enabled" : "armed · drives off") : "not armed",
        sup.phase !== "running" ? (PHASE_TEXT[sup.phase] || sup.phase || "").toLowerCase() : "",
        iso ? `${iso} isolated` : "",
      ].filter(Boolean).join(" · ");
  const tone = sup?.latched || sup?.estop ? "danger" : iso ? "warning" : !sup || !sup.armed ? "inactive" : undefined;
  return (
    <Panel id="joints" icon={Cpu} title="Joints" summary={summary} tone={tone}>
      <JointsDetail />
    </Panel>
  );
}

/* ───────────── motion ───────────── */

function MotionPanel() {
  const m = useRobot((s) => s.motion);
  const hist = useRobot((s) => s.motionHistory);
  const sup = useRobot((s) => s.supervisor);
  const tcp = useRobot((s) => s.tcp);
  const checks = motionReadiness(sup);
  const blocked = checks.filter((c) => !c.ok);
  const pct = Math.round((m?.progress || 0) * 100);
  const failed = m?.final && m.state !== "succeeded" && m.state !== "canceled";
  const tone = m?.active ? "info" : failed ? "danger" : blocked.length ? "inactive" : undefined;
  const summary = m?.active ? `${motionTitle(m)} · ${pct} %` : blocked.length ? `inactive · ${blocked[0].short}` : "ready to move";

  return (
    <Panel id="motion" icon={Activity} title="Motion" summary={summary} tone={tone}>
      <div className={cx("dk-ready", blocked.length ? "is-bad" : "is-ok")} title={blocked.length ? blocked.map((c) => c.tip).join("\n") : "The motion server's start checks pass: a motion would be accepted"}>
        <span className="dk-ready-title">{blocked.length ? "Motions are refused now" : "Ready to move"}</span>
        <span className="dk-checks">
          {checks.map((c) => (
            <span key={c.label} className={cx("dk-check", c.ok ? "is-ok" : "is-bad")} title={c.ok ? c.label : c.tip}>
              {c.label}
            </span>
          ))}
        </span>
      </div>

      {m?.id ? (
        <div className="dk-block">
          <div className="dk-row">
            <strong className="truncate">{motionTitle(m)}</strong>
            <span className={cx("dk-badge", m.active ? "is-info" : m.state === "succeeded" ? "is-ok" : failed ? "is-bad" : "is-muted")}>{MOTION_STATE_TEXT[m.state] || m.state}</span>
            {m.active && (
              <Button size="sm" variant="soft-danger" icon={Square} onClick={() => send("MOTION_STOP")} title="Stop this motion">
                Stop
              </Button>
            )}
          </div>
          <span className={cx("progress", m.state === "succeeded" && "is-success", failed && "is-danger")}>
            <span style={{ width: `${m.final && m.state === "succeeded" ? 100 : pct}%` }} />
          </span>
          {(m.stageLabel || m.stageCount > 1) && (
            <div className="xs muted">
              {m.stageLabel && /^stage\b/i.test(m.stageLabel)
                ? m.stageLabel
                : [m.stageCount > 1 ? `Stage ${m.stage}/${m.stageCount}` : "", m.stageLabel].filter(Boolean).join(": ")}
            </div>
          )}
          {m.error && (
            <div className="dk-error">
              <span className="mono">{m.error}</span> {MOTION_ERROR_TEXT[m.error] || ""}
            </div>
          )}
          {m.message && <div className="dk-msg">{m.message}</div>}
          <Facts
            rows={[
              ["Kind", MOTION_KIND[m.kind] || m.kind || "–"],
              ["Target", m.target || "–"],
              ["Type", m.motionType || "–"],
              ["Planner", m.planner || "–"],
              ["Speed", m.speed ? `${m.speed} m/s` : "default", "", "Requested tool speed (0 = the configured default)"],
              ["Accel.", m.acceleration ? `${m.acceleration} m/s²` : "default"],
              ["Peak planned", m.achievedSpeed ? `${m.achievedSpeed} m/s` : "–", m.speed && m.achievedSpeed && m.achievedSpeed < m.speed * 0.95 ? "warn" : "", "Highest tool speed of the planned trajectory; lower than requested when the robot cannot do more"],
              ["Speed scale", m.speedScale ? `${m.speedScale} %` : "–", m.speedScale && m.speedScale < 100 ? "warn" : ""],
              ["Elapsed", m.elapsed ? `${m.elapsed} s` : "–"],
              ["Plan", m.cached ? "from cache" : "planned", "", "The trajectory came from the plan cache (no planning)"],
              m.pathLength ? ["Path", `${m.pathLength} mm${m.pathFraction && m.pathFraction < 1 ? ` · ${Math.round(m.pathFraction * 100)} % planned` : ""}`, m.pathFraction && m.pathFraction < 1 ? "warn" : ""] : null,
              ["Dry run", m.dryRun ? "Yes (nothing moves)" : "No", m.dryRun ? "info" : ""],
              tcp ? ["TCP now", `${Number(tcp.speed || 0).toFixed(3)} m/s`, "", `Measured tool speed${tcp.frame ? ` (${tcp.frame})` : ""}`] : null,
              ["ID", <span key="id" className="mono">{m.id}</span>],
            ]}
          />
          {m.targetJoints?.length > 0 && (
            <table className="sd-grid dk-joints">
              <thead>
                <tr>
                  <th />
                  {m.targetJoints.map((_, i) => (
                    <th key={i}>J{i + 1}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr className="sd-text sd-num">
                  <th>Target °</th>
                  {m.targetJoints.map((v, i) => (
                    <td key={i} className="mono">{deg(v)}</td>
                  ))}
                </tr>
              </tbody>
            </table>
          )}
        </div>
      ) : (
        <p className="xs muted dk-empty">No motion since the server started.</p>
      )}

      {hist.length > 0 && (
        <div className="dk-section">
          <div className="dk-h">Recent motions</div>
          <ul className="dk-list">
            {hist.map((h) => (
              <li key={h.id} title={[h.id, h.stageLabel, h.message, h.error && `${h.error}: ${MOTION_ERROR_TEXT[h.error] || ""}`].filter(Boolean).join("\n")}>
                <span className={cx("dk-dot", h.state === "succeeded" ? "is-ok" : h.state === "canceled" ? "is-muted" : "is-bad")} />
                <span className="truncate grow">{motionTitle(h)}</span>
                <span className="dk-list-meta">{MOTION_STATE_TEXT[h.state] || h.state}{h.elapsed ? ` · ${h.elapsed} s` : ""}</span>
                <span className="dk-list-time">{time(h.at)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Panel>
  );
}

/* ───────────── program (control_logic_bt) ───────────── */

function ProgramPanel() {
  const navigate = useNavigate();
  const { runner, active, state, tone, value, cycles, sub, name } = useProgramSummary();
  const sup = useRobot((s) => s.supervisor);
  const btFailure = useRobot((s) => s.btFailure);
  const controlActive = useRobot((s) => s.controlActive);
  const processStatus = useRobot((s) => s.processStatus);
  const live = active ? { paused: active.paused, run: (active.running || []).map((r) => [r.uid, r.ms, r.name]), bp: {} } : null;
  const g = guide(runner, live, { latched: Boolean(sup?.latched), profile: sup?.profile || null });
  const lf = runner?.lastFailure;
  const mode = runner ? (runner.simRun ? "Sim run (no robot)" : runner.dryRun ? "Dry run (plan only)" : "Normal") : "–";
  const panelTone = tone === "neutral" ? undefined : tone === "off" ? "inactive" : tone;

  return (
    <Panel id="program" icon={Workflow} title="Program" summary={`${value}${cycles ? ` · ${cycles}` : sub ? ` · ${sub}` : ""}`} tone={panelTone}>
      <div className={cx("dk-guide", `tone-${g.tone}`)}>
        <strong>{g.title}</strong>
        {g.text && <span>{g.text}</span>}
      </div>

      {runner && (
        <Facts
          rows={[
            ["State", STATE_LABEL[state] || state, state === "FAILED" || state === "NO_TREE" ? "bad" : isActiveState(state) ? "ok" : ""],
            ["Mode", mode, runner.simRun || runner.dryRun ? "info" : ""],
            ["Cycles", runner.cyclesTarget ? `${runner.cyclesDone} / ${runner.cyclesTarget}` : `${runner.cyclesDone} (until stopped)`, "", "Completed cycles since the last start"],
            ["Total", `${runner.cyclesTotal}`, "", "Completed cycles since the runner started"],
            ["This cycle", isActiveState(state) ? fmtS(runner.cycleElapsed) : "–"],
            ["Last cycle", runner.cyclesTotal ? fmtS(runner.lastCycle) : "–"],
            ["Average", runner.cyclesDone ? fmtS(runner.avgCycle) : "–", "", "Since the last start"],
            ["Min / max", runner.cyclesDone && (runner.minCycle || runner.maxCycle) ? `${fmtS(runner.minCycle)} / ${fmtS(runner.maxCycle)}` : "–"],
            active ? ["Ticks", `${active.ticks}${active.paused ? " · held" : ""}`, active.paused ? "warn" : "", "Tick count; held = step mode (the tree is not ticking)"] : null,
            ["Start node", runner.hasStartNode ? "In tree" : "Gated by runner", "", "Tree root contains StartControlNode (otherwise the runner gates the whole tree)"],
          ]}
        />
      )}
      {name && (
        <div className="dk-file truncate">
          Program <strong>{name}</strong>
        </div>
      )}

      {active?.running?.length > 0 && isActiveState(state || (controlActive ? "RUNNING" : "")) && (
        <div className="dk-section">
          <div className="dk-h">Running now</div>
          {active.ancestors?.length > 0 && <div className="dk-crumbs">{active.ancestors.join(" › ")}</div>}
          <ul className="dk-list">
            {active.running.map((r) => (
              <li key={`${r.uid}-${r.name}`}>
                <span className="dk-dot is-run" />
                <span className="truncate grow">{r.name}</span>
                <span className="dk-list-meta">{r.type}</span>
                <span className="dk-list-time">{fmtMs(r.ms)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {active?.lastEvent && (
        <div className="dk-section">
          <div className="dk-h">Last change</div>
          <div className="dk-term mono">{plainText(active.lastEvent)}</div>
        </div>
      )}

      {lf ? (
        <div className="dk-fail">
          <div className="dk-h">Failure (cycle {lf.cycle})</div>
          <strong className="dk-fail-node">{lf.node}</strong>
          {lf.error && <span className="dk-fail-error">{lf.error}</span>}
          {lf.path && <span className="dk-crumbs">{lf.path}</span>}
          <Facts
            rows={[
              lf.time ? ["At", lf.time] : null,
              lf.stepTime ? ["Step time", fmtS(lf.stepTime)] : null,
              lf.ports ? ["Ports", <span key="p" className="mono">{lf.ports}</span>] : null,
            ]}
          />
        </div>
      ) : btFailure ? (
        <div className="dk-fail is-soft">
          <div className="dk-h">Last failed node (from the log)</div>
          <strong className="dk-fail-node">{btFailure.node}</strong>
          {btFailure.reason && <span className="dk-fail-error">{btFailure.reason}</span>}
          {btFailure.trace?.length > 0 && <span className="dk-crumbs">{btFailure.trace.join(" › ")}</span>}
        </div>
      ) : null}

      {runner?.profile?.length > 0 && (
        <div className="dk-section">
          <div className="dk-h">Slowest in the last cycle</div>
          <ol className="dk-olist">
            {runner.profile.slice(0, 5).map((p) => (
              <li key={p} className="mono">{p}</li>
            ))}
          </ol>
        </div>
      )}
      {runner?.message && <div className="dk-msg" title="Last runner message">{plainText(runner.message)}</div>}

      <div className="dk-foot">
        <ProcessSwitch size="sm" />
        <span className="xs muted grow truncate" title="Reported by the control process">
          {controlActive ? "Control active" : "Control inactive"}
          {processStatus ? ` · ${processStatus}` : ""}
        </span>
        <Button size="sm" variant="soft" icon={ExternalLink} onClick={() => navigate("/runner")}>
          NexRoot Runner
        </Button>
      </div>
    </Panel>
  );
}

const PANELS = { joints: JointsPanel, motion: MotionPanel, program: ProgramPanel };
const DOCK_ORDER = Object.keys(PANELS);

export function StatusDock() {
  const open = useStatusDock((s) => s.open);
  const shown = DOCK_ORDER.filter((p) => open.includes(p));
  useEffect(() => {
    if (shown.length) ensureDockSpots();
  }, [shown.length]);
  if (!shown.length) return null;
  return (
    <div className="status-dock">
      {shown.map((id) => {
        const P = PANELS[id];
        return <P key={id} />;
      })}
    </div>
  );
}
