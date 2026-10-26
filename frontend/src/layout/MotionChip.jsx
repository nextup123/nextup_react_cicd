// Motion status of the motion server, always in the top bar: the running
// motion (stage, progress, Stop), the last result, or, when nothing runs,
// whether a motion would be accepted: "Ready", or "Inactive" with the first
// reason (not armed, JOG mode, emergency…) and a light red border. Click to
// open the motion panel (verbose detail, readiness, recent motions).
import { useEffect, useRef, useState } from "react";
import { Ban, CheckCircle2, CircleDot, FlaskConical, Square, XCircle } from "lucide-react";
import { cx } from "../components/ui";
import { send } from "../lib/ws";
import { useWsMessage } from "../lib/useWs";
import { MOTION_STATE_TEXT, motionTitle } from "../lib/robotText";
import { motionBlockers } from "../lib/motionReady";
import { toast } from "../store/toast";
import { useRobot } from "../store/robot";
import { toggleDockPanel, useDockOpen } from "../store/statusDock";

const SHOW_FINAL_MS = 6000;

export function MotionChip() {
  const m = useRobot((s) => s.motion);
  // only the first failing check's text: re-renders when the reason changes, not on every status
  const blocked = useRobot((s) => motionBlockers(s.supervisor)[0]?.short || "");
  const open = useDockOpen("motion");
  const [finalSeen, setFinalSeen] = useState(null); // id of a final motion whose highlight has expired
  // Only highlight a final result for a motion this page saw running (the
  // server replays the last status to a freshly opened page).
  const liveIds = useRef(new Set());
  if (m?.active && m.id) liveIds.current.add(m.id);

  // A final result is highlighted for a few seconds, then the chip calms down.
  useEffect(() => {
    if (!m?.final) return;
    const t = setTimeout(() => setFinalSeen(m.id), SHOW_FINAL_MS);
    return () => clearTimeout(t);
  }, [m?.id, m?.final]);

  useWsMessage("MOTION_RESULT", (p) => {
    if (!p?.id) return;
    const title = motionTitle(p);
    if (p.state === "succeeded") toast.success(p.message || `${title}: done`, { title });
    else if (p.state === "canceled") toast.info(p.message || "Stopped", { title });
    else toast.error(p.message || p.error || p.state, { title: `${title}: ${MOTION_STATE_TEXT[p.state] || p.state}` });
  });
  useWsMessage("ACTION_RESULT", (p) => {
    if (p?.action === "stop" && p.ok === false) toast.error(`Stop: ${p.message}`);
  });

  const fresh = m?.final && finalSeen !== m.id && liveIds.current.has(m.id);
  const idle = !m?.id || (!m.active && !fresh);
  const pct = Math.round((m?.progress || 0) * 100);
  const failed = m?.final && m.state !== "succeeded" && m.state !== "canceled";
  const tone = idle ? (blocked ? "inactive" : m?.id && failed ? "idle-bad" : "idle") : m.state === "succeeded" ? "success" : failed ? "danger" : m.final ? "muted" : "active";
  const stage = m?.stageCount > 1 ? ` · ${m.stage}/${m.stageCount}` : "";

  const title = idle ? "Motion" : motionTitle(m);
  const sub = idle
    ? blocked
      ? `Inactive · ${blocked}`
      : m?.id
        ? `Ready · last: ${MOTION_STATE_TEXT[m.state] || m.state}`
        : "Ready to move"
    : `${MOTION_STATE_TEXT[m.state] || m.state}${stage}${m.active ? ` · ${pct} %` : failed && m.message ? ` · ${m.message}` : ""}`;
  const tip = idle && blocked
    ? `Motions are refused now: ${blocked}.\nClick for the motion panel (every start check).`
    : m?.id
    ? [motionTitle(m), `${MOTION_STATE_TEXT[m.state] || m.state}${stage}`, m.stageLabel, m.message, "", "Click for the motion panel"].filter((x) => x !== undefined && x !== null).join("\n")
    : "No motion yet. Click for the motion panel (readiness and recent motions).";

  return (
    <div className={cx("motion-chip", `is-${tone}`, open && "is-open")}>
      <button type="button" className="motion-chip-main" onClick={() => toggleDockPanel("motion")} aria-expanded={open} title={tip}>
        {idle && blocked ? (
          <Ban size={15} />
        ) : idle ? (
          <CircleDot size={15} />
        ) : m.dryRun ? (
          <FlaskConical size={15} />
        ) : tone === "success" ? (
          <CheckCircle2 size={15} />
        ) : tone === "danger" ? (
          <XCircle size={15} />
        ) : (
          <span className="spinner" style={{ width: 13, height: 13 }} />
        )}
        <span className="motion-chip-text">
          <span className="motion-chip-title">{title}</span>
          <span className="motion-chip-sub">{sub}</span>
          {!idle && (
            <span className={cx("progress", tone === "success" && "is-success", tone === "danger" && "is-danger")}>
              <span style={{ width: `${m.final && m.state === "succeeded" ? 100 : pct}%` }} />
            </span>
          )}
        </span>
      </button>
      {m?.active && (
        <button type="button" className="motion-chip-stop" onClick={() => send("MOTION_STOP")} title="Stop this motion">
          <Square size={13} fill="currentColor" />
        </button>
      )}
    </div>
  );
}
