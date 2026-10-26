// Diagnostics page lessons.
import { BookOpen, ClipboardList, Compass, Eye, FileText, HardDriveDownload, History, ScrollText, ShieldAlert, SquareTerminal } from "lucide-react";
import { robotApi } from "../../lib/robotApi";

const PAGE = "/diagnostics";
const q = (sel) => document.querySelector(sel);
const byText = (sel, label) => () => [...document.querySelectorAll(sel)].find((b) => b.textContent.trim().startsWith(label)) || null;
const tabBtn = (label) => byText(".dg-tabs .tab", label);
const onTab = (id) => () => {
  const el = q(`[data-tut="dg-tab-${id}"]`);
  return !!el && !el.hidden;
};
const recView = (label) => byText('[data-tut="dg-rec-filters"] .segmented button', label);
const recViewOn = (label) => () => !!recView(label)()?.classList.contains("is-active");
const viewerOpen = () => !!q(".fwin .bb-body");
const iowOpen = () => !!q(".fwin .iow-body");
const fieldValue = (sel) => (q(sel)?.value || "").trim();
/** A step that waits a moment, then passes if what it waits for is not on this robot. */
const orAbsent = (done, presentSel) => (ctx) => done() || (Date.now() - ctx.mem.stepAt > 1500 && !q(presentSel));

const openTab = (label, id, text) => ({
  target: tabBtn(label),
  check: onTab(id),
  title: `Open ${label}`,
  text: text || `Click the ${label} tab.`,
});

const tour = {
  id: "diagnostics.tour",
  page: PAGE,
  group: "Start here",
  icon: Compass,
  title: "Find your way around",
  blurb: "Where to look when something goes wrong.",
  learn: ["The six tabs", "IO watch", "Which tab for which question"],
  steps: () => [
    { title: "When something goes wrong", text: "This page collects everything the robot reports: messages, drive errors, safety events and recordings. It also explains fault codes." },
    { target: tabBtn("Logs"), title: "Logs", text: "Live messages from the robot as they happen, next to the history of drive errors." },
    { target: tabBtn("Summary"), title: "Summary", text: "One button gathers everything below into one page: what needs attention first, the robot now, the last 24 hours, the joints, the PLC and the robot PC." },
    { target: tabBtn("Robot records"), title: "Robot records", text: "What the safety supervisor, the drives and the motion server wrote down, plus black box recordings of every emergency." },
    { target: tabBtn("Fault lookup"), title: "Fault lookup", text: "Type a drive fault code and read what it means, how to check it and how to fix it." },
    { target: tabBtn("Commands"), title: "Commands", text: "A notebook of notes and service commands your team keeps for this robot." },
    { target: tabBtn("Description"), title: "Description", text: "Free text about known errors and how to handle them." },
    { target: "dg-iowatch", title: "IO watch", text: "Opens a floating window that logs when inputs change. It stays open while you switch tabs." },
    { target: ".dg-tabs", title: "A star means unsaved", text: "When Commands or Description has edits that are not saved yet, its tab shows a star." },
  ],
};

