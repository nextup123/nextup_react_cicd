'use strict';

// update/index.js -- Settings > Software Update: updates the whole console (backend, frontend,
// drive tools) from version tags of its git repository, and problem reports to the release
// server. Routes under /update-api (server.js). See lib/updater.js for the steps and
// launcher.js for the restart and the automatic go-back.

const fs = require('fs');
const express = require('express');
const config = require('./config');
const updater = require('./lib/updater');
const hub = require('./lib/hub');
const settings = require('./lib/settings');
const { probes, configure } = require('./lib/probes');

let restartHook = () => process.exit(config.RESTART_EXIT_CODE);
let reportContext = async () => ({});

const router = express.Router();

const wrap = (fn) => (req, res) => Promise.resolve(fn(req, res)).catch((err) => {
  if (!err.status || err.status >= 500) console.error('[UPDATE]', err.message);
  res.status(err.status || 500).json({ success: false, error: err.message });
});

// Installing, going back, restarting and changing the update source need the password.
function needPassword(req, res, next) {
  if (typeof req.body?.password === 'string' && req.body.password === config.PASSWORD) return next();
  res.status(401).json({ success: false, error: 'Incorrect password' });
}

router.get('/health', (req, res) => res.json({ version: config.APP_VERSION, supervised: config.SUPERVISED }));

router.get('/updates/status', wrap(async (req, res) => {
  res.json({ ...(await updater.status()), hub: await hub.status(), settings: await settings.getPublic() });
}));

router.post('/updates/check', wrap(async (req, res) => {
  res.json(await updater.check());
}));

router.post('/updates/install', needPassword, wrap(async (req, res) => {
  res.json({ success: true, job: await updater.start(req.body.version) });
}));

router.post('/updates/rollback', needPassword, wrap(async (req, res) => {
  res.json({ success: true, job: await updater.rollback({ restoreData: req.body.restoreData !== false }) });
}));

router.post('/updates/restart', needPassword, wrap(async (req, res) => {
  if (!config.SUPERVISED) {
    return res.status(409).json({ success: false, error: 'This console was not started with "npm start", so it cannot restart itself. Restart it the way it was started (for example its service).' });
  }
  updater.refuseWhileBusy('Restarting');
  res.json({ success: true });
  // Let the answer reach the browser, then exit; `npm start` (update/launcher.js) starts it again.
  setTimeout(() => restartHook(), 300);
}));

// Opening "Update settings" asks for the password first.
router.post('/auth/verify', needPassword, (req, res) => res.json({ success: true }));

router.get('/updates/settings', wrap(async (req, res) => res.json(await settings.getPublic())));
router.put('/updates/settings', needPassword, wrap(async (req, res) => {
  const saved = await settings.save(req.body || {});
  hub.flush().catch(() => {});
  res.json({ success: true, settings: saved });
}));

router.get('/updates/history', wrap(async (req, res) => {
  res.json({ updates: (await hub.listUpdates()).map(({ log, ...u }) => u) });
}));

// ── Problem reports ───────────────────────────────────────────
router.get('/reports', wrap(async (req, res) => {
  res.json({ reports: (await hub.listReports()).map(({ context, ...r }) => r), hub: await hub.status() });
}));

router.post('/reports', wrap(async (req, res) => {
  const extra = req.body?.includeDetails === false ? {} : await reportContext().catch(() => ({}));
  const report = await hub.createReport(req.body || {}, { simulated: probes.simulated(), ...extra });
  const { context, ...rest } = report;
  res.json({ success: true, report: rest, hub: await hub.status() });
}));

router.post('/reports/send', wrap(async (req, res) => {
  res.json(await hub.flush());
}));

router.use((req, res) => res.status(404).json({ error: `No route for ${req.method} ${req.originalUrl}` }));

/**
 * server.js wires the running console in: busy() (robot program, motion, drive work),
 * health() ({ robot, controller, drives }), simulated(), restart() (exit with code 75 after a
 * clean shutdown) and context() (what a problem report says about the robot).
 */
function start({ restart, context, ...hooks } = {}) {
  try { fs.mkdirSync(config.DATA_DIR, { recursive: true }); } catch (err) { console.error('[UPDATE]', err.message); }
  configure(hooks);
  if (restart) restartHook = restart;
  if (context) reportContext = context;
  if (process.env.UPDATE_SMOKE_TEST) return;
  updater.onStartup().catch((err) => console.error('[UPDATE]', err.message));
  hub.start();
}

module.exports = {
  router, start,
  RESTART_EXIT_CODE: config.RESTART_EXIT_CODE,
  version: config.APP_VERSION,
  paths: () => [{ label: 'Software update (settings, logs, copies)', path: config.DATA_DIR }],
};
