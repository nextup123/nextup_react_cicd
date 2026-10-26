// NextPLC page lessons (Program, Block Library, Monitor and Help tabs).
import { BookOpen, Boxes, Compass, FilePlus2, FlaskConical, Gauge, PanelsTopLeft, Puzzle, Star, Workflow, Wrench } from "lucide-react";
import { api } from "../engine";

const PROGRAM = "/nextplc/program";
const LIBRARY = "/nextplc/library";
const MONITOR = "/nextplc/monitor";
const HELP = "/nextplc/help";

const has = (sel) => !!document.querySelector(sel);
const tut = (id) => () => has(`[data-tut="${id}"]`);
const plc = (ctx) => ctx.bridge("nextplc") || {};
/** The pages talk to the robot's PLC (not the simulator). */
const realMode = () => has(".mode-switch.real");
const simMode = () => !realMode();
const isPractice = (ctx) => /tutorial|practice/i.test(plc(ctx).name || "");
/** A practice program name not taken yet: Tutorial_practice, Tutorial_practice_2 … */
function freeName(ctx) {
  const names = new Set((plc(ctx).files || []).map((n) => n.replace(/\.ya?ml$/i, "")));
  let n = "Tutorial_practice";
  for (let i = 2; names.has(n); i++) n = `Tutorial_practice_${i}`;
  return n;
}
/** A library program was saved (not this project's program). */
const savedLibrary = (name) => /^api:PUT \/plc-api\/programs\/[^/]+$/.test(name) && !/\/(%40|@)project$/.test(name);
const panelTab = (n) => `[data-tut="plc-panel-tabs"] [role=tab]:nth-child(${n})`;
const onPanelTab = (id) => (ctx) => plc(ctx).tab === id;
const shellTab = (n) => `.nxplc-tabs [role=tab]:nth-child(${n})`;
const sideTab = (n) => `[data-tut="plc-side-tabs"] [role=tab]:nth-child(${n})`;
const sideOn = (n) => () => has(`${sideTab(n)}[aria-selected="true"]`);
const blockTab = (n) => `[data-tut="plc-lib-block"] [role=tab]:nth-child(${n})`;
const editorTab = (n) => `[data-tut="plc-be-tabs"] [role=tab]:nth-child(${n})`;
const helpQuery = () => document.querySelector('[data-tut="plc-help-search"] input')?.value || "";

const simStep = {
  id: "sim",
  target: "plc-mode",
  check: simMode,
  title: "Use the simulator",
  text: "Make sure SIM is selected in this switch. In SIM the program runs here and nothing reaches the robot.",
  tip: "ROBOT sends Load, Write, Force and Reset to the PLC on the robot, and real outputs switch.",
};
const practiceStep = {
  id: "practice",
  target: "plc-program-select",
  check: isPractice,
  title: "Open your practice program",
  text: "Pick your practice program in this list (in the Library part). No practice program yet? Do \"Write your first program\" first, or skip.",
};

