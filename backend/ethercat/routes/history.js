'use strict';

const express = require('express');
const history = require('../lib/history');
const { toInt } = require('../lib/util');

const router = express.Router();

router.get('/history', async (req, res) => {
  try {
    res.json({ entries: await history.list(Math.min(1000, toInt(req.query.limit, 200) || 200)) });
  } catch (err) {
    res.status(500).json({ error: `Could not read history: ${err.message}` });
  }
});

router.post('/history', async (req, res) => {
  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
    return res.status(400).json({ success: false, message: 'Invalid entry' });
  }
  res.json({ success: true, entry: await history.record(req.body) });
});

module.exports = router;
