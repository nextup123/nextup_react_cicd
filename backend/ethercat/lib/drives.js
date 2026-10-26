'use strict';

/**
 * The drives on the bus, from `ethercat slaves` (or the simulated bus), and a
 * short "is everything answering" check used before and after an update.
 */

const { execFile } = require('child_process');
const config = require('../config');
const { getBridge } = require('./sdo');

function parseEthercatSlaves(raw) {
  const slaves = [];
  for (const line of String(raw).split('\n')) {
    // e.g. "0  0:0  OP  +  SV660N Servo Drive"
    const m = line.match(/^\s*(\d+)\s+\S+\s+([A-Za-z+\-]+)\s+[A-Z!?+\-]\s+(.+)$/);
    if (m) slaves.push({ position: parseInt(m[1], 10), state: m[2].trim(), name: m[3].trim() });
  }
  return slaves;
}

/** Runs `ethercat slaves`; resolves with { code, stdout, stderr, slaves, missing }. */
function listSlaves(master = 0) {
  const bridge = getBridge();
  if (bridge.mock) return Promise.resolve({ code: 0, stdout: '', stderr: '', slaves: bridge.slaves() });
  const args = master ? ['slaves', '--master', String(master)] : ['slaves'];
  return new Promise((resolve) => {
    // execFile + timeout: a missing binary or a hung master must not hang the caller.
    execFile(config.ETHERCAT_BIN, args, { timeout: 8000 }, (err, stdout = '', stderr = '') => {
      resolve({
        code: err ? (typeof err.code === 'number' ? err.code : 1) : 0,
        missing: !!(err && err.code === 'ENOENT'),
        stdout,
        stderr: stderr || (err && err.killed ? 'ethercat command timed out' : ''),
        slaves: parseEthercatSlaves(stdout),
      });
    });
  });
}

/** { controller, drives }: is the drive controller connected, and how many drives answer. */
async function healthNow() {
  const bridge = getBridge();
  const r = await listSlaves().catch(() => ({ slaves: [] }));
  return { controller: !!bridge.isReady(), drives: r.slaves.length };
}

/**
 * What got worse between two health checks (before and after an update), in plain
 * words, or '' when nothing did. Only what worked before counts: drives that were
 * switched off before the update are not held against the new version.
 */
function healthWorse(before, now) {
  if (!before || !now) return '';
  if (before.controller && !now.controller) return 'the drive controller no longer connects';
  if (before.drives > 0 && now.drives < before.drives) {
    return now.drives ? `only ${now.drives} of ${before.drives} drives answer` : `none of the ${before.drives} drives answer`;
  }
  return '';
}

module.exports = { parseEthercatSlaves, listSlaves, healthNow, healthWorse };
