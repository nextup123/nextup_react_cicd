// Black-box CSV helpers: parse the supervisor's recording (comment header,
// columns, rows), describe the columns, decode drive status words, find the
// moments something changed, and write the CSV back out.

export const GROUPS = {
  q: { label: "Position", long: "Joint position (actual)", unit: "rad", angle: true },
  qd: { label: "Velocity", long: "Joint velocity (actual)", unit: "rad/s", angle: true },
  pos_ref: { label: "Position cmd", long: "Position command from the trajectory (empty = no command)", unit: "rad", angle: true },
  pos_out: { label: "Position out", long: "Position written to the drive", unit: "rad", angle: true },
  jog_ref: { label: "Jog cmd", long: "Jog command (empty = no command)", unit: "jog" },
  jog_out: { label: "Jog out", long: "Jog velocity written to the drive", unit: "jog" },
  statusword: { label: "Statusword", long: "Drive status word (CiA 402 state)", lane: true },
  mode: { label: "Mode", long: "Drive mode of operation", lane: true },
  state: { label: "Supervisor", long: "Supervisor phase, profile, drive mode and flags", lane: true },
  other: { label: "Other", long: "Other columns in the file" },
};
export const LINE_GROUPS = ["q", "qd", "pos_ref", "pos_out", "jog_ref", "jog_out"];
export const STATE_COLS = ["phase", "profile", "drive_mode", "armed", "latched", "estop"];
const TIME_COLS = ["t_rel_s", "t", "time", "t_s", "stamp"];

const PHASES = { 0: "startup", 1: "running", 2: "mode change", 3: "mode change", 4: "mode change", 5: "mode change", 6: "reset", 7: "reset", 8: "reset", 9: "emergency" };
const PROFILES = { 0: "none", 1: "auto", 2: "safeauto", 3: "jog" };
const MODES = { 0: "none", 1: "PP", 3: "PV", 6: "homing", 8: "CSP", 9: "CSV", 10: "CST" };

/** CiA 402 state from a status word. */
export function cia402(sw) {
  const n = typeof sw === "number" ? sw : parseInt(String(sw), 16);
  if (!Number.isFinite(n) || n === 0) return { key: "none", text: "no data" };
  if ((n & 0x4f) === 0x08) return { key: "fault", text: "Fault" };
  if ((n & 0x4f) === 0x0f) return { key: "fault", text: "Fault reaction" };
  if ((n & 0x4f) === 0x40) return { key: "disabled", text: "Switch on disabled" };
  if ((n & 0x6f) === 0x27) return { key: "enabled", text: "Operation enabled" };
  if ((n & 0x6f) === 0x23) return { key: "on", text: "Switched on" };
  if ((n & 0x6f) === 0x21) return { key: "ready", text: "Ready to switch on" };
  if ((n & 0x6f) === 0x07) return { key: "qstop", text: "Quick stop" };
  if ((n & 0x4f) === 0x00) return { key: "none", text: "Not ready" };
  return { key: "other", text: "?" };
}

/** Label of a lane value. */
export function laneText(col, v) {
  if (v === "" || v === undefined || v === null) return "–";
  const info = columnInfo(col);
  if (info.group === "statusword") return `${v} ${cia402(v).text}`;
  const n = Number(v);
  if (col === "phase") return `${v} ${PHASES[n] || ""}`.trim();
  if (col === "profile") return `${v} ${PROFILES[n] || ""}`.trim();
  if (col === "drive_mode" || info.group === "mode") return `${v} ${MODES[n] || ""}`.trim();
  if (col === "armed" || col === "latched" || col === "estop") return n ? `${col} ON` : `${col} off`;
  return String(v);
}

/** Lane colour class of a value. */
export function laneTone(col, v) {
  const info = columnInfo(col);
  if (v === "" || v === undefined) return "none";
  if (info.group === "statusword") return cia402(v).key;
  const n = Number(v);
  if (col === "estop" || col === "latched") return n ? "fault" : "off";
  if (col === "armed") return n ? "enabled" : "off";
  if (col === "phase") return n === 9 ? "fault" : n === 1 ? "enabled" : n >= 6 ? "ready" : n >= 2 ? "on" : "off";
  if (col === "profile") return ["off", "c1", "c2", "c3"][n] || "c4";
  return `c${(Math.abs(Math.round(n)) % 5) + 1}`;
}

export function columnInfo(name) {
  const m = /^(q|qd|pos_ref|pos_out|jog_ref|jog_out|statusword|mode)_joint(\d+)$/.exec(name);
  if (m) return { group: m[1], joint: Number(m[2]) };
  if (STATE_COLS.includes(name)) return { group: "state" };
  const j = /^joint(\d+)$/.exec(name); // older files: one position column per joint
  if (j) return { group: "q", joint: Number(j[1]) };
  return { group: "other" };
}

