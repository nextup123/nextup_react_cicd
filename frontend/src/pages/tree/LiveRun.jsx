// Live view of the running behaviour tree (bt_debug_pkg): which node runs,
// the last failure, and step mode (pause / step / resume / breakpoint).
import { useEffect, useMemo, useState } from "react";
import { create } from "zustand";
import { Activity, CircleSlash, Crosshair, ExternalLink, MoreVertical, Pause, Play, StepForward, Workflow, XOctagon } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button, Menu, cx } from "../../components/ui";
import { robotApi, robotCall } from "../../lib/robotApi";
import { useRobot } from "../../store/robot";
import { isActiveState } from "../runner/runnerModel";

const FAILURE_SHOW_MS = 30000;
const LIVE_KEY = "nextup.bt.live";

/** Breakpoint chosen in this browser (the runner does not report it back). */
export const useBtDebug = create(() => ({
  breakAt: "",
  live: (() => {
    try {
      return localStorage.getItem(LIVE_KEY) !== "0";
    } catch {
      return true;
    }
  })(),
}));

export function setBreakpoint(name) {
  robotCall(() => robotApi.btBreak(name || ""), { quietOk: false }).then((r) => r?.ok !== false && useBtDebug.setState({ breakAt: name || "" }));
}

/** A run is going on: the runner's state machine when it reports, else the process flag. */
const useProgramActive = () => useRobot((s) => (s.btRunnerStatus ? isActiveState(s.btRunnerStatus.state) : s.controlActive));

/** { runningNames: Set, failedName } for the canvas while live highlighting is on. */
export function useLiveHighlight() {
  const live = useBtDebug((s) => s.live);
  const bt = useRobot((s) => s.btActive);
  const active = useProgramActive();
  const failure = useRobot((s) => s.btFailure);
  const [, tick] = useState(0);
  useEffect(() => {
    if (!failure) return;
    const t = setTimeout(() => tick((n) => n + 1), FAILURE_SHOW_MS + 50);
    return () => clearTimeout(t);
  }, [failure]);
  const names = (bt?.running || []).map((r) => r.name).join("|");
  const runningNames = useMemo(() => (live && active && names ? new Set(names.split("|")) : null), [live, active, names]);
  const failedName = live && failure && Date.now() - failure.at < FAILURE_SHOW_MS ? failure.node : null;
  return { runningNames, failedName };
}

export function LiveRunBar({ onFocusName }) {
  const navigate = useNavigate();
  const live = useBtDebug((s) => s.live);
  const breakAt = useBtDebug((s) => s.breakAt);
  const bt = useRobot((s) => s.btActive);
  const active = useProgramActive();
  const failure = useRobot((s) => s.btFailure);
  const node = active ? bt?.running?.[0] : null;

  const setLive = (v) => {
    useBtDebug.setState({ live: v });
    try {
      localStorage.setItem(LIVE_KEY, v ? "1" : "0");
    } catch {
      /* ignore */
    }
  };

  const status = !active ? "Program stopped" : bt?.paused ? `Paused${node ? ` at ${node.name}` : ""}` : node ? `Running ${node.name}` : "Running";
  return (
    <div className={cx("bt-live", active && "is-active", bt?.paused && "is-paused")} title={bt ? `Cycle ${bt.cycle} · ${bt.ticks} ticks${bt.lastEvent ? ` · ${bt.lastEvent}` : ""}` : "No status from the program runner"}>
      <span className="bt-live-dot" />
      <span className="truncate bt-narrow-hide">{status}</span>
      {active && bt && <span className="xs muted bt-narrow-hide">#{bt.cycle}</span>}
      <Menu
        trigger={({ toggle }) => <Button size="sm" variant="ghost" icon={MoreVertical} onClick={toggle} aria-label="Run and debug" title="Run and debug" />}
        items={[
          { header: "NexRoot runner (whole tree, run and debug)" },
          { label: "Open the runner", icon: Workflow, onClick: () => navigate("/runner") },
          { label: "Open the runner in a new window", icon: ExternalLink, onClick: () => window.open("/runner-window", "nexroot-runner", "width=1440,height=900") },
          "-",
          { header: "Live view" },
          { label: "Highlight the running node", checked: live, onClick: () => setLive(!live) },
          { label: "Show the running node", icon: Crosshair, disabled: !node, onClick: () => onFocusName?.(node.name) },
          failure ? { label: `Show last failure: ${failure.node}`, icon: XOctagon, onClick: () => onFocusName?.(failure.node), title: failure.reason } : null,
          "-",
          { header: "Step mode" },
          { label: "Pause", icon: Pause, disabled: !active || bt?.paused, onClick: () => robotCall(() => robotApi.btPause()) },
          { label: "Step one node", icon: StepForward, disabled: !active, onClick: () => robotCall(() => robotApi.btStep(), { quietOk: true }) },
          { label: "Resume", icon: Play, disabled: !active || !bt?.paused, onClick: () => robotCall(() => robotApi.btResume(), { quietOk: true }) },
          breakAt ? { label: `Clear breakpoint (${breakAt})`, icon: CircleSlash, onClick: () => setBreakpoint("") } : { label: "Breakpoint: right-click a node", icon: Activity, disabled: true },
        ]}
      />
    </div>
  );
}
