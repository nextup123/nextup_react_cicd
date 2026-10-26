// Every project operation, with the confirmations and the "unsaved changes"
// handling of the old Project Manager. Anything that changes the active
// project calls invalidate.all() so every page reloads its data (this
// replaces the old shell reloading all iframes).
import { useCallback, useRef, useState } from "react";
import { confirm, prompt } from "../../store/confirm";
import { toast } from "../../store/toast";
import { api, errorMessage } from "../../lib/api";
import { guardIdle, showBusy } from "../../lib/interlock";
import { invalidate } from "../../lib/queries";
import { formatDate, projectsApi, uniqueName, validateName } from "./projectsApi";

const isUnsavedError = (err) => /unsaved changes/i.test(err?.message || "");

/**
 * A project switch loads new points, programs and the project's PLC program: refused while the
 * robot program runs or the robot moves (popup), and confirmed while the robot's PLC runs.
 */
async function readyToSwitch(name) {
  if (!guardIdle("switch the project")) return false;
  const st = await api.get("/system/interlock").catch(() => null);
  if (st?.busy) {
    showBusy("switch the project", st.reasons);
    return false;
  }
  if (st?.plc) {
    return confirm({
      title: "The robot's PLC is running",
      message: `It runs ${st.plc.program ? `"${st.plc.program}"` : "a program"}. Loading "${name}" loads that project's PLC program into it right away, and its outputs may switch.\n\nContinue?`,
      confirmLabel: "Load project",
    });
  }
  return true;
}

