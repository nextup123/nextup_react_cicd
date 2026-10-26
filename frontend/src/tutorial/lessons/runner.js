// NexRoot Runner page lessons. Starting a run runs the robot program, so
// those steps are marked `motion`; Sim and Dry runs are suggested for practice.
import { Bug, Compass, Eye, GitFork, OctagonAlert, PanelRight, Play, ShieldCheck } from "lucide-react";
import { useBtRunner } from "../../store/btRunner";
import { allowed, isActiveState } from "../../pages/runner/runnerModel";
import { api } from "../engine";

const PAGE = "/runner";
const has = (sel) => !!document.querySelector(/^[\w-]+$/.test(sel) ? `[data-tut="${sel}"]` : sel);
const tab = (n) => `.nr-tabs .tab:nth-child(${n})`;
const tabOn = (n) => has(`${tab(n)}[aria-selected="true"]`);
const rs = () => useBtRunner.getState();
const state = () => rs().runner?.state || "";
const active = () => isActiveState(state());
/** The run has ended, once it was seen running (the status may lag right after Start). */
const ended = (c) => {
  if (active()) c.mem.rnSeenActive = true;
  return !!c.mem.rnSeenActive && !!state() && !active();
};
const popOpen = () => has("rn-start-pop");
const SIM_TIP = "Normal moves the robot. Dry plans every motion and nothing moves. Sim runs only the logic, without the robot.";

const noTree = () =>
  !rs().structure && {
    target: "rn-tree",
    title: "No tree yet",
    text: "The runner has not sent a tree. Turn on the process switch, or load the program, then try this lesson again. You can still read the steps.",
  };

/** Start a run from the Start popup: click Start, pick cycles and mode, go. */
const startSteps = (why) => [
  {
    target: "rn-start",
    motion: "Starting runs the robot program. In Normal mode the robot moves. Choose Sim or Dry for practice: they move nothing. Keep the cell clear.",
    click: true,
    title: "Start",
    text: why,
  },
  {
    target: '[data-tut="rn-cycles"] .nr-chip:last-child',
    requires: popOpen,
    check: () => has('[data-tut="rn-cycles"] .nr-chip:last-child.is-on'),
    title: "How many cycles",
    text: "Click ∞ so it runs until you stop it. The numbers run that many cycles, Other takes any number.",
  },
  {
    target: ".nr-start-mode",
    requires: popOpen,
    click: true,
    title: "Mode",
    text: `${SIM_TIP} Pick one; Sim is best for practice.`,
  },
  {
    target: "rn-start-go",
    requires: popOpen,
    onEnter: (c) => (c.mem.rnSeenActive = false),
    signal: api("/bt/runner/start"),
    title: "Go",
    text: "Press the Start button at the bottom. The page remembers your choice for next time.",
  },
];

/* ───────────── Start here ───────────── */

const tour = {
  id: "runner.tour",
  page: PAGE,
  group: "Start here",
  icon: Compass,
  title: "Find your way around",
  blurb: "What the runner shows and where the controls are.",
  learn: ["The status and commands", "The live tree", "The details panel"],
  steps: () => [
    {
      title: "Watch the program run",
      text: "This page shows the robot program while it runs: every node of the tree, coloured live. Here you start, pause and stop it, and find out why it stopped. You edit the program on Robot Program.",
    },
    { target: ".nr-process", title: "Process", text: "This switch starts or stops the program process on the robot PC. It must be on for the runner to work." },
    { target: "rn-state", title: "Status", text: "The state of the runner: Idle, Running, Paused, Failed and so on. Next to it the cycles done in this run and in total." },
    { target: "rn-guide", title: "What to do now", text: "This line says what the runner is doing and what you can do next. Read it when you are not sure." },
    { target: "rn-actions", title: "Commands", text: "Start, Pause, Next, Finish cycle, Stop, Abort, and Load and Validate on the right. Only the commands the state allows are active: point at a grey one to read why." },
    { target: "rn-tree", title: "The live tree", text: "The whole program with every subtree in place. Orange runs now, green succeeded, red failed." },
    { target: "rn-tools", title: "Tree tools", text: "Follow, jump to a failure, compact or graph view, fold and unfold, zoom and reload." },
    { target: "rn-side", title: "Details", text: "Run shows times, Failure why a cycle stopped, Node the selected node, Events every change, Data the blackboard." },
    { target: "rn-popout", title: "Its own window", text: "Open the runner in a separate window, for example on a second screen." },
  ],
};

