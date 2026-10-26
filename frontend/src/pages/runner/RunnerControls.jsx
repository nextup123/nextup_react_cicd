// Runner command bar: the state of control_logic_bt's state machine, what to
// do next, and only the commands that state accepts. Nothing here blocks:
// every button sends one service call and the state comes back on its own.
import { useEffect, useState } from "react";
import { Flag, Pause, Play, RotateCcw, ShieldCheck, SkipForward, Square, StepForward, Upload, XOctagon } from "lucide-react";
import { Badge, Button, Input, Popover, Segmented, cx } from "../../components/ui";
import { robotApi, robotCall } from "../../lib/robotApi";
import { ProcessSwitch } from "../../components/robot/ProcessSwitch";
import { toast } from "../../store/toast";
import { STATE_LABEL, STATE_TONE, allowed, fmtS, guide } from "./runnerModel";

const START_KEY = "nextup.runner.start";

function readStart() {
  try {
    const v = JSON.parse(localStorage.getItem(START_KEY));
    if (v && typeof v === "object") return { cycles: Number(v.cycles) || 0, mode: ["normal", "dry", "sim"].includes(v.mode) ? v.mode : "normal" };
  } catch {
    /* ignore */
  }
  return { cycles: 0, mode: "normal" };
}

const CYCLE_PRESETS = [5, 10, 50, 100, 1000];
const MODES = [
  { value: "normal", label: "Normal", title: "The robot moves", hint: "The robot moves. Needs AUTO or SAFEAUTO." },
  { value: "dry", label: "Dry", title: "Every motion is planned, nothing moves; outputs are not written, inputs assumed OK", hint: "Plans every motion from the robot's position; the robot stays where it is." },
  { value: "sim", label: "Sim", title: "No motion server at all; outputs not written, inputs assumed OK", hint: "Runs the program's logic without the robot." },
];

const BUTTONS = [
  { key: "pause", label: "Pause", icon: Pause, title: "Hold after the running step (nothing new starts)" },
  { key: "resume", label: "Resume", icon: Play, title: "Continue with the next step" },
  { key: "step", label: "Next", icon: StepForward, title: "Run the next action, then pause again (only while PAUSED)" },
  { key: "finish_cycle", label: "Finish cycle", icon: Flag, title: "Run this cycle to its end, then stop" },
  { key: "stop", label: "Stop", icon: Square, title: "End the run after the running step" },
  { key: "abort", label: "Abort", icon: XOctagon, title: "Halt now: running motions are stopped", danger: true },
  { key: "reset", label: "Reset", icon: RotateCcw, title: "Acknowledge the failure (FAILED → IDLE)" },
];

export default function RunnerControls({ runner, live, robot, onValidate, validating }) {
  const [busy, setBusy] = useState("");
  const [start, setStart] = useState(readStart);
  const state = runner?.state || "";
  const g = guide(runner, live, robot);
  const next = new Set(g.next);

  useEffect(() => {
    try {
      localStorage.setItem(START_KEY, JSON.stringify(start));
    } catch {
      /* ignore */
    }
  }, [start]);

  const act = async (key, opts = start) => {
    setBusy(key);
    try {
      if (key === "start") {
        await robotCall(() => robotApi.runnerStart({ cycles: opts.cycles, dryRun: opts.mode === "dry", simMode: opts.mode === "sim" }), { quietOk: true });
      } else if (key === "load") {
        const r = await robotCall(() => robotApi.runnerLoadMain(), { success: "Main program loaded" });
        if (r && r.ok === false && r.hint) toast.info(r.hint, { title: "How to fix" });
      } else if (key === "dbgStep") await robotCall(() => robotApi.btStep(), { quietOk: true });
      else if (key === "dbgResume") {
        robotApi.btContinue().catch(() => {}); // also releases a Breakpoint node in the tree
        await robotCall(() => robotApi.btResume(), { quietOk: true });
      }
      else await robotCall(() => robotApi.runnerAction(key), { quietOk: true });
    } finally {
      setBusy("");
    }
  };

  const tickHeld = Boolean(live?.paused) && ["RUNNING", "PAUSING", "PAUSED", "STOPPING", "FINISHING"].includes(state);
  const shown = BUTTONS.filter((b) => {
    if (b.key === "resume") return allowed(state, "resume");
    if (b.key === "pause") return !allowed(state, "resume");
    if (b.key === "reset") return state === "FAILED";
    return true;
  });

  const modeText = runner?.simRun ? "SIM RUN" : runner?.dryRun ? "DRY RUN" : "";
  return (
    <div className={cx("nr-bar", `tone-${g.tone}`)} data-tut="rn-bar">
      <div className="nr-state" data-tut="rn-state">
        <ProcessSwitch size="sm" className="nr-process" />
        <span className="nr-sep" />
        <Badge tone={STATE_TONE[state] || "neutral"} size="lg" dot>
          {STATE_LABEL[state] || state || "No status"}
        </Badge>
        {modeText && <Badge tone="info">{modeText}</Badge>}
        {runner && (
          <span className="xs muted nr-counts" data-tut="rn-counts" title="Cycles done in this run / requested (∞ = until stopped) · since the runner started">
            Cycle {runner.cyclesDone}
            {runner.cyclesTarget > 0 ? ` / ${runner.cyclesTarget}` : " / ∞"} · total {runner.cyclesTotal}
            {runner.cycleElapsed > 0 && ` · ${fmtS(runner.cycleElapsed)}`}
          </span>
        )}
      </div>

      <div className="nr-guide" role="status" data-tut="rn-guide">
        <strong>{g.title}</strong>
        <span className="muted">{g.text}</span>
      </div>

      <div className="nr-actions" data-tut="rn-actions">
        {tickHeld && (
          <>
            <Button size="sm" variant="primary" icon={SkipForward} data-tut="rn-tick-once" loading={busy === "dbgStep"} onClick={() => act("dbgStep")} title="Tick the tree exactly once (step mode)">
              Tick once
            </Button>
            <Button size="sm" variant="primary" icon={Play} data-tut="rn-tick-continue" loading={busy === "dbgResume"} onClick={() => act("dbgResume")} title="Tick normally again">
              Continue ticking
            </Button>
            <span className="nr-sep" />
          </>
        )}
        <StartChooser
          start={start}
          canStart={allowed(state, "start")}
          primary={next.has("start")}
          busy={busy === "start"}
          stateText={STATE_LABEL[state] || "the runner is not reporting"}
          onStart={(opts) => {
            setStart(opts);
            act("start", opts);
          }}
        />
        {shown.map((b) => {
          const ok = allowed(state, b.key);
          return (
            <Button
              key={b.key}
              data-tut={`rn-${b.key.replace("_", "-")}`}
              size="sm"
              icon={b.icon}
              variant={!ok ? "default" : b.danger ? "soft-danger" : next.has(b.key) ? "primary" : "default"}
              disabled={!ok}
              loading={busy === b.key}
              onClick={() => act(b.key)}
              title={ok ? b.title : `${b.title}. Not available while ${STATE_LABEL[state] || "the runner is not reporting"}.`}
            >
              {b.label}
            </Button>
          );
        })}
        <span className="nr-actions-right">
          <Button
            size="sm"
            icon={Upload}
            data-tut="rn-load"
            loading={busy === "load"}
            disabled={!allowed(state, "load")}
            onClick={() => act("load")}
            title={allowed(state, "load") ? "Load the main program into the runner" : "Loading is possible only while IDLE, FAILED or with no program. Stop the run first."}
          >
            Load
          </Button>
          <Button size="sm" icon={ShieldCheck} data-tut="rn-validate" loading={validating} onClick={onValidate} title="Check the main program without loading it: structure, settings and points. Nothing moves.">
            Validate
          </Button>
        </span>
      </div>
    </div>
  );
}

