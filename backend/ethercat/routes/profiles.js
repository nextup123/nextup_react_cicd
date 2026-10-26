'use strict';

/**
 * Per-drive configuration profiles (data/drive_profiles.json).
 *
 * driver_config.json stays the register list + template value. A profile
 * stores, per drive position, only the values that differ from the template:
 *   { "updatedAt": "...", "drives": { "0": { "2005h/08h": "8388608" } } }
 */

const express = require('express');
const path = require('path');
const config = require('../config');
const { readJson, updateJson } = require('../lib/util');

const router = express.Router();
const FILE = () => path.join(config.DATA_DIR, 'drive_profiles.json');
const EMPTY = { updatedAt: null, drives: {} };
const KEY_RE = /^[0-9a-f]{1,4}h?\/[0-9a-f]{1,2}h?$/i;

function validate(drives) {
  if (!drives || typeof drives !== 'object' || Array.isArray(drives)) return 'drives must be an object';
  for (const [pos, values] of Object.entries(drives)) {
    if (!/^\d{1,3}$/.test(pos)) return `Invalid drive position "${pos}"`;
    if (!values || typeof values !== 'object' || Array.isArray(values)) return `Drive ${pos}: values must be an object`;
    for (const [k, v] of Object.entries(values)) {
      if (!KEY_RE.test(k)) return `Drive ${pos}: invalid register key "${k}"`;
      if (!['string', 'number'].includes(typeof v) || String(v).length > 64) return `Drive ${pos}: invalid value for ${k}`;
    }
  }
  return null;
}

router.get('/drive-profiles', async (req, res) => {
  try {
    res.json(await readJson(FILE()));
  } catch (err) {
    if (err.code === 'ENOENT') return res.json(EMPTY);
    res.status(500).json({ error: `Could not read drive_profiles.json: ${err.message}` });
  }
});

router.put('/drive-profiles', async (req, res) => {
  const drives = req.body?.drives;
  const problem = validate(drives);
  if (problem) return res.status(400).json({ success: false, error: problem });
  try {
    const saved = await updateJson(FILE(), (data) => {
      data.drives = drives;
      data.updatedAt = new Date().toISOString();
      return data;
    }, EMPTY);
    res.json({ success: true, updatedAt: saved.updatedAt });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