const tour = {
  id: "nextplc.tour",
  page: PROGRAM,
  group: "Start here",
  icon: Compass,
  title: "Find your way around",
  blurb: "What the PLC does and where everything lives.",
  learn: ["The four tabs", "RUN, STOP and SIM or ROBOT", "Code and the panels"],
  steps: () => [
    { title: "The robot's PLC", text: "The PLC reads the inputs, runs your logic and writes the outputs, again and again every few milliseconds. Here you write that logic, test it and watch it run." },
    { target: ".nxplc-tabs", title: "Four tabs", text: "Program is where you write the logic. Block Library holds ready-made blocks. Monitor shows the live PLC. Help has the manuals." },
    { target: "plc-run", title: "RUN or STOP", text: "RUN means the PLC runs a program every scan, with its name next to it. STOP means no program runs and the outputs are held safe." },
    { target: "plc-strip", title: "Warnings show up here", text: "SAFE, IO fault and FORCE only appear when they are on. If you see one, the Monitor tab tells you more." },
    { target: "plc-mode", title: "SIM or ROBOT", text: "SIM runs your program in a simulated PLC: nothing reaches the robot. ROBOT talks to the PLC on the robot, so real outputs switch. It asks before it changes." },
    { target: "plc-program-select", title: "The program list", text: "At the top is this project's program, marked with a star. The PLC runs it for this project. Below it is the Library: programs every project can use." },
    { target: "plc-helpers", title: "Helpers", text: "Add a rung, a block or a sequence with a form, add a ready pattern, or insert an address. You don't have to remember the syntax." },
    { target: "plc-editor", title: "The code", text: "The program as text. A red line shows an error, and a green mark shows rungs that are true while it runs." },
    { target: "plc-panel-tabs", title: "The same program, other views", text: "Ladder, Form and Teacher show the same program as a diagram, as tables and in plain words. Guide, Outline and Check help you along." },
    { target: "plc-check", title: "Check and Load", text: "Check tests the program with the same loader the PLC uses. Load sends it to the simulated PLC, or to the robot when ROBOT is on." },
    { target: "plc-shortcuts", title: "Two shortcuts", text: "Ctrl+S saves and Ctrl+Enter checks." },
  ],
};

const first = {
  id: "nextplc.first-program",
  page: PROGRAM,
  group: "Start here",
  icon: FilePlus2,
  title: "Write your first program",
  blurb: "Make a practice program in the library, add a rung, save and check it.",
  learn: ["Make a library program", "Add a rung with a form", "Save and check"],
  note: "This lesson makes a new practice program in the library. This project's program stays as it is.",
  steps: () => [
    { target: "plc-new", check: tut("plc-new-form"), title: "New program", text: "Click New." },
    {
      target: "plc-new-form",
      requires: tut("plc-new-form"),
      signal: savedLibrary,
      title: "Name it",
      text: (ctx) => `Type ${freeName(ctx)} and press Create.`,
      tip: "Names use letters, digits, - and _.",
    },
    {
      target: "plc-program-select",
      onEnter: (ctx) => (ctx.mem.plcPractice = plc(ctx).name),
      title: "It's in the library",
      text: "Your program is open and listed in the Library part. This project's program, at the top with the star, was not touched.",
    },
    { target: "plc-editor", title: "A rung is one line of logic", text: "A rung writes one bit from a condition, like: switch the lamp on when the button is pressed and the robot is in auto." },
    {
      target: "plc-add-rung",
      check: tut("plc-rung-form"),
      onEnter: (ctx) => (ctx.mem.plcRungs = plc(ctx).rungs ?? 0),
      title: "Add a rung",
      text: "Click Add a rung.",
    },
    {
      target: "plc-rung-form",
      requires: tut("plc-rung-form"),
      check: (ctx) => !has('[data-tut="plc-rung-form"]') && (plc(ctx).rungs ?? 0) > (ctx.mem.plcRungs ?? 0),
      title: "Fill the form",
      text: "Keep the type on out. As the bit it writes, type M10 (or press pick). As the condition, type gpio1.di1. Press Add rung.",
      tip: "M bits are memory bits inside the PLC. Practising with them switches nothing on the cell.",
    },
    { target: "plc-status-line", title: "It loads", text: "This line tells you at once if the program is fine. When it is red it shows the line with the error, and go jumps there." },
    { target: "plc-save", signal: savedLibrary, title: "Save", text: "Save it: press Ctrl+S or click Save." },
    { target: "plc-check", signal: api("/plc-api/programs/check"), title: "Check", text: "Now press Ctrl+Enter or click Check." },
    { target: "plc-panel-body", title: "The result", text: "The Check tab shows whether the program loads and lists every rung with its line." },
  ],
  outro: "Your practice program is saved in the library. Next, see it as a ladder diagram, or run it in the simulator.",
};

