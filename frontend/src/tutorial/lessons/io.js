// IO Control page lessons.
import { Compass, LogIn, LogOut, Pencil, Pin, ToggleRight } from "lucide-react";
import { api } from "../engine";

const PAGE = "/io";
const esc = (s) => (window.CSS?.escape ? CSS.escape(s) : String(s).replace(/"/g, '\\"'));
const row = (name) => `[data-tut-io="${esc(name)}"]`;
const formOpen = () => !!document.querySelector('[data-tut="io-form"]');
const menuItem = (id) => () => !!document.querySelector(`[data-tut="${id}"]`);
const madeName = (ctx) => ctx.mem.madeIo || ctx.lastOf("/io-control/addControl")?.body?.name || "";

const tour = {
  id: "io.tour",
  page: PAGE,
  group: "Start here",
  icon: Compass,
  title: "Find your way around",
  blurb: "Live signals on the left, your IO steps on the right.",
  learn: ["Live driver and GPIO signals", "IO sequences", "Signal watch"],
  steps: () => [
    { title: "Inputs and outputs", text: "Outputs switch things on the cell, like a gripper or a light. Inputs tell the robot what is happening, like a part sensor." },
    { target: "io-driver", title: "Driver I/O", text: "The signals wired to the robot's joint drivers, live. A green dot means on." },
    { target: "io-gpio", title: "GPIO I/O", text: "Signals of the extra GPIO modules, if your cell has them." },
    { target: "io-seq", title: "IO sequences", text: "Named IO steps, like GripperOpen. Robot programs use these names, so you never have to remember wire numbers." },
    { target: ["io-watch", ".io-watch-off"], title: "Signal watch", text: "Records when inputs change, with timing and the robot position. Great for finding a flaky sensor." },
  ],
};

const addOut = {
  id: "io.add-output",
  page: PAGE,
  group: "IO steps",
  icon: LogOut,
  title: "Add an output step",
  blurb: "Give a driver output a name so programs can switch it.",
  learn: ["Open Add", "Pick the output", "Save it with a name"],
  steps: () => [
    { target: "io-add", check: menuItem("io-add-driver-do"), title: "Add", text: "Click Add." },
    { target: "io-add-driver-do", click: true, requires: menuItem("io-add-driver-do"), title: "Driver output", text: "Choose Driver output (DO)." },
    {
      target: "io-form",
      requires: formOpen,
      signal: api("/io-control/addControl"),
      title: "Name and wire",
      text: "Give it a clear name like GripperClose (letters and digits only), pick the driver and output, choose Switch or Push, write a short log message, then press Add output step.",
      tip: "Push turns the output on for a short time and then off again, like pressing a button.",
    },
    {
      target: (ctx) => row(madeName(ctx)),
      onEnter: (ctx) => (ctx.mem.madeIo = ctx.lastOf("/io-control/addControl")?.body?.name || ctx.mem.madeIo),
      title: "Added!",
      text: "Your step is in the list. Robot programs can now use it by name.",
    },
  ],
};

const addIn = {
  id: "io.add-input",
  page: PAGE,
  group: "IO steps",
  icon: LogIn,
  title: "Add an input check",
  blurb: "Let the robot wait for a sensor before it goes on.",
  learn: ["Add a driver input", "Wait time", "What happens when it fails"],
  steps: () => [
    { target: "io-add", check: menuItem("io-add-driver-di"), title: "Add", text: "Click Add." },
    { target: "io-add-driver-di", click: true, requires: menuItem("io-add-driver-di"), title: "Driver input", text: "Choose Driver input (DI)." },
    {
      target: "io-form",
      requires: formOpen,
      signal: api("/io-control/addControl"),
      title: "Set the check",
      text: "Name it, for example PartPresent (letters and digits only). Pick the input, set how long to wait for it, write a short log message, then press the add button.",
      tip: "If the input does not come in time, the step fails and shows a sensing-failed message.",
    },
  ],
};

const toggle = {
  id: "io.switch",
  page: PAGE,
  group: "Use IO",
  icon: ToggleRight,
  title: "Switch an output",
  blurb: "Turn an output on and off by hand.",
  learn: ["Switch on", "See the feedback", "Switch off"],
  note: "This switches a real output: a gripper may open or close. Keep hands clear of the tool.",
  steps: () => [
    {
      target: ".io-seq.is-out [data-tut='io-live']",
      motion: "This switches a real output on the cell. Keep hands clear of the gripper and the tool.",
      signal: ["ws:TOGGLE_DO", "ws:GPIO_COMMAND"],
      title: "Switch it",
      text: "Flip the switch (or press Push) on an output step.",
      missing: "There is no output step yet. Do \"Add an output step\" first, or skip.",
    },
    {
      target: ".io-seq.is-out [data-tut='io-live']",
      title: "Feedback",
      text: "The small dot next to the switch is the real state reported by the robot. The switch is what you asked for; the dot is what happened.",
    },
    {
      target: ".io-seq.is-out [data-tut='io-live']",
      signal: ["ws:TOGGLE_DO", "ws:GPIO_COMMAND"],
      title: "Switch it back",
      text: "Flip it again to put it back.",
    },
  ],
};

const pin = {
  id: "io.pin",
  page: PAGE,
  group: "Use IO",
  icon: Pin,
  title: "Keep a switch on every page",
  blurb: "Float an IO control over all pages, handy while teaching.",
  learn: ["Pin a step", "Move it", "Unpin it"],
  steps: () => [
    {
      target: "io-pin",
      check: () => !!document.querySelector(".fio"),
      title: "Pin it",
      text: "Click the pin on an IO step.",
      missing: "There are no IO steps yet. Add one first, or skip.",
    },
    { target: ".fio", title: "It floats", text: "This little control now shows on every page. Drag it by its handle to put it where you like." },
    { target: "nav-points", title: "Try it", text: "Open Teach Points: the control comes with you, so you can open the gripper while you jog." },
    { target: ".fio", check: () => !document.querySelector(".fio"), title: "Unpin", text: "When you no longer need it, unpin it: click the pin on its step again, or the x on the floating control." },
  ],
};

const edit = {
  id: "io.edit",
  page: PAGE,
  group: "IO steps",
  icon: Pencil,
  title: "Edit, delete and undo",
  blurb: "Change a step, remove it, and bring it back.",
  learn: ["Edit a step", "Delete it", "Undo"],
  steps: (ctx) => [
    {
      target: () => (madeName(ctx) ? [`${row(madeName(ctx))} [data-tut="io-edit"]`, "io-edit"] : "io-edit"),
      click: true,
      title: "Edit",
      text: "Click the pencil on an IO step.",
    },
    {
      target: "io-form",
      requires: formOpen,
      signal: api("/io-control/updateControl"),
      title: "Change it",
      text: "Change something, for example the log message, and press Save.",
    },
    {
      target: () => (madeName(ctx) ? [`${row(madeName(ctx))} [data-tut="io-del"]`, "io-del"] : "io-del"),
      signal: api("/io-control/deleteControl"),
      title: "Delete",
      text: "Click the bin on the same step and confirm.",
    },
    { target: "io-undo", signal: api("/io-control/undo"), title: "Undo", text: "Deleted by mistake? Press Undo and it's back." },
  ],
};

export default [tour, addOut, addIn, toggle, pin, edit];
