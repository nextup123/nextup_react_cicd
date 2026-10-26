// backend/ros/recordFiles.js
//
// Robot record files in error_container, read straight from disk so every
// field the nodes write reaches the UI. The services (get_event_log,
// get_error_log, get_io_log) answer with a fixed message that drops the
// extra fields (request_id, cause, file, last_error, previous_error, ...).
//
// Every file is a crash-safe YAML list with one entry per line:
//   "  - {time: ..., joint: joint2, last_error: 3592, code_hex: 0x0E08, ...}"
// Lines are parsed with the JSON schema so hex texts (0x0E08, 0x1637) stay
// text and times stay text.

import fsp from 'fs/promises';
import path from 'path';
import yaml from 'js-yaml';
import { PHASE } from './interfaces.js';

const LINE = /^\s*-\s*\{/;

export const RECORD_FILES = Object.freeze({
  events: 'event_logs.yaml',
  errors: 'error_logs.yaml',
  io: 'io_logs.yaml',
  motions: 'motion_logs.yaml',
  ioWatch: 'io_watch.yaml',
  codes: 'error_codes.yaml',
  counters: 'fault_counters.yaml',
});

const parseLine = (line) => {
  try {
    const d = yaml.load(line, { schema: yaml.JSON_SCHEMA });
    return Array.isArray(d) && d[0] && typeof d[0] === 'object' ? d[0] : null;
  } catch {
    return null; // a half-written last line after a power cut
  }
};

/**
 * Newest-first entries of one record file, or null when the file is not there.
 * filter(entry) keeps an entry; max caps the answer (the total is the whole file).
 */
export async function readRecordFile(file, { max = 300, filter } = {}) {
  let text;
  try {
    text = await fsp.readFile(file, 'utf8');
  } catch {
    return null;
  }
  const lines = text.split('\n').filter((l) => LINE.test(l));
  const entries = [];
  for (let i = lines.length - 1; i >= 0 && entries.length < max; i--) {
    const e = parseLine(lines[i]);
    if (e && (!filter || filter(e))) entries.push(e);
  }
  return { entries, total: lines.length };
}

/* ───────────── error code table (error_codes.yaml) ───────────── */

let codeCache = { file: '', mtime: 0, table: null };

/** { default: { "0x0E08": "text" }, <joint or drive section>: {...} } or null. */
export async function codeTable(dir) {
  const file = path.join(dir, RECORD_FILES.codes);
  try {
    const st = await fsp.stat(file);
    if (codeCache.file === file && codeCache.mtime === st.mtimeMs) return codeCache.table;
    const doc = yaml.load(await fsp.readFile(file, 'utf8'), { schema: yaml.JSON_SCHEMA }) || {};
    const table = {};
    for (const [section, map] of Object.entries(doc)) {
      if (!map || typeof map !== 'object') continue;
      table[section] = {};
      for (const [k, v] of Object.entries(map)) table[section][normHex(k)] = String(v);
    }
    codeCache = { file, mtime: st.mtimeMs, table };
    return table;
  } catch {
    return null;
  }
}

export function normHex(v) {
  if (v === undefined || v === null || v === '') return '';
  const s = String(v).trim();
  const n = /^0x[0-9a-f]+$/i.test(s) ? parseInt(s, 16) : /^\d+$/.test(s) ? Number(s) : NaN;
  if (!Number.isFinite(n)) return s;
  return `0x${n.toString(16).toUpperCase().padStart(4, '0')}`;
}

const hexToNum = (h) => (h && /^0x[0-9a-f]+$/i.test(h) ? parseInt(h, 16) : 0);

export function describeCode(table, hex, joint) {
  if (!table || !hex || hex === '0x0000') return '';
  return table[joint]?.[hex] || table.default?.[hex] || '';
}

/* ───────────── one record → the UI's shape ───────────── */

const COMMON = ['time', 'stamp', 'source', 'joint', 'event', 'detail', 'profile', 'phase', 'count', 'description', 'state', 'statusword', 'mode'];
const KNOWN = {
  events: new Set([...COMMON, 'code_hex', 'previous_code']),
  errors: new Set([...COMMON, 'code', 'code_hex', 'last_error', 'previous_error', 'previous_code']),
  io: new Set(['time', 'stamp', 'source', 'signal', 'event', 'device', 'input', 'bit', 'value', 'was_for_s', 'count', 'positions_deg', 'profile', 'phase', 'detail']),
  motions: new Set(['time', 'stamp', 'kind', 'event', 'motion_id', 'target', 'motion_type', 'planner', 'dry_run', 'speed_mps', 'acceleration_mps2', 'speed_scale', 'duration_s', 'detail', 'code', 'error']),
};

const toNum = (v, d = 0) => {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'bigint') return Number(v);
  if (typeof v === 'string' && /^0x[0-9a-f]+$/i.test(v)) return parseInt(v, 16);
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  return d;
};
const empty = (v) => v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length);
const plainValue = (v) => (typeof v === 'bigint' ? Number(v) : Array.isArray(v) || ArrayBuffer.isView(v) ? Array.from(v, plainValue) : v);

