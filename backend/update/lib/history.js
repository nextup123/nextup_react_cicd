'use strict';

/**
 * Update history of the console (<user_config_files>/software_update/history.json): updates,
 * going back and problem reports, newest first, capped. Problem reports send the last entries
 * along. (The drive tools keep their own history, ethercat/lib/history.js.)
 */

const path = require('path');
const config = require('../config');
const { readJson, updateJson } = require('./util');

const FILE = () => path.join(config.DATA_DIR, 'history.json');
const MAX_ENTRIES = 1000;
const KINDS = new Set(['recipe', 'config', 'sdo', 'reset', 'node', 'faults', 'update', 'report']);
const OUTCOMES = new Set(['ok', 'partial', 'failed', 'cancelled', 'info']);

const str = (v, max) => (v === undefined || v === null ? '' : String(v).slice(0, max));

function sanitise(e) {
  return {
    id: `h-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    at: new Date().toISOString(),
    kind: KINDS.has(e.kind) ? e.kind : 'sdo',
    outcome: OUTCOMES.has(e.outcome) ? e.outcome : 'info',
    title: str(e.title, 200) || 'Operation',
    detail: str(e.detail, 4000),
    drives: Array.isArray(e.drives) ? e.drives.filter((d) => Number.isInteger(d) && d >= 0).slice(0, 64) : [],
    // One row per failed operation: which drive, which step, what was sent, why it failed.
    failures: Array.isArray(e.failures)
      ? e.failures.slice(0, 300).filter((f) => f && typeof f === 'object').map((f) => ({
        drive: Number.isInteger(f.drive) && f.drive >= 0 ? f.drive : null,
        step: Number.isInteger(f.step) && f.step > 0 ? f.step : null,
        name: str(f.name, 120),
        action: ['read', 'write', 'check'].includes(f.action) ? f.action : '',
        address: str(f.address, 20),
        value: str(f.value, 64),
        error: str(f.error, 300),
        skipped: Number.isInteger(f.skipped) && f.skipped > 0 ? f.skipped : 0,
      }))
      : undefined,
    stats: e.stats && typeof e.stats === 'object' && !Array.isArray(e.stats)
      ? Object.fromEntries(Object.entries(e.stats).slice(0, 10).filter(([, v]) => typeof v === 'number'))
      : undefined,
  };
}

async function record(entry) {
  const clean = sanitise(entry || {});
  try {
    await updateJson(FILE(), (list) => {
      if (!Array.isArray(list)) throw new Error('history.json is not a list');
      list.unshift(clean);
      if (list.length > MAX_ENTRIES) list.length = MAX_ENTRIES;
      return clean;
    }, []);
  } catch (err) {
    console.error('[HISTORY] write failed:', err.message);
  }
  return clean;
}

async function list(limit = 200) {
  try {
    const data = await readJson(FILE());
    return Array.isArray(data) ? data.slice(0, limit) : [];
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
}

module.exports = { record, list };
