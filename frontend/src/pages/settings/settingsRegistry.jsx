// Everything the Settings page shows, one section per page or area. The rest
// of the UI keeps only what is used on every run; what is set once lives here.
//
// To add a setting: append an item { id, title, description, component } to
// the section it belongs to (or add a section). `component` is a React
// component that loads and saves its own data; keep it self-contained so the
// page needs no change. Sections open at /setup/<section id>.
//
// A section with `page` (a component) instead of items fills the whole area;
// `group: "tools"` puts its button in the second block of the list (Driver
// Settings and Software Update, below Robot / Point teach / Display / System).
import { lazy } from "react";
import { Bot, CloudDownload, Cpu, FolderTree, MapPin, Monitor } from "lucide-react";
import { importRetry } from "../../lib/retry";
import { SpeedLimitsEditor } from "../../components/robot/SpeedLimitsEditor";
import { HomesManager } from "../../components/robot/HomesManager";
import { TcpOffsetEditor } from "../../components/robot/TcpOffsetEditor";
import { JogMethodSetting, PanelLayoutSetting, SystemPaths, ReloadAppSetting, ThemeSetting } from "./basicSettings";

const DriverSettings = lazy(importRetry(() => import("../ethercat/DriverSettings.jsx")));
const SoftwareUpdate = lazy(importRetry(() => import("../ethercat/SoftwareUpdate.jsx")));

export const SETTINGS = [
  {
    id: "robot",
    label: "Robot",
    icon: Bot,
    description: "Safety limits the supervisor applies in every mode.",
    items: [
      {
        id: "overspeed",
        title: "Overspeed limits per mode",
        description: "Drive overspeed thresholds for AUTO, SAFEAUTO and JOG, per joint.",
        component: SpeedLimitsEditor,
      },
    ],
  },
  {
    id: "point-teach",
    label: "Point teach",
    icon: MapPin,
    description: "Homes, tool and jogging used while teaching points.",
    items: [
      {
        id: "homes",
        title: "Homes",
        description: "Which home the HOME button moves to, teaching new homes, and homing speed and tolerances.",
        component: HomesManager,
      },
      {
        id: "tcp",
        title: "Tool (TCP) offset",
        description: "Offset of the tool tip from the flange. Cartesian values, TCP speed and Cartesian jog use it.",
        component: TcpOffsetEditor,
      },
      {
        id: "jog-method",
        title: "Jog method",
        description: "How the jog buttons move the robot.",
        component: JogMethodSetting,
      },
    ],
  },
  {
    id: "display",
    label: "Display",
    icon: Monitor,
    description: "How the console looks on this robot.",
    items: [
      { id: "theme", title: "Theme", description: "Colour and light, gray or dark mode.", component: ThemeSetting },
      { id: "panels", title: "Status panels", description: "The joints, motion and program panels opened from the top bar.", component: PanelLayoutSetting },
    ],
  },
  {
    id: "system",
    label: "System",
    icon: FolderTree,
    description: "For service and debugging.",
    items: [
      { id: "reload", title: "Reload web app", description: "When a page shows stale data or did not load.", component: ReloadAppSetting },
      { id: "paths", title: "File locations", description: "Where the robot keeps its data. Shown only here.", component: SystemPaths },
    ],
  },
  {
    id: "driver-settings",
    label: "Driver Settings",
    icon: Cpu,
    group: "tools",
    hint: "Recipes, drive values, manual read/write",
    description: "The servo drives: saved recipes, values for each drive, and reading or writing one value.",
    page: DriverSettings,
  },
  {
    id: "software-update",
    label: "Software Update",
    icon: CloudDownload,
    group: "tools",
    hint: "New versions, going back, reports",
    description: "New versions of the whole console, what they change, going back, and reporting a problem.",
    page: SoftwareUpdate,
  },
];