const logs = {
  id: "diagnostics.logs",
  page: PAGE,
  group: "Logs",
  icon: ScrollText,
  title: "Read the live logs",
  blurb: "Find the message you need in a busy log.",
  learn: ["Search and filters", "Pause while reading", "Refresh and Clear"],
  steps: () => [
    openTab("Logs", "logs"),
    { target: "dg-log", requires: onTab("logs"), title: "Newest first", text: "Every line has its time, a level badge and BT when it comes from the robot program. New lines appear at the top." },
    {
      target: '[data-tut="dg-live-filters"] .search-input',
      requires: onTab("logs"),
      check: () => !!fieldValue('[data-tut="dg-live-filters"] .search-input input'),
      title: "Search",
      text: "Type a word in the search box, for example error or a step name. Matches are marked.",
    },
    {
      target: '[data-tut="dg-live-filters"] select[aria-label="Level"]',
      requires: onTab("logs"),
      check: () => fieldValue('[data-tut="dg-live-filters"] select[aria-label="Level"]') !== "all",
      title: "Only one level",
      text: "Pick a level, for example Failures, to see only those lines.",
    },
    { target: '[data-tut="dg-live-filters"] select[aria-label="Source"]', requires: onTab("logs"), title: "Source and length", text: "Show only the robot program or only the other parts, and choose how many lines to keep in view." },
    {
      target: '[data-tut="dg-live"] .card-header .switch',
      requires: onTab("logs"),
      check: () => /paused/i.test(q('[data-tut="dg-live"] .card-header .switch')?.textContent || ""),
      title: "Pause",
      text: "Flip the Live switch to pause. The list stops moving so you can read. The title counts the lines that arrive meanwhile.",
    },
    {
      target: '[data-tut="dg-live"] .card-header .switch',
      requires: onTab("logs"),
      check: () => /live/i.test(q('[data-tut="dg-live"] .card-header .switch')?.textContent || ""),
      title: "Back to live",
      text: "Flip it again to catch up with the new lines.",
    },
    { target: "dg-live-refresh", requires: onTab("logs"), title: "Refresh", text: "Loads the saved lines again from the robot." },
    { target: "dg-live-clear", requires: onTab("logs"), title: "Clear", text: "Deletes every saved log line for good. It asks first. Only clear when you are sure nobody needs the old lines." },
    {
      target: '[data-tut="dg-live-filters"] .search-input',
      requires: onTab("logs"),
      check: () => !fieldValue('[data-tut="dg-live-filters"] .search-input input') && fieldValue('[data-tut="dg-live-filters"] select[aria-label="Level"]') === "all",
      title: "Clean up",
      text: "Empty the search box and set the level back to All levels, so you see every line again.",
    },
  ],
};

const errors = {
  id: "diagnostics.errors",
  page: PAGE,
  group: "Logs",
  icon: History,
  title: "Drive error history",
  blurb: "Which joint reported which error, and when.",
  learn: ["Read the list", "Search it", "Look up a code"],
  steps: () => [
    openTab("Logs", "logs"),
    { target: "dg-errors", requires: onTab("logs"), title: "Error history", text: "Each row is an error a joint drive reported: the time, the joint and the error code. The newest is on top." },
    { target: '[data-tut="dg-errors"] .search-input', requires: onTab("logs"), title: "Search", text: "Search by time, joint or code. Choose how many entries to load next to it." },
    {
      target: ["dg-err-code", "dg-errors"],
      requires: onTab("logs"),
      title: "Look up a code",
      text: "Each code is a button. Click it and the Fault lookup tab opens with that code, so you see what it means at once.",
      tip: "No errors listed? Good news. The list fills when a drive reports a fault.",
    },
  ],
};

const records = {
  id: "diagnostics.records",
  page: PAGE,
  group: "Robot records",
  icon: ShieldAlert,
  title: "Robot records",
  blurb: "Safety events, drive errors, fault counters and the motion log.",
  learn: ["Supervisor events", "Drive errors and counters", "Motion log and filters"],
  steps: () => [
    openTab("Robot records", "records"),
    { target: recView("Supervisor events"), requires: onTab("records"), check: recViewOn("Supervisor events"), title: "Supervisor events", text: "Click Supervisor events: mode changes, emergencies and resets." },
    {
      target: ".dg-rec-row",
      requires: onTab("records"),
      check: orAbsent(() => !!q(".dg-rec-row.is-open"), ".dg-rec-row"),
      title: "Open a record",
      text: "Click a row. It opens and lists every field of that record.",
      missing: "Nothing recorded yet. This step moves on by itself.",
    },
    { target: recView("Drive errors"), requires: onTab("records"), check: recViewOn("Drive errors"), title: "Drive errors", text: "Click Drive errors: every error a joint drive raised or cleared, with the code before and after." },
    {
      target: ["dg-rec-code", "dg-rec-list"],
      requires: onTab("records"),
      title: "Codes are links",
      text: "A red code button opens the Fault lookup with that code.",
    },
    { target: recView("Fault counters"), requires: onTab("records"), check: recViewOn("Fault counters"), title: "Fault counters", text: "Click Fault counters: how many faults and errors each joint had. A joint that keeps counting up needs a look." },
    { target: recView("Motion log"), requires: onTab("records"), check: recViewOn("Motion log"), title: "Motion log", text: "Click Motion log: every motion the robot made, with its result, speed and duration." },
    { target: "dg-rec-filters", requires: onTab("records"), title: "Filters", text: "Search every field, pick one event or result, one joint, and how many records to load." },
    { target: ["dg-rec-clear", "dg-rec-filters"], requires: onTab("records"), title: "Clear", text: "On Supervisor events, Drive errors and Fault counters a Clear button empties that list. It cannot be undone, so leave it unless your service team asks." },
    { target: "dg-records", requires: onTab("records"), title: "Updates by itself", text: "New events come in live and the list refreshes. Refresh loads it again by hand." },
  ],
};

