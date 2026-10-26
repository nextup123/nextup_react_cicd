/**
 * Every HTTP call of the drive tools (backend/ethercat, mounted at /ecat-api). Writes to the
 * drives wait while the robot program runs or the robot moves: the browser checks first
 * (lib/interlock.js, same popup as the rest of NextUp) and the server checks again (409
 * ROBOT_BUSY). Software update calls are in updateApi.js (/update-api).
 */
import { guardRequest, onServerBusy } from '../../lib/interlock';
import { noteServerDown, noteServerUp } from '../../lib/serverHealth';

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

const BASE = '/ecat-api';

export async function request(method, path, body, { timeout = 20000, signal, base = BASE } = {}) {
  if (method !== 'GET') guardRequest(method, `${base}${path}`, body);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  const onAbort = () => ctrl.abort();
  signal?.addEventListener('abort', onAbort);

  let res;
  try {
    res = await fetch(`${base}${path}`, {
      method,
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new ApiError(signal?.aborted ? 'Request cancelled' : `Request timed out after ${timeout / 1000}s`, 0);
    }
    noteServerDown();
    throw new ApiError('Cannot reach the robot server', 0);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }

  if (res.status >= 502 && res.status <= 504) noteServerDown(); else noteServerUp();
  let data = null;
  try { data = await res.json(); } catch { /* empty / non-JSON body */ }
  if (res.status === 409 && data?.code === 'ROBOT_BUSY') onServerBusy(data);

  // SDO-style endpoints answer errors as { success:false, ... } — hand
  // those back so the caller can show the drive's message.
  if (!res.ok && !(data && typeof data === 'object' && 'success' in data)) {
    throw new ApiError(data?.error || data?.message || `HTTP ${res.status}`, res.status);
  }
  return data;
}

const get = (p, o) => request('GET', p, undefined, o);
const post = (p, b, o) => request('POST', p, b ?? {}, o);
const put = (p, b, o) => request('PUT', p, b, o);
const patch = (p, b, o) => request('PATCH', p, b, o);

export const api = {
  health: () => get('/health', { timeout: 4000 }),
  verifyPassword: (password) => post('/auth/verify', { password }),

  slaves: (master = 0) => get(`/slaves?master=${master}`, { timeout: 15000 }),

  sdoGet: (payload, opts) => post('/sdo/get', payload, opts),
  sdoSet: (payload, opts) => post('/sdo/set', payload, opts),
  resetDrive: (master_id, slave_position) => post('/reset', { master_id, slave_position }),
  readFaultSlot: (master_id, slave_position, slot, opts) => post('/faults/read-slot', { master_id, slave_position, slot }, opts),

  presets: () => get('/presets'),
  faultDb: () => get('/fault'),
  driverConfig: () => get('/driver-config'),
  parameterCatalog: () => get('/parameter-catalog'),
  saveDriverDefault: (index, subindex, defaultValue) => patch('/driver-config', { index, subindex, defaultValue }),
  saveDriverConfig: (registers) => put('/driver-config', { registers }),

  recipes: () => get('/recipes'),
  saveRecipes: (data) => put('/recipes', data),
  markRecipeExecuted: (id) => post(`/recipes/${encodeURIComponent(id)}/executed`),

  driveProfiles: () => get('/drive-profiles'),
  saveDriveProfiles: (drives) => put('/drive-profiles', { drives }),

  history: (limit = 200) => get(`/history?limit=${limit}`),
  addHistory: (entry) => post('/history', entry),

  saveErrorLog: (snapshot) => post('/error-log', snapshot, { timeout: 30000 }),
  activity: (id, what, active) => post('/activity', { id, what, active }),

  nodeStart: (password, node_name, package_name) => post('/node/start', { password, node_name, package_name }, { timeout: 15000 }),
  nodeStop: () => post('/node/stop'),
};

/** Cache read-only reference data (presets, fault DB) for the session. */
const cache = new Map();
export function cached(key, loader) {
  if (!cache.has(key)) {
    const p = loader().catch((err) => { cache.delete(key); throw err; });
    cache.set(key, p);
  }
  return cache.get(key);
}
