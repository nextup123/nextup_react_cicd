// Parsing helpers for /logs_topic lines and error codes.

export const LEVELS = {
  info: { label: "Info", tone: undefined },
  success: { label: "Success", tone: "success" },
  warn: { label: "Warning", tone: "warning" },
  failure: { label: "Failure", tone: "danger" },
};

const TAGGED = /^\s*(\[bt\]\s*)?(?:\[(info|success|warn|failure)\]\s*)?([\s\S]*)$/i;
// Plain "ERROR | node | text" style lines (backend / simulator logs).
const WORD_LEVEL = /^\s*(ERROR|FATAL|FAIL(?:URE|ED)?|WARN(?:ING)?|SUCCESS|INFO|DEBUG)\b/i;

function wordLevel(text) {
  const m = String(text).match(WORD_LEVEL);
  if (!m) return null;
  const w = m[1].toUpperCase();
  if (w.startsWith("WARN")) return "warn";
  if (w === "SUCCESS") return "success";
  if (w === "INFO" || w === "DEBUG") return "info";
  return "failure";
}

/**
 * Normalise one log line. `raw` is the text as published on /logs_topic,
 * optionally "[bt] [level] message". `storedLevel` is the level saved by the
 * backend history (it only understands a leading [level] tag).
 */
export function parseLog(raw, storedLevel) {
  const text = String(raw ?? "");
  const m = text.match(TAGGED);
  const bt = !!m?.[1];
  const tagged = m?.[2]?.toLowerCase();
  const message = (m ? m[3] : text).trim();
  let level = tagged || (storedLevel && storedLevel !== "info" ? String(storedLevel).toLowerCase() : null) || wordLevel(message) || "info";
  if (!LEVELS[level]) level = "info";
  return { bt, level, message };
}

export function fmtClock(ms) {
  const d = new Date(ms);
  if (isNaN(d)) return "";
  return d.toLocaleTimeString("en-GB", { hour12: false });
}

export function fmtDay(ms) {
  const d = new Date(ms);
  if (isNaN(d)) return "";
  return d.toLocaleDateString(undefined, { day: "2-digit", month: "short" });
}

export const toHex = (dec) => {
  const n = Number(dec);
  if (!Number.isFinite(n)) return String(dec ?? "");
  return n.toString(16).toUpperCase().padStart(2, "0");
};

/** Split text into [{text, hit}] for highlighting `term` (case-insensitive). */
export function highlightParts(text, term) {
  const s = String(text ?? "");
  if (!term) return [{ text: s, hit: false }];
  const out = [];
  const lower = s.toLowerCase();
  const t = term.toLowerCase();
  let i = 0;
  while (i < s.length) {
    const j = lower.indexOf(t, i);
    if (j < 0) {
      out.push({ text: s.slice(i), hit: false });
      break;
    }
    if (j > i) out.push({ text: s.slice(i, j), hit: false });
    out.push({ text: s.slice(j, j + t.length), hit: true });
    i = j + t.length;
  }
  return out;
}
