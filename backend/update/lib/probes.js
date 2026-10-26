'use strict';

// What the update needs to know about the running console, filled in by server.js (update/index.js
// configure()): whether the robot or the drives are working, how the robot and the drives are
// connected (compared before and after an update), and whether this is the simulated robot.

const probes = {
  busy: () => ({ busy: false, what: '' }),
  health: async () => null,
  simulated: () => false,
};

function configure(next) {
  for (const k of Object.keys(probes)) if (typeof next?.[k] === 'function') probes[k] = next[k];
}

/**
 * What got worse between two health checks (before and after an update), in plain words, or ''
 * when nothing did. Only what worked before counts: drives that were switched off before the
 * update are not held against the new version.
 */
function healthWorse(before, now) {
  if (!before || !now) return '';
  if (before.robot && !now.robot) return 'the robot controllers no longer connect';
  if (before.controller && !now.controller) return 'the drive controller no longer connects';
  if (before.drives > 0 && now.drives < before.drives) {
    return now.drives ? `only ${now.drives} of ${before.drives} drives answer` : `none of the ${before.drives} drives answer`;
  }
  return '';
}

module.exports = { probes, configure, healthWorse };
