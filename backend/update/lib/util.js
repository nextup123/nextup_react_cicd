'use strict';

const fs = require('fs').promises;
const path = require('path');

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Parse an SDO index / sub-index in any of the formats the app uses:
 *   0x6040, "0x6040", "6040h", "1Fh", 24640
 * Plain numeric strings without a prefix/suffix are treated as hex,
 * matching the original server's behaviour for register tables.
 */
function parseIndex(value) {
  if (typeof value === 'number') return Number.isInteger(value) && value >= 0 ? value : NaN;
  if (value === null || value === undefined) return NaN;
  const s = String(value).trim().replace(/h$/i, '').replace(/^0x/i, '');
  if (!/^[0-9a-f]+$/i.test(s)) return NaN;
  return parseInt(s, 16);
}

const DTYPES = new Set([
  'int8', 'int16', 'int32', 'int64',
  'uint8', 'uint16', 'uint32', 'uint64',
  'float', 'double', 'string',
]);

/** Normalise "Uint16" / "String" / undefined → the lowercase type the SDO service expects. */
function normaliseDtype(value, fallback = 'uint16') {
  const t = String(value ?? '').trim().toLowerCase();
  return DTYPES.has(t) ? t : fallback;
}

function toInt(value, fallback = 0) {
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 ? n : fallback;
}

/** Serialises async work. Each call to run() waits for the previous one. */
function createLock() {
  let tail = Promise.resolve();
  return function run(fn) {
    const result = tail.then(fn, fn);
    tail = result.catch(() => {});
    return result;
  };
}

const fileLocks = new Map();
function lockFor(file) {
  if (!fileLocks.has(file)) fileLocks.set(file, createLock());
  return fileLocks.get(file);
}

async function readJson(file) {
  const raw = await fs.readFile(file, 'utf8');
  return JSON.parse(raw);
}

/** Write-to-temp then rename, so a crash never leaves a half-written JSON file. */
async function writeJsonAtomic(file, data, indent = 2) {
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(data, null, indent), 'utf8');
  await fs.rename(tmp, file);
}

/** Read-modify-write a JSON file under a per-file lock. Return null from mutate() to skip the write. */
function updateJson(file, mutate, fallback) {
  return lockFor(file)(async () => {
    let data;
    try {
      data = await readJson(file);
    } catch (err) {
      if (err.code === 'ENOENT' && fallback !== undefined) data = structuredClone(fallback);
      else throw err;
    }
    const result = await mutate(data);
    if (result !== null) await writeJsonAtomic(file, data);
    return result;
  });
}

function dataPath(dir, name) {
  return path.join(dir, name);
}

module.exports = {
  delay, parseIndex, normaliseDtype, toInt, createLock, lockFor,
  readJson, writeJsonAtomic, updateJson, dataPath,
};
