// Settings page lessons.
import { Bot, Compass, Crosshair, FolderTree, Home, Monitor } from "lucide-react";

const PAGE = "/setup";
const q = (sel) => document.querySelector(sel);
const byText = (sel, label) => () => [...document.querySelectorAll(sel)].find((b) => b.textContent.trim().startsWith(label)) || null;
const onSection = (id) => () => !!q(`[data-tut="st-nav-${id}"]`)?.classList.contains("is-active");
const openSection = (id, label) => ({
  target: `st-nav-${id}`,
  check: onSection(id),
  title: `Open ${label}`,
  text: `Click ${label} in the list on the left.`,
});
const homesTab = (label) => byText('[data-tut="st-homes"] .tabs .tab', label);
const homesTabOn = (label) => () => !!homesTab(label)()?.classList.contains("is-active");

const tour = {
  id: "settings.tour",
  page: PAGE,
  group: "Start here",
  icon: Compass,
  title: "Find your way around",
  blurb: "Everything you set once, in one place.",
  learn: ["The sections", "How a setting card works", "How to get here"],
  steps: () => [
    { title: "Set once, use every day", text: "The other pages keep only what you use on every run. What you set once, like homes, the tool or safety limits, lives here." },
    { target: "st-nav", title: "Sections", text: "One section per area. Each shows how many settings it holds." },
    { target: "st-nav-robot", title: "Robot", text: "Safety limits the supervisor applies in every mode." },
    { target: "st-nav-point-teach", title: "Point teach", text: "Homes, the tool offset and how the jog buttons move the robot." },
    { target: "st-nav-display", title: "Display", text: "Theme and the status panels of the top bar." },
    { target: "st-nav-system", title: "System", text: "Where the robot keeps its data, for service and debugging." },
    { target: "st-nav-driver-settings", title: "Driver Settings", text: "The servo drives: saved recipes, the values of each drive, and reading or writing one value (with the password)." },
    { target: "st-nav-software-update", title: "Software Update", text: "New versions of the whole console, going back to the previous one, and reporting a problem." },
    { target: "st-head", title: "One card per setting", text: "Each card loads and saves on its own. A change counts only when you press that card's button." },
    { target: ".settings-btn", title: "Getting here", text: "The gear at the bottom of the sidebar always brings you back to Settings." },
  ],
};

const robot = {
  id: "settings.robot",
  page: PAGE,
  group: "Robot",
  icon: Bot,
  title: "Overspeed limits",
  blurb: "How fast each joint may go before the drive stops it.",
  learn: ["Limits per mode", "Joint values", "Apply and keep"],
  note: "These are real safety limits. The lesson only shows them; change them only when you know the right values.",
  steps: () => [
    openSection("robot", "Robot"),
    { target: "st-overspeed", requires: onSection("robot"), title: "Overspeed limits", text: "If a joint goes faster than its limit, the drive stops the robot. Each mode has its own limits." },
    {
      target: '[data-tut="st-overspeed"] .segmented',
      requires: onSection("robot"),
      click: true,
      title: "Pick a mode",
      text: "Click a mode to see its limits. The active mode is marked. Looking changes nothing.",
      missing: "The limits could not be loaded. Is the supervisor running? Skip to read on.",
    },
    { target: '[data-tut="st-overspeed"] .limits-grid', requires: onSection("robot"), title: "One value per joint", text: "The limit of each joint in drive units. Under the fields you see the speed cap of that mode." },
    { target: '[data-tut="st-overspeed"] .checkbox, [data-tut="st-overspeed"] .st-actions', requires: onSection("robot"), title: "Keep after a restart", text: "With this ticked, the new limits are saved on the robot and come back after a restart. Without it they last until the next restart." },
    { target: '[data-tut="st-overspeed"] .btn-primary', requires: onSection("robot"), title: "Apply", text: "Apply sends the values of the shown mode. The supervisor uses them from the next mode change. Only press it when you mean to change the limits." },
  ],
};

