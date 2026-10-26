// One HTTP client for the whole app; every path is relative to the page origin.
import { tutSignal } from "../../../tutorial/bus";
import { guardRequest, onServerBusy } from "../../../lib/interlock";
import { noteServerDown, noteServerUp } from "../../../lib/serverHealth";
import { RETRY_DELAYS, isTransientStatus, wait } from "../../../lib/retry";
export class ApiError extends Error {
  constructor(message, status, data) { super(message); this.status = status; this.data = data; }
}
// reads are tried again while the server starts or restarts (the page gets its data, not an error)
async function request(method, path, body) {
  const delays = method === "GET" ? RETRY_DELAYS : [];
  for (let i = 0; ; i++) {
    try { return await requestOnce(method, path, body); }
    catch (err) { if (i >= delays.length || !isTransientStatus(err?.status ?? -1)) throw err; await wait(delays[i]); }
  }
}
async function requestOnce(method, path, body) {
  if (method !== "GET") guardRequest(method, path, body); // nothing that takes effect mid-cycle while the robot works
  const opts = { method, headers: {} };
  if (body !== undefined) { opts.headers["Content-Type"] = "application/json"; opts.body = JSON.stringify(body); }
  let res;
  try { res = await fetch(path, opts); } catch { noteServerDown(); throw new ApiError("Cannot reach the robot server", 0); }
  if (res.status >= 502 && res.status <= 504) noteServerDown(); else noteServerUp();
  const type = res.headers.get("content-type") || "";
  const data = type.includes("application/json") ? await res.json().catch(() => null) : await res.text();
  if (res.status === 409 && data?.code === "ROBOT_BUSY") onServerBusy(data);
  if (!res.ok) throw new ApiError((data && (data.message || data.error)) || `${res.status} ${res.statusText}`, res.status, data);
  tutSignal(`api:${method} ${path}`, { body, data }); // lessons wait for these
  return data;
}
export const api = {
  get: (p) => request("GET", p),
  post: (p, b) => request("POST", p, b ?? {}),
  put: (p, b) => request("PUT", p, b ?? {}),
  del: (p) => request("DELETE", p),
};

export const programsApi = {
  list: () => api.get("/plc-api/programs"),
  examples: () => api.get("/plc-api/programs/examples"),
  read: (name) => api.get(`/plc-api/programs/${encodeURIComponent(name)}`),
  save: (name, text) => api.put(`/plc-api/programs/${encodeURIComponent(name)}`, { text }),
  rename: (name, to) => api.post(`/plc-api/programs/${encodeURIComponent(name)}/rename`, { to }),
  remove: (name) => api.del(`/plc-api/programs/${encodeURIComponent(name)}`),
  check: (text, name) => api.post("/plc-api/programs/check", { text, name }),
  describe: (text, name) => api.post("/plc-api/programs/describe", { text, name }),
  load: (name) => api.post("/plc-api/programs/load", name ? { name } : {}),
  /** Copy a library program over this project's program (the one the PLC runs for this project). */
  useInProject: (name) => api.post(`/plc-api/programs/${encodeURIComponent(name)}/use`),
  /** Keep this project's program in the library under a name. */
  toLibrary: (to, overwrite = false) => api.post("/plc-api/programs/@project/to-library", { to, overwrite }),
};
export const plcApi = {
  status: () => api.get("/plc-api/plc/status"),
  events: () => api.get("/plc-api/plc/events"),
  setBits: (name, value, pulse_ms) => api.post("/plc-api/plc/set-bits", { name, value, pulse_ms }),
  getBits: (name) => api.post("/plc-api/plc/get-bits", { name }),
  force: (name, value, release = false) => api.post("/plc-api/plc/force", { name, value, release }),
  releaseAll: () => api.post("/plc-api/plc/release-all"),
  resetFault: () => api.post("/plc-api/plc/reset-fault"),
  reload: () => api.post("/plc-api/plc/load", { path: "" }),
  simInput: (name, value, pulse_ms) => api.post("/plc-api/plc/sim/input", { name, value, pulse_ms }),
  simSupervisor: (cmd, value) => api.post("/plc-api/plc/sim/supervisor", { cmd, value }),
  simInputsStale: (stale) => api.post("/plc-api/plc/sim/inputs-stale", { stale }),
};
export const blocksApi = {
  list: () => api.get("/plc-api/blocks"),
  save: (name, text) => api.put(`/plc-api/blocks/${encodeURIComponent(name)}`, { text }),
  remove: (name) => api.del(`/plc-api/blocks/${encodeURIComponent(name)}`),
};
export const simApi = {
  scenarios: () => api.get("/plc-api/sim/scenarios"),
  read: (name) => api.get(`/plc-api/sim/scenarios/${encodeURIComponent(name)}`),
  save: (name, text) => api.put(`/plc-api/sim/scenarios/${encodeURIComponent(name)}`, { text }),
  remove: (name) => api.del(`/plc-api/sim/scenarios/${encodeURIComponent(name)}`),
  run: (program, name, scenario, csv = false) => api.post("/plc-api/sim/run", { program, name, scenario, csv }),
};
export const docsApi = {
  list: () => api.get("/plc-api/docs"),
  read: (name) => api.get(`/plc-api/docs/${encodeURIComponent(name)}`),
};
export const systemApi = {
  mode: () => api.get("/plc-api/system/mode"),
  setMode: (mode) => api.post("/plc-api/system/mode", { mode }),
};