const blackbox = {
  id: "diagnostics.blackbox",
  page: PAGE,
  group: "Robot records",
  icon: HardDriveDownload,
  title: "Black box recordings",
  blurb: "Replay the last seconds before an emergency.",
  learn: ["Open a recording", "Chart: zoom and read values", "Table: check and edit rows"],
  setup: async (ctx) => {
    try {
      const r = await robotApi.blackbox();
      ctx.mem.bbCount = (r?.files || []).length;
    } catch {
      ctx.mem.bbCount = 0;
    }
  },
  steps: (ctx) => {
    const head = [
      openTab("Robot records", "records"),
      { target: recView("Black box"), requires: onTab("records"), check: recViewOn("Black box"), title: "Black box", text: "Click Black box." },
    ];
    if (!ctx.mem.bbCount)
      return [
        ...head,
        {
          target: "dg-rec-list",
          title: "No recordings yet",
          text: "At every emergency the supervisor records the last seconds of joint data. There are none on this robot yet. When there are, open this lesson again to learn the viewer.",
        },
      ];
    const inViewer = { requires: viewerOpen, backTo: "bb-view" };
    return [
      ...head,
      { target: "dg-bb-causes", requires: onTab("records"), title: "By cause", text: "Recordings are grouped by what caused the stop. Click a cause to see only those." },
      { id: "bb-view", target: "dg-bb-view", requires: onTab("records"), check: viewerOpen, title: "Open one", text: "Click View on a recording. A double click on the row works too." },
      { target: "dg-bb-head", ...inViewer, title: "The black box window", text: "The top shows the cause, the time of the stop and how many rows were recorded. Drag the window by its title, or double click the title to make it big." },
      { target: "dg-bb-picker", ...inViewer, title: "Pick signals", text: "Tick the signals to draw: positions, speeds, currents and more, per joint. Changing only picks every signal that moved." },
      { target: "dg-bb-chart", ...inViewer, title: "Read the chart", text: "Move over the chart to read values. Drag across it to zoom into that time. Click to set a cursor. The trigger line is the moment of the stop." },
      { target: "dg-bb-tools", ...inViewer, title: "Zoom tools", text: "Zoom in and out, back to Full, or jump to a quarter second around the trigger. Degrees shows angles in degrees." },
      { target: "dg-bb-readout", ...inViewer, title: "Values and changes", text: "The values at the cursor, the min and max in view, and a list of every state change. Click a change to jump there." },
      {
        target: byText('[data-tut="dg-bb-head"] .segmented button', "Table"),
        ...inViewer,
        check: () => !!q('[data-tut="dg-bb-table-tools"]'),
        title: "Table view",
        text: "Click Table to see the raw rows.",
      },
      { target: "dg-bb-table-tools", requires: () => viewerOpen() && !!q('[data-tut="dg-bb-table-tools"]'), title: "Filter the table", text: "Show signal groups and joints, hide rows where nothing changes, or type a time to jump to it." },
      {
        target: "dg-bb-table",
        requires: () => viewerOpen() && !!q('[data-tut="dg-bb-table"]'),
        check: () => !!q('[data-tut="dg-bb-table"] td.is-edited'),
        title: "Edit a cell",
        text: "Double click a value, change it and press Enter. Edits stay in this window until you save a copy.",
      },
      {
        target: byText('[data-tut="dg-bb-actions"] button', "Undo"),
        ...inViewer,
        check: () => !q('[data-tut="dg-bb-table"] td.is-edited'),
        title: "Undo",
        text: "Press Undo to take the edit back.",
      },
      { target: "dg-bb-actions", ...inViewer, title: "Keep or share", text: "Tick rows to remove them, Reset drops every edit, the download button saves the recording to your computer, and Save copy keeps an edited copy on the robot next to the original. The original never changes." },
      { target: ".fwin .fwin-actions", check: () => !viewerOpen(), title: "Close", text: "Close the window with the x when you are done." },
    ];
  },
};