const homes = {
  id: "settings.homes",
  page: PAGE,
  group: "Point teach",
  icon: Home,
  title: "Homes",
  blurb: "Where the HOME button goes, and how to teach a new home.",
  learn: ["The home list", "Teach a home", "Homing settings"],
  note: "The lesson only opens things. Go moves the robot, so it stays your choice.",
  steps: () => [
    openSection("point-teach", "Point teach"),
    { target: homesTab("Homes"), requires: onSection("point-teach"), check: homesTabOn("Homes"), title: "The home list", text: "Click the Homes tab." },
    {
      target: ['[data-tut="st-homes"] .home-list', "st-homes"],
      requires: onSection("point-teach"),
      title: "Your homes",
      text: "Each home with its joint angles. Active is the one the HOME button uses. Robot is here shows when the robot stands on it. A lock means it cannot be changed.",
    },
    {
      target: ['[data-tut="st-homes"] .home-row .row', "st-homes"],
      requires: onSection("point-teach"),
      title: "Set active, Go, delete",
      text: "Set active makes a home the one HOME uses. Go moves the robot there, so keep the area clear. The bin deletes a home, but never the active one.",
    },
    { target: homesTab("Teach a home"), requires: onSection("point-teach"), check: homesTabOn("Teach a home"), title: "Teach a home", text: "Click Teach a home." },
    {
      target: "st-homes",
      requires: onSection("point-teach"),
      title: "Where the angles come from",
      text: "Give it a name, then take the angles from where the robot is now, from a taught point, or type them in degrees.",
    },
    {
      target: "st-homes",
      requires: onSection("point-teach"),
      title: "Stages",
      text: "Home in stages lets some joints move first, for example to lift the arm before it turns. Lower stage numbers move first. Teach home saves it.",
    },
    { target: homesTab("Homing settings"), requires: onSection("point-teach"), check: homesTabOn("Homing settings"), title: "Homing settings", text: "Click Homing settings." },
    {
      target: "st-homes",
      requires: onSection("point-teach"),
      title: "Speed and tolerances",
      text: "How fast the robot goes home, how close counts as home, and how long it may take to settle. Save homing settings keeps them.",
    },
  ],
};

const tool = {
  id: "settings.tool",
  page: PAGE,
  group: "Point teach",
  icon: Crosshair,
  title: "Tool offset and jog method",
  blurb: "Tell the robot where the tool tip is, and how jogging works.",
  learn: ["Tool offset", "When it applies", "Jog method"],
  note: "A wrong tool offset changes every Cartesian value. The lesson only shows it.",
  steps: () => [
    openSection("point-teach", "Point teach"),
    { target: "st-tcp", requires: onSection("point-teach"), title: "Tool offset", text: "How far the tool tip is from the robot's flange, in millimetres, and how it is turned, in degrees." },
    { target: '[data-tut="st-tcp"] .limits-grid', requires: onSection("point-teach"), title: "Why it matters", text: "Cartesian positions, the tool speed and Cartesian jogging all use this offset." },
    { target: '[data-tut="st-tcp"] .btn-primary', requires: onSection("point-teach"), title: "Apply offset", text: "Apply sends the offset to the robot. It lasts until the controller restarts. Permanent tool data belongs in the robot description." },
    { target: "st-jog-method", requires: onSection("point-teach"), title: "Jog method", text: "Step commands repeat small steps while you hold a jog button. That is the standard. The servo stream is experimental." },
  ],
};

const display = {
  id: "settings.display",
  page: PAGE,
  group: "Display",
  icon: Monitor,
  title: "Theme and panels",
  blurb: "Make the console look right for your cell.",
  learn: ["Choose a theme", "Status panels", "Reset their spots"],
  steps: () => [
    openSection("display", "Display"),
    { target: '[data-tut="st-theme"] .btn', requires: onSection("display"), check: () => !!q(".tm-modal"), title: "Choose a theme", text: "Click Choose theme." },
    { target: ".tm-modal", requires: () => !!q(".tm-modal"), title: "Light, gray or dark", text: "Pick a mode and a colour. You see the change at once. A darker mode is easier on the eyes in a dim cell." },
    { target: ".tm-modal .modal-close", check: () => !q(".tm-modal"), title: "Close", text: "Close the window when you like what you see." },
    { target: "st-panels", requires: onSection("display"), title: "Status panels", text: "The joints, motion and program panels open from the top bar. You can drag each one anywhere; it remembers its spot." },
    { target: '[data-tut="st-panels"] .btn', requires: onSection("display"), title: "Reset positions", text: "Lost a panel? Reset positions puts the open ones back under the top bar." },
  ],
};

const system = {
  id: "settings.system",
  page: PAGE,
  group: "System",
  icon: FolderTree,
  title: "File locations",
  blurb: "Where the robot keeps its data, for service work.",
  learn: ["What is stored where", "Copy a location"],
  steps: () => [
    openSection("system", "System"),
    { target: "st-paths", requires: onSection("system"), title: "File locations", text: "Where the robot keeps the active project, points, programs, logs and more. Your service team may ask for these." },
    {
      target: '[data-tut="st-paths"] dd',
      requires: onSection("system"),
      click: true,
      title: "Copy one",
      text: "Click a location to copy it. A small copied note shows it worked.",
      missing: "The locations could not be loaded. Skip to finish.",
    },
  ],
};

export default [tour, robot, homes, tool, display, system];
