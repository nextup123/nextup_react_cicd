'use strict';

const express = require('express');
const config = require('../config');
const { setSdo, getSdo, getBridge } = require('../lib/sdo');
const { delay, toInt } = require('../lib/util');
const history = require('../lib/history');

const router = express.Router();

function sendError(res, err, shape = 'sdo') {
  const status = err.status || 500;
  if (status >= 500) console.error('[SDO]', err.message);
  if (shape === 'sdo') return res.status(status).json({ success: false, sdo_return_message: err.message });
  return res.status(status).json({ success: false, message: err.message });
}

router.post('/sdo/set', async (req, res) => {
  try {
    res.json(await setSdo(req.body || {}));
  } catch (err) { sendError(res, err); }
});

router.post('/sdo/get', async (req, res) => {
  try {
    res.json(await getSdo(req.body || {}));
  } catch (err) { sendError(res, err); }
});

// ── DS402 fault reset (0x6040 = 0x80) ─────────────────────────
router.post('/reset', async (req, res) => {
  const { index, subindex, dtype, value } = config.FAULT_RESET;
  const pos = toInt(req.body?.slave_position, -1);
  try {
    const r = await setSdo({
      master_id: req.body?.master_id,
      slave_position: req.body?.slave_position,
      sdo_index: index, sdo_subindex: subindex, sdo_data_type: dtype, sdo_value: value,
    });
    history.record({
      kind: 'reset', outcome: r.success ? 'ok' : 'failed', drives: pos >= 0 ? [pos] : [],
      title: `Fault reset on J${pos + 1}`, detail: r.success ? '0x6040 = 0x80' : r.sdo_return_message,
    });
    res.json(r);
  } catch (err) {
    history.record({ kind: 'reset', outcome: 'failed', drives: pos >= 0 ? [pos] : [], title: `Fault reset on J${pos + 1}`, detail: err.message });
    sendError(res, err);
  }
});

// ── Homing ─────────────────────────────────────────────────────
// The old single-drive route reported success even when the drive
// rejected the write; it now returns the drive's answer.
router.post('/homing', async (req, res) => {
  try {
    const r = await setSdo({
      master_id: req.body?.master_id,
      slave_position: req.body?.slave_position,
      sdo_index: 0x2005, sdo_subindex: 0x1f, sdo_data_type: 'uint16', sdo_value: '6',
    });
    res.json({ success: r.success, message: r.success ? 'Homing sequence initiated' : r.sdo_return_message });
  } catch (err) { sendError(res, err, 'msg'); }
});

const HOMING_SEQUENCE = [
  { index: '2002h', subindex: '02h', value: 0 },
  { index: '200Dh', subindex: '01h', value: 1 },
  { index: '2002h', subindex: '02h', value: 1 },
  { index: '200Dh', subindex: '01h', value: 1 },
  { index: '2005h', subindex: '1Fh', value: 6 },
];

router.post('/homing/batch', async (req, res) => {
  const master_id = toInt(req.body?.master_id, 0);
  const positions = Array.isArray(req.body?.slave_positions) ? req.body.slave_positions : [];
  if (!positions.length) return res.status(400).json({ success: false, message: 'No slave positions provided' });

  const results = [];
  for (const slave_position of positions) {
    for (const step of HOMING_SEQUENCE) {
      let r;
      try {
        r = await setSdo({ master_id, slave_position, sdo_index: step.index, sdo_subindex: step.subindex, sdo_data_type: 'uint16', sdo_value: step.value });
      } catch (err) {
        r = { success: false, sdo_return_message: err.message };
      }
      results.push({ slave: slave_position, index: step.index, subindex: step.subindex, success: r.success, message: r.sdo_return_message });
      // Settle time is needed after every step (also after a failure).
      await delay(4000);
    }
  }
  // Used to always say success:true.
  res.json({ success: results.every((r) => r.success), results });
});

// ── Fault log: select a slot and read it as ONE uninterrupted sequence ──
const FAULT_REGISTERS = ['0x23', '0x24', '0x26', '0x29', '0x2A', '0x2C'];

router.post('/faults/read-slot', async (req, res) => {
  const master_id = toInt(req.body?.master_id, 0);
  const slave_position = toInt(req.body?.slave_position, 0);
  const slot = toInt(req.body?.slot, 0);
  if (slot < 1 || slot > 9) return res.status(400).json({ success: false, message: 'slot must be 1–9' });

  const base = { master_id, slave_position, sdo_index: 0x200b };
  try {
    const result = await getBridge().exclusive(async (call) => {
      const sel = await setSdo({ ...base, sdo_subindex: 0x22, sdo_data_type: 'uint16', sdo_value: slot }, call);
      if (!sel.success) return { slot, error: `Could not select slot: ${sel.sdo_return_message || 'write failed'}` };
      await delay(150);
      const registers = {};
      const readErrors = {};
      for (const sub of FAULT_REGISTERS) {
        try {
          const r = await getSdo({ ...base, sdo_subindex: sub, sdo_data_type: 'uint16' }, call);
          const n = r.success ? Number(r.sdo_return_value) : NaN;
          registers[sub] = Number.isFinite(n) ? n : null;
          if (!r.success) readErrors[sub] = r.sdo_return_message || 'read failed';
        } catch (err) {
          registers[sub] = null;
          readErrors[sub] = err.message;
        }
      }
      // Without the fault code we can't tell "empty" from "unreadable".
      if (registers['0x23'] === null) {
        return { slot, registers, error: `Fault code read failed: ${readErrors['0x23'] || 'no value'}` };
      }
      return { slot, registers, readErrors };
    });
    res.json({ success: !result.error, ...result });
  } catch (err) {
    res.json({ success: false, slot, error: err.message });
  }
});

module.exports = router;
