'use strict';

const express = require('express');
const config = require('../config');
const nodeManager = require('../lib/nodeManager');
const { getBridge } = require('../lib/sdo');
const { listSlaves } = require('../lib/drives');
const { toInt } = require('../lib/util');
const history = require('../lib/history');

const router = express.Router();

function checkPassword(pw) {
  return typeof pw === 'string' && pw === config.SDO_PASSWORD;
}

// One call for everything the header needs (replaces two separate polls).
router.get('/health', (req, res) => {
  const bridge = getBridge();
  res.json({
    ros2: bridge.isReady(),
    rosError: bridge.initError(),
    controllerIssue: bridge.issue ? bridge.issue() : null,
    mock: !!bridge.mock,
    serviceClients: bridge.clientCount(),
    node: nodeManager.status(),
  });
});

// Kept for compatibility with the old frontend / scripts.
router.get('/status', (req, res) => {
  const bridge = getBridge();
  res.json({ ros2: bridge.isReady(), serviceClients: bridge.clientCount() });
});

router.post('/auth/verify', (req, res) => {
  if (checkPassword(req.body?.password)) return res.json({ success: true });
  res.status(401).json({ success: false, message: 'Incorrect password' });
});

// ── Slaves ────────────────────────────────────────────────────
router.get('/slaves', async (req, res) => {
  const r = await listSlaves(toInt(req.query.master, 0));
  if (r.missing) return res.status(500).json({ error: `${config.ETHERCAT_BIN} not found`, slaves: [] });
  const { missing, ...out } = r;
  res.json(out);
});

// ── ROS node control ──────────────────────────────────────────
router.post('/node/start', async (req, res) => {
  if (!checkPassword(req.body?.password)) {
    return res.status(401).json({ success: false, message: 'Incorrect password' });
  }
  const { status, ...result } = await nodeManager.start(req.body || {});
  history.record({ kind: 'node', outcome: result.success ? 'ok' : 'failed', title: result.success ? 'Drive communication started' : 'Drive communication failed to start', detail: result.message });
  res.status(status || 200).json(result);
});

router.post('/node/stop', (req, res) => {
  const { status, ...result } = nodeManager.stop();
  if (result.success) history.record({ kind: 'node', outcome: 'info', title: 'Drive communication stopped', detail: result.message });
  res.status(status || 200).json(result);
});

router.get('/node/status', (req, res) => res.json(nodeManager.status()));
router.get('/node/info', (req, res) => res.json(nodeManager.status()));

module.exports = router;
module.exports.parseEthercatSlaves = require('../lib/drives').parseEthercatSlaves;