const panels = {
  id: "nextplc.panels",
  page: PROGRAM,
  group: "Write the logic",
  icon: PanelsTopLeft,
  title: "Ladder, Form and Teacher",
  blurb: "See and edit the same program as a diagram, as tables and in words.",
  learn: ["The ladder diagram", "The form and the teacher", "Guide, outline and hide code"],
  steps: () => [
    { target: "plc-program-select", title: "Pick a program", text: "Open your practice program if you have one. Every panel shows the program that is open." },
    { target: panelTab(1), check: onPanelTab("ladder"), title: "Ladder", text: "Click Ladder." },
    { target: [".lad-toolbar", "plc-panel-body"], title: "Build with symbols", text: "Each rung is drawn as a ladder rung. Click an element to select it, then use these buttons to add contacts, branches, timers or a coil. Changes go straight into the code." },
    { target: "plc-panel-body", title: "Sequences too", text: "Sequences are drawn below the rungs as step charts. While the program runs in the PLC you see the power flow live." },
    { target: panelTab(2), check: onPanelTab("form"), title: "Form", text: "Click Form." },
    { target: "plc-panel-body", title: "Tables", text: "Names, blocks, rungs, sequences and alarms as rows. Use add to make one, the pencil to edit it and the arrows to move it. The code follows." },
    { target: panelTab(3), check: onPanelTab("teacher"), title: "Teacher", text: "Click Teacher." },
    { target: "plc-panel-body", title: "In plain words", text: "Every rung read back as a sentence. Great to check that the logic does what you meant." },
    { target: panelTab(4), check: onPanelTab("guide"), title: "Guide", text: "Click Guide." },
    { target: "plc-panel-body", title: "Help where you type", text: "The guide follows the cursor in the code and shows what you can write there, with examples you can insert." },
    { target: panelTab(5), check: onPanelTab("outline"), title: "Outline", text: "Click Outline: a list of everything in the program. Click an entry to jump to its line." },
    { target: panelTab(6), check: onPanelTab("check"), title: "Check", text: "Click Check. It shows the result of the last check." },
    { target: "plc-hidecode", check: (ctx) => plc(ctx).hideCode === true, title: "More room", text: "Click Hide code. The panel takes the whole width." },
    { target: "plc-hidecode", check: (ctx) => plc(ctx).hideCode === false, title: "Code back", text: "Click Show code to bring the code back." },
  ],
};

const helpers = {
  id: "nextplc.helpers",
  page: PROGRAM,
  group: "Write the logic",
  icon: Workflow,
  title: "Blocks, sequences and patterns",
  blurb: "Add a ready-made block, a step sequence and a pattern with forms.",
  learn: ["Add a block", "Add a sequence", "Patterns and addresses"],
  note: "Use your practice program: this lesson changes the program that is open.",
  steps: () => [
    practiceStep,
    {
      target: "plc-add-block",
      requires: isPractice,
      backTo: "practice",
      check: tut("plc-block-form"),
      onEnter: (ctx) => (ctx.mem.plcBlocks = plc(ctx).blocks ?? 0),
      title: "Add a block",
      text: "A block is ready-made logic from the library. Click Add a block.",
    },
    {
      target: "plc-block-form",
      requires: tut("plc-block-form"),
      check: (ctx) => !has('[data-tut="plc-block-form"]') && (plc(ctx).blocks ?? 0) > (ctx.mem.plcBlocks ?? 0),
      title: "Wire the block",
      text: "Pick blinker. Connect enable to M10 and output to M11 (pick helps), then press Add block.",
      tip: "Each port says what it needs. Ports with a default can stay empty.",
    },
    {
      target: "plc-add-seq",
      requires: isPractice,
      backTo: "practice",
      check: tut("plc-seq-form"),
      onEnter: (ctx) => (ctx.mem.plcSeqs = plc(ctx).seqs ?? 0),
      title: "Add a sequence",
      text: "A sequence runs steps one after the other, like a little robot program. Click Add a sequence.",
    },
    {
      target: "plc-seq-form",
      requires: tut("plc-seq-form"),
      check: (ctx) => !has('[data-tut="plc-seq-form"]') && (plc(ctx).seqs ?? 0) > (ctx.mem.plcSeqs ?? 0),
      title: "Steps",
      text: "Name it demo and set start to M12. For each step, add what it switches on with + and when it goes on in next. Press Add sequence.",
      tip: "A timeout makes a step give up after a time and set an alarm bit.",
    },
    { target: "plc-patterns", check: tut("plc-patterns-list"), title: "Patterns", text: "Click Patterns." },
    {
      target: "plc-patterns-list",
      check: () => !has('[data-tut="plc-patterns-list"]'),
      title: "Ready-made pieces",
      text: "Common pieces of logic, added to the right parts of the program. Click one to add it, or close this window.",
    },
    { target: "plc-address", check: tut("plc-address-list"), title: "Insert address", text: "Click Insert address." },
    {
      target: "plc-address-list",
      check: () => !has('[data-tut="plc-address-list"]'),
      title: "Every address",
      text: "All inputs, outputs, M bits, registers and system bits with their names. Click one to add it at the cursor line, or close this window.",
    },
    { target: "plc-save", requires: isPractice, backTo: "practice", signal: savedLibrary, title: "Save", text: "Save your practice program: Ctrl+S or Save." },
  ],
};

