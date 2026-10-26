// Pure helpers for the NexRoot runner page: the runner's state machine
// (control_logic_bt docs/RUNNER.md), status characters, the tree index.
import { KINDS, SUBTREE_TAGS, colorOf, kindOf } from "../tree/treeModel";

/* ───────────── node status (one character per node in BT_LIVE.st) ───────────── */
// R running · S success · F failure (current) · s / f finished earlier in this
// cycle (BehaviorTree.CPP resets finished children to IDLE) · h halted · . idle
export const STATUS_CLASS = { R: "st-run", S: "st-ok", F: "st-fail", s: "st-was-ok", f: "st-was-fail", h: "st-halt", ".": "st-idle" };
export const STATUS_LABEL = {
  R: "Running",
  S: "Success",
  F: "Failed",
  s: "Succeeded in this cycle",
  f: "Failed in this cycle",
  h: "Halted while running",
  ".": "Not ticked in this cycle",
};

/* ───────────── runner state machine ───────────── */
// Every action the runner offers, and in which states its service accepts it
// (see control_logic_bt runner_control.cpp).
export const ACTIONS = ["start", "pause", "resume", "step", "stop", "finish_cycle", "abort", "reset", "load"];

const ALLOWED = {
  NO_TREE: ["load"],
  IDLE: ["start", "load"],
  RUNNING: ["pause", "stop", "finish_cycle", "abort"],
  PAUSING: ["resume", "stop", "abort"],
  PAUSED: ["resume", "step", "stop", "abort"],
  STOPPING: ["abort"],
  FINISHING: ["pause", "stop", "abort"],
  FAILED: ["reset", "start", "load"],
};

export const STATE_TONE = {
  NO_TREE: "danger",
  IDLE: "neutral",
  RUNNING: "success",
  PAUSING: "warning",
  PAUSED: "warning",
  STOPPING: "warning",
  FINISHING: "info",
  FAILED: "danger",
};

export const STATE_LABEL = {
  NO_TREE: "No tree",
  IDLE: "Idle",
  RUNNING: "Running",
  PAUSING: "Pausing…",
  PAUSED: "Paused",
  STOPPING: "Stopping…",
  FINISHING: "Finishing cycle",
  FAILED: "Failed",
};

export const isActiveState = (s) => ["RUNNING", "PAUSING", "PAUSED", "STOPPING", "FINISHING"].includes(s);

export function allowed(state, action) {
  return Boolean(ALLOWED[state]?.includes(action));
}

/**
 * What the operator should do now: { tone, title, text, next: [actions] }.
 * robot: { latched, profile } from the supervisor, live: BT_LIVE.
 */