function splitCsvLine(line) {
  if (!line.includes('"')) return line.split(",");
  const out = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

/** { metaLines, meta, columns, rows: [{ id, v: string[] }], timeCol } */
export function parseBlackbox(text) {
  const lines = String(text).replace(/\r/g, "").split("\n");
  const metaLines = [];
  const meta = {};
  let i = 0;
  for (; i < lines.length; i++) {
    const l = lines[i];
    if (l.startsWith("#")) {
      metaLines.push(l);
      const m = /^#\s*([a-z_ ]+?):\s*(.*)$/i.exec(l);
      if (m) meta[m[1].trim().toLowerCase().replace(/\s+/g, "_")] = m[2].trim();
      else if (!meta.title) meta.title = l.replace(/^#\s*/, "").trim();
      continue;
    }
    if (l.trim()) break;
  }
  const columns = i < lines.length ? splitCsvLine(lines[i].trim()) : [];
  const rows = [];
  for (let k = i + 1; k < lines.length; k++) {
    const l = lines[k];
    if (!l.trim() || l.startsWith("#")) continue;
    const v = splitCsvLine(l);
    while (v.length < columns.length) v.push("");
    rows.push({ id: rows.length, v });
  }
  const timeCol = Math.max(0, columns.findIndex((c) => TIME_COLS.includes(c.toLowerCase())));
  return { metaLines, meta, columns, rows, timeCol };
}

/** Seconds of every row (relative time, or ISO time → seconds from the first row). */
export function timesOf(rows, timeCol) {
  if (!rows.length) return [];
  const first = rows[0].v[timeCol];
  if (first !== "" && Number.isFinite(Number(first))) return rows.map((r) => Number(r.v[timeCol]));
  const t0 = Date.parse(first);
  if (Number.isFinite(t0)) return rows.map((r) => (Date.parse(r.v[timeCol]) - t0) / 1000);
  return rows.map((_, i) => i);
}

export const toNum = (s) => {
  if (s === "" || s === undefined || s === null) return NaN;
  if (/^0x[0-9a-f]+$/i.test(s)) return parseInt(s, 16);
  return Number(s);
};

/** Index of the row nearest to time t (times sorted ascending). */
export function nearest(times, t) {
  let lo = 0;
  let hi = times.length - 1;
  if (hi < 0) return -1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (times[mid] < t) lo = mid;
    else hi = mid;
  }
  return Math.abs(times[lo] - t) <= Math.abs(times[hi] - t) ? lo : hi;
}

export function lowerIndex(times, t) {
  let lo = 0;
  let hi = times.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (times[mid] < t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * Moments a state column changed (supervisor phase/flags, statusword, mode):
 * [{ i, t, col, from, to }], oldest first.
 */
export function findChanges(columns, rows, times) {
  const watch = columns.map((c, k) => ({ c, k, g: columnInfo(c).group })).filter((x) => x.g === "state" || x.g === "statusword" || x.g === "mode");
  const out = [];
  for (let i = 1; i < rows.length; i++) {
    const a = rows[i - 1].v;
    const b = rows[i].v;
    for (const w of watch) {
      if (a[w.k] !== b[w.k]) out.push({ i, t: times[i], col: w.c, from: a[w.k], to: b[w.k] });
    }
  }
  return out;
}

/** Columns that hold any value other than zero / empty (worth showing first). */
export function activeColumns(columns, rows) {
  const out = new Set();
  columns.forEach((c, k) => {
    const first = rows[0]?.v[k];
    for (const r of rows) {
      const v = r.v[k];
      if (v !== "" && v !== first) {
        out.add(c);
        return;
      }
    }
  });
  return out;
}

const csvCell = (s) => (/[",\n]/.test(s) ? `"${String(s).replace(/"/g, '""')}"` : s);

export function toCsv(doc, rows, note) {
  const head = [...doc.metaLines];
  if (note) head.push(`# ${note}`);
  return `${head.join("\n")}${head.length ? "\n" : ""}${doc.columns.map(csvCell).join(",")}\n${rows.map((r) => r.v.map(csvCell).join(",")).join("\n")}\n`;
}

/** min / max / mean / range of a numeric column over rows i0..i1. */
export function stats(rows, k, i0 = 0, i1 = rows.length - 1) {
  let min = Infinity;
  let max = -Infinity;
  let sum = 0;
  let n = 0;
  for (let i = Math.max(0, i0); i <= Math.min(rows.length - 1, i1); i++) {
    const x = toNum(rows[i].v[k]);
    if (!Number.isFinite(x)) continue;
    if (x < min) min = x;
    if (x > max) max = x;
    sum += x;
    n++;
  }
  return n ? { min, max, mean: sum / n, n } : null;
}