const project = {
  id: "nextplc.project",
  page: PROGRAM,
  group: "Library and project",
  icon: Star,
  title: "This project's program and the library",
  blurb: "Which program the PLC runs, and how to keep copies.",
  learn: ["This project's program", "Save as a copy", "Use in this project"],
  steps: (ctx) => [
    {
      target: "plc-program-select",
      title: "One program per project",
      text: "This project's program, with the star, is saved with the project. The PLC runs it for this project and loads it when it starts. Library programs are shared by every project.",
    },
    !plc(ctx).hasProject && {
      target: "plc-start-project",
      title: "No program yet",
      text: "This project has no program yet. Start this project's program makes an empty one. You can also open a library program and use it in this project.",
    },
    practiceStep,
    { target: "plc-saveas", check: tut("plc-saveas-form"), title: "Save as", text: "Save as keeps a copy in the library. Click it." },
    {
      target: "plc-saveas-form",
      requires: tut("plc-saveas-form"),
      signal: savedLibrary,
      title: "Name the copy",
      text: "Type Tutorial_practice_copy and press Save.",
      tip: "Save as works on this project's program too: a good way to share it with other projects.",
    },
    {
      target: "plc-use",
      title: "Use in this project",
      text: "Use in this project copies the open library program over this project's program. The old one is kept as a backup. Only press it when you really want this program to run for this project, so not now.",
    },
    {
      target: "plc-delete",
      requires: isPractice,
      backTo: "practice",
      signal: (name) => /^api:DELETE \/plc-api\/programs\/.*(tutorial|practice)/i.test(name),
      title: "Delete the copy",
      text: "The copy is open now. Click the bin and confirm. Deleting cannot be undone, so only delete programs you really don't need.",
    },
  ],
};

const run = {
  id: "nextplc.run",
  page: PROGRAM,
  group: "Run and test",
  icon: FlaskConical,
  title: "Run it in the simulator",
  blurb: "Load your practice program into the simulated PLC and watch it live.",
  learn: ["SIM first", "Load into SIM", "See it live"],
  note: "This lesson only uses the simulated PLC. Nothing reaches the robot.",
  steps: () => [
    simStep,
    practiceStep,
    {
      target: "plc-load",
      requires: simMode,
      backTo: "sim",
      signal: api("/plc-api/programs/load"),
      title: "Load into SIM",
      text: "Press Load into SIM and confirm. If it asks to save first, choose Save and load.",
    },
    { target: "plc-run", title: "Running", text: "RUN with your program's name: the simulated PLC runs it now." },
    { target: panelTab(1), check: onPanelTab("ladder"), title: "Live ladder", text: "Click Ladder." },
    { target: "plc-panel-body", title: "Power flow", text: "The live mark shows the PLC runs this exact program. Rungs that are true light up, here and in the code." },
    { target: shellTab(3), click: true, title: "Watch it", text: "Click Monitor to see every input and output of the PLC." },
  ],
  outro: "To give the simulator this project's program back, open it from the list and press Load into SIM.",
};