/* ───────────── Before you run ───────────── */

const check = {
  id: "runner.check",
  page: PAGE,
  group: "Before you run",
  icon: ShieldCheck,
  title: "Check and load",
  blurb: "Validate the main program and load it into the runner.",
  learn: ["Validate", "Read the result", "Load"],
  steps: () => {
    const canLoad = allowed(state(), "load");
    return [
      {
        target: "rn-validate",
        signal: api("/bt/runner/validate"),
        title: "Validate",
        text: "Click Validate. It checks the main program: structure, settings and points. Nothing moves.",
      },
      {
        target: ".vp",
        requires: () => has(".vp"),
        title: "The result",
        text: "Problems are listed one at a time; the arrows step through them and the tree marks each problem node in red or orange. Drag the box by its top bar.",
      },
      { target: ".vp", check: () => !has(".vp"), title: "Close it", text: "Close the box with its x, or press Esc." },
      canLoad
        ? {
            target: "rn-load",
            signal: api("/bt/runner/load"),
            title: "Load",
            text: "Click Load. The runner takes the main program as it is saved now. Nothing starts or moves.",
          }
        : { target: "rn-load", title: "Load", text: "Load puts the saved main program into the runner. It works only while the runner is Idle, Failed or has no tree, so stop the run first." },
      { target: "rn-reload", title: "Reload", text: "When the tree here looks out of date, reload it from the runner." },
    ];
  },
};

/* ───────────── Run the program ───────────── */

const run = {
  id: "runner.run",
  page: PAGE,
  group: "Run the program",
  icon: Play,
  motion: true,
  title: "Start, pause and stop",
  blurb: "Start a run, pause it, step through it and finish the cycle.",
  learn: ["Start with cycles and a mode", "Pause, Next and Resume", "Finish cycle and Stop"],
  note: "In Normal mode the robot moves. Choose Sim (no robot) or Dry (plans only) for practice. Know where the E-STOP is.",
  steps: () => {
    if (!allowed(state(), "start")) {
      return [
        { target: "rn-guide", title: "Not ready to start", text: "Start works when the runner is Idle or Failed. Read this line for what to do, or stop the current run first, then try again." },
        { target: "rn-actions", title: "The commands", text: "Pause holds after the running step. Next runs one action while paused. Finish cycle ends at the end of the cycle. Stop ends after the running step. Abort halts at once." },
      ];
    }
    return [
      ...startSteps("Click Start."),
      { target: "rn-state", title: "Running", text: "The status turns green and the cycle counter counts. The guide line says which action runs." },
      { target: "rn-canvas", title: "Watch it", text: "The running nodes are orange, finished ones green. Follow keeps the running action in view." },
      {
        target: "rn-pause",
        signal: api("/bt/runner/pause"),
        check: ended,
        title: "Pause",
        text: "Click Pause. The running step finishes, then nothing new starts.",
      },
      {
        target: "rn-step",
        signal: api("/bt/runner/step"),
        check: ended,
        title: "One action",
        text: "Wait until the status says Paused, then click Next. One action runs and it pauses again.",
      },
      {
        target: "rn-resume",
        signal: api("/bt/runner/resume"),
        check: ended,
        title: "Resume",
        text: "Click Resume to go on with the cycle.",
      },
      {
        target: "rn-finish-cycle",
        signal: api("/bt/runner/finish_cycle"),
        check: ended,
        title: "Finish the cycle",
        text: "Click Finish cycle. This cycle runs to its end, then the run ends.",
      },
      { target: "rn-state", check: ended, title: "Back to Idle", text: "Wait until the status says Idle." },
      { target: "rn-stop", title: "Stop and Abort", text: "Stop ends the run after the running step. Abort halts at once and stops running motions. The E-STOP always stops everything." },
    ];
  },
};

