'use strict';

const express = require('express');
const path = require('path');
const config = require('../config');
const { readJson, updateJson } = require('../lib/util');

const router = express.Router();
const LOG_FILE = path.join(config.DATA_DIR, 'error_log.json');

// The browser used to embed the whole fault-database entry (every cause and
// solution) in every slot of every snapshot, which made the log file grow by
// ~100 KB per black-box run and could exceed Express' 100 KB body limit.
// Store a reference instead; the details are always in faults.json.
function compactSlot(slot) {
  if (!slot || typeof slot !== 'object') return slot;
  const out = { ...slot };
  if (slot.faultDetails && typeof slot.faultDetails === 'object') {
    const { subFaultCode, name, type, resettable, faultRange } = slot.faultDetails;
    out.faultDetails = { subFaultCode, name, type, resettable, faultRange };
  }
  if (Array.isArray(slot.slots)) out.slots = slot.slots.map(compactSlot);
  return out;
}

router.post('/error-log', async (req, res) => {
  const payload = req.body;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return res.status(400).json({ success: false, message: 'Invalid payload' });
  }
  const snapshot = {
    ...payload,
    data: Array.isArray(payload.data) ? payload.data.map(compactSlot) : payload.data,
    receivedAt: new Date().toISOString(),
  };
  try {
    const total = await updateJson(LOG_FILE, (log) => {
      if (!Array.isArray(log.snapshots)) log.snapshots = [];
      log.snapshots.push(snapshot);
      if (log.snapshots.length > config.MAX_LOG_SNAPSHOTS) {
        log.snapshots = log.snapshots.slice(-config.MAX_LOG_SNAPSHOTS);
      }
      return log.snapshots.length;
    }, { snapshots: [] });
    console.log(`[error-log] Snapshot saved (${snapshot.mode}), total: ${total}`);
    res.json({ success: true, totalSnapshots: total });
  } catch (err) {
    console.error('[error-log] Write failed:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

router.get('/error-log', async (req, res) => {
  try {
    const log = await readJson(LOG_FILE);
    const limit = Number(req.query.limit);
    if (limit > 0 && Array.isArray(log.snapshots)) log.snapshots = log.snapshots.slice(-limit);
    res.json(log);
  } catch (err) {
    if (err.code === 'ENOENT') return res.json({ snapshots: [] });
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