const faults = {
  id: "diagnostics.faults",
  page: PAGE,
  group: "Fault lookup",
  icon: BookOpen,
  title: "Look up a fault code",
  blurb: "What a code means, how to check it and how to fix it.",
  learn: ["Search a code", "Read causes and remedies", "Filter the database"],
  steps: () => [
    openTab("Fault lookup", "faults"),
    {
      target: '[data-tut="dg-fault-filters"] .search-input',
      requires: onTab("faults"),
      check: () => !!fieldValue('[data-tut="dg-fault-filters"] .search-input input'),
      title: "Search",
      text: "Type a fault code, for example E101. A word like overcurrent works too.",
    },
    {
      target: ".dg-group-head",
      requires: onTab("faults"),
      check: () => !!q(".dg-group.is-open"),
      title: "Open a fault",
      text: "Each fault has sub-codes. Click a fault to open it, if it is not open yet.",
      missing: "Nothing matches. Try another code, like E101.",
    },
    {
      target: ".dg-sub",
      requires: onTab("faults"),
      title: "Causes and remedies",
      text: "Each sub-code lists possible causes. For each one you see how to check it and the remedy. The badges say if a reset clears it.",
    },
    { target: '[data-tut="dg-fault-filters"] .segmented', requires: onTab("faults"), title: "Resettable or not", text: "Show only codes that a reset clears, or only those that need a repair first." },
    { target: '[data-tut="dg-fault-filters"] select', requires: onTab("faults"), title: "Category", text: "Narrow the list to drive faults, axis faults or warnings." },
    {
      target: '[data-tut="dg-fault-filters"]',
      requires: onTab("faults"),
      check: () => !fieldValue('[data-tut="dg-fault-filters"] .search-input input'),
      title: "Reset",
      text: "Press Reset (or empty the search box) to see the whole database again.",
    },
  ],
  outro: "Faster still: click a code in the error history or the robot records and it opens here.",
};

const commands = {
  id: "diagnostics.commands",
  page: PAGE,
  group: "Notes",
  icon: SquareTerminal,
  title: "The commands notebook",
  blurb: "Notes and service commands kept for this robot.",
  learn: ["Notes and commands", "Copy a command", "Add, then discard"],
  note: "This lesson adds a practice cell and throws it away again. If you have unsaved edits in the notebook, save them first.",
  steps: () => [
    openTab("Commands", "commands"),
    { target: ["dg-cmd-cells", "dg-commands"], requires: onTab("commands"), title: "Cells", text: "A note explains, a command is the text to type on the robot's computer. Your service team keeps them here." },
    { target: '[data-tut="dg-cmd-cells"] .dg-cell.is-command .dg-cell-actions', requires: onTab("commands"), title: "Copy", text: "The copy button next to a command puts it on the clipboard, ready to paste.", missing: "There are no commands in the notebook yet." },
    {
      target: "dg-cmd-note",
      requires: onTab("commands"),
      onEnter: (ctx) => (ctx.mem.cells = document.querySelectorAll(".dg-cell").length),
      check: (ctx) => document.querySelectorAll(".dg-cell").length > ctx.mem.cells,
      title: "Add a note",
      text: "Click Add note. Add command works the same way.",
    },
    { target: () => [...document.querySelectorAll(".dg-cell")].pop() || null, requires: onTab("commands"), title: "Write in it", text: "Type a few words in the new cell. The arrows move a cell up or down, the bin removes it." },
    { target: "dg-cmd-save", requires: onTab("commands"), title: "Save is your choice", text: "Save writes every cell to the robot. Nothing is saved until you press it. This time we throw the practice cell away." },
    {
      target: "dg-cmd-discard",
      requires: onTab("commands"),
      check: () => !q('[data-tut="dg-cmd-discard"]'),
      title: "Discard",
      text: "Click Discard and confirm. The notebook goes back to how it was saved.",
    },
  ],
};

const description = {
  id: "diagnostics.description",
  page: PAGE,
  group: "Notes",
  icon: FileText,
  title: "The error description",
  blurb: "Your team's notes about known errors.",
  learn: ["Read it", "Edit mode", "Save or cancel"],
  steps: () => [
    openTab("Description", "description"),
    { target: "dg-desc-text", requires: onTab("description"), title: "Read it", text: "Free text about errors this cell has had and what helped. Read it before you call for help." },
    { target: "dg-desc-edit", requires: onTab("description"), check: () => !!q('[data-tut="dg-desc-cancel"]'), title: "Edit", text: "Click Edit to change the text." },
    { target: "dg-desc-text", requires: () => !!q('[data-tut="dg-desc-cancel"]'), title: "Write", text: "Now the text can be changed. Add what you learned, like the error, the cause and the fix." },
    { target: "dg-desc-save", requires: () => !!q('[data-tut="dg-desc-cancel"]'), title: "Save when you mean it", text: "Save keeps your text for everyone. Press it only when you want to keep the change." },
    {
      target: "dg-desc-cancel",
      requires: onTab("description"),
      check: () => !!q('[data-tut="dg-desc-edit"]'),
      title: "Leave edit mode",
      text: "Click Cancel to leave without saving (or Save, if you want to keep your text).",
      tip: "If you typed something, Cancel asks before it throws your text away.",
    },
  ],
};

