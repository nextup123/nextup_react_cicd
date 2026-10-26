// Projects page lessons.
import { Compass, Copy, FilePlus2, FolderOpen, PencilLine, Save, Search } from "lucide-react";
import { api } from "../engine";

const PAGE = "/projects";
const esc = (s) => (window.CSS?.escape ? CSS.escape(s) : String(s).replace(/"/g, '\\"'));
const proj = (name, key) => `[data-tut-project="${esc(name)}"] [data-tut="pm-${key}"]`;
const card = (name) => `[data-tut-project="${esc(name)}"]`;
const pm = (ctx) => ctx.bridge("projects") || {};
const formOpen = () => !!document.querySelector('[data-tut="project-form"]');
/** A practice name not taken yet: Tutorial_practice, Tutorial_practice_2 … */
function freeName(ctx) {
  const names = new Set(pm(ctx).names || []);
  let n = "Tutorial_practice";
  for (let i = 2; names.has(n); i++) n = `Tutorial_practice_${i}`;
  return n;
}

/** A project that is safe to practise on: one made in a lesson, else any not active. */
let lastMade = null; // kept across lessons, so later lessons use the project made earlier
function practiceProject(ctx) {
  const { names = [], activeName } = pm(ctx);
  const made = ctx.mem.madeProject || lastMade;
  if (made && names.includes(made) && made !== activeName) return made;
  return names.find((n) => /tutorial|practice|copy/i.test(n) && n !== activeName) || names.find((n) => n !== activeName) || null;
}

const tour = {
  id: "projects.tour",
  page: PAGE,
  group: "Start here",
  icon: Compass,
  title: "Find your way around",
  blurb: "What a project is and where everything lives on this page.",
  learn: ["The active project", "Save and versions", "The project list"],
  steps: () => [
    {
      title: "A project holds everything",
      text: "A project keeps the robot's points, programs, IO and settings together. The robot always works in one project: the active project.",
    },
    { target: "pm-active", title: "The active project", text: "This card shows the project the robot uses right now, and whether it has unsaved changes." },
    { target: "pm-save", title: "Save", text: "Save puts your changes into the project and keeps that state as a version, so you can always go back to it. Autosave keeps the project too, but makes no version." },
    { target: "pm-browser", title: "All projects", text: "Every project on the robot is listed here. Each card has buttons to load, rename, copy, see versions or delete it." },
    { target: "pm-toolbar", title: "Find a project fast", text: "Search by name or owner, sort the list, and switch between cards and a table." },
    { target: "nav-projects", title: "Always one click away", text: "The active project's name also sits at the top of the sidebar. Click it to come back here from any page." },
  ],
};

const make = {
  id: "projects.new",
  page: PAGE,
  group: "Start here",
  icon: FilePlus2,
  title: "Make a new project",
  blurb: "Create a fresh project from the standard template.",
  learn: ["Open the new project form", "Name it and create it"],
  steps: () => [
    { target: "pm-new", click: true, title: "Start a new project", text: "Click New project." },
    {
      target: "project-form",
      group: "create",
      requires: formOpen,
      signal: api("/api/projects/create"),
      title: "Give it a name",
      text: (ctx) => `Type a name, for example ${freeName(ctx)}. Keep Standard as the start, then press Create project.`,
      tip: "Names must be new. They use letters, numbers, - and _. Standard starts with the default settings; Blank starts empty.",
    },
    {
      target: (ctx) => card(ctx.mem.madeProject || ctx.lastOf("/api/projects/create")?.body?.name || ""),
      onEnter: (ctx) => (lastMade = ctx.mem.madeProject = ctx.lastOf("/api/projects/create")?.body?.name || ctx.mem.madeProject),
      title: "There it is!",
      text: "Your new project is in the list. It is not active yet: load it when you want to work in it.",
    },
  ],
  outro: "You can make as many projects as you like. Quick create makes one with a single click.",
};

const copy = {
  id: "projects.copy",
  page: PAGE,
  group: "Everyday work",
  icon: Copy,
  title: "Copy a project",
  blurb: "Duplicate a project to try changes without touching the original.",
  learn: ["Copy from a project card", "Name the copy"],
  steps: () => [
    {
      target: (ctx) => {
        const p = practiceProject(ctx);
        return p ? [proj(p, "copy"), "pm-copy"] : "pm-copy";
      },
      click: true,
      title: "Pick the project to copy",
      text: "Click the Copy button on a project card. Copying the practice project is a good choice.",
    },
    {
      target: "project-form",
      requires: formOpen,
      signal: api("/api/projects/copy"),
      title: "Name the copy",
      text: "Give the copy a name that is not used yet (a red note means it is taken), then press Create copy.",
    },
    {
      target: (ctx) => card(ctx.lastOf("/api/projects/copy")?.body?.name || ""),
      onEnter: (ctx) => (lastMade = ctx.mem.madeProject = ctx.lastOf("/api/projects/copy")?.body?.name || ctx.mem.madeProject),
      title: "Copied!",
      text: "The copy has all the files of the saved project. Changes to the copy never touch the original.",
    },
  ],
};

const load = {
  id: "projects.load",
  page: PAGE,
  group: "Everyday work",
  icon: FolderOpen,
  title: "Load a project",
  blurb: "Make another project the active one, then switch back.",
  learn: ["Load a project", "See it become active", "Load your own project again"],
  note: "Loading changes the project the robot works in. Do this lesson while the robot is not running a program.",
  setup: (ctx) => {
    ctx.mem.prevProject = pm(ctx).activeName || null;
  },
  steps: (ctx) => [
    {
      target: (c) => {
        const p = practiceProject(c);
        return ["choice", p ? proj(p, "load") : null, '[data-tut="pm-load"]:not(:disabled)'].filter(Boolean);
      },
      signal: api("/api/projects/load"),
      title: "Load a project",
      text: "Click Load on a project card, then confirm. If the app asks about unsaved changes, choose Save & load to keep them.",
    },
    { target: "pm-active", title: "It's active now", text: "The card at the top now shows the project you loaded. Every page works in this project from now on." },
    ctx.mem.prevProject && {
      target: (c) => ["choice", proj(c.mem.prevProject, "load")],
      signal: api("/api/projects/load"),
      title: "Switch back",
      text: `Now load your own project again: press Load on "${ctx.mem.prevProject}". If it asks about unsaved changes, choose Save & load.`,
    },
  ],
};

const save = {
  id: "projects.save",
  page: PAGE,
  group: "Everyday work",
  icon: Save,
  title: "Save, versions and undo",
  blurb: "Keep your work safe and go back to an older state.",
  learn: ["Save the project", "Open, restore and delete versions", "Save as, Discard and Autosave"],
  steps: () => [
    { target: "pm-save", signal: api("/api/projects/save", "POST", (b) => !b.auto), title: "Save your work", text: "Press Save project." },
    { id: "pm-versions-open", target: "pm-active-versions", click: true, title: "Every save is a version", text: "Click Versions to see the saved states of this project. Only Save makes a version; autosave does not, so the list stays short." },
    { target: "versions-restore", requires: () => !!document.querySelector('[data-tut="versions"]'), backTo: "pm-versions-open", title: "Go back in time", text: "Each row is a state you saved. Restore loads that state as the active project; save it afterwards to keep it." },
    {
      target: "versions-delete",
      requires: () => !!document.querySelector('[data-tut="versions"]'),
      title: "Delete what you don't need",
      text: "The bin deletes one version. The project itself does not change.",
    },
    {
      target: ["versions-delete-all", "versions"],
      check: () => !document.querySelector('[data-tut="versions"]'),
      title: "Clean up all at once",
      text: "Delete all removes every saved version of this project. Close this window when you have looked around.",
    },
    { target: "pm-saveas", title: "Save as…", text: "Save as copies the project under a new name and switches to the copy. Handy before a big change." },
    { target: "pm-discard", title: "Discard changes", text: "Made a mess? Discard changes throws away everything since the last save." },
    { title: "Autosave", target: ".pm-active .switch, .pm-active [role=switch]", text: "Turn on Autosave and the project is saved for you every few seconds while this page is open. Autosave makes no versions: press Save when you want a state you can go back to." },
  ],
};

const rename = {
  id: "projects.rename",
  page: PAGE,
  group: "Tidy up",
  icon: PencilLine,
  title: "Rename and delete",
  blurb: "Give a project a better name, and remove ones you no longer need.",
  learn: ["Rename a project", "Delete a project"],
  note: "Use a practice project for this lesson (make one in \"Make a new project\" first). The active project cannot be deleted.",
  steps: () => [
    {
      target: (ctx) => {
        const p = practiceProject(ctx);
        return p ? proj(p, "rename") : "pm-rename";
      },
      signal: api("/api/projects/rename"),
      title: "Rename",
      text: (ctx) => {
        const p = practiceProject(ctx);
        return `Click the pencil on ${p ? `"${p}"` : "a project"}, type a new name and press Confirm.`;
      },
    },
    {
      target: (ctx) => {
        const n = ctx.lastOf("/api/projects/rename")?.body?.newName;
        return n ? [proj(n, "delete")] : "pm-delete";
      },
      onEnter: (ctx) => (ctx.mem.madeProject = ctx.lastOf("/api/projects/rename")?.body?.newName || ctx.mem.madeProject),
      signal: (name) => name.startsWith("api:DELETE /api/projects/delete/"),
      title: "Delete",
      text: "Now delete it: click the bin and confirm. Its saved versions go with it. Deleting cannot be undone, so only delete projects you really don't need.",
    },
  ],
};

const find = {
  id: "projects.find",
  page: PAGE,
  group: "Tidy up",
  icon: Search,
  title: "Search, sort and views",
  blurb: "Find the project you need in a long list.",
  learn: ["Search", "Sort", "Cards or table"],
  steps: () => [
    {
      target: ".pm-search",
      check: (ctx) => !!pm(ctx).search,
      title: "Search",
      text: "Type a few letters of a project name in the search box.",
    },
    { target: ".pm-toolbar .row .segmented", click: true, title: "Sort", text: "Sort by name, last modified or created date. Click one." },
    { target: ".pm-toolbar > .segmented", click: true, title: "Cards or table", text: "Switch between big cards and a compact table." },
  ],
};

export default [tour, make, copy, load, save, rename, find];
