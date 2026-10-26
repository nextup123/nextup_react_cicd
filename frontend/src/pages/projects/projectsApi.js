// Project manager endpoints (backend/routes/pm_projects.js).
import { api } from "../../lib/api";

const enc = encodeURIComponent;

export const projectsApi = {
  /** Metadata (project.yaml) of one project. */
  details: (projectName) => api.post("/api/projects/active-project", { projectName }),
  create: (data) => api.post("/api/projects/create", data),
  /** Replace the runtime with this project. Fails when the runtime has unsaved changes. */
  load: (name) => api.post("/api/projects/load", { name }),
  /** Same as load but discards unsaved runtime changes. */
  overwrite: (name) => api.post("/api/projects/overwrite", { name }),
  /** Save the runtime into the active project. A manual save makes a new version with a backup;
   *  auto=true (autosave) saves without one and is skipped when nothing changed. */
  save: (auto = false) => api.post("/api/projects/save", { auto }),
  copy: (sourceName, { name, owner, description }) => api.post("/api/projects/copy", { sourceName, name, owner, description }),
  rename: (currentName, newName) => api.post("/api/projects/rename", { currentName, newName }),
  remove: (name) => api.del(`/api/projects/delete/${enc(name)}`),
  /** { current_version, versions: [{ id, project_version, saved_at, saved_by, is_head }] } */
  versions: (name) => api.get(`/api/projects/versions/${enc(name)}`),
  restore: (name, versionId) => api.post("/api/projects/restore", { name, versionId }),
  removeVersion: (name, versionId) => api.del(`/api/projects/versions/${enc(name)}/${enc(versionId)}`),
  removeAllVersions: (name) => api.del(`/api/projects/versions/${enc(name)}`),
};

export function formatDate(value, withWeekday = false) {
  if (!value) return "—";
  const d = new Date(value);
  if (isNaN(d)) return String(value);
  return d.toLocaleString(undefined, withWeekday
    ? { weekday: "short", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }
    : { dateStyle: "medium", timeStyle: "short" });
}

/** "Name 1", "Name 2"… first name not used by an existing project. */
export function uniqueName(base, projects, startAt = 1) {
  const taken = new Set((projects || []).map((p) => p.name));
  for (let i = startAt; ; i++) {
    const name = `${base} ${i}`;
    if (!taken.has(name)) return name;
  }
}

/** Project names become folder names on the robot. */
export function validateName(name, projects, { allow } = {}) {
  const n = (name || "").trim();
  if (!n) return "Enter a name";
  if (/[\\/]/.test(n) || n === "." || n === "..") return "Name cannot contain / or \\";
  if (n.length > 80) return "Name is too long (80 characters max)";
  if (n !== allow && (projects || []).some((p) => p.name === n)) return "A project with this name already exists";
  return null;
}
