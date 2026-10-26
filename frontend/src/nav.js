import { createElement, lazy } from "react";
import { registerPageReset } from "./lib/pageReload";
import { importRetry } from "./lib/retry";
import { Activity, Cable, Cpu, FolderKanban, GitBranch, MapPin, Route, Settings, SlidersHorizontal, Workflow } from "lucide-react";

/** A code-split page whose code is fetched again by "Reload page" (Alt+R) if it failed. */
function page(rawLoad) {
  const load = importRetry(rawLoad); // the page's code is fetched again if it failed
  let Lazy = lazy(load);
  registerPageReset(() => {
    Lazy = lazy(load);
  });
  return function Page(props) {
    return createElement(Lazy, props);
  };
}

// One entry per page. `path` is the browser route; pages are code-split.
export const NAV = [
  {
    section: "Workspace",
    items: [
      { path: "/projects", label: "Projects", description: "Create, load and version robot projects", icon: FolderKanban, component: page(() => import("./pages/projects/ProjectsPage.jsx")) },
    ],
  },
  {
    section: "Programming",
    items: [
      { path: "/points", label: "Teach Points", description: "Jog the robot and save positions", icon: MapPin, component: page(() => import("./pages/points/PointsPage.jsx")) },
      { path: "/programs", label: "Motion Programs", description: "Named motion step lists the robot program runs", icon: Route, component: page(() => import("./pages/programs/ProgramsPage.jsx")) },
      { path: "/io", label: "IO Control", description: "Digital inputs, outputs and IO sequences", icon: Cable, component: page(() => import("./pages/io/IoPage.jsx")) },
      { path: "/tree", label: "Robot Program", description: "Build and edit the steps the robot runs", icon: GitBranch, component: page(() => import("./pages/tree/TreePage.jsx")) },
      { path: "/nextplc", label: "NextPLC", description: "The robot's soft PLC: logic, blocks, live I/O and commissioning", icon: Cpu, component: page(() => import("./pages/nextplc/NextPlcPage.jsx")) },
    ],
  },
  {
    section: "Operation",
    items: [
      { path: "/runner", label: "NexRoot Runner", description: "Watch and debug the running program, the whole tree live", icon: Workflow, component: page(() => import("./pages/runner/RunnerPage.jsx")) },
      { path: "/client", label: "Client Control", description: "Run production and monitor cycles", icon: SlidersHorizontal, component: page(() => import("./pages/client/ClientPage.jsx")) },
      { path: "/diagnostics", label: "Diagnostics", description: "Live logs, error history and fault lookup", icon: Activity, component: page(() => import("./pages/diagnostics/DiagnosticsPage.jsx")) },
    ],
  },
];

// Pages reached from elsewhere than the nav list (Settings: the gear in the
// sidebar footer). Not /settings: that prefix is a backend API route.
export const EXTRA_ROUTES = [
  { path: "/setup", label: "Settings", description: "One-time setup for each page: homes, tool, limits and more", icon: Settings, component: page(() => import("./pages/settings/SettingsPage.jsx")) },
];

export const ROUTES = [...NAV.flatMap((s) => s.items), ...EXTRA_ROUTES];
export const DEFAULT_ROUTE = "/points";
