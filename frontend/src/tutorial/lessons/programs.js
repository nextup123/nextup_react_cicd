// Motion Programs page lessons. Every hands-on lesson works on a practice
// program (Tutorial_practice …) that the lesson makes when there is none yet,
// so real programs are never changed. Running is marked `motion`.
import { Code2, Compass, Copy, FilePlus2, ListOrdered, MapPin, Play, Route, Save, SlidersHorizontal, SquarePen } from "lucide-react";
import { queryClient } from "../../lib/queryClient";
import { useDraft, isDirty } from "../../pages/programs/draftStore";
import { PROGRAMS_KEY } from "../../pages/programs/programsApi";
import { api } from "../engine";

const PAGE = "/programs";
const esc = (s) => (window.CSS?.escape ? CSS.escape(s) : String(s).replace(/"/g, '\\"'));
const has = (sel) => !!document.querySelector(/^[\w-]+$/.test(sel) ? `[data-tut="${sel}"]` : sel);
const row = (name) => `[data-tut-program="${esc(name)}"]`;
const rowMenu = (name) => `${row(name)} [data-tut="mp-prog-menu"]`;
const tab = (n) => `.mp-tabs .tab:nth-child(${n})`;
const tabOn = (n) => has(`${tab(n)}[aria-selected="true"]`);
const selRow = (key) => `[data-tut="mp-step"][aria-selected="true"] [data-tut="${key}"]`;

const data = () => queryClient.getQueryData(PROGRAMS_KEY) || {};
const names = () => (data().programs || []).map((p) => p.name);
const ds = () => useDraft.getState();
const draft = () => ds().draft;
const cur = () => draft()?.steps?.[ds().sel] || null;
const len = () => draft()?.steps?.length || 0;
const dirty = () => isDirty(ds());
/** True once `v` has stayed the same for `ms` (so a check does not fire in the middle of typing). */
function settled(ctx, key, v, ms = 1200) {
  const k = `mpSettled_${key}`;
  const m = ctx.mem[k];
  if (!m || m.v !== v) {
    ctx.mem[k] = { v, at: Date.now() };
    return false;
  }
  return Date.now() - m.at >= ms;
}
const saveSig = (test) => api("/robot/programs", "POST", (b) => !test || test(b));

/** A name not taken yet: Tutorial_practice, Tutorial_practice_2 … */
function freeName(base = "Tutorial_practice") {
  const taken = new Set(names());
  let n = base;
  for (let i = 2; taken.has(n); i++) n = `${base}_${i}`;
  return n;
}

let lastMade = null; // kept across lessons
/** The practice program: the one made in a lesson, else any saved Tutorial… program. */
function practice(ctx) {
  const list = names();
  const made = ctx.mem.mpPractice || lastMade;
  if (made && list.includes(made)) return made;
  return list.find((n) => /^tutorial/i.test(n)) || null;
}

/** Steps that make and save a new practice program. */
const makeSteps = () => [
  { target: "mp-new", click: true, title: "New program", text: "Click New." },
  {
    target: ["mp-tpl-blank", "mp-new"],
    check: () => !!draft() && !ds().savedName,
    title: "Start from Blank",
    text: "Pick Blank under Start from. It has one step to start with. If the page asks about unsaved changes, choose Discard.",
    tip: "The other templates are ready-made shapes: a simple move, pick and place, palletizing and more.",
  },
  {
    target: "mp-name",
    onEnter: (ctx) => (ctx.mem.mpWant = freeName()),
    check: (ctx) => {
      const n = draft()?.name || "";
      if (n === ctx.mem.mpWant) return settled(ctx, "name", n, 500);
      return /^tutorial_/i.test(n) && !names().includes(n) && settled(ctx, "name", n, 2500);
    },
    title: "Name it",
    text: (ctx) => `Click the Name field and type ${ctx.mem.mpWant || "Tutorial_practice"}.`,
    tip: "Names use letters, numbers, _ and -. Spaces become _.",
  },
  {
    target: "mp-save",
    signal: saveSig((b) => /^tutorial/i.test(b.program?.name || "")),
    title: "Save it",
    text: "Press Save. If the page warns about problems, choose Save anyway: you fix them later.",
  },
  {
    target: (ctx) => row(ctx.mem.mpPractice || ""),
    onEnter: (ctx) => (lastMade = ctx.mem.mpPractice = ctx.lastOf("/robot/programs")?.body?.program?.name || ctx.mem.mpPractice),
    title: "There it is!",
    text: "Your practice program is in the list. The other lessons use it, so your real programs stay as they are.",
  },
];

/** Open the practice program, or make one first. */
function openPractice(ctx) {
  const p = practice(ctx);
  if (!p) return [{ title: "A practice program first", text: "This lesson works on a practice program, so your real programs stay as they are. Let's make one." }, ...makeSteps()];
  ctx.mem.mpPractice = p;
  if (ds().savedName === p) return [];
  return [
    {
      target: row(p),
      check: () => ds().savedName === p,
      title: "Open your practice program",
      text: `Click "${p}" in the list. If the page asks about unsaved changes, choose Discard.`,
    },
  ];
}

/** Any program open (the preview and the text view work on every program). */
const needOpen = () =>
  !draft() && {
    target: "mp-prog",
    check: () => !!draft(),
    title: "Open a program",
    text: "Click a program in the list.",
  };

const saveStep = {
  target: "mp-save",
  signal: saveSig(),
  title: "Save",
  text: "Press Save (or Ctrl+S) to keep your changes in the practice program.",
};

/* ───────────── Start here ───────────── */

const tour = {
  id: "programs.tour",
  page: PAGE,
  group: "Start here",
  icon: Compass,
  title: "Find your way around",
  blurb: "What a motion program is and where everything lives on this page.",
  learn: ["The program list", "Settings, checks and steps", "Preview and the side panel"],
  steps: () => [
    {
      title: "Motion programs",
      text: "A motion program is a named list of moves on your taught points: joint moves, straight lines, arcs and more. The Robot Program runs it with one RunProgram node and does the logic and IO in between.",
    },
    data().exists === false && {
      target: "mp-list",
      title: "Start motion programs",
      text: "This project has no motion programs yet. Start motion programs makes a simple starter program to begin with.",
    },
    { target: "mp-list", title: "Your programs", text: "Every motion program of the project is listed here. Click one to open it. The number is its step count; a red mark means a problem." },
    { target: "mp-new", title: "New", text: "Start a new program from a template: blank, a simple move, pick and place, palletizing and more." },
    { target: "mp-title", title: "The open program", text: "The name of the program you edit. New means it is not saved yet, unsaved means it has changes." },
    { target: "mp-settings", title: "Program settings", text: "Name, description, how often it repeats and its default speed and acceleration." },
    { target: "mp-checks", title: "Checks while you type", text: "The program is checked as you edit, with the same rules the motion server uses. Green means it will be accepted." },
    { target: "mp-steps", title: "Steps", text: "The moves in order, one per line. Click one to edit it, drag to reorder, add more below." },
    { target: "mp-preview", title: "Path preview", text: "The tool path drawn from the taught points, from the top, the front or the side." },
    { target: "mp-side", title: "Step, Run and Text", text: "Step edits the selected step. Run tries the program on the robot. Text shows it as written text." },
    { target: "mp-save", title: "Save", text: "Save keeps your changes. Undo, redo and discard sit next to it." },
  ],
};

const make = {
  id: "programs.practice",
  page: PAGE,
  group: "Start here",
  icon: FilePlus2,
  title: "Make a practice program",
  blurb: "Create a program from a template, name it and save it.",
  learn: ["New from a template", "Name it", "Save it"],
  steps: () => makeSteps(),
  outro: "The next lessons use this practice program. Delete it when you are done in \"Copy, rename and delete\".",
};

/* ───────────── Steps ───────────── */

const steps = {
  id: "programs.steps",
  page: PAGE,
  group: "Steps",
  icon: ListOrdered,
  title: "Add and arrange steps",
  blurb: "Add, copy, reorder and delete steps, with undo.",
  learn: ["Add a step", "Copy and reorder", "Delete and undo"],
  steps: (ctx) => [
    ...openPractice(ctx),
    { target: "mp-steps", title: "One line per step", text: "Each line shows the motion, its target, the speed and whether it stops at the point or rounds the corner. A red mark means a problem: point at it to read why." },
    { target: "mp-add", onEnter: (c) => (c.mem.n0 = len()), click: true, title: "Add a step", text: "Click Add step. The new step goes after the selected one." },
    {
      target: ["mp-add-lin", "mp-add"],
      check: (c) => len() > (c.mem.n0 ?? 0),
      title: "A straight line",
      text: "Pick Straight to a point (LIN). The list also has arcs, circles, curves, spirals and weld seams.",
    },
    {
      target: [selRow("mp-step-dup"), "mp-step-dup"],
      onEnter: (c) => (c.mem.n1 = len()),
      check: (c) => len() > (c.mem.n1 ?? 0),
      title: "Copy a step",
      text: "Click the copy icon on the selected step. Ctrl+D does the same.",
    },
    {
      target: "mp-steps",
      onEnter: (c) => (c.mem.order = JSON.stringify(draft()?.steps)),
      check: (c) => len() === (c.mem.n1 ?? 0) + 1 && JSON.stringify(draft()?.steps) !== c.mem.order,
      title: "Reorder",
      text: "Drag a step by its grip on the left to a new place. Or select a step and press Alt+↑ or Alt+↓.",
    },
    {
      target: [selRow("mp-step-del"), "mp-step-del"],
      onEnter: (c) => (c.mem.n2 = len()),
      check: (c) => len() < (c.mem.n2 ?? 0),
      title: "Delete a step",
      text: "Click the bin on a step. With a step selected, the Delete key does the same.",
    },
    {
      target: "mp-undo",
      check: () => ds().future.length > 0,
      title: "Undo",
      text: "Oops? Click Undo and the step is back. Ctrl+Z does the same.",
    },
    {
      target: "mp-redo",
      onEnter: (c) => (c.mem.fut = ds().future.length),
      check: (c) => ds().future.length < (c.mem.fut ?? 1),
      title: "Redo",
      text: "Redo does it again. Ctrl+Y does the same.",
    },
    { target: "mp-steps", title: "Keys", text: "↑ and ↓ select the step above or below. Ctrl+D copies, Delete removes, Alt+↑ and Alt+↓ move the selected step." },
    saveStep,
  ],
};

const inspector = {
  id: "programs.inspector",
  page: PAGE,
  group: "Steps",
  icon: SquarePen,
  title: "Edit a step",
  blurb: "Motion, target, offset, speed, blend, dwell and note.",
  learn: ["Change the motion", "Set speed and stops", "Add a note"],
  steps: (ctx) => [
    ...openPractice(ctx),
    {
      target: '[data-tut="mp-step"][data-tut-step="0"]',
      check: () => ds().sel === 0 && has("mp-insp"),
      title: "Pick step 1",
      text: "Click step 1 in the list. The Step tab on the right shows its fields.",
    },
    { target: "mp-insp-head", requires: () => has("mp-insp"), title: "The step editor", text: "Only the fields this step can use are shown. Point at any label to read what it does. The icons copy or delete the step." },
    {
      target: "mp-motions",
      requires: () => has("mp-insp"),
      onEnter: (c) => (c.mem.mot = cur()?.motion),
      check: (c) => !!cur() && cur().motion !== c.mem.mot,
      title: "Change the motion",
      text: (c) =>
        `PTP moves all joints at once, the fastest way. LIN moves the tool in a straight line. The others draw arcs, circles, curves and spirals. Click ${c.mem.mot === "LIN" ? "PTP" : "LIN"}.`,
      tip: "The first step can only be PTP or LIN: a program starts by going to a point.",
    },
    {
      target: "mp-motions",
      requires: () => has("mp-insp"),
      check: (c) => cur()?.motion === c.mem.mot,
      title: "And back",
      text: (c) => `Click ${c.mem.mot || "PTP"} again. Values that still fit are kept when you switch.`,
    },
    {
      target: ["mp-form", "mp-insp"],
      title: "Defined by",
      text: "A step goes to a point, to a point with an offset, or moves relative to where the last step ended. Each choice shows only the fields it needs.",
    },
    { target: ["mp-geometry", "mp-insp"], title: "Where to", text: "The target point, and for arcs and circles also the via or centre point, radius and angle. The lesson \"Choose a point\" shows the picker." },
    { target: ["mp-offset", "mp-insp"], title: "Offset", text: "With an offset the robot goes next to the point, for example 80 mm above it. The z buttons are quick presets." },
    { target: ["mp-orient", "mp-insp"], title: "Tool and weave", text: "Some motions let you choose how the tool turns on the way. A straight line can also weave, for welding." },
    {
      target: "mp-speeds",
      requires: () => has("mp-insp"),
      onEnter: (c) => (c.mem.spd = cur()?.speed_mps),
      check: (c) => !!cur() && cur().speed_mps !== c.mem.spd,
      title: "Speed",
      text: "An empty speed uses the program speed. Click one of the speed buttons, for example 0.1.",
    },
    {
      target: "mp-speeds",
      title: "Blend and dwell",
      text: "Blend rounds the corner at this point so the robot does not stop. Dwell waits there for some seconds. A lock means blending is not possible here: point at it to read why.",
    },
    {
      target: "mp-note",
      requires: () => has("mp-insp"),
      check: (c) => !!cur()?.note && settled(c, "note", cur().note),
      title: "A note",
      text: "Type a short note, for example: gripper closes here. Notes show in the step list.",
    },
    { target: ["mp-insp-issues", "mp-checks"], title: "Problems and fixes", text: "Problems of this step show at the top of the editor. Many have a fix button that corrects them for you." },
    saveStep,
  ],
};

const points = {
  id: "programs.points",
  page: PAGE,
  group: "Steps",
  icon: MapPin,
  title: "Choose a point",
  blurb: "Pick the target of a step from your taught points.",
  learn: ["Open the point list", "Search and pick", "What the marks mean"],
  steps: (ctx) => [
    ...openPractice(ctx),
    {
      target: '[data-tut="mp-step"][data-tut-step="0"]',
      check: () => ds().sel === 0 && has("mp-point"),
      title: "Pick step 1",
      text: "Click step 1. It goes to a point, so the Step tab shows a point field.",
    },
    {
      target: '[data-tut="mp-point"] [data-tut="mp-picker"]',
      requires: () => has("mp-point"),
      check: () => has("mp-picker-list"),
      title: "Open the list",
      text: "Click the point field.",
    },
    {
      target: "mp-picker-list",
      requires: () => has("mp-picker-list"),
      check: () => !has("mp-picker-list") && !!cur()?.point,
      title: "Pick a point",
      text: "Type a few letters to search, then click a point. Points the robot can use come first.",
      tip: "The arrow keys and Enter work too.",
    },
    {
      target: "mp-point",
      title: "Marks on points",
      text: "Not taught means the point does not exist yet. No joints means it must be taught again before it can run. Frame marks a point that is a reference frame.",
    },
    {
      target: "mp-point",
      title: "Not taught yet?",
      text: "You can type a new name and choose Use it. The step keeps it in red until you teach the point on Teach Points.",
    },
    saveStep,
  ],
};

/* ───────────── Program ───────────── */

const settings = {
  id: "programs.settings",
  page: PAGE,
  group: "Program",
  icon: SlidersHorizontal,
  title: "Program settings",
  blurb: "Description, repeat, speed, acceleration, tool and frame.",
  learn: ["Describe it", "Repeat it", "Default speed"],
  steps: (ctx) => [
    ...openPractice(ctx),
    { target: "mp-name", title: "Name", text: "The Robot Program calls the program by this name. To rename a saved program, use Rename in the list, so you are reminded to change the trees that call it." },
    {
      target: "mp-desc",
      check: (c) => !!draft()?.description && settled(c, "desc", draft().description),
      title: "Description",
      text: "Type a short description of what the program does. It shows in the list.",
    },
    {
      target: ".mp-w-repeat",
      check: () => draft()?.repeat === 2,
      title: "Repeat",
      text: "Repeat runs the steps again and again. Click 2.",
      tip: "∞ repeats until the program is finished or stopped. A RunProgram node in a tree refuses ∞.",
    },
    {
      target: ".mp-w-repeat",
      check: () => draft()?.repeat === 1,
      title: "Back to once",
      text: "Click once.",
    },
    { target: "mp-numbers", title: "Speed and acceleration", text: "The defaults for every step that has no speed of its own. Empty uses the standard values of the robot." },
    { target: "mp-more", click: true, title: "Tool and frame", text: "Click Tool and frame." },
    { target: "mp-toolframe", requires: () => has("mp-toolframe"), title: "Tool and frame", text: "The tool and the reference frame are saved with the program. The motion server does not use them yet." },
    { target: "mp-checks", title: "Checks", text: "When something is wrong, this bar turns red or orange. Click it for the list: step jumps to the step, the fix buttons correct it for you." },
    saveStep,
  ],
};

const preview = {
  id: "programs.preview",
  page: PAGE,
  group: "Program",
  icon: Route,
  title: "Path preview",
  blurb: "See the tool path from three sides and play it.",
  learn: ["Top, front and side", "Play the path", "Select steps in the drawing"],
  steps: () => [
    needOpen(),
    { target: "mp-canvas", title: "The tool path", text: "Each step is drawn in its motion colour, with its number at the end. The selected step is highlighted." },
    { target: '[data-tut="mp-preview-bar"] .segmented button:nth-child(2)', click: true, title: "Front view", text: "Click Front to look at the path from the front." },
    { target: '[data-tut="mp-preview-bar"] .segmented button:nth-child(3)', click: true, title: "Side view", text: "Click Side. Top looks down from above." },
    {
      target: "mp-play",
      check: () => has(".mp-tool.is-on") || !!document.querySelector('[data-tut="mp-play"]')?.disabled,
      title: "Play",
      text: "Click Play. A dot runs along the path in step order. The button is grey when fewer than two points have coordinates.",
    },
    { target: "mp-play", title: "Stop playing", text: "Click it again to stop the dot." },
    { target: "mp-canvas", title: "Pick in the drawing", text: "Click a number or a line to select that step. Point at a line to see which step it is." },
    { target: "mp-preview-foot", title: "An approximation", text: "PTP is drawn straight, but the real joint move curves. Points without coordinates are listed here; teach them to see the full path." },
  ],
};

const text = {
  id: "programs.text",
  page: PAGE,
  group: "Program",
  icon: Code2,
  title: "The text view",
  blurb: "Read a program as text, or edit all programs by typing.",
  learn: ["This program as text", "Copy it", "The whole file"],
  steps: () => [
    needOpen(),
    { target: tab(3), check: () => has("mp-yaml"), title: "Open Text", text: "Click the Text tab." },
    { target: "mp-yaml-pre", requires: () => has("mp-yaml"), title: "This program", text: "The program exactly as it is saved, one step per line, with your notes as comments. It follows your edits live." },
    { target: "mp-yaml-copy", requires: () => has("mp-yaml-copy"), click: true, title: "Copy", text: "Click Copy to put the text on the clipboard, for example to send it to someone." },
    {
      target: '[data-tut="mp-yaml-bar"] .segmented button:nth-child(2)',
      requires: () => has("mp-yaml"),
      check: () => has(".mp-yaml-edit"),
      title: "Whole file",
      text: "Click Whole file.",
    },
    {
      target: ".mp-yaml-edit",
      requires: () => has(".mp-yaml-edit"),
      title: "Every program as text",
      text: "Here you can type all programs at once. A typing mistake shows in red, and the server checks the text before it keeps it.",
    },
    { target: "mp-yaml-save", requires: () => has("mp-yaml-save"), title: "Save file", text: "Save file keeps the text. Don't press it now: in the editor you can't make typing mistakes." },
    { target: tab(1), check: () => tabOn(1), title: "Back to the step", text: "Click the Step tab to go back to the editor." },
  ],
};

const save = {
  id: "programs.save",
  page: PAGE,
  group: "Program",
  icon: Save,
  title: "Save and discard",
  blurb: "See unsaved changes, throw them away, or save with the keys.",
  learn: ["Unsaved changes", "Discard", "Save with Ctrl+S"],
  steps: (ctx) => [
    ...openPractice(ctx),
    { target: "mp-desc", check: () => dirty(), title: "Change something", text: "Type a few letters into the description." },
    { target: "mp-title", title: "Unsaved", text: "The title says unsaved, and the list shows a dot on the program. Nothing reaches the robot until you save." },
    { target: "mp-discard", check: () => !dirty(), title: "Discard", text: "Click Discard changes. The saved version comes back. Undo still brings your change back if you need it." },
    { target: "mp-desc", check: () => dirty(), title: "Change it again", text: "Type into the description once more." },
    {
      target: "mp-save",
      signal: saveSig(),
      keys: "Ctrl+S",
      title: "Save with the keys",
      text: "Press Ctrl+S. It saves from anywhere on the page.",
    },
    { title: "Safe from mistakes", text: "Opening another program or leaving the page with unsaved changes always asks first. Programs with problems can be saved, but the motion server only runs them once they are fixed." },
  ],
};

/* ───────────── Program list ───────────── */

const tidy = {
  id: "programs.tidy",
  page: PAGE,
  group: "Program list",
  icon: Copy,
  title: "Copy, rename and delete",
  blurb: "Duplicate a program, give it a new name and remove it.",
  learn: ["Duplicate", "Rename", "Delete"],
  note: "This lesson works on your practice program only. Deleting a real program breaks the trees that call it.",
  steps: (ctx) => {
    const p = () => ctx.mem.mpPractice || practice(ctx) || "";
    const copyName = () => ctx.mem.mpCopy || "";
    const renamed = () => ctx.mem.mpRenamed || copyName();
    return [
      ...(practice(ctx) ? [] : makeSteps()),
      { target: () => rowMenu(p()), click: true, title: "Program actions", text: () => `Click the three dots on "${p()}".` },
      {
        target: () => ["mp-prog-dup", rowMenu(p())],
        check: () => !!draft() && !ds().savedName && draft().name.startsWith(`${p()}_copy`),
        title: "Duplicate",
        text: "Click Duplicate. The copy opens as a new program, not saved yet.",
      },
      {
        target: "mp-save",
        signal: saveSig((b) => (b.program?.name || "").startsWith(`${p()}_copy`)),
        title: "Save the copy",
        text: "Press Save.",
      },
      {
        target: () => rowMenu(copyName()),
        onEnter: (c) => (c.mem.mpCopy = c.lastOf("/robot/programs")?.body?.program?.name || c.mem.mpCopy),
        click: true,
        title: "Rename it",
        text: () => `Click the three dots on "${copyName()}".`,
      },
      {
        target: () => ["confirm-ok", "mp-prog-rename", rowMenu(copyName())],
        onEnter: (c) => (c.mem.mpNewName = freeName("Tutorial_renamed")),
        signal: saveSig((b) => !!b.oldName && b.oldName === copyName() && b.program?.name !== b.oldName),
        title: "A new name",
        text: (c) => `Click Rename, type ${c.mem.mpNewName} and press Rename.`,
        tip: "Trees that call a program by its old name must be changed too.",
      },
      {
        target: () => rowMenu(renamed()),
        onEnter: (c) => (c.mem.mpRenamed = c.lastOf("/robot/programs")?.body?.program?.name || c.mem.mpRenamed),
        click: true,
        title: "Delete it",
        text: () => `Click the three dots on "${renamed()}".`,
      },
      {
        target: () => ["confirm-ok", "mp-prog-delete", rowMenu(renamed())],
        signal: (name) => name === `api:DELETE /robot/programs/${encodeURIComponent(renamed())}`,
        title: "Delete",
        text: "Click Delete and confirm. A backup of the old file is kept, but only delete programs you really don't need.",
      },
      names().length > 4 && { target: "mp-search", title: "Search", text: "With many programs, type here to find one by its name or description." },
    ];
  },
};

/* ───────────── Run ───────────── */

const run = {
  id: "programs.run",
  page: PAGE,
  group: "Run",
  icon: Play,
  motion: true,
  title: "Try it on the robot",
  blurb: "Dry run to check the plan, then run the program for real.",
  learn: ["Overrides for one run", "Dry run", "Run and stop"],
  note: "Run moves the robot through every step. Try it on the simulator first, keep the cell clear and know where the E-STOP is.",
  steps: (ctx) => {
    const canRun = data().canRun !== false;
    return [
      ...openPractice(ctx),
      { target: tab(2), check: () => has("mp-run"), title: "Open Run", text: "Click the Run tab." },
      { target: "mp-run-overrides", requires: () => has("mp-run"), title: "Just for this run", text: "Loops and Speed change only the next run. Empty means as saved in the program." },
      { target: "mp-shift-toggle", requires: () => has("mp-run"), click: true, title: "Shift", text: "Click Shift the whole program." },
      { target: "mp-shift", requires: () => has("mp-shift"), title: "Shift the program", text: "Moves every point of the run by x, y and z, for example to the next place on a pallet. The preview shows the shifted path. Leave it at zero now." },
      { target: "mp-shift-toggle", requires: () => has("mp-run"), click: true, title: "Hide the shift", text: "Click Hide the shift. A hidden shift is not used." },
      canRun
        ? {
            target: "mp-dry",
            requires: () => has("mp-run"),
            motion: "A dry run plans every part of the program and moves nothing. The next step then moves the robot for real.",
            signal: api("/robot/programs/run", "POST", (b) => !!b.dryRun),
            title: "Dry run",
            text: "Press Dry run. If there are unsaved changes, choose Save and run.",
            tip: "Grey buttons? Fix the problems first: the motion server refuses a program with problems.",
          }
        : { target: "mp-run", title: "Running is off", text: "The motion server can't run programs right now. You can still edit and save; running comes back when the server is up." },
      canRun && { target: ["mp-live", "mp-run"], title: "Live status", text: "The state, the step it is working on and a progress bar. Failed shows the reason here." },
      canRun && {
        target: "mp-run-go",
        requires: () => has("mp-run"),
        motion: true,
        signal: api("/robot/programs/run", "POST", (b) => !b.dryRun),
        title: "Run",
        text: "Press Run and confirm. The robot moves through every step; the running step is marked in the list and the preview.",
      },
      { target: "mp-stop", title: "Stop and Finish", text: "Stop ends the motion in a controlled way. Finish ends a repeating program at the end of the current pass. The E-STOP always stops everything." },
      { target: "mp-snippet", title: "Use it in a tree", text: "The node that runs this program from the Robot Program, with your loops, speed and shift. Click the copy icon to copy it." },
    ];
  },
};

export default [tour, make, steps, inspector, points, settings, preview, text, save, tidy, run];