const failure = {
  id: "runner.failure",
  page: PAGE,
  group: "Run the program",
  icon: OctagonAlert,
  title: "When a cycle fails",
  blurb: "Find the node that stopped the run and why.",
  learn: ["The Failure tab", "Jump to the node", "Reset"],
  steps: () => [
    { target: tab(2), check: () => tabOn(2), title: "Failure", text: "Click the Failure tab." },
    {
      target: "rn-side",
      title: "What failed",
      text: "The node that stopped the cycle, its error, its settings, the joint angles and the blackboard at that moment. Show jumps to it in the tree. If nothing failed yet, it says so.",
    },
    { target: ".nr-jumpfail", title: "Jump to failure", text: "With this on, the page shows the failed node and this tab by itself when a cycle fails." },
    { target: ["rn-show-failure", "rn-tools"], title: "Find it again", text: "After a failure, the target button in the tools shows the failed node at any time." },
    { target: "rn-guide", title: "Then Reset", text: "Fix the cause, often on Robot Program or Teach Points. Then Reset acknowledges the failure, or Start runs again." },
  ],
};

/* ───────────── Watch the tree ───────────── */

const views = {
  id: "runner.views",
  page: PAGE,
  group: "Watch the tree",
  icon: GitFork,
  title: "Compact and graph view",
  blurb: "Two ways to see the tree, with folding and zoom.",
  learn: ["Compact rows", "Fold subtrees", "The graph"],
  steps: () => [
    noTree(),
    { target: ".nr-view button:nth-child(1)", check: () => has(".nl-wrap"), title: "Compact", text: "Click Compact." },
    { target: ".nl-wrap", requires: () => has(".nl-wrap"), title: "One line per node", text: "Like a folder listing: the node, its type, its status and how long it runs. Many nodes fit on the screen at once." },
    {
      target: ["rn-tighter", "rn-roomier"],
      onEnter: (c) => (c.mem.rnDens = localStorage.getItem("nextup.runner.density")),
      check: (c) => localStorage.getItem("nextup.runner.density") !== c.mem.rnDens,
      title: "Row height",
      text: "Click Tighter rows or Roomier rows, next to the fold buttons.",
    },
    { target: "rn-fold-all", click: true, title: "Fold", text: "Click Fold every subtree. Each subtree shrinks to one line with the number of hidden nodes." },
    { target: "rn-unfold-all", click: true, title: "Unfold", text: "Click Unfold everything. Double-click a node, or click its small arrow, to fold just that one." },
    { target: ".nl-foot", requires: () => has(".nl-wrap"), title: "Colours", text: "Orange running, green success, red failure, pale green done earlier in this cycle. The last change is shown on the right." },
    { target: ".nr-view button:nth-child(2)", check: () => has(".nr-canvas"), title: "Graph", text: "Click Graph." },
    { target: ".nr-canvas", requires: () => has(".nr-canvas"), title: "Boxes and links", text: "The tree as boxes. Drag to move it, scroll to zoom, double-click a subtree to fold it." },
    { target: "rn-orient", requires: () => has(".nr-canvas"), click: true, title: "Layout", text: "Click to lay the tree out left to right, or top to bottom." },
    { target: "rn-zoom-in", requires: () => has(".nr-canvas"), click: true, title: "Zoom", text: "Click Zoom in. Zoom out is next to it." },
    { target: "rn-fit", requires: () => has(".nr-canvas"), click: true, title: "Fit", text: "Click Fit the tree to see all of it." },
    { target: "rn-legend", title: "Legend", text: "The colours of the graph. Use the view you like: the page remembers it." },
  ],
};

const find = {
  id: "runner.find",
  page: PAGE,
  group: "Watch the tree",
  icon: Eye,
  title: "Find, follow and select",
  blurb: "Search for a node, keep the running action in view and inspect a node.",
  learn: ["Search", "Follow", "The Node tab"],
  steps: () => [
    noTree(),
    { target: "rn-search", press: "Enter", title: "Find a node", text: "Type part of a node name or type and press Enter. Enter again jumps to the next match." },
    {
      id: "rn-select",
      target: "rn-canvas",
      check: () => tabOn(3) && has("rn-node-show"),
      title: "Select a node",
      text: "Click a node in the tree. The Node tab opens on the right.",
    },
    { target: "rn-side", title: "The Node tab", text: "Its name and type, where it sits in the tree, its status and its recent results. Click a name in the path to jump up the tree." },
    { target: "rn-node-show", requires: () => has("rn-node-show"), backTo: "rn-select", click: true, title: "Show", text: "Click Show to centre the node in the tree." },
    { target: "rn-node-edit", requires: () => has("rn-node-edit"), backTo: "rn-select", title: "Edit", text: "Edit opens this node in the Robot Program editor, so you can change it." },
    { target: ".nr-follow", title: "Follow", text: "While the program runs, Follow keeps the running action in view. After you move the tree yourself, it waits a few seconds." },
    { target: "rn-show-running", title: "Where is it now?", text: "This button shows the running action at once." },
  ],
};

