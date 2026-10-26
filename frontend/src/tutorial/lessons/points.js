// Teach Points page lessons. Lessons that move the robot are marked
// `motion` and show the robot-moves notice before the first moving step.
import { Compass, Crosshair, Gauge, MapPinPlus, Move3d, Navigation, RefreshCcwDot, RotateCw } from "lucide-react";
import { useRobot } from "../../store/robot";
import { api } from "../engine";

const PAGE = "/points";
const esc = (s) => (window.CSS?.escape ? CSS.escape(s) : String(s).replace(/"/g, '\\"'));
const row = (name) => `[data-tut-point="${esc(name)}"]`;
const mode = () => useRobot.getState().mode;
const modalOpen = (id) => () => !!document.querySelector(`[data-tut="${id}"]`);
const jogOf = (test) => (name, data) => name === "jog" && test(data || {});
const MODE_TEXT = {
  safeauto: "SafeAuto runs programs automatically at reduced speed. Use it to try a new program safely.",
  jog: "Jog is for moving the robot by hand with the buttons on this page.",
  auto: "Auto runs programs at full production speed.",
};

/** Make sure the robot is in Jog before a jog lesson. */
const toJog = (ctx) =>
  mode() !== "jog" && {
    target: "pp-mode-jog",
    check: () => mode() === "jog",
    title: "Switch to Jog first",
    text: "The jog buttons only move the robot in Jog mode. Click Jog and wait until the bar is full.",
  };

const tour = {
  id: "points.tour",
  page: PAGE,
  group: "Start here",
  icon: Compass,
  title: "Find your way around",
  blurb: "Points list, 3D view and the motion panel.",
  learn: ["Where points are listed", "The live 3D robot", "Where you move the robot"],
  steps: () => [
    { title: "Teach points", text: "A point is a robot position you save with a name. Programs then move the robot from point to point." },
    { target: "pp-points", title: "Your points", text: "Every saved point is listed here. Go moves the robot to it, the pencil edits it." },
    { target: "pp-3d", title: "Live 3D view", text: "The robot as it is right now, with your points shown around it. Drag to turn the view, scroll to zoom." },
    { target: "pp-jog", title: "Robot motion", text: "Mode, servo and the jog buttons that move the robot by hand." },
    { target: "mode-chip", title: "Mode at a glance", text: "The top bar always shows the current mode and speed, on every page." },
    { target: "estop", title: "Your E-STOP", text: "This button stops every drive at once. Remember where it is before you move the robot." },
  ],
};

const modes = {
  id: "points.modes",
  page: PAGE,
  group: "Start here",
  icon: Gauge,
  title: "Modes of operation",
  blurb: "SafeAuto, Jog and Auto: what each is for, and how to switch.",
  learn: ["What each mode means", "Switch mode", "Switch back to Jog"],
  steps: () => {
    const start = mode();
    const away = start === "jog" ? "safeauto" : null;
    return [
      { target: "pp-modes", title: "Three modes", text: `${MODE_TEXT.safeauto} ${MODE_TEXT.jog} ${MODE_TEXT.auto}` },
      { target: "pp-modes", title: "Switching is safe", text: "When you switch, the robot settles first and the bar fills up. If anything is not right, it stays in the old mode and tells you why." },
      away && {
        target: "pp-mode-safeauto",
        check: () => mode() === "safeauto",
        title: "Switch to SafeAuto",
        text: "Click SafeAuto and watch the bar.",
      },
      {
        target: "pp-mode-jog",
        check: () => mode() === "jog",
        title: away ? "And back to Jog" : "Switch to Jog",
        text: "Click Jog. In Jog you can move the robot with the buttons below.",
      },
      { target: "mode-chip", title: "Same mode everywhere", text: "The top bar shows the new mode too. Click it for speed and more tools." },
    ];
  },
};

const joints = {
  id: "points.jog-joints",
  page: PAGE,
  group: "Move the robot",
  icon: RotateCw,
  motion: true,
  title: "Move joint by joint",
  blurb: "Turn each joint of the robot with the jog buttons.",
  learn: ["Hold a button to move", "Release to stop", "Watch the angles change"],
  steps: (ctx) => [
    toJog(ctx),
    { target: "pp-joints", title: "Joints", text: "J1 is the base, J6 is the wrist at the tool. Each row turns one joint. The number is its angle in degrees." },
    {
      target: "jog-j1-plus",
      motion: true,
      signal: jogOf((d) => d.axis === "j1" && d.dir === "+"),
      title: "Turn the base",
      text: "Press and hold J1 + for a moment, then let go. The robot stops as soon as you release.",
    },
    {
      target: "jog-j1-minus",
      signal: jogOf((d) => d.axis === "j1" && d.dir === "-"),
      title: "And back",
      text: "Now hold J1 − to turn it back.",
    },
    {
      target: "pp-joints",
      signal: jogOf((d) => /^j[2-6]$/.test(d.axis)),
      title: "Try another joint",
      text: "Hold any other joint button, J2 to J6. Small moves are best.",
    },
    { target: "pp-3d", title: "See it move", text: "The 3D view follows the robot live, so you can check a move from any angle." },
  ],
};

const cart = {
  id: "points.jog-cart",
  page: PAGE,
  group: "Move the robot",
  icon: Move3d,
  motion: true,
  title: "Move in straight lines",
  blurb: "Move the tool up, down and sideways with Cartesian jog.",
  learn: ["X, Y, Z moves", "R, P, W rotations", "The jog frame"],
  steps: (ctx) => [
    toJog(ctx),
    { target: "pp-cart", title: "Cartesian", text: "Here the tool moves in straight lines: X, Y and Z move it, R, P and W turn it. All joints work together for you." },
    { target: "pp-frame", title: "Which directions?", text: "The frame decides what X, Y and Z mean: the robot base, the tool itself, or one of your points." },
    {
      target: "jog-cz-plus",
      motion: true,
      signal: jogOf((d) => d.axis === "cz" && d.dir === "+"),
      title: "Lift the tool",
      text: "Hold Z + to move the tool straight up, then let go.",
    },
    {
      target: "jog-cz-minus",
      signal: jogOf((d) => d.axis === "cz" && d.dir === "-"),
      title: "Lower it again",
      text: "Hold Z − to move it back down.",
    },
    {
      target: "pp-cart",
      signal: jogOf((d) => /^c[rpw]$/.test(d.axis)),
      title: "Turn the tool",
      text: "Hold one of R, P or W. The tool turns but its tip stays in place.",
    },
  ],
};

const teach = {
  id: "points.teach",
  page: PAGE,
  group: "Points",
  icon: MapPinPlus,
  title: "Make a point",
  blurb: "Save the robot's current position as a named point.",
  learn: ["Teach point", "Name it", "Find it in the list"],
  steps: () => [
    { title: "Position first", text: "A point saves where the robot is right now. Normally you jog the robot to the spot first. For practice, the current position is fine." },
    { target: "pp-teach", click: true, title: "Teach point", text: "Click Teach point." },
    {
      target: "point-editor",
      requires: modalOpen("point-editor"),
      signal: api("/point-planning/addPoint"),
      title: "Name it",
      text: "Type a short name, for example pick_1, add a description if you like, then press Add point.",
      tip: "Names use letters, numbers, - and _.",
    },
    {
      target: (ctx) => row(ctx.lastOf("/point-planning/addPoint")?.body?.name || ""),
      onEnter: (ctx) => (ctx.mem.madePoint = ctx.lastOf("/point-planning/addPoint")?.body?.name),
      title: "Saved!",
      text: "Your point is in the list and in the 3D view. Programs can use it now.",
    },
  ],
};

const update = {
  id: "points.update",
  page: PAGE,
  group: "Points",
  icon: RefreshCcwDot,
  motion: true,
  title: "Update a point",
  blurb: "Move the robot a little and save the new position into an existing point.",
  learn: ["Jog a little", "Edit the point", "Update its position"],
  steps: (ctx) => {
    const pick = () => ctx.mem.madePoint || null;
    return [
      toJog(ctx),
      {
        target: "pp-jog",
        motion: true,
        signal: jogOf(() => true),
        title: "Move a little",
        text: "Hold any jog button briefly to change the robot's position.",
      },
      {
        target: () => (pick() ? [`${row(pick())} [data-tut="pp-edit"]`, '[data-tut="pp-edit"]:not(:disabled)'] : '[data-tut="pp-edit"]:not(:disabled)'),
        click: true,
        title: "Edit the point",
        text: pick() ? `Click the pencil on "${pick()}".` : "Click the pencil on a point you want to update.",
      },
      {
        target: "point-editor",
        requires: modalOpen("point-editor"),
        signal: api("/point-planning/updatePoint"),
        title: "Update it",
        text: "Keep \"Replace saved position\" ticked and press Update point. Untick it when you only want to change the name or description.",
      },
      { target: "pp-undo", title: "Oops? Undo", text: "Undo brings back the point as it was before your last change." },
    ];
  },
};

const goTo = {
  id: "points.go",
  page: PAGE,
  group: "Points",
  icon: Navigation,
  motion: true,
  title: "Go to a point",
  blurb: "Send the robot to a saved point: test first, then move.",
  learn: ["Open Go", "Test the path", "Move"],
  steps: () => [
    { target: '[data-tut="pp-go"]', click: true, title: "Pick a point", text: "Click Go on any point." },
    {
      target: "move-test",
      requires: modalOpen("move-point"),
      signal: api("/goto/point", "POST", (b) => !!b.dryRun),
      title: "Test first",
      text: "Test plans the path and checks it without moving. Press Test.",
    },
    {
      target: "move-go",
      motion: "Move sends the robot to the point for real. Keep the area clear. The Stop button in this window and the E-STOP both stop it at once.",
      requires: modalOpen("move-point"),
      signal: api("/goto/point", "POST", (b) => !b.dryRun),
      title: "Now move",
      text: "Press Move. You can close the window while it moves; the top bar shows the motion.",
    },
  ],
};

const tools = {
  id: "points.tools",
  page: PAGE,
  group: "More",
  icon: Crosshair,
  title: "Handy point tools",
  blurb: "Lock points, reorder them, and other ways to jog.",
  learn: ["Lock and reorder", "More actions", "Keyboard and gamepad jog"],
  steps: () => [
    { target: "pp-lock", title: "Reorder", text: "Unlock the order to drag points into a new order. Lock it again so nothing moves by accident." },
    { target: "pp-row-more", title: "More on each point", text: "Details and history, lock a point against changes, save it as a home, or delete it." },
    { target: "pp-tools", title: "Other ways to jog", text: "Jog with the keyboard or a gamepad from the Tools menu. The pad floats over the page, so the 3D view stays in sight." },
  ],
};

export default [tour, modes, joints, cart, teach, update, goTo, tools];
