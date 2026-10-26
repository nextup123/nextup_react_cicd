// Program status (control_logic_bt runner) in the top bar: runner state,
// cycle and the action running now. Click to open the program panel.
// Reads only the runner status (2 Hz) and the running leaves (BT_ACTIVE, at
// most 5 Hz); the per-node tree stream stays off unless a runner page is open.
import { Workflow } from "lucide-react";
import { cx } from "../components/ui";
import { useRobot } from "../store/robot";
import { toggleDockPanel, useDockOpen } from "../store/statusDock";
import { processRunning } from "../components/robot/ProcessSwitch";
import { plainName, plainText } from "../lib/plainText";
import { STATE_LABEL, STATE_TONE, fmtMs, isActiveState } from "../pages/runner/runnerModel";



/**
 * One summary of the program for the chip and the panel. Whenever nothing runs
 * it reads IDLE while the control process is on and STOPPED when it is off,
 * with the reason underneath: ready to start, no program loaded, process off.
 */
export function useProgramSummary() {
  const runner = useRobot((s) => s.btRunnerStatus);
  const active = useRobot((s) => s.btActive);
  const controlActive = useRobot((s) => s.controlActive);
  const processStatus = useRobot((s) => s.processStatus);
  const processOn = processRunning(processStatus);
  const state = runner?.state || null;
  const running = isActiveState(state);
  const leaf = active?.running?.[0];
  const paused = Boolean(active?.paused) && running;
  const name = runner?.tree ? plainName(runner.tree) : "";

  let tone, value, sub;
  if (paused) [tone, value, sub] = ["warning", "Held (step mode)", leaf?.name || name];
  else if (running) [tone, value, sub] = [STATE_TONE[state] || "success", STATE_LABEL[state] || state, leaf ? `${leaf.name}${leaf.ms >= 1000 ? ` · ${fmtMs(leaf.ms)}` : ""}` : name];
  else if (state === "FAILED") [tone, value, sub] = ["danger", "Failed", runner.lastFailure ? `at ${runner.lastFailure.node}` : name];
  else if (!runner && controlActive) [tone, value, sub] = ["success", "Running", "Program"];
  // nothing runs: Idle while the control process is on, Stopped when it is off
  else if (!(processOn || (runner && !processStatus))) [tone, value, sub] = ["off", "Stopped", "Process off"];
  else if (state === "NO_TREE") [tone, value, sub] = ["neutral", "Idle", "No program loaded"];
  else if (!runner) [tone, value, sub] = ["neutral", "Idle", "Waiting for the runner"];
  else [tone, value, sub] = ["neutral", "Idle", name ? `Ready · ${name}` : "Ready to start"];

  const cycles = runner && (runner.cyclesTarget ? `cycle ${Math.min(runner.cyclesDone + (running ? 1 : 0), runner.cyclesTarget)}/${runner.cyclesTarget}` : running ? `cycle ${runner.cyclesDone + 1}` : runner.cyclesDone ? `${runner.cyclesDone} cycles` : "");
  return { runner, active, state, tone, value, cycles, sub, leaf, paused, name, processOn };
}

export function ProgramChip() {
  const { runner, tone, value, cycles, sub } = useProgramSummary();
  const open = useDockOpen("program");
  const tip = runner
    ? [`Program: ${value}`, cycles, sub, plainText(runner.message), "", "Click for the program panel"].filter((x, i, a) => x || (x === "" && i === a.length - 2)).join("\n")
    : `Program ${value.toLowerCase()}${sub ? ` (${sub.toLowerCase()})` : ""}. Click for the program panel.`;
  return (
    <button type="button" className={cx("prog-chip", `is-${tone}`, open && "is-open")} onClick={() => toggleDockPanel("program")} aria-expanded={open} title={tip}>
      <span className="prog-chip-icon">
        <Workflow size={15} />
        <span className="prog-chip-lamp" />
      </span>
      <span className="prog-chip-text">
        <span className="prog-chip-value">
          {value}
          {cycles && <span className="prog-chip-cycles">{cycles}</span>}
        </span>
        <span className="prog-chip-sub">{sub || "Program"}</span>
      </span>
    </button>
  );
}