const panels = {
  id: "runner.panels",
  page: PAGE,
  group: "Watch the tree",
  icon: PanelRight,
  title: "Times, events and data",
  blurb: "Cycle times, the list of events and the blackboard.",
  learn: ["Cycle times", "Events", "Blackboard"],
  steps: () => [
    { target: tab(1), check: () => tabOn(1), title: "Run", text: "Click the Run tab." },
    { target: ["rn-stats", "rn-side"], title: "Cycle times", text: "What runs now and for how long, this cycle, the last one, the average, the fastest and slowest. Below: the slowest steps of the last cycle." },
    { target: tab(4), check: () => tabOn(4), title: "Events", text: "Click the Events tab." },
    {
      target: ["rn-ev-nav", "rn-side"],
      title: "Every change",
      text: "Each time a step starts, succeeds or fails, newest first. Click one to show its node in the tree; Previous and Next walk through them.",
    },
    { target: tab(5), check: () => tabOn(5), title: "Data", text: "Click the Data tab." },
    { target: "rn-side", title: "Blackboard", text: "The values the program keeps while it runs, and which tree is loaded with any warnings." },
  ],
};

/* ───────────── Debug ───────────── */

const breakpoints = {
  id: "runner.breakpoints",
  page: PAGE,
  group: "Debug",
  icon: Bug,
  motion: true,
  title: "Breakpoints",
  blurb: "Hold the program at a node, tick it step by step and go on.",
  learn: ["Set a breakpoint", "Tick once", "Clear it"],
  note: "The practice run part starts the program. In Normal mode the robot moves: use Sim or Dry. Remember to clear the breakpoint at the end.",
  steps: () => {
    const canStart = allowed(state(), "start");
    return [
      noTree(),
      {
        target: "rn-canvas",
        check: () => has("rn-break-start") || has("rn-break-clear"),
        title: "Pick a node",
        text: "Click an action in the tree, for example a move. The Node tab opens.",
      },
      {
        target: "rn-break-start",
        requires: () => has("rn-break-start") || has("rn-break-clear"),
        signal: api("/bt/break", "POST", (b) => !!b.name),
        title: "Break when it starts",
        text: "Click Break when it starts. The tree will hold just before this node runs. Break on failure holds only when it fails.",
      },
      { target: [".nl-row.has-bp", "rn-canvas"], title: "Marked", text: "The node now carries the breakpoint mark. Only one breakpoint is set at a time." },
      { target: "rn-canvas", check: () => has("rn-ctx-menu"), title: "Right-click", text: "Right-click any node." },
      {
        target: "rn-ctx-menu",
        requires: () => has("rn-ctx-menu"),
        check: () => !has("rn-ctx-menu"),
        title: "The node menu",
        text: "Centre, fold, set or clear the breakpoint and open the node in the editor. Move the mouse off the menu to close it.",
      },
      ...(canStart
        ? [
            ...startSteps("Start a run and watch it stop at your breakpoint. Click Start."),
            {
              target: "rn-guide",
              check: () => !!rs().live?.paused,
              title: "Held",
              text: "Wait until the guide says Held at the breakpoint. If the node does not run in this program, press Skip step.",
            },
            { target: "rn-tick-once", requires: () => has("rn-tick-once"), signal: api("/bt/step"), title: "Tick once", text: "Click Tick once. The tree moves on by exactly one tick. Motions that already run go on to their end." },
          ]
        : []),
      {
        target: ["rn-break-clear", "rn-canvas"],
        signal: api("/bt/break", "POST", (b) => !b.name),
        title: "Clear it",
        text: "Click the node with the breakpoint and press Clear breakpoint, or use the right-click menu.",
      },
      canStart && { target: "rn-tick-continue", requires: () => has("rn-tick-continue"), signal: api("/bt/resume"), title: "Continue", text: "Click Continue ticking. The tree runs on normally." },
      canStart && {
        target: "rn-stop",
        signal: api("/bt/runner/stop"),
        check: ended,
        title: "Stop the run",
        text: "Click Stop. The run ends after the running step.",
      },
    ];
  },
};

export default [tour, check, run, failure, views, find, panels, breakpoints];
