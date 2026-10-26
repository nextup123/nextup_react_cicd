// Every lesson, per page. Robot Program node lessons come from the live node
// library, so they follow whatever nodes the robot has.
import { Activity, Cable, Cpu, FolderKanban, GitBranch, MapPin, Route, Settings, SlidersHorizontal, Workflow } from "lucide-react";
import projects from "./projects";
import points from "./points";
import programs from "./programs";
import io from "./io";
import tree from "./tree";
import nextplc from "./nextplc";
import runner from "./runner";
import client from "./client";
import diagnostics from "./diagnostics";
import settings from "./settings";
import { nodeLessons } from "./treeNodes";

export const PAGES = [
  { path: "/projects", label: "Projects", icon: FolderKanban },
  { path: "/points", label: "Teach Points", icon: MapPin },
  { path: "/programs", label: "Motion Programs", icon: Route },
  { path: "/io", label: "IO Control", icon: Cable },
  { path: "/tree", label: "Robot Program", icon: GitBranch },
  { path: "/nextplc", label: "NextPLC", icon: Cpu },
  { path: "/runner", label: "NexRoot Runner", icon: Workflow },
  { path: "/client", label: "Client Control", icon: SlidersHorizontal },
  { path: "/diagnostics", label: "Diagnostics", icon: Activity },
  { path: "/setup", label: "Settings", icon: Settings },
];

/** lib: the Robot Program node library (indexNodeTypes), or null while not loaded. */
export function allLessons(lib) {
  return [...projects, ...points, ...programs, ...io, ...tree, ...nextplc, ...runner, ...client, ...diagnostics, ...settings, ...nodeLessons(lib)];
}
