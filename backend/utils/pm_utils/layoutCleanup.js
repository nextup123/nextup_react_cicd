// layoutCleanup.js -- brings a project folder (the active project or a saved one) to the current
// layout. Files no page uses any more are removed, the tree template stops including the removed
// run-path trees, and NextPLC programs other than the project's own program.yaml move to the
// shared library in user_config_files/plc (plc/paths.js). Safe to run any number of times; a
// read-only or missing folder is left as it is.
import fs from "fs-extra";
import path from "node:path";

import { PROJECTS_ROOT, ACTIVE_RUNTIME_PATH } from "./paths.js";
import { migrateProjectPlcDir } from "../../plc/paths.js";

/** Relative to the project folder. A trailing "/" removes the whole folder. */
const OBSOLETE = [
  "emergency_manager.yaml",
  "joint_velocities_tuner.yaml",
  "controller_dashboard.yaml",
  "run_path_with_uids.json",
  "group_run_path_with_uids.json",
  "backup_meta.yaml",
  "planning_data/paths.yaml",
  "planning_data/plan_path.xml",
  "planning_data/plan_path_undo.xml",
  "control_data/run_path.xml",
  "control_data/group_run_path.xml",
  "control_data/nodes.json",
  "debuggers/",
];
const REMOVED_INCLUDE = /^[ \t]*<include\s+path="(?:group_)?run_path\.xml"\s*\/>[ \t]*\r?\n/gm;

/** Clean one project folder. Returns the list of what changed (relative names). */
export async function cleanProjectDir(dir, tag) {
  const changed = [];
  if (!(await fs.pathExists(dir))) return changed;
  for (const rel of OBSOLETE) {
    const p = path.join(dir, rel);
    try {
      if (await fs.pathExists(p)) {
        await fs.remove(p);
        changed.push(rel);
      }
    } catch { /* keep it */ }
  }
  const template = path.join(dir, "control_data", "template.xml");
  try {
    if (await fs.pathExists(template)) {
      const text = await fs.readFile(template, "utf8");
      const next = text.replace(REMOVED_INCLUDE, "");
      if (next !== text) {
        await fs.writeFile(template, next, "utf8");
        changed.push("control_data/template.xml");
      }
    }
  } catch { /* keep it */ }
  if (migrateProjectPlcDir(path.join(dir, "plc_data"), tag)) changed.push("plc_data");
  return changed;
}

/** The active project and every saved project; run once at start-up. Never throws. */
export async function cleanAllProjects() {
  try {
    const active = await cleanProjectDir(ACTIVE_RUNTIME_PATH, projectTag(ACTIVE_RUNTIME_PATH));
    if (active.length) console.log(`[INIT] active project brought to the current layout: ${active.join(", ")}`);
    if (await fs.pathExists(PROJECTS_ROOT)) {
      for (const e of await fs.readdir(PROJECTS_ROOT, { withFileTypes: true })) {
        if (!e.isDirectory()) continue;
        const done = await cleanProjectDir(path.join(PROJECTS_ROOT, e.name), e.name);
        if (done.length) console.log(`[INIT] project ${e.name} brought to the current layout: ${done.join(", ")}`);
      }
    }
  } catch (err) {
    console.error("[INIT] layout cleanup failed:", err.message);
  }
}

function projectTag(dir) {
  try {
    const m = /^name:\s*['"]?([^'"\n]+)/m.exec(fs.readFileSync(path.join(dir, "project.yaml"), "utf8"));
    return m ? m[1].trim() : "project";
  } catch {
    return "project";
  }
}
