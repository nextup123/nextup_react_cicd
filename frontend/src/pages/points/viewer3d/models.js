// Robot models for the 3D view: the list comes from the robot (every
// description in its urdf folder), the choice is saved on the robot and
// announced to every browser (WS ROBOT_MODEL), and the simulator follows it.
import { create } from "zustand";
import { subscribe } from "../../../lib/ws";
import { plainText } from "../../../lib/plainText";
import { fetchRetry } from "../../../lib/retry";

export const useRobotModels = create(() => ({ list: [], selected: null, rosModel: null, dir: "", model: null, loading: false, error: null }));

// reads are tried again while the server starts (a PUT is sent once)
const get = (url, init) =>
  (!init?.method || init.method === "GET" ? fetchRetry(url, init) : fetch(url, init)).then(async (r) => {
    const body = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(plainText(body.message) || `HTTP ${r.status}`);
    return body;
  });

let loadingId = null;
async function loadModel(id) {
  if (!id) return;
  loadingId = id;
  useRobotModels.setState({ loading: true, error: null });
  try {
    const model = await get(`/robot-models/model/${encodeURIComponent(id)}`);
    if (loadingId !== id) return;
    useRobotModels.setState({ model, loading: false });
  } catch (err) {
    if (loadingId === id) useRobotModels.setState({ loading: false, error: err.message });
  }
}

/** Reads the list again (new files in the robot's urdf folder appear here). */
export async function refreshModels() {
  try {
    const r = await get("/robot-models");
    const cur = useRobotModels.getState();
    useRobotModels.setState({ list: r.models || [], selected: r.selected, rosModel: r.rosModel, dir: r.dir, error: r.models?.length ? null : "No robot model found on the robot PC" });
    if (r.selected && (r.selected !== cur.model?.id || !cur.model)) loadModel(r.selected);
  } catch (err) {
    useRobotModels.setState({ error: `Robot models: ${err.message}` });
  }
}

export async function chooseModel(id) {
  const prev = useRobotModels.getState().selected;
  useRobotModels.setState({ selected: id });
  try {
    await get("/robot-models/selected", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
    loadModel(id);
    return true;
  } catch (err) {
    useRobotModels.setState({ selected: prev, error: err.message });
    return false;
  }
}

let wired = false;
/** Follow selections made in other browsers (and model file changes). */
export function wireModelUpdates() {
  if (wired) return;
  wired = true;
  subscribe("ROBOT_MODEL", (p) => {
    const cur = useRobotModels.getState();
    if (!p?.id) return;
    if (p.id !== cur.model?.id || p.stamp !== cur.model?.stamp) {
      useRobotModels.setState({ selected: p.id });
      loadModel(p.id);
    }
  });
}