/** stamp: a ROS Time {sec, nanosec} (service) or float seconds (file) → ms. */
function stampMs(s) {
  if (s && typeof s === 'object') {
    const sec = toNum(s.sec);
    return sec ? sec * 1000 + Math.round(toNum(s.nanosec) / 1e6) : null;
  }
  const n = toNum(s);
  return n ? Math.round(n * 1000) : null;
}

const phaseText = (p) => (typeof p === 'number' ? PHASE[p] || `phase ${p}` : p || '');
const hexText = (v) => (empty(v) ? '' : typeof v === 'string' && /^0x/i.test(v) ? v.toUpperCase().replace(/^0X/, '0x') : normHex(v));

/**
 * Normalise a record from either a file line or a service message.
 * Known fields get names the UI reads; everything else lands in `extra`, and
 * `fields` keeps every field as written (for the full detail view).
 * kind: events | errors | io | motions
 */
export function recordView(kind, e, { table, fromService = false } = {}) {
  const known = KNOWN[kind] || new Set();
  const fields = {};
  const extra = {};
  for (const [k, raw] of Object.entries(e || {})) {
    const v = plainValue(raw);
    if (k === 'stamp') continue;
    // service messages carry every field; zeros and blanks there mean "not set"
    if (fromService && (empty(v) || v === 0 || v === false)) continue;
    if (empty(v)) continue;
    fields[k] = v;
    if (!known.has(k)) extra[k] = v;
  }
  const base = {
    stamp: stampMs(e?.stamp),
    time: e?.time || '',
    event: e?.event || '',
    detail: e?.detail || '',
    profile: e?.profile || '',
    phase: phaseText(e?.phase),
    extra,
    fields,
  };

  if (kind === 'io') {
    const value = e?.value;
    return {
      ...base,
      source: e?.source || '',
      signal: e?.signal || '',
      device: e?.device || '',
      input: e?.input || '',
      bit: toNum(e?.bit, null),
      value: value === true || value === 1 || value === '1' || /^(high|rising|on)$/i.test(String(e?.event || '')),
      wasFor: e?.was_for_s !== undefined ? Math.round(toNum(e.was_for_s) * 1000) / 1000 : null,
      count: toNum(e?.count, 0),
      positionsDeg: Array.from(e?.positions_deg || [], (v) => Math.round(toNum(v) * 100) / 100),
    };
  }

  if (kind === 'motions') {
    return {
      ...base,
      id: e?.motion_id || e?.id || '',
      kind: e?.kind || '',
      target: e?.target || '',
      motionType: e?.motion_type || '',
      planner: e?.planner || '',
      dryRun: Boolean(e?.dry_run),
      speed: e?.speed_mps !== undefined ? toNum(e.speed_mps) : null,
      acceleration: e?.acceleration_mps2 !== undefined ? toNum(e.acceleration_mps2) : null,
      speedScale: e?.speed_scale !== undefined ? toNum(e.speed_scale) : null,
      durationS: e?.duration_s !== undefined ? Math.round(toNum(e.duration_s) * 1000) / 1000 : null,
      state: e?.state || e?.event || '',
      code: toNum(e?.code, 0),
      error: e?.error || '',
      message: e?.message || e?.detail || '',
    };
  }

  // events / errors (NextupErrorEvent and the YAML lines)
  const joint = e?.joint || '';
  const out = {
    ...base,
    source: e?.source || '',
    joint,
    state: e?.state || '',
    statusword: empty(e?.statusword) || (fromService && !toNum(e.statusword)) ? '' : hexText(e.statusword),
    mode: empty(e?.mode) || (fromService && !toNum(e.mode)) ? null : toNum(e.mode, null),
    count: toNum(e?.count, 1) || 1,
    description: e?.description || '',
  };
  if (kind === 'errors') {
    const codeHex = hexText(e?.code_hex) || (empty(e?.last_error ?? e?.code) ? '' : normHex(toNum(e.last_error ?? e.code)));
    const lastError = !empty(e?.last_error) ? toNum(e.last_error) : !empty(e?.code) ? toNum(e.code) : hexToNum(codeHex);
    const prev = e?.previous_error ?? e?.previous_code;
    const previousError = empty(prev) ? 0 : toNum(prev);
    const previousHex = previousError ? normHex(previousError) : '';
    Object.assign(out, {
      lastError,
      code: lastError,
      codeHex: lastError ? codeHex || normHex(lastError) : codeHex,
      previousError,
      previousHex,
      description: out.description || describeCode(table, codeHex, joint),
      previousDescription: previousError ? describeCode(table, previousHex, joint) : '',
    });
  } else {
    // supervisor events: `code` is the emergency cause id, kept with the other extras
    out.code = 0;
    out.codeHex = '';
  }
  return out;
}

