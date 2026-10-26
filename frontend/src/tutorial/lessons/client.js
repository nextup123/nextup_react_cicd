// Client Control page lessons.
import { BarChart3, Cable, Compass, Gauge, LayoutGrid, Play, Settings2 } from "lucide-react";
import { useRobot } from "../../store/robot";
import { processRunning } from "../../components/robot/ProcessSwitch";

const PAGE = "/client";
const q = (sel) => document.querySelector(sel);
const uiCommand = (command) => (name, data) => name === "ws:UI_COMMANDS" && data?.command === command;
const startReady = () => {
  const b = q('[data-tut="cc-start"]');
  return !!b && !b.disabled;
};
const OUTPUT = '[data-tut="cc-outputs"] .cc-io-tile .switch, [data-tut="cc-outputs"] .cc-io-tile .btn';

const tour = {
  id: "client.tour",
  page: PAGE,
  group: "Start here",
  icon: Compass,
  title: "Find your way around",
  blurb: "The production screen: run the program and watch the cycles.",
  learn: ["Robot state and the buttons", "Speed override and production", "The operator panel"],
  steps: () => [
    { title: "The production screen", text: "This page is for running the cell. You start and stop the robot program here and watch how the cycles go." },
    { target: "cc-state", title: "Robot state", text: "This tells you what the robot is doing right now: Not ready, Ready to start, Running, Paused or a stop. The text under it says what to do next." },
    { target: "cc-facts", title: "Process, status and mode", text: "The Process switch loads the robot program. Next to it you see the reported status, the mode of operation and, while running, the cycle number." },
    { target: "cc-buttons", title: "Start, Stop, Finish Cycle", text: "Start runs the program. Stop stops it at once and resets it. Finish Cycle lets the robot finish the part it is on, then stop." },
    { target: "cc-speed", title: "Speed override", text: "Sets how fast the robot runs, from 0 to 100 percent. It works at once, also while the program runs." },
    { target: "cc-production", title: "Production", text: "Cycle counters and cycle times, so you can see how the shift is going." },
    { target: "cc-panel", title: "Operator panel", text: "The controls of this cell: run mode, CNC machine, inputs, outputs and whatever buttons, lamps and values were added for this project. Edit changes it; it is saved with the project." },
    { target: "estop", title: "Always within reach", text: "The red E-STOP in the top bar stops every drive at once, from any page." },
  ],
};

const run = {
  id: "client.run",
  page: PAGE,
  group: "Run production",
  icon: Play,
  motion: true,
  title: "Start, finish and stop",
  blurb: "Run the robot program and stop it the right way.",
  learn: ["Turn on Process", "Start the program", "Finish Cycle and Stop"],
  note: "Do this lesson with a program you know, ideally in Low speed test. Keep the cell clear.",
  steps: () => [
    {
      target: ".cc-facts .switch",
      check: () => processRunning(useRobot.getState().processStatus),
      title: "Turn on Process",
      text: "Flip the Process switch on. It loads the robot program. The robot does not move yet.",
      tip: "If Process is on already, this step moves on by itself.",
    },
    {
      target: "cc-state",
      check: startReady,
      title: "Wait for ready",
      text: "Wait until the state says Ready to start. That can take a few seconds.",
      tip: "If it stays Not ready, the robot program did not report ready. Check the Robot Program page, or skip this step to read on.",
    },
    {
      target: "cc-start",
      motion: true,
      signal: uiCommand("start_bt"),
      title: "Start",
      text: () => (startReady() ? "Press Start. The robot switches to Auto and runs the program." : "Start is still waiting for ready. When it lights up, press it. Or skip this step to read on."),
      tip: "If something blocks the start, like a latched emergency, a window tells you what to fix first.",
    },
    { target: "cc-state", title: "Watch it run", text: "The state shows Running. Now shows the step the program is on, and Cycle counts the cycles." },
    {
      target: "cc-finish",
      signal: uiCommand("control_exit_bt"),
      title: "Finish Cycle",
      text: "Press Finish Cycle. The robot completes the part it is on and then stops. This is the normal way to end a run.",
    },
    {
      target: "cc-stop",
      title: "Stop",
      text: "Stop ends the program at once and resets it. Use it when something is wrong. For danger, press the E-STOP.",
    },
  ],
  outro: "Finish Cycle at the end of a shift, Stop when something looks wrong, E-STOP when someone is in danger.",
};

const speed = {
  id: "client.speed",
  page: PAGE,
  group: "Run production",
  icon: Gauge,
  title: "Speed override",
  blurb: "Slow the robot down or speed it up while it runs.",
  learn: ["Read the gauge", "Step down and up", "The supervisor cap"],
  note: "A higher speed applies at once, also while the program runs.",
  steps: () => [
    { target: "cc-speed", title: "The gauge", text: "The big number is the speed you set. Under it you see the speed the robot really uses." },
    {
      target: '[data-tut="cc-speed"] .cc-speed-row button:first-of-type',
      signal: "ws:SET_SPEED_INT8",
      title: "Slower",
      text: "Press the minus button. Each press takes off 5 percent.",
    },
    { target: '[data-tut="cc-speed"] .cc-range', title: "Slider", text: "Drag the slider for bigger changes. The robot follows smoothly, without jumps." },
    {
      target: '[data-tut="cc-speed"] .cc-speed-row button:last-of-type',
      signal: "ws:SET_SPEED_INT8",
      title: "Faster",
      text: "Press the plus button to go back up.",
    },
    { target: "cc-speed", title: "Capped speed", text: "Some modes have a top speed set by the supervisor. Then the gauge shows a mark and says limited to, and the robot never goes faster than that." },
  ],
};

