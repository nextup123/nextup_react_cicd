// backend - rosHelper.js

import fs from "fs/promises";
import { parseXmlString } from "../user_config/customXmlParser.js";
import { ioFilePath, LOGS_JSON_FILE, LIVE_LOGS_JSON_FILE } from "../config/path.js";

const XML_PATH = ioFilePath.DO_DI_TREE_XML_FILE;
const LOG_FILE = LOGS_JSON_FILE;
const LIVE_LOG_FILE = LIVE_LOGS_JSON_FILE;

// Keep at most this many live-log entries on disk (ring buffer).
const LIVE_LOG_MAX = 2000;

// ===== Utility: Recursively search nodes =====
export function extractNodes(node, tagName, result = []) {
  if (!node || !node["@children"]) return result;

  for (const child of node["@children"]) {
    if (child.tagName === tagName) {
      result.push(child.content["@attributes"]);
    }
    extractNodes(child.content, tagName, result);
  }
  return result;
}

// ===== Async XML Parser =====
export const getParsedXml = async () => {
  const xmlContent = await fs.readFile(XML_PATH, "utf-8");
  return parseXmlString(xmlContent);
};


// ===================================================================
//  Log files are written in batches: entries are kept in memory and the
//  file is read, appended and written at most once per FLUSH_MS. The old
//  code re-read and re-wrote the whole file (up to 2000 pretty-printed
//  entries) for every single message, which dominated CPU while a tree ran.
// ===================================================================
const FLUSH_MS = 1000;

function createBatchWriter(flushFn) {
  let pending = [];
  let timer = null;
  let chain = Promise.resolve();

  const flush = () => {
    timer = null;
    if (pending.length === 0) return chain;
    const batch = pending;
    pending = [];
    chain = chain.then(() => flushFn(batch)).catch((err) => console.error("Error writing log batch:", err));
    return chain;
  };

  return {
    add(entries) {
      pending.push(...entries);
      if (!timer) timer = setTimeout(flush, FLUSH_MS);
    },
    /** Write what is queued now (before a read or clear). */
    flushNow() {
      if (timer) clearTimeout(timer);
      return flush();
    },
    /** Run fn after queued writes, dropping anything still queued. */
    afterDrop(fn) {
      if (timer) clearTimeout(timer);
      timer = null;
      pending = [];
      chain = chain.then(fn).catch((err) => console.error("Error in log writer:", err));
      return chain;
    },
  };
}

// ----- Toast log (/bt_toast_popup -> logs.json, 100 per type) -----
const toastWriter = createBatchWriter(async (entries) => {
  let data;
  try {
    data = JSON.parse(await fs.readFile(LOG_FILE, "utf-8"));
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
  }
  if (!data || typeof data !== "object") data = {};
  for (const key of ["failure", "success", "warn"]) if (!Array.isArray(data[key])) data[key] = [];

  for (const { type, entry } of entries) {
    if (!data[type]) {
      console.warn("Unknown log type:", type);
      continue;
    }
    data[type].push(entry);
  }
  // Keep only the latest 100 logs
  for (const key of Object.keys(data)) {
    if (Array.isArray(data[key]) && data[key].length > 100) data[key] = data[key].slice(-100);
  }
  await fs.writeFile(LOG_FILE, JSON.stringify(data, null, 2));
});

export function saveLogMessage(rawMsg) {
  const parts = String(rawMsg ?? "").split(",");
  if (parts.length < 3) {
    console.warn("Invalid log format:", rawMsg);
    return;
  }
  const duration = parts.pop();
  const type = parts.pop().trim();
  const message = parts.join(","); // Handles commas inside the message
  toastWriter.add([
    { type, entry: { message: message.trim(), duration: Number(duration), timestamp: new Date().toISOString() } },
  ]);
}

// ===================================================================
//  LIVE LOGS  (/logs_topic -> live_logs.json)
//  File shape: { logs: [ { message, level, timestamp } ] }
//  Stored oldest -> newest so the UI can render latest at the bottom.
// ===================================================================

// Extract a level tag like "[warn] some text" -> { level:'warn', message:'some text' }
function parseLiveLevel(text) {
  const match = String(text).match(/^\s*\[(info|success|warn|failure)\]\s*(.*)$/is);
  if (!match) return { level: "info", message: String(text).trim() };
  return { level: match[1].toLowerCase(), message: match[2].trim() };
}

async function readLiveFile() {
  try {
    const data = JSON.parse(await fs.readFile(LIVE_LOG_FILE, "utf-8"));
    return Array.isArray(data?.logs) ? data.logs : [];
  } catch (err) {
    if (err.code === "ENOENT" || err instanceof SyntaxError) return [];
    throw err;
  }
}

const liveWriter = createBatchWriter(async (entries) => {
  let logs = await readLiveFile();
  logs.push(...entries);
  // Ring-buffer: keep only the most recent LIVE_LOG_MAX.
  if (logs.length > LIVE_LOG_MAX) logs = logs.slice(-LIVE_LOG_MAX);
  await fs.writeFile(LIVE_LOG_FILE, JSON.stringify({ logs }));
});

/** Save several /logs_topic lines (one batched file write). */
export function saveLiveLogs(lines) {
  const timestamp = new Date().toISOString();
  const entries = [];
  for (const raw of lines) {
    if (raw == null || String(raw).trim() === "") continue;
    const { level, message } = parseLiveLevel(raw);
    entries.push({ message, level, timestamp });
  }
  if (entries.length) liveWriter.add(entries);
}

export function saveLiveLog(rawMsg) {
  saveLiveLogs([rawMsg]);
}

// Read the last `limit` live logs (oldest -> newest).
export async function readLiveLogs(limit = 500) {
  await liveWriter.flushNow();
  const logs = await readLiveFile();
  return limit > 0 ? logs.slice(-limit) : logs;
}

// Clear all live logs on disk.
export async function clearLiveLogs() {
  return liveWriter.afterDrop(() => fs.writeFile(LIVE_LOG_FILE, JSON.stringify({ logs: [] })));
}