/** Start: asks how many cycles and in which mode, then starts (the last choice is remembered). */
function StartChooser({ start, canStart, primary, busy, stateText, onStart }) {
  const [cycles, setCycles] = useState(start.cycles);
  const [mode, setMode] = useState(start.mode);
  const hint = MODES.find((m) => m.value === mode)?.hint;
  return (
    <Popover
      width={372}
      align="left"
      className="nr-start-pop"
      trigger={({ toggle, open }) => (
        <Button
          size="sm"
          icon={Play}
          data-tut="rn-start"
          variant={canStart && primary ? "primary" : "default"}
          disabled={!canStart}
          loading={busy}
          onClick={() => {
            if (!open) {
              setCycles(start.cycles);
              setMode(start.mode);
            }
            toggle();
          }}
          title={canStart ? "Choose the cycles and the mode, then start" : `Start the run. Not available while ${stateText}.`}
        >
          Start
        </Button>
      )}
    >
      {(close) => (
        <form
          className="col nr-pop"
          data-tut="rn-start-pop"
          style={{ gap: 12 }}
          onSubmit={(e) => {
            e.preventDefault();
            close();
            onStart({ cycles, mode });
          }}
        >
          <div className="col" style={{ gap: 6 }}>
            <span className="small strong">Cycles</span>
            <div className="nr-cycle-presets" role="group" aria-label="Cycles" data-tut="rn-cycles">
              {CYCLE_PRESETS.map((n) => (
                <button key={n} type="button" className={cx("nr-chip", cycles === n && "is-on")} onClick={() => setCycles(n)}>
                  {n}
                </button>
              ))}
              <button type="button" className={cx("nr-chip", cycles === 0 && "is-on")} onClick={() => setCycles(0)} title="Run until stopped">
                ∞
              </button>
            </div>
            <label className="row" style={{ gap: 8, alignItems: "center" }}>
              <span className="xs muted">Other</span>
              <Input size="sm" type="number" min={0} step={1} value={cycles} onChange={(e) => setCycles(Math.max(0, Math.floor(Number(e.target.value) || 0)))} style={{ width: 110 }} />
              <span className="xs muted">{cycles > 0 ? `${cycles} cycle${cycles === 1 ? "" : "s"}` : "until stopped"}</span>
            </label>
          </div>
          <div className="col" style={{ gap: 6 }}>
            <span className="small strong">Mode</span>
            <Segmented block className="nr-start-mode" value={mode} onChange={setMode} options={MODES.map(({ value, label, title }) => ({ value, label, title }))} />
            <span className="xs muted">{hint}</span>
          </div>
          <div className="row" style={{ gap: 6, justifyContent: "flex-end" }}>
            <Button size="sm" type="button" variant="ghost" onClick={close}>
              Cancel
            </Button>
            <Button size="sm" type="submit" variant="primary" icon={Play} data-tut="rn-start-go">
              Start {cycles > 0 ? `${cycles}×` : "∞"} · {MODES.find((m) => m.value === mode)?.label}
            </Button>
          </div>
        </form>
      )}
    </Popover>
  );
}
