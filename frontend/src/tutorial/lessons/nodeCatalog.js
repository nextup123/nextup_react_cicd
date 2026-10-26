// Short, plain explanations of the robot program nodes, grouped into lessons
// of nodes that behave alike. Which lessons show, and which nodes each one
// lists, comes from the live node library: a family appears only when at
// least one of its nodes is in the library, and library nodes no family
// knows get a generic lesson per category (see treeNodes.js).
import {
  Ban, Binary, CheckCheck, Clock3, Combine, Crosshair, FlipHorizontal2, GitFork, Hourglass, ListOrdered, MessageSquareText,
  Navigation, Plug, Radio, Repeat, ShieldAlert, Spline, SplitSquareHorizontal, TimerReset, Variable,
} from "lucide-react";

/** child: "none" leaf, "one" decorator (wraps one child), "many" control (several children). */
export const FAMILIES = [
  {
    id: "result",
    title: "Always Success / Always Failure",
    icon: CheckCheck,
    child: "none",
    what: "They finish at once with a fixed result. Use them as placeholders while you build, or to force a branch on purpose.",
    nodes: {
      AlwaysSuccess: { line: "Does nothing and reports success." },
      AlwaysFailure: { line: "Does nothing and reports failure." },
    },
    example: "In a Fallback, an Always Success as the last child means \"if nothing else worked, carry on anyway\".",
  },
  {
    id: "sequence",
    title: "Sequences: run in order",
    icon: ListOrdered,
    child: "many",
    what: "A sequence runs its children from left to right. If one fails, the sequence stops and fails. It succeeds when all children succeed.",
    nodes: {
      Sequence: { line: "Runs children in order. One fails, all fail." },
      SequenceStar: { line: "Like Sequence, but after a failure it continues from the failed child instead of starting over." },
      ReactiveSequence: { line: "Checks the earlier children again on every tick, so a condition can stop an action that is still running." },
    },
    example: "Pick a part = Sequence of: move above part, open gripper, move down, close gripper, move up.",
  },
  {
    id: "fallback",
    title: "Fallbacks: try alternatives",
    icon: GitFork,
    child: "many",
    what: "A fallback tries its children one by one until one succeeds. It is your plan B, plan C. It fails only if every child fails.",
    nodes: {
      Fallback: { line: "Tries children in order until one succeeds." },
      ReactiveFallback: { line: "Checks the earlier children again on every tick and switches back as soon as one of them succeeds." },
      AlternatingSelector: { line: "Takes a different child each time it runs (see its mode setting)." },
    },
    example: "Fallback of: check part is there, else show a popup \"no part\". The popup only shows when the check fails.",
  },
  {
    id: "branch",
    title: "If-then-else and while-do",
    icon: SplitSquareHorizontal,
    child: "many",
    what: "These decide which branch runs. The first child is the question, the other children are the answers.",
    nodes: {
      IfThenElse: { line: "First child succeeds: runs the second child. It fails: runs the third." },
      WhileDoElse: { line: "While the first child succeeds, keeps running the second. When it fails, runs the third." },
    },
    example: "IfThenElse: is the gripper closed? then move on, else open it first.",
  },
  {
    id: "parallel",
    title: "Parallel: run together",
    icon: Combine,
    child: "many",
    what: "Runs all its children at the same time.",
    nodes: {
      Parallel: { line: "Runs children together.", attrs: { success_threshold: "how many children must succeed", failure_threshold: "how many failures stop it" } },
    },
    example: "Move to the next point while a light blinks, both at once.",
  },
  {
    id: "invert",
    title: "Inverter: flip the result",
    icon: FlipHorizontal2,
    child: "one",
    what: "A decorator wraps exactly one child and changes how it runs or what it reports.",
    nodes: {
      Inverter: { line: "Turns success into failure and failure into success." },
    },
    example: "Inverter around an input check = \"succeed when the input is OFF\".",
  },
  {
    id: "force",
    title: "Force Success / Force Failure",
    icon: Ban,
    child: "one",
    what: "They run their child, then report a fixed result no matter what the child did.",
    nodes: {
      ForceSuccess: { line: "Runs the child, then always reports success." },
      ForceFailure: { line: "Runs the child, then always reports failure." },
    },
    example: "Force Success around an optional message, so a failed message never stops the program.",
  },
  {
    id: "loop",
    title: "Repeat and retry",
    icon: Repeat,
    child: "one",
    what: "Run the child more than once.",
    nodes: {
      Repeat: { line: "Runs its child a set number of times. Stops early if the child fails.", attrs: { num_cycles: "how many times, -1 = forever" } },
      RetryUntilSuccessful: { line: "Tries the child again when it fails.", attrs: { num_attempts: "how many tries in total" } },
      KeepRunningUntilFailure: { line: "Runs the child again and again until it fails." },
    },
    example: "Retry Until Successful (3) around a grip: try up to three times before giving up.",
  },
  {
    id: "timing",
    title: "Waiting and time limits",
    icon: Hourglass,
    child: "mixed",
    what: "Wait a moment, wait for something, or stop something that takes too long.",
    nodes: {
      Sleep: { line: "Waits, then succeeds. A plain pause.", attrs: { msec: "wait time in ms, 1000 = 1 s" } },
      Delay: { line: "Waits, then runs its child.", attrs: { delay_msec: "wait time in ms before the child starts" } },
      DelayTicks: { line: "Waits a number of ticks, then runs its child.", attrs: { ticks: "how many ticks to wait" } },
      Timeout: { line: "Stops the child and fails if it takes too long.", attrs: { msec: "time limit in ms" } },
      WaitUntilTrue: { line: "Checks its child again and again until it succeeds or time runs out.", attrs: { timeout_ms: "give up after this long", check_interval_ms: "how often to check" } },
    },
    example: "Timeout (5000) around a move: if the robot is not there in 5 s, the step fails instead of waiting forever.",
  },
  {
    id: "once",
    title: "Run once",
    icon: TimerReset,
    child: "one",
    what: "Run the child only the first time; later runs skip it.",
    nodes: {
      RunOnce: { line: "Runs its child the first time only." },
      GeneralOneShot: { line: "Runs its child one time, then skips it." },
    },
    example: "Run Once around a homing move at the start of the program.",
  },
  {
    id: "messages",
    title: "Messages and popups",
    icon: MessageSquareText,
    child: "none",
    what: "Tell the operator what is happening.",
    nodes: {
      MsgLogger: { line: "Writes a line to the robot messages (the bell in the top bar).", attrs: { msg_log: "the text" } },
      MsgPopup: { line: "Shows a message on the screen.", attrs: { msg: "the text", type: "success, warn or failure", timeout: "seconds it stays" } },
      PrintMessage: { line: "Writes a message to the program log.", attrs: { msg: "the text" } },
    },
    example: "A Message Popup \"Load a new tray\" when the tray is empty.",
  },
  {
    id: "io",
    title: "Inputs and outputs",
    icon: Plug,
    child: "none",
    what: "Switch outputs (gripper, lights) and check inputs (sensors).",
    nodes: {
      DoControl: { line: "Switches a digital output on or off.", attrs: { driver_id: "which driver", do_id: "which output", expected_action: "true = on, false = off", push_wait: "for push outputs: how long it stays on" } },
      DIControl: { line: "Checks a digital input. Fails if it is not as expected in time.", attrs: { di_id: "which input", expected_status: "true = on, false = off", wait_time: "how long to wait for it" } },
    },
    tip: "Easier: name your IO steps on the IO Control page, then add them from the library's DO/DI section.",
    example: "Close gripper (DoControl), then check the gripper-closed sensor (DIControl).",
  },
  {
    id: "signals",
    title: "Robot signals",
    icon: Radio,
    child: "none",
    what: "Send a value to, or check a value from, another part of the robot software.",
    nodes: {
      PublishDataOnTopic: { line: "Sends a value on a named signal." },
      CheckBoolTopic: { line: "Succeeds when a yes/no signal has the expected value.", attrs: { timeout_ms: "how long to wait", freshness_ms: "how recent the value must be" } },
      CheckTopic: { line: "Like Check Bool, for numbers and text too." },
    },
    example: "Check a signal from the conveyor before picking.",
  },
  {
    id: "variables",
    title: "Variables and maths",
    icon: Variable,
    child: "none",
    what: "A program can remember values in named variables, calculate with them and compare them.",
    nodes: {
      SetVar: { line: "Stores a value in a variable.", attrs: { key: "variable name", value: "what to store" } },
      ArithmeticNode: { line: "result = a op b (+ − × ÷).", attrs: { op: "the operation" } },
      MathExpression: { line: "Works out a formula with a…e and stores the result." },
      Modulo: { line: "Remainder of a division. Handy for \"every 5th part\"." },
      Compare: { line: "Succeeds when left op right is true (a check)." },
      WaitForBlackboardChange: { line: "Waits until a variable changes." },
      PublishBlackboard: { line: "Shares a variable with other robot software." },
      SubscribeToBlackboard: { line: "Receives a shared value into a variable." },
    },
    example: "Counter + Modulo + Compare: every 10th part, take it out for checking.",
  },
  {
    id: "timers",
    title: "Timers and counters",
    icon: Clock3,
    child: "none",
    what: "Measure how long things take and count cycles.",
    nodes: {
      TimerStart: { line: "Starts a stopwatch.", attrs: { key: "timer name" } },
      TimerStop: { line: "Stops it and keeps the time." },
      TimerReset: { line: "Sets it back to zero." },
      CycleCounter: { line: "Counts finished cycles.", attrs: { cycle_count: "where the count is kept" } },
    },
    example: "Timer Start at the top of a cycle, Timer Stop at the end: now you know your cycle time.",
  },
  {
    id: "move",
    title: "Moving to points",
    icon: Navigation,
    child: "none",
    what: "These nodes move the robot to the points you taught on Teach Points.",
    nodes: {
      PlanAndExecute: { line: "Plans a path to a point and moves there.", attrs: { pose_goal: "the point", cart: "true = straight line", speed_factor: "0.1 = 10 % speed" } },
      PilzPointsPlanner: { line: "Moves to a point the industrial way: PTP (fast joint move) or LIN (straight line).", attrs: { pose_goal: "the point", planner_id: "PTP or LIN" } },
      IsAtPose: { line: "Checks whether the robot is already at a point.", attrs: { target_name: "the point" } },
    },
    tip: "In the settings, point fields offer the list of your taught points.",
    example: "Fallback of: Is At Pose (home), else Plan And Execute (home). Goes home only when it is not there yet.",
  },
  {
    id: "paths",
    title: "Arcs, frames, weaving and paths",
    icon: Spline,
    child: "mixed",
    what: "Special motions: arcs, moves relative to a frame, welding weaves and combined smooth motions.",
    nodes: {
      PilzCircPlanner: { line: "Moves along an arc: from start, through interim, to goal." },
      PilzFramePlanner: { line: "Moves by an offset (x y z, r p w) relative to a frame." },
      WeavingMotionPlanner: { line: "Weaves side to side along a line, for welding." },
      RunPath: { line: "Runs a saved path." },
      MakePilzMotion: { line: "Joins the points of its Add Pilz Point children into one smooth motion." },
      AddPilzPoint: { line: "One point of a Make Pilz Motion." },
    },
    example: "Make Pilz Motion with three Add Pilz Point children: one smooth move through three points.",
  },
  {
    id: "safety",
    title: "Collision protection",
    icon: ShieldAlert,
    child: "none",
    what: "Limits how hard each joint may push, so the robot stops when it hits something.",
    nodes: {
      RunwayProtection: { line: "Sets a torque limit per joint while the program runs.", attrs: { active: "true = on", j1_torque: "limit for joint 1 (and so on to j6)" } },
    },
    example: "Turn it on before moving into a tight fixture.",
  },
];

/** Motion programs are added from the library's Motion programs list, not taught here. */
export const SKIP_NODES = new Set(["RunProgram"]);

export const FALLBACK_ICON = { action: Crosshair, condition: Binary, control: GitFork, decorator: Repeat };