const production = {
  id: "client.production",
  page: PAGE,
  group: "Watch the cycles",
  icon: BarChart3,
  title: "Production numbers",
  blurb: "Counters and cycle times at a glance.",
  learn: ["Session and total counters", "Cycle time averages", "The cycle time chart"],
  steps: () => [
    { target: '[data-tut="cc-kpis"] .cc-kpi:nth-child(1)', title: "This session", text: "Cycles finished since this app was opened. It counts on while you visit other pages." },
    { target: '[data-tut="cc-kpis"] .cc-kpi:nth-child(2)', title: "Last session", text: "How many cycles the previous session made." },
    { target: '[data-tut="cc-kpis"] .cc-kpi:nth-child(3)', title: "Total", text: "Every cycle this robot has counted." },
    { target: "cc-reset-total", title: "Reset the total", text: "This small button sets the total back to 0. It asks first and cannot be undone, so only use it when you really need a fresh count." },
    { target: '[data-tut="cc-kpis"] .cc-kpi:nth-child(4)', title: "Last cycle", text: "How long the last cycle took, in seconds." },
    { target: '[data-tut="cc-kpis"] .cc-kpi:nth-child(5)', title: "Averages", text: "Avg 5 and Avg 15 are the average of the last 5 and 15 cycles. They show a trend better than one cycle." },
    { target: "cc-spark", title: "Cycle time chart", text: "The last cycles as a small line. A line that climbs means cycles get slower. Point at it to see the range." },
  ],
};

const setup = {
  id: "client.setup",
  page: PAGE,
  group: "Watch the cycles",
  icon: Settings2,
  title: "Run mode and CNC",
  blurb: "Choose how fast production runs and which machine is served.",
  learn: ["The three run modes", "Speed scale", "CNC machine"],
  note: "These are real settings of the cell. The lesson only shows them; change them when you mean to.",
  steps: () => [
    { target: "cc-runmode", missing: "This project's operator panel has no run mode buttons. Edit the panel and add Option buttons wired to Run mode, or press Default.", title: "Run mode", text: "Low speed test runs slowly, good for a first run. High speed test is faster and adjustable. Production runs the program at its full speed." },
    { target: "cc-speedscale", title: "Speed scale", text: "Only in High speed test you can set the speed here, from 0.50 to 0.90. It is saved for the next time." },
    { target: "cc-runmode", title: "Switching while running", text: "If the program runs when you switch the mode, the app asks first, because the new speed applies at once." },
    { target: "cc-cnc", missing: "This project's operator panel has no CNC buttons. Edit the panel and add Option buttons wired to the CNC machine, or press Default.", title: "CNC machine", text: "Pick CNC 1, CNC 2 or Both. The robot program uses this to know which machine to load." },
  ],
};

const io = {
  id: "client.io",
  page: PAGE,
  group: "Watch the cycles",
  icon: Cable,
  title: "Inputs and outputs",
  blurb: "See sensors and switch outputs without leaving production.",
  learn: ["Read the inputs", "Switch an output", "Reload the lists"],
  note: "This switches a real output: a gripper may open or close. Keep hands clear of the tool.",
  steps: () => [
    { target: "cc-inputs", missing: "This project's operator panel has no input group. Edit the panel and add a Signal group, or press Default.", title: "Inputs", text: "Each input step of the project with its state. A green dot and ON mean the signal is there." },
    {
      target: OUTPUT,
      motion: "This switches a real output on the cell. Keep hands clear of the gripper and the tool.",
      signal: ["ws:TOGGLE_DO", "ws:GPIO_COMMAND"],
      title: "Switch an output",
      text: "Flip the switch of an output, or press Push. Push turns it on for a moment and off again.",
      missing: "There are no output steps in this project yet. Add them on the IO Control page, or skip.",
    },
    {
      target: '[data-tut="cc-outputs"] .cc-io-tile .switch',
      motion: "This switches the output again. Keep hands clear of the gripper and the tool.",
      signal: ["ws:TOGGLE_DO", "ws:GPIO_COMMAND"],
      title: "Switch it back",
      text: "Flip it again to put it back the way it was.",
      missing: "No switch here to put back. Skip this step.",
    },
    { target: "cc-panel", title: "Always the current list", text: "The Inputs and Outputs groups show the IO steps of the IO Control page; a change there shows up here by itself." },
  ],
};

const panel = {
  id: "client.panel",
  page: PAGE,
  group: "Set up the cell",
  icon: LayoutGrid,
  title: "Build the operator panel",
  blurb: "Add buttons, lamps, switches and values for this cell.",
  learn: ["Edit mode", "Add and wire a widget", "Move, resize, auto-arrange"],
  note: "The panel belongs to the project: it is saved, versioned and restored with it.",
  steps: () => [
    { target: "cc-panel-edit", title: "Edit", text: "Edit opens the panel for changes. The robot keeps running; only the panel changes." },
    { target: "cc-panel", title: "Move and resize", text: "In edit mode drag a widget by its body to move it and by its bottom-right corner to resize it. What it covers moves down, gaps close upwards." },
    { target: "cc-panel", title: "Add a widget", text: "Add shows every kind: buttons, toggles, lamps, option buttons, dropdowns, number and text fields, sliders, value displays, signal groups and headings. Then you choose what it is wired to: a console action, a PLC bit or register, a robot input or output, the IO list, a ROS topic, a blackboard value or a robot state." },
    { target: "cc-panel", title: "Safety", text: "Anything that acts waits until the robot is stopped, unless you untick it for that widget. Stop and reset actions always work. Tick Ask before it acts for anything that needs a second thought." },
    { target: "cc-panel", title: "Auto-arrange and Done", text: "Auto-arrange packs the widgets in reading order with the edges lined up. Done leaves edit mode; every change is already saved." },
  ],
};

export default [tour, run, speed, production, setup, io, panel];