const monitor = {
  id: "nextplc.monitor",
  page: MONITOR,
  group: "Run and test",
  icon: Gauge,
  title: "Watch the PLC live",
  blurb: "Inputs, outputs, memory, alarms and events as they happen.",
  learn: ["The live image", "Rungs, sequences and alarms", "Events"],
  steps: () => [
    { target: "plc-scan", title: "Scans", text: "How often the PLC runs the program, how long the last run took, and how many runs since it was loaded." },
    { target: "plc-inputs", title: "Inputs", text: "Every input, live. A lit dot means on. Names from the program show under the address." },
    simMode()
      ? { target: '[data-tut="plc-inputs"] .bit.clickable', signal: api("/plc/sim/input"), title: "Try an input", text: "In SIM you can click an input to switch it. Click di1 of gpio1. If your practice program runs, the rung you wrote reacts." }
      : { target: "plc-inputs", title: "Pick an input", text: "Clicking an input here picks it for the Commission tools. It does not switch anything." },
    { target: "plc-outputs", title: "Outputs", text: "The real state of each output. A dimmed one is not in the program. ≠ shows what the logic wants when it differs, and F means forced." },
    { target: "plc-mbits", title: "M bits", text: "Memory bits inside the PLC. Click one to pick it for writing." },
    { target: "plc-regs", title: "Registers", text: "Number values, like counters and settings. Click one to pick it for writing." },
    { target: "plc-sysbits", title: "System bits", text: "What the robot tells the PLC: auto, emergency, IO fault and more. Hover one to see what it means." },
    { target: sideTab(2), check: sideOn(2), title: "Rungs", text: "Click Rungs: each rung of the loaded program, lit while it is true." },
    { target: sideTab(3), check: sideOn(3), title: "Sequences", text: "Click Sequences: the step each sequence is in right now." },
    { target: sideTab(4), check: sideOn(4), title: "Alarms", text: "Click Alarms: alarms that came and went since you opened the page." },
    { target: sideTab(5), check: sideOn(5), title: "Events", text: "Click Events: what the PLC reported, like loads and faults." },
    { target: "plc-hide-image", check: () => !has('[data-tut="plc-inputs"]'), title: "Hide the image", text: "Click Hide image to give the side panel the whole width." },
    { target: "plc-hide-image", check: tut("plc-inputs"), title: "Show it again", text: "Click Show image." },
  ],
};