export function guide(runner, live, robot = {}) {
  if (!runner) {
    return {
      tone: "neutral",
      title: "No status from the runner",
      text: "The program runner is not reporting. Start it from the power menu or the robot PC; this page connects by itself.",
      next: [],
    };
  }
  const st = runner.state;
  const lf = runner.lastFailure;
  const where = live?.run?.[0]?.[2];
  if (live?.paused && isActiveState(st)) {
    return {
      tone: "warning",
      title: live.bp?.name ? `Held at the breakpoint "${live.bp.name}"` : "Held at tick level",
      text: "The tree is frozen between two ticks (step mode). Motions that already run continue to their end. Tick once to advance one tick, or Continue ticking.",
      next: ["dbgStep", "dbgResume"],
    };
  }
  switch (st) {
    case "NO_TREE":
      return { tone: "danger", title: "No tree loaded", text: "The tree has an error, so the runner has nothing to run. Validate it, fix it in Robot Program, then Load it.", next: ["validate", "load"] };
    case "IDLE": {
      if (robot.latched) return { tone: "danger", title: "Emergency is latched", text: "Reset the emergency first (top bar). A sim run works without the robot.", next: ["start"] };
      if (robot.profile === "jog") return { tone: "warning", title: "Ready, but the robot is in JOG", text: "Motions are refused in JOG: switch the mode to AUTO or SAFEAUTO, or start a Sim run (nothing moves).", next: ["start"] };
      return { tone: "info", title: "Ready", text: "Press Start, then choose how many cycles and the mode (Normal, Dry: plan only, Sim: no robot).", next: ["start"] };
    }
    case "RUNNING":
      return {
        tone: "success",
        title: `Running${where ? `: ${where}` : ""}`,
        text: "Pause holds after the running step. Stop ends after the running step, Finish cycle at the end of this cycle. Abort halts now (motions stop).",
        next: ["pause"],
      };
    case "PAUSING":
      return { tone: "warning", title: "Pausing…", text: `Waiting for ${where ? `"${where}"` : "the running step"} to finish; nothing new starts. Then the runner is PAUSED.`, next: ["resume"] };
    case "PAUSED":
      return { tone: "warning", title: "Paused", text: "Nothing runs. Next runs one action and pauses again; Resume continues the cycle; Stop ends the run.", next: ["resume", "step"] };
    case "STOPPING":
      return { tone: "warning", title: "Stopping…", text: "The running step finishes, then the run ends (IDLE). Abort halts it now.", next: [] };
    case "FINISHING":
      return { tone: "info", title: "Finishing the cycle", text: "This cycle runs to its end, then the run ends. Stop ends sooner, after the running step.", next: [] };
    case "FAILED":
      return {
        tone: "danger",
        title: lf ? `Cycle ${lf.cycle} failed at "${lf.node}"` : "The cycle failed",
        text: `${lf?.error ? `${lf.error}. ` : ""}Fix the cause (the red node), then Reset to acknowledge, or Start again.`,
        next: ["reset", "start"],
      };
    default:
      return { tone: "neutral", title: st, text: runner.message || "", next: [] };
  }
}

/* ───────────── tree index ───────────── */

/** structure (BtTree view) → { nodes, byUid, children(uid → [uid]), root, posOf(uid → index) } */
export function indexTree(structure, lib) {
  const nodes = structure?.nodes || [];
  const byUid = new Map();
  const posOf = new Map();
  const children = new Map();
  nodes.forEach((n, i) => {
    byUid.set(n.uid, n);
    posOf.set(n.uid, i);
  });
  for (const n of nodes) {
    if (!n.parent || !byUid.has(n.parent)) continue;
    if (!children.has(n.parent)) children.set(n.parent, []);
    children.get(n.parent).push(n.uid);
  }
  const root = byUid.get(structure?.rootUid) || nodes.find((n) => !n.parent || !byUid.has(n.parent)) || null;
  const kind = new Map();
  const color = new Map();
  for (const n of nodes) {
    const k = runtimeKind(n, children.get(n.uid)?.length || 0, lib);
    kind.set(n.uid, k);
    color.set(n.uid, k === "subtree" ? KINDS.subtree.color : colorOf(n.type, lib) || KINDS[k]?.color);
  }
  return { nodes, byUid, posOf, children, root, kind, color };
}

function runtimeKind(n, childCount, lib) {
  if (SUBTREE_TAGS.has(n.type) || n.type === "SubTreeNode" || n.type === "SubtreeNode") return "subtree";
  const k = kindOf(n.type, lib);
  if (k !== "other") return k;
  if (n.leaf || childCount === 0) return /^(Is|Check|Has)[A-Z]|Condition/.test(n.type) ? "condition" : "action";
  return childCount === 1 ? "decorator" : "control";
}

/** uids from the root down to `uid`. */
export function pathTo(index, uid) {
  const out = [];
  let n = index.byUid.get(uid);
  let guard = 0;
  while (n && guard++ < 512) {
    out.unshift(n.uid);
    n = index.byUid.get(n.parent);
  }
  return out;
}

export const fmtS = (s) => (s === undefined || s === null || !isFinite(s) ? "—" : s >= 100 ? `${Math.round(s)} s` : `${Number(s).toFixed(s >= 10 ? 1 : 2)} s`);
export const fmtMs = (ms) => (ms >= 60000 ? `${Math.floor(ms / 60000)} min ${Math.round((ms % 60000) / 1000)} s` : ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms)} ms`);
