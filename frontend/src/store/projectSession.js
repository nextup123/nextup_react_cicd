// Live project session (unsaved-changes state) and autosave, run by the shell
// on every page, as the always-loaded project iframe did before.
import { useEffect, useRef } from "react";
import { create } from "zustand";
import { api, errorMessage } from "../lib/api";
import { invalidate, useActiveProject, useProjects } from "../lib/queries";
import { toast } from "./toast";

const AUTOSAVE_KEY = "nextup.projects.autosave";
const AUTOSAVE_MS = 10_000;

function readAutosave() {
  try {
    return localStorage.getItem(AUTOSAVE_KEY) !== "0";
  } catch {
    return true;
  }
}

export const useProjectSession = create(() => ({
  connected: false,
  states: {}, // { [project]: { state: "DIRTY" | "ACTIVE", reason, at } }
  autosave: readAutosave(),
}));

export function setAutosave(on) {
  try {
    localStorage.setItem(AUTOSAVE_KEY, on ? "1" : "0");
  } catch {
    /* ignore */
  }
  useProjectSession.setState({ autosave: on });
}

/** True when the active project has unsaved changes (stream first, list as fallback). */
export function useIsDirty() {
  const { data: active } = useActiveProject();
  const { data: list } = useProjects();
  const name = active?.active_project;
  const streamState = useProjectSession((s) => (name ? s.states[name]?.state : null));
  if (!name) return false;
  if (streamState) return streamState === "DIRTY";
  return list?.projects?.find((p) => p.name === name)?.state === "DIRTY";
}

let saving = false;
/** Shared by the shell's autosave and the Projects page; skips while a save is running. */
export async function autoSaveProject(name) {
  if (saving || !name) return;
  saving = true;
  try {
    const res = await api.post("/api/projects/save", { auto: true });
    if (!res?.skipped) toast.success("Project auto-saved", { duration: 2000 });
  } catch (err) {
    toast.error(errorMessage(err), { title: "Auto-save failed" });
  } finally {
    saving = false;
    invalidate.projects();
  }
}

/** Mount once (AppShell): SSE stream of the session state + autosave timer. */
export function useProjectSessionRunner() {
  const { data: active } = useActiveProject();
  const activeName = active?.active_project || null;
  const activeRef = useRef(activeName);
  activeRef.current = activeName;
  const dirty = useIsDirty();
  const autosave = useProjectSession((s) => s.autosave);

  useEffect(() => {
    if (typeof EventSource === "undefined") return undefined;
    const es = new EventSource("/api/status/stream");
    es.onopen = () => useProjectSession.setState({ connected: true });
    es.onerror = () => useProjectSession.setState({ connected: false });
    es.onmessage = (event) => {
      let data;
      try {
        data = JSON.parse(event.data);
      } catch {
        return;
      }
      if (!data?.project) return;
      const s = useProjectSession.getState();
      useProjectSession.setState({
        connected: true,
        states: { ...s.states, [data.project]: { state: String(data.state || "").toUpperCase(), reason: data.reason, at: Date.now() } },
      });
      // Another browser loaded a different project: every page's data is stale.
      if (activeRef.current && data.project !== activeRef.current && data.reason === "init") invalidate.all();
    };
    return () => es.close();
  }, []);

  useEffect(() => {
    if (!autosave || !dirty || !activeName) return undefined;
    const id = setInterval(() => autoSaveProject(activeName), AUTOSAVE_MS);
    return () => clearInterval(id);
  }, [autosave, dirty, activeName]);
}
