//projectSaver.js

import fs from "fs-extra";
import path from "node:path";
import yaml from "js-yaml";

import { markClean, readSession } from "./dirtyTracker.js";
import { resetDirtyFlag } from "./mutationWatcher.js";

import {
  PROJECTS_ROOT,
  ACTIVE_RUNTIME_PATH,
  USER_CONFIG_ROOT,
  PROJECT_BACKUP_ROOT,
} from "./paths.js";

const ACTIVE_PROJECT_FILE = path.join(
  USER_CONFIG_ROOT,
  "active_project.yaml"
);

const SESSION_FILE = ".session.yaml";

// ---------- Helpers ----------

async function readYamlSafe(filePath) {
  try {
    if (!(await fs.pathExists(filePath))) return null;
    return yaml.load(await fs.readFile(filePath, "utf8"));
  } catch {
    return null;
  }
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function bumpPatchVersion(version = "1.0.0") {
  const [major, minor, patch] = version.split(".").map(Number);
  return `${major}.${minor}.${patch + 1}`;
}

/** Files of the project folder that the runtime no longer has (removed from the active project). */
async function removeStale(projectPath) {
  const walk = async (rel) => {
    for (const e of await fs.readdir(path.join(projectPath, rel), { withFileTypes: true })) {
      const r = path.join(rel, e.name);
      if (!rel && e.name === "project.yaml") continue;
      const inRuntime = await fs.pathExists(path.join(ACTIVE_RUNTIME_PATH, r));
      if (!inRuntime) await fs.remove(path.join(projectPath, r));
      else if (e.isDirectory()) await walk(r);
    }
  };
  await walk("");
}

// ---------- Main Save Logic ----------

/**
 * Copy the active project (runtime) into its saved project folder.
 *  - manual save (the Save buttons): a new version with a backup copy of what was saved, which
 *    Versions can restore
 *  - auto save (auto: true): the same copy but no new version and no backup; skipped when
 *    nothing changed
 */
async function saveProject({ auto = false } = {}) {
  // 1️⃣ Identify active project
  const activeData = await readYamlSafe(ACTIVE_PROJECT_FILE);
  const projectName = activeData?.active_project;

  if (!projectName) {
    throw new Error("No active project to save");
  }

  if (auto) {
    const currentSession = await readSession();
    if (!currentSession?.dirty) {
      return { success: true, skipped: true, reason: "not_dirty" };
    }
  }

  const projectPath = path.join(PROJECTS_ROOT, projectName);
  const projectYamlPath = path.join(projectPath, "project.yaml");

  if (!(await fs.pathExists(projectPath))) {
    throw new Error("Active project does not exist");
  }

  if (!(await fs.pathExists(ACTIVE_RUNTIME_PATH))) {
    throw new Error("Active runtime does not exist");
  }

  // 2️⃣ Read project metadata FIRST
  const projectMeta = (await readYamlSafe(projectYamlPath)) || {};
  const oldVersion = projectMeta.project_version || "1.0.0";
  const newVersion = auto ? oldVersion : bumpPatchVersion(oldVersion);

  // 3️⃣ Copy runtime → project (exclude session), drop what the runtime no longer has
  await fs.copy(ACTIVE_RUNTIME_PATH, projectPath, {
    overwrite: true,
    filter: (src) => !src.endsWith(SESSION_FILE),
  });
  await removeStale(projectPath);

  // 4️⃣ Update project.yaml
  projectMeta.project_version = newVersion;
  projectMeta.last_modified = new Date().toISOString();
  await fs.writeFile(projectYamlPath, yaml.dump(projectMeta), "utf8");

  // 5️⃣ Manual save only: keep a copy of the saved state (OUTSIDE the project dir)
  let backupPath = null;
  if (!auto) {
    backupPath = path.join(PROJECT_BACKUP_ROOT, projectName, timestamp());
    await fs.ensureDir(backupPath);
    await fs.copy(projectPath, backupPath);
    const backupMeta = {
      project_name: projectName,
      project_version: newVersion,
      saved_at: new Date().toISOString(),
      saved_by: projectMeta.owner || "unknown",
      reason: "manual_save",
    };
    await fs.writeFile(path.join(backupPath, "backup_meta.yaml"), yaml.dump(backupMeta), "utf8");
  }

  // 6️⃣ Mark runtime CLEAN
  const sessionPath = path.join(ACTIVE_RUNTIME_PATH, SESSION_FILE);
  const session = (await readYamlSafe(sessionPath)) || {};

  session.dirty = false;
  session[auto ? "last_auto_save" : "last_manual_save"] = new Date().toISOString();

  await fs.writeFile(sessionPath, yaml.dump(session), "utf8");

  await markClean(auto ? "auto_save" : "manual_save");

  resetDirtyFlag();

  return {
    success: true,
    project: projectName,
    auto,
    new_version: newVersion,
    backup: backupPath ? path.basename(backupPath) : null,
  };
}

export { saveProject };