export function useProjectActions({ activeName, dirty, projects, ask }) {
  const [busy, setBusy] = useState(null); // short label of the running operation
  const busyRef = useRef(false);

  // Run one operation at a time (also used by autosave to stay out of the way).
  const run = useCallback(async (label, fn) => {
    if (busyRef.current) {
      toast.warning("Another project operation is still running");
      return false;
    }
    busyRef.current = true;
    setBusy(label);
    try {
      return await fn();
    } finally {
      busyRef.current = false;
      setBusy(null);
    }
  }, []);

  /** Activate `name`. Asks what to do with unsaved changes first. Returns true when loaded. */
  const doLoad = useCallback(
    async (name, { askFirst = true, knownDirty = dirty, checked = false } = {}) => {
      if (!checked && !(await readyToSwitch(name))) return false;
      if (knownDirty && activeName) {
        const choice = await ask({
          title: "Unsaved changes",
          message: `"${activeName}" has unsaved changes. What should happen to them before "${name}" is loaded?`,
          choices: [
            { value: "discard", label: "Discard & load", variant: "soft-danger" },
            { value: "save", label: "Save & load", variant: "primary", autoFocus: true },
          ],
        });
        if (!choice) return false;
        if (choice === "save") {
          await projectsApi.save();
          await projectsApi.load(name);
        } else {
          await projectsApi.overwrite(name);
        }
      } else {
        if (askFirst) {
          const ok = await confirm({
            title: "Load project",
            message: `Make "${name}" the active project?\nAll pages will reload their points, paths, IO and settings from it.`,
            confirmLabel: "Load project",
          });
          if (!ok) return false;
        }
        try {
          await projectsApi.load(name);
        } catch (err) {
          // The runtime became dirty after our last update: ask and retry.
          if (isUnsavedError(err)) return doLoad(name, { askFirst: false, knownDirty: true, checked: true });
          throw err;
        }
      }
      return true;
    },
    [activeName, dirty, ask]
  );

  const afterActiveChange = () => invalidate.all();

  const load = (project) =>
    run("load", async () => {
      try {
        if (!(await doLoad(project.name))) return false;
        toast.success(`"${project.name}" is now the active project`);
        return true;
      } catch (err) {
        toast.error(errorMessage(err), { title: "Could not load project" });
        return false;
      } finally {
        afterActiveChange();
      }
    });

  const save = () =>
    run("save", async () => {
      if (!activeName) return toast.error("No active project to save");
      try {
        const res = await projectsApi.save();
        toast.success(res?.new_version ? `Saved "${activeName}" as version ${res.new_version}` : `Saved "${activeName}"`);
      } catch (err) {
        toast.error(errorMessage(err), { title: "Save failed" });
      } finally {
        invalidate.projects();
      }
    });

  const autoSave = useCallback(async () => {
    if (busyRef.current || !activeName) return;
    busyRef.current = true;
    try {
      const res = await projectsApi.save(true);
      if (!res?.skipped) toast.success("Project auto-saved", { duration: 2000 });
    } catch (err) {
      toast.error(errorMessage(err), { title: "Auto-save failed" });
    } finally {
      busyRef.current = false;
      invalidate.projects();
    }
  }, [activeName]);

  /** Throw away runtime edits by reloading the saved project (backend "overwrite"). */
  const discardChanges = () =>
    run("discard", async () => {
      if (!activeName) return;
      if (!(await readyToSwitch(activeName))) return;
      const ok = await confirm({
        title: "Discard unsaved changes?",
        message: `Reload "${activeName}" from its last saved state. Every change made since the last save is lost.`,
        tone: "danger",
        confirmLabel: "Discard changes",
      });
      if (!ok) return;
      try {
        await projectsApi.overwrite(activeName);
        toast.success("Changes discarded");
      } catch (err) {
        toast.error(errorMessage(err), { title: "Could not discard changes" });
      } finally {
        afterActiveChange();
      }
    });

  /** New project from the form (not activated, like the old page). Throws to keep the form open. */
  const create = async (values) => {
    await projectsApi.create({ ...values, owner: values.owner || "Anonymous" });
    toast.success(`Project "${values.name}" created`, { title: "Load it from the list to start using it" });
    invalidate.projects();
  };

  const createQuick = (type) =>
    run("create", async () => {
      const isBlank = type === "blank";
      const ok = await confirm({
        title: isBlank ? "Create blank project" : "Create default project",
        message: isBlank
          ? "Create an empty project (no points, paths or IO) and make it the active project?"
          : "Create a project from the standard template and make it the active project?",
        confirmLabel: "Create & load",
      });
      if (!ok) return;
      const name = uniqueName(isBlank ? "Blank" : "Default", projects);
      try {
        await projectsApi.create({
          name,
          owner: "Nextup",
          description: isBlank ? "Blank project" : "Default template project",
          project_type: isBlank ? "blank" : "standard",
        });
        invalidate.projects();
      } catch (err) {
        return toast.error(errorMessage(err), { title: "Could not create project" });
      }
      try {
        if (await doLoad(name, { askFirst: false })) toast.success(`"${name}" created and loaded`);
        else toast.info(`"${name}" created but not loaded`);
      } catch (err) {
        toast.error(errorMessage(err), { title: `"${name}" was created but could not be loaded` });
      } finally {
        afterActiveChange();
      }
    });

  /** File copy of a project. Throws to keep the form open. */
  const copy = async (source, values) => {
    if (values.name === source.name) throw new Error("The new name must be different from the original");
    await projectsApi.copy(source.name, {
      name: values.name,
      owner: values.owner || source.owner || "Anonymous",
      description: values.description || `Copy of ${source.name}`,
    });
    toast.success(`"${values.name}" created as a copy of "${source.name}"`);
    invalidate.projects();
  };

  /**
   * Save as: copy the active project under a new name and switch to it.
   * The copy is made from the saved project files, so unsaved changes are
   * saved into the current project first (after asking). Throws to keep the form open.
   */
  const saveAs = async (values) => {
    if (!activeName) throw new Error("No active project");
    if (dirty) {
      const ok = await confirm({
        title: "Save current changes first?",
        message: `To include your unsaved changes, they are saved into "${activeName}" first (its previous state stays available in Version history), then copied to "${values.name}".`,
        tone: "warning",
        confirmLabel: "Save & continue",
      });
      if (!ok) return;
      await projectsApi.save();
    }
    const active = projects.find((p) => p.name === activeName);
    await projectsApi.copy(activeName, {
      name: values.name,
      owner: values.owner || active?.owner || "Nextup",
      description: values.description || active?.description || "",
    });
    try {
      await projectsApi.load(values.name);
      toast.success(`Saved as "${values.name}" and loaded`);
    } catch (err) {
      toast.error(errorMessage(err), { title: `"${values.name}" was created but could not be loaded` });
    } finally {
      afterActiveChange();
    }
  };

  const rename = (project) =>
    run("rename", async () => {
      const isActive = project.name === activeName;
      if (isActive && !guardIdle("rename the active project")) return;
      const newName = await prompt({
        title: "Rename project",
        message: isActive ? "This is the active project; it is reloaded under the new name." : undefined,
        label: "New name",
        defaultValue: project.name,
      });
      if (!newName || newName === project.name) return;
      const invalid = validateName(newName, projects);
      if (invalid) return toast.error(invalid);
      try {
        if (isActive && dirty) {
          const ok = await confirm({
            title: "Save changes first?",
            message: `"${project.name}" has unsaved changes. They must be saved before the project can be renamed.`,
            tone: "warning",
            confirmLabel: "Save & rename",
          });
          if (!ok) return;
          await projectsApi.save();
        }
        await projectsApi.rename(project.name, newName);
        toast.success(`Renamed to "${newName}"`);
        if (isActive) await projectsApi.load(newName);
      } catch (err) {
        toast.error(errorMessage(err), { title: "Rename failed" });
      } finally {
        if (isActive) afterActiveChange();
        else invalidate.projects();
      }
    });

  const remove = (project) =>
    run("delete", async () => {
      if (project.name === activeName) return toast.error("The active project cannot be deleted. Load another project first.");
      const ok = await confirm({
        title: "Delete project?",
        message: `"${project.name}", all its points, programs and settings and all its saved versions are deleted permanently. This cannot be undone.`,
        tone: "danger",
        confirmLabel: "Delete project",
      });
      if (!ok) return;
      try {
        await projectsApi.remove(project.name);
        toast.success(`"${project.name}" deleted`);
      } catch (err) {
        toast.error(errorMessage(err), { title: "Delete failed" });
      } finally {
        invalidate.projects();
      }
    });

  /** Restore a backup snapshot into the runtime (and make that project active). Returns true when done. */
  const restore = (project, version) =>
    run("restore", async () => {
      const isActive = project.name === activeName;
      if (!(await readyToSwitch(project.name))) return false;
      const lines = [
        `Replace the working copy with "${project.name}" as it was before version ${version.project_version || "?"} was saved (${formatDate(version.saved_at)}).`,
      ];
      if (!isActive) lines.push(`"${project.name}" becomes the active project.`);
      if (dirty && activeName) lines.push(`Unsaved changes in "${activeName}" are lost.`);
      lines.push("The restored state counts as unsaved: save it to keep it.");
      const ok = await confirm({ title: "Restore this version?", message: lines.join("\n\n"), tone: "danger", confirmLabel: "Restore" });
      if (!ok) return false;
      try {
        await projectsApi.restore(project.name, version.id);
        toast.success(`Restored "${project.name}"`, { title: "Save the project to keep the restored state" });
        return true;
      } catch (err) {
        toast.error(errorMessage(err), { title: "Restore failed" });
        return false;
      } finally {
        afterActiveChange();
      }
    });

  return { busy, load, save, autoSave, discardChanges, create, createQuick, copy, saveAs, rename, remove, restore };
}
