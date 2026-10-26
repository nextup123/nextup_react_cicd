'use strict';

const express = require('express');
const path = require('path');
const config = require('../config');
const { readJson, updateJson, delay, toInt, parseIndex, normaliseDtype } = require('../lib/util');
const { setSdo } = require('../lib/sdo');

const router = express.Router();
const file = (name) => path.join(config.DATA_DIR, name);
const bundled = (name) => path.join(config.BUNDLED_DATA_DIR, name);

function serveJson(name, where = file) {
  return async (req, res) => {
    try {
      res.json(await readJson(where(name)));
    } catch (err) {
      console.error(`[DATA] ${name}:`, err.message);
      res.status(500).json({ error: `Failed to read ${name}` });
    }
  };
}

// Reference data ships with each version, so it comes from the running version's
// own data folder; the operator's recipes and settings live in DATA_DIR.
router.get('/presets', serveJson('sdo_presets.json', bundled));
router.get('/fault', serveJson('faults.json', bundled));
router.get('/parameter-catalog', serveJson('parameter_catalog.json', bundled));
router.get('/driver-config', serveJson('driver_config.json'));

router.patch('/driver-config', async (req, res) => {
  const { index, subindex, defaultValue } = req.body || {};
  if (!index || !subindex || defaultValue === undefined) {
    return res.status(400).json({ error: 'index, subindex, and defaultValue are required' });
  }
  try {
    const updated = await updateJson(file('driver_config.json'), (list) => {
      const entry = list.find((r) =>
        String(r.index).toLowerCase() === String(index).toLowerCase() &&
        String(r.subindex).toLowerCase() === String(subindex).toLowerCase());
      if (!entry) {
        const err = new Error(`Register ${index}/${subindex} not found`);
        err.status = 404;
        throw err;
      }
      entry.defaultValue = defaultValue;
      return entry;
    });
    res.json({ success: true, updated });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// Replace the whole parameter list (Driver config → Edit parameters).
// Stored in the same driver_config.json the v1 tool used; optional fields
// (units, min, max, description, group) are ignored by v1.
const hex = (n, w) => `${n.toString(16).toUpperCase().padStart(w, '0')}h`;
function cleanRegister(r, i) {
  const fail = (msg) => { const e = new Error(`Parameter ${i + 1}: ${msg}`); e.status = 400; throw e; };
  if (!r || typeof r !== 'object') fail('not an object');
  const name = String(r.name ?? '').trim().slice(0, 120);
  if (!name) fail('name is required');
  const index = parseIndex(r.index);
  const subindex = parseIndex(r.subindex);
  if (!(index >= 0 && index <= 0xffff)) fail(`bad index "${r.index}"`);
  if (!(subindex >= 0 && subindex <= 0xff)) fail(`bad sub-index "${r.subindex}"`);
  const dataType = normaliseDtype(r.dataType, '');
  if (!dataType) fail(`unknown data type "${r.dataType}"`);
  const out = { name, index: hex(index, 4), subindex: hex(subindex, 2), dataType };
  const num = (v) => (v === '' || v === null || v === undefined ? undefined : Number(v));
  if (dataType === 'string') out.defaultValue = String(r.defaultValue ?? '').slice(0, 64);
  else {
    const d = num(r.defaultValue);
    if (d === undefined || !Number.isFinite(d)) fail('default value must be a number');
    out.defaultValue = d;
    for (const k of ['min', 'max']) {
      const v = num(r[k]);
      if (v !== undefined) { if (!Number.isFinite(v)) fail(`${k} must be a number`); out[k] = v; }
    }
    if (out.min !== undefined && out.max !== undefined && out.min > out.max) fail('min is greater than max');
    if (out.min !== undefined && d < out.min) fail('default is below min');
    if (out.max !== undefined && d > out.max) fail('default is above max');
  }
  for (const k of ['units', 'description', 'group']) {
    const v = String(r[k] ?? '').trim();
    if (v) out[k] = v.slice(0, k === 'description' ? 400 : 40);
  }
  const param = String(r.param ?? '').trim();
  if (/^[A-Za-z0-9.\-]{1,16}$/.test(param)) out.param = param;
  if (Array.isArray(r.options) && dataType !== 'string') {
    const opts = r.options
      .filter((o) => o && Number.isFinite(Number(o.value)) && String(o.label ?? '').trim())
      .slice(0, 64)
      .map((o) => ({ value: Number(o.value), label: String(o.label).trim().slice(0, 100) }));
    if (opts.length) out.options = opts;
  }
  return out;
}

router.put('/driver-config', async (req, res) => {
  const list = req.body?.registers;
  if (!Array.isArray(list)) return res.status(400).json({ error: 'registers must be a list' });
  if (list.length > 500) return res.status(400).json({ error: 'At most 500 parameters' });
  try {
    const clean = list.map(cleanRegister);
    const seen = new Set();
    clean.forEach((r, i) => {
      const k = `${r.index}/${r.subindex}`.toLowerCase();
      if (seen.has(k)) { const e = new Error(`Parameter ${i + 1}: ${r.index}:${r.subindex} is listed twice`); e.status = 400; throw e; }
      seen.add(k);
    });
    await updateJson(file('driver_config.json'), (cur) => { cur.length = 0; cur.push(...clean); return true; }, []);
    res.json({ success: true, registers: clean });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// Batch write (kept for API compatibility; the React UI writes register
// by register through /api/sdo/set so it can show live progress + cancel).
router.post('/driver-config/apply', async (req, res) => {
  const master_id = toInt(req.body?.master_id, 0);
  const joints = Array.isArray(req.body?.joints) ? req.body.joints : [];
  const registers = Array.isArray(req.body?.registers) ? req.body.registers : [];
  if (!joints.length) return res.status(400).json({ error: 'No joints specified' });
  if (!registers.length) return res.status(400).json({ error: 'No registers specified' });

  const results = [];
  for (const joint of joints) {
    for (const reg of registers) {
      let r;
      try {
        r = await setSdo({ master_id, slave_position: joint, sdo_index: reg.index, sdo_subindex: reg.subindex, sdo_data_type: reg.dataType, sdo_value: reg.value });
      } catch (err) {
        r = { success: false, sdo_return_message: err.message };
      }
      results.push({ joint, index: reg.index, subindex: reg.subindex, success: r.success, message: r.sdo_return_message });
      await delay(200);
    }
  }
  res.json({ success: results.every((r) => r.success), results });
});

module.exports = router;
