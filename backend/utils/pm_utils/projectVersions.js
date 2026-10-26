import fs from "fs-extra";
import path from "node:path";
import yaml from "js-yaml";

import { PROJECT_BACKUP_ROOT, PROJECTS_ROOT } from "./paths.js";

async function readYamlSafe(file) {
  try {
    if (!(await fs.pathExists(file))) return null;
    return yaml.load(await fs.readFile(file, "utf8"));
  } catch {
    return null;
  }
}

async function listProjectVersions(projectName) {
  // ---- HEAD version ----
  const projectYamlPath = path.join(
    PROJECTS_ROOT,
    projectName,
    "project.yaml"
  );

  const projectMeta = (await readYamlSafe(projectYamlPath)) || {};
  const currentVersion = projectMeta.project_version || "unknown";

  // ---- Backup dir ----
  const projectBackupDir = path.join(
    PROJECT_BACKUP_ROOT,
    projectName
  );

  if (!(await fs.pathExists(projectBackupDir))) {
    return {
      current_version: currentVersion,
      versions: [],
    };
  }

  const entries = await fs.readdir(projectBackupDir, {
    withFileTypes: true,
  });

  const versions = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const backupPath = path.join(projectBackupDir, entry.name);
    const metaPath = path.join(backupPath, "backup_meta.yaml");

    const meta = await readYamlSafe(metaPath);

    versions.push({
      id: entry.name,
      project_version: meta?.project_version || "unknown",
      saved_at: meta?.saved_at || entry.name,
      saved_by: meta?.saved_by || "unknown",
      is_head: meta?.project_version === currentVersion,
    });
  }

  // ---- Sort (newest first) ----
  versions.sort((a, b) => {
    // Prefer ISO timestamps if available
    const aTime = Date.parse(a.saved_at) || 0;
    const bTime = Date.parse(b.saved_at) || 0;
    return bTime - aTime;
  });

  return {
    current_version: currentVersion,
    versions,
  };
}

/** Backup folders live directly under .project_backups/<project>/; never accept anything else. */
function backupDir(projectName, versionId) {
  const name = String(projectName || "");
  if (!name || name.includes("/") || name.includes("\\") || name === "." || name === "..") throw new Error("Invalid project name");
  const root = path.join(PROJECT_BACKUP_ROOT, name);
  if (versionId === undefined) return root;
  const id = String(versionId || "");
  if (!id || id !== path.basename(id) || id === "." || id === "..") throw new Error("Invalid version");
  return path.join(root, id);
}

async function deleteProjectVersion(projectName, versionId) {
  const dir = backupDir(projectName, versionId);
  if (!(await fs.pathExists(dir))) throw new Error("Backup version does not exist");
  await fs.remove(dir);
  return { success: true, deleted: versionId };
}

async function deleteAllProjectVersions(projectName) {
  const dir = backupDir(projectName);
  let count = 0;
  if (await fs.pathExists(dir)) {
    count = (await fs.readdir(dir, { withFileTypes: true })).filter((e) => e.isDirectory()).length;
    await fs.remove(dir);
  }
  return { success: true, deleted: count };
}

/** Move the versions of a renamed project with it. */
async function moveProjectVersions(fromName, toName) {
  const from = backupDir(fromName), to = backupDir(toName);
  if (!(await fs.pathExists(from)) || (await fs.pathExists(to))) return;
  await fs.move(from, to);
}

export { listProjectVersions, deleteProjectVersion, deleteAllProjectVersions, moveProjectVersions, backupDir };