const commission = {
  id: "nextplc.commission",
  page: MONITOR,
  group: "Run and test",
  icon: Wrench,
  title: "Commission in SIM",
  blurb: "Write bits, pulse, force and release, safely in the simulator.",
  learn: ["Write and pulse a bit", "Force and release", "Reload and reset"],
  note: "Do this in SIM. On the ROBOT, writing and forcing switch real outputs, and a forced input hides the real sensor.",
  steps: () => [
    simStep,
    { target: sideTab(1), check: sideOn(1), title: "Commission", text: "Click Commission." },
    { target: "plc-cm-write", title: "Write from outside", text: "Only M bits and registers can be written. A bit the program writes itself is refused." },
    {
      target: "plc-cm-writebit",
      requires: simMode,
      backTo: "sim",
      signal: api("/plc/set-bits", "POST", (b) => !b.pulse_ms),
      title: "Write a bit",
      text: "Type M20 in the M bit field (or click an M bit in the image), choose 1 and press Write.",
    },
    {
      target: "plc-cm-pulse",
      requires: simMode,
      backTo: "sim",
      signal: api("/plc/set-bits", "POST", (b) => !!b.pulse_ms),
      title: "Pulse",
      text: "Pulse sets the bit to 1 for the time next to it, then back. Press Pulse.",
    },
    { target: "plc-cm-writereg", title: "Registers", text: "Below, type a register like R5 and a number, and press Write to set it." },
    {
      target: "plc-cm-profile",
      requires: simMode,
      backTo: "sim",
      signal: api("/plc/sim/supervisor", "POST", (b) => b.cmd === "JOG"),
      title: "Leave auto",
      text: "Forcing is refused in auto. Here you play the robot: press JOG.",
      missing: "These buttons only show in SIM. Switch to SIM, or skip.",
    },
    {
      target: "plc-cm-force1",
      requires: simMode,
      backTo: "sim",
      signal: api("/plc/force", "POST", (b) => !b.release && b.value === true),
      title: "Force an input",
      text: "Keep gpio1.di1 in the field and press Force = 1. The PLC now sees it as on, whatever the real sensor says.",
    },
    { target: ['[data-tut="plc-strip"] .plc-chip.is-warn', "plc-strip"], title: "FORCE shows", text: "The strip shows FORCE and how many are forced, on every NextPLC tab." },
    { target: ["plc-cm-forcelist", "plc-cm-force"], title: "Forced list", text: "Each forced address with a release button, and Release all." },
    {
      target: "plc-cm-release",
      signal: [api("/plc/force", "POST", (b) => !!b.release), api("/plc/release-all")],
      title: "Release",
      text: "Press Release. Always release every force before production.",
    },
    {
      target: "plc-cm-profile",
      requires: simMode,
      backTo: "sim",
      signal: api("/plc/sim/supervisor", "POST", (b) => b.cmd === "AUTO"),
      title: "Back to auto",
      text: "Press AUTO.",
    },
    { target: "plc-cm-program", title: "Program and faults", text: "Reload starts the program fresh. Load another runs a different program. Reset fault clears the safe state after an emergency." },
    { target: ["plc-cm-sim", "plc-cm-program"], title: "Play the robot", text: "In SIM you also set armed, emergency, e-stop, a drive fault or stale inputs, to test how your program reacts." },
  ],
};

const library = {
  id: "nextplc.library",
  page: LIBRARY,
  group: "Blocks",
  icon: Boxes,
  title: "Use the block library",
  blurb: "Find a ready-made block and see how to use it.",
  learn: ["Pick a block", "Ports and how it works", "Use it in a program"],
  steps: () => [
    { target: "plc-lib-list", title: "Blocks", text: "Ready-made blocks like a blinker or a timer chain, plus your own blocks." },
    { target: '[data-tut="plc-lib-list"] .libitem', click: true, title: "Pick one", text: "Click a block." },
    { target: "plc-lib-block", title: "Ports", text: "Ports are what you connect: in reads a bit, out writes a bit, and time or number takes a value." },
    { target: blockTab(2), check: () => has(`${blockTab(2)}[aria-selected="true"]`), title: "How it works", text: "Click How it works." },
    { target: blockTab(3), check: () => has(`${blockTab(3)}[aria-selected="true"]`), title: "Code", text: "Click Code to see the block's own logic." },
    { target: blockTab(1), check: () => has(`${blockTab(1)}[aria-selected="true"]`), title: "Back to ports", text: "Click Ports." },
    { target: "plc-lib-useline", title: "Use it", text: "This is the line a program needs. Copy it, or simply use Add a block on the Program tab." },
    { target: ["plc-lib-copy", "plc-lib-edit"], title: "Make it yours", text: "Copy to my blocks and edit makes your own version. The library block stays as it is." },
  ],
};

