// One HTTP client for the whole app. All paths are relative to the page
// origin, so the UI works from any machine on the network (the old pages
// hard-coded http://localhost:3000 and broke when opened remotely).

import { plainText } from "./plainText";
import { tutSignal } from "../tutorial/bus";
import { guardRequest, onServerBusy } from "./interlock";
import { noteServerDown, noteServerUp } from "./serverHealth";
import { RETRY_DELAYS, isTransientStatus, wait } from "./retry";

export class ApiError extends Error {
  constructor(message, status, data) {
    super(plainText(message));
    this.status = status;
    this.data = data;
  }
}

// Reads are tried again on a network error or a 5xx (server starting / restarting), so a page
// gets all its data instead of an error; pass { retry: false } for polls that come back anyway.
async function request(method, path, body, opts = {}) {
  const delays = method === "GET" && opts.retry !== false ? RETRY_DELAYS : [];
  for (let i = 0; ; i++) {
    try {
      return await requestOnce(method, path, body, opts);
    } catch (err) {
      if (err?.name === "AbortError" || i >= delays.length || !isTransientStatus(err?.status ?? -1)) throw err;
      await wait(delays[i], opts.signal);
    }
  }
}

async function requestOnce(method, path, body, { raw = false, signal } = {}) {
  // a change the running cycle would pick up waits until the robot is idle (popup, no request)
  if (method !== "GET") guardRequest(method, path, body);
  const opts = { method, headers: {}, signal };
  if (body !== undefined) {
    if (body instanceof FormData) {
      opts.body = body;
    } else {
      opts.headers["Content-Type"] = "application/json";
      opts.body = JSON.stringify(body);
    }
  }

  let res;
  try {
    res = await fetch(path, opts);
  } catch (err) {
    if (err.name === "AbortError") throw err;
    noteServerDown();
    throw new ApiError("Cannot reach the robot server", 0);
  }
  if (res.status === 502 || res.status === 503 || res.status === 504) noteServerDown();
  else noteServerUp();

  const type = res.headers.get("content-type") || "";
  let data;
  if (raw) data = await res.text();
  else if (type.includes("application/json")) data = await res.json().catch(() => null);
  else data = await res.text();

  if (!res.ok) {
    if (res.status === 409 && data?.code === "ROBOT_BUSY") onServerBusy(data);
    const msg =
      (data && typeof data === "object" && (data.message || data.error || data.details)) ||
      (typeof data === "string" && data.length < 300 && data) ||
      `Request failed (${res.status})`;
    throw new ApiError(msg, res.status, data);
  }
  tutSignal(`api:${method} ${path}`, { body, data });
  return data;
}

export const api = {
  get: (path, opts) => request("GET", path, undefined, opts),
  post: (path, body = {}, opts) => request("POST", path, body, opts),
  put: (path, body = {}, opts) => request("PUT", path, body, opts),
  del: (path, body, opts) => request("DELETE", path, body, opts),
  text: (path, opts) => request("GET", path, undefined, { ...opts, raw: true }),
};

export function errorMessage(err, fallback = "Something went wrong") {
  if (!err) return fallback;
  if (typeof err === "string") return err;
  return err.message || fallback;
}
