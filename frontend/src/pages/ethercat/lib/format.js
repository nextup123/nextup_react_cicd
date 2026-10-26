export const MASTER_ID = 0;

export const DATA_TYPES = ['int8', 'int16', 'int32', 'int64', 'uint8', 'uint16', 'uint32', 'uint64', 'float', 'double', 'string'];

const INT_RANGES = {
  int8: [-128, 127], int16: [-32768, 32767], int32: [-2147483648, 2147483647],
  uint8: [0, 255], uint16: [0, 65535], uint32: [0, 4294967295],
  int64: [Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER], uint64: [0, Number.MAX_SAFE_INTEGER],
};

/** "Uint16" / "String" / undefined → "uint16" / "string" / fallback */
export function normDtype(t, fallback = 'uint16') {
  const s = String(t ?? '').trim().toLowerCase();
  return DATA_TYPES.includes(s) ? s : fallback;
}

/** Parse "0x6040", "6040h" (hex) or "24640" (decimal). Returns NaN when invalid. */
export function parseIndexInput(str) {
  const s = String(str ?? '').trim();
  if (!s) return NaN;
  if (/^0x[0-9a-f]+$/i.test(s)) return parseInt(s, 16);
  if (/^[0-9a-f]+h$/i.test(s)) return parseInt(s.slice(0, -1), 16);
  if (/^\d+$/.test(s)) return parseInt(s, 10);
  return NaN;
}

/** Register-table notation ("2005h") → number */
export function parseRegHex(str) {
  return parseIndexInput(/^[0-9a-f]+$/i.test(String(str ?? '').trim()) ? `${str}h` : str);
}

export function hex(n, width = 4) {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return '—';
  return '0x' + Number(n).toString(16).toUpperCase().padStart(width, '0');
}

/** "2005h" → "0x2005", "1Fh" → "0x1F" */
export function regLabel(str, width = 4) {
  const n = parseRegHex(str);
  return Number.isNaN(n) ? String(str) : hex(n, width);
}

/** Validate a value for an SDO write of the given type. Returns an error string or null. */
export function validateValue(raw, dtype) {
  const s = String(raw ?? '').trim();
  if (s === '') return 'Value required';
  const t = normDtype(dtype);
  if (t === 'string') return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return 'Not a number';
  if (t === 'float' || t === 'double') return null;
  if (!Number.isInteger(n)) return 'Must be a whole number';
  const [min, max] = INT_RANGES[t] || [];
  if (min !== undefined && (n < min || n > max)) return `Out of range for ${t} (${min}…${max})`;
  return null;
}

export function jointLabel(position) {
  return `J${Number(position) + 1}`;
}

export function stateTone(state) {
  const s = String(state || '').toUpperCase();
  if (s === 'OP') return 'ok';
  if (['PREOP', 'SAFEOP', 'INIT', 'BOOT'].includes(s)) return 'warn';
  if (s.includes('ERR')) return 'danger';
  return 'neutral';
}

// Plain names for EtherCAT states; the raw state stays in tooltips.
const STATE_WORDS = { OP: 'Ready', SAFEOP: 'Safe mode', PREOP: 'Starting', INIT: 'Not ready', BOOT: 'Updating' };
export function stateLabel(state) {
  const s = String(state || '').toUpperCase().replace(/[^A-Z]/g, '');
  return STATE_WORDS[s] || (s.includes('ERR') ? 'Error' : state || 'Unknown');
}

export function formatDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function formatDateTime(iso) {
  if (!iso) return 'Never';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function timeNow() {
  return new Date().toLocaleTimeString('en-GB', { hour12: false });
}

export function uid(prefix = 'id') {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

export const sleep = (ms, signal) => new Promise((resolve) => {
  if (signal?.aborted) return resolve();
  const t = setTimeout(resolve, ms);
  signal?.addEventListener('abort', () => { clearTimeout(t); resolve(); }, { once: true });
});

export function plural(n, word, pluralWord = `${word}s`) {
  return `${n} ${n === 1 ? word : pluralWord}`;
}