const ownBlock = {
  id: "nextplc.own-block",
  page: LIBRARY,
  group: "Blocks",
  icon: Puzzle,
  title: "Make your own block",
  blurb: "Write a block, check it and test it.",
  learn: ["New block", "Live check", "Run a test"],
  steps: () => [
    { target: "plc-lib-new", check: tut("plc-lib-name"), title: "New block", text: "Click New block." },
    { target: "plc-lib-name", requires: tut("plc-lib-name"), check: tut("plc-be-bar"), title: "Name it", text: "Type Tutorial_practice and press Create." },
    { target: "plc-be-code", requires: tut("plc-be-bar"), title: "The block's code", text: "A block has ports and its own rungs. In the rungs you use the port names instead of addresses." },
    { target: "plc-be-tabs", requires: tut("plc-be-bar"), title: "Form and guide", text: "Form edits ports and rungs as tables. Guide helps where you type. Expanded shows the rungs with test addresses filled in." },
    { target: "plc-be-check", requires: tut("plc-be-bar"), title: "Checked as you type", text: "The block is checked all the time. Green means it loads; red shows the error." },
    { target: "plc-be-save", requires: tut("plc-be-bar"), signal: (name) => /^api:PUT \/plc-api\/blocks\/[^/]+$/.test(name), title: "Save", text: "Press Save to my blocks." },
    { target: editorTab(4), requires: tut("plc-be-bar"), check: () => has(`${editorTab(4)}[aria-selected="true"]`), title: "Test", text: "Click Test." },
    { target: "plc-be-scenario", requires: tut("plc-be-bar"), title: "A scenario", text: "A test sets inputs and expects outputs. The wiring above says which test addresses the ports use." },
    { target: "plc-be-test", requires: tut("plc-be-bar"), signal: api("/test"), title: "Run test", text: "Press Run test. The result shows pass or fail, with a log." },
    { target: "plc-be-close", click: true, title: "Close", text: "Click Close." },
    { target: "plc-lib-list", title: "Your block", text: "It's in the list, marked your block. Programs can use it like any library block. The bin next to Edit block deletes it." },
  ],
};

const help = {
  id: "nextplc.help",
  page: HELP,
  group: "Help",
  icon: BookOpen,
  title: "Read the manuals",
  blurb: "Find answers in the manuals and search them.",
  learn: ["The three manuals", "Search", "Reading style"],
  steps: () => [
    { target: "plc-help-docs", title: "Three manuals", text: "How to write the logic, The block library, and the Full manual." },
    { target: '[data-tut="plc-help-docs"] .libitem:nth-child(2)', click: true, title: "Open one", text: "Click The block library." },
    { target: '[data-tut="plc-help-toc"] .toc-item', click: true, title: "Contents", text: "These are the chapters of the open manual. Click one to jump there." },
    { target: "plc-help-note", title: "The picture in your head", text: "The few rules worth remembering, always at hand." },
    { target: "plc-help-search", check: () => helpQuery().trim().length >= 3, title: "Search", text: "Type timer in the search box." },
    { target: '[data-tut="plc-help-hits"] .libitem', click: true, title: "Matches", text: "Matches from every manual. Click one to read it; your words are marked in the text." },
    { target: "plc-help-search", check: () => !helpQuery(), title: "Clear", text: "Clear the search with the x or Esc." },
    { target: "plc-help-style", click: true, title: "Reading or Cozy", text: "Cozy uses bigger text with more space. Click to switch." },
    { target: "plc-help-hide", check: () => !has('[data-tut="plc-help-docs"]'), title: "Full width", text: "Click this to hide the list. The text takes the whole width." },
    { target: "plc-help-show", check: tut("plc-help-docs"), title: "List back", text: "Click this to show the list again." },
  ],
};

export default [tour, first, panels, helpers, project, run, monitor, commission, library, ownBlock, help];