/** Filter for file entries, same meaning as the service query. */
export function recordFilter({ joint = '', signal = '', event = '', sinceSeconds = 0 } = {}) {
  const since = sinceSeconds > 0 ? Date.now() / 1000 - sinceSeconds : 0;
  if (!joint && !signal && !event && !since) return undefined;
  return (e) =>
    (!joint || e.joint === joint) &&
    (!signal || e.signal === signal) &&
    (!event || String(e.event).toLowerCase() === String(event).toLowerCase()) &&
    (!since || toNum(e.stamp) >= since);
}

/** io_watch.yaml → [{ name, device, input, logRising, logFalling, debounceMs }] or null. */
export async function readIoWatchFile(dir) {
  const file = path.join(dir, RECORD_FILES.ioWatch);
  try {
    const doc = yaml.load(await fsp.readFile(file, 'utf8'), { schema: yaml.JSON_SCHEMA }) || {};
    const list = Array.isArray(doc.signals) ? doc.signals : Array.isArray(doc) ? doc : [];
    return {
      file,
      signals: list.filter((s) => s && s.name).map((s) => ({
        name: String(s.name),
        device: String(s.device || ''),
        input: String(s.input || ''),
        logRising: s.log_rising !== false,
        logFalling: s.log_falling !== false,
        debounceMs: toNum(s.debounce_ms, 0),
        level: -1,
      })),
    };
  } catch {
    return null;
  }
}

/* ───────────── black box CSV ───────────── */

/** The "# key: value" header of a black-box file (first lines only). */
export async function blackboxHeader(file) {
  let fh;
  try {
    fh = await fsp.open(file, 'r');
    const buf = Buffer.alloc(4096);
    const { bytesRead } = await fh.read(buf, 0, buf.length, 0);
    const text = buf.subarray(0, bytesRead).toString('utf8');
    const meta = {};
    let columns = [];
    for (const line of text.split('\n')) {
      if (line.startsWith('#')) {
        const m = /^#\s*([a-z_ ]+?):\s*(.*)$/i.exec(line);
        if (m) meta[m[1].trim().toLowerCase().replace(/\s+/g, '_')] = m[2].trim();
        else if (!meta.title) meta.title = line.replace(/^#\s*/, '').trim();
      } else if (line.trim()) {
        columns = line.trim().split(',');
        break;
      }
    }
    return { meta, columns };
  } catch {
    return { meta: {}, columns: [] };
  } finally {
    await fh?.close();
  }
}

/** blackbox_2026-10-13_18-40-26_drive_left_operation_enabled_joint1.csv → parts. */
export function blackboxName(f) {
  const m = /^blackbox_(\d{4}-?\d{2}-?\d{2})[_T](\d{2}-?\d{2}-?\d{2})_(.+)\.csv$/i.exec(f);
  if (!m) return { slug: '', joint: '', time: '' };
  const d = m[1].replace(/^(\d{4})(\d{2})(\d{2})$/, '$1-$2-$3');
  const t = m[2].replace(/-/g, ':').replace(/^(\d{2})(\d{2})(\d{2})$/, '$1:$2:$3');
  const slug = m[3];
  const j = /(?:^|_)(joint\d+)$/i.exec(slug);
  return { slug, joint: j ? j[1] : '', time: `${d} ${t}` };
}