const ioWatch = {
  id: "diagnostics.iowatch",
  page: PAGE,
  group: "IO watch",
  icon: Eye,
  title: "Watch inputs",
  blurb: "Log every change of a sensor to find a flaky one.",
  learn: ["Choose what to watch", "Read the IO log", "Trace everything"],
  steps: () => {
    const open = { requires: iowOpen, backTo: "iow-open" };
    return [
      { id: "iow-open", target: "dg-iowatch", check: iowOpen, title: "Open IO watch", text: "Click IO watch." },
      { target: ".fwin .iow-body", ...open, title: "Two sides", text: "Left: every input and output of the drives and the GPIO module. Right: the log of their changes. The window floats; drag it by its title." },
      { target: "dg-iow-find", ...open, title: "Find an IO", text: "Search by name or number. Outputs adds the outputs to the list." },
      {
        target: "dg-iow-devices",
        ...open,
        check: () => {
          const b = q('[data-tut="dg-iow-undo"]');
          return !!b && !b.disabled;
        },
        title: "Tick one",
        text: "Open a drive and tick an input. You can rename it, choose to log on or off edges, and set a debounce time.",
      },
      { target: "dg-iow-apply", ...open, title: "Apply is your choice", text: "Apply starts watching what you ticked and stops what you unticked. The robot keeps logging those inputs until you change it." },
      {
        target: "dg-iow-undo",
        ...open,
        check: () => !!q('[data-tut="dg-iow-undo"]')?.disabled,
        title: "Undo",
        text: "This time press Undo to drop the change. (Or press Apply if you really want to watch that input.)",
      },
      { target: "dg-iow-logtools", ...open, title: "Filter the log", text: "Pause the live list, pick one signal, show only HIGH or LOW edges, or search." },
      { target: ["dg-iow-timeline", "dg-iow-log"], ...open, title: "Timeline", text: "Each watched signal as a line over time. Green is HIGH. Choose the time span next to it." },
      { target: "dg-iow-log", ...open, title: "The log", text: "Each change with its time, how long the level held before, and the robot position. Click a row to see the whole record." },
      { target: "dg-iow-trace", ...open, title: "Trace 60 s", text: "Logs every IO change of every device for one minute. Handy when you do not know which signal to watch." },
      { target: ".fwin .fwin-actions", check: () => !iowOpen(), title: "Close", text: "Close the window with the x. The inputs you applied are still watched." },
    ];
  },
};

const summary = {
  id: "diagnostics.summary",
  page: PAGE,
  group: "Start here",
  icon: ClipboardList,
  title: "Get the summary",
  blurb: "Everything in one page, with what to fix first.",
  learn: ["Get latest summary", "Read the verdict", "Copy it for service"],
  steps: () => [
    openTab("Summary", "summary"),
    { target: "dg-sum-run", requires: onTab("summary"), check: () => !!q(".dg-sum-verdict"), title: "Get latest summary", text: "Click Get latest summary. It reads every record and the live status once; nothing runs in the background." },
    { target: ".dg-sum-verdict", requires: onTab("summary"), title: "The verdict", text: "Green: all good. Amber: the robot can work, but check the points. Red: fix the first point before production. The points are sorted, most serious first." },
    { target: ".dg-sum-grid", requires: onTab("summary"), title: "The details", text: "The robot now, the last 24 hours, the PLC, every joint with its last error (click a code to look it up) and the robot PC." },
    { target: '[data-tut="dg-summary"] .card-header', requires: onTab("summary"), title: "Copy", text: "Copy puts the summary on the clipboard as plain text, ready to paste into a message to your service team." },
  ],
};

export default [tour, summary, logs, errors, records, blackbox, faults, commands, description, ioWatch];
