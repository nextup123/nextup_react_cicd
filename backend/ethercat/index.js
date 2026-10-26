'use strict';

// ethercat/index.js -- the drive tools inside NextUp (merged EtherCAT Config Tool v3.8):
// Settings > Driver Settings (Recipes, Drive settings, Manual read/write) and Diagnostics >
// Robot records > Drive faults. All routes under /ecat-api (server.js), like /plc-api.
//
//   bridge    real drives through the web backend's ROS 2 node (ros.js), or the simulated
//             6-drive bus (mock.js) when the console runs its simulated robot
//   routes/   system (health, drives, drive communication), sdo, data, recipes, fault log,
//             history, drive profiles; the same request / answer shapes as the separate tool
//   lib/      SDO helpers, the drive communication process, JSON files, activity leases
//
// Nothing here polls: the pages ask while they are open.

const express = require('express');
const config = require('./config');
const { setBridge, getBridge } = require('./lib/sdo');
const nodeManager = require('./lib/nodeManager');
const activity = require('./lib/activity');
const drives = require('./lib/drives');
const { seedUserData } = require('./lib/userData');

let started = false;

/** Picks the real or simulated drives. appRos = the web backend's ROS bridge (or null). */
async function start(appRos) {
  if (started) return;
  started = true;
  try { seedUserData(); } catch (err) { console.error('[ECAT] could not prepare the data folder:', err.message); }
  const forced = config.MOCK_ENV;
  const mock = forced === undefined || forced === '' ? Boolean(appRos?.simulated || !appRos?.node) && forced !== '0' : config.envBool('ECAT_MOCK');
  const bridge = mock ? require('./mock') : require('./ros');
  setBridge(bridge);
  if (bridge.mock) nodeManager.useMock(bridge);
  // When the SDO server process exits, its service clients are dead too.
  nodeManager.setOnExit(() => bridge.destroyAllClients());
  await bridge.init(appRos);
}

// Until start() ran (the ROS bridge comes up after the routes are mounted) every call says so.
function ready(req, res, next) {
  if (getBridge()) return next();
  res.status(503).json({ success: false, error: 'The drive tools are starting', sdo_return_message: 'The drive tools are starting' });
}

const router = express.Router();
// Operators never see ROS wording (node/service names, "ROS 2").
router.use(require('./lib/plainWords').middleware);
router.use(ready);
router.use(require('./routes/system'));
router.use(require('./routes/sdo'));
router.use(require('./routes/data'));
router.use(require('./routes/recipes'));
router.use(require('./routes/errorLog'));
router.use(require('./routes/history'));
router.use(require('./routes/profiles'));

// The screens say when a recipe run or a settings write starts and ends (renewed every few
// seconds while it runs), so software updates and restarts wait for it.
router.post('/activity', (req, res) => {
  const { id, what, active } = req.body || {};
  if (!id) return res.status(400).json({ success: false, error: 'id is required' });
  if (active === false) activity.release(id);
  else activity.hold(id, what);
  res.json({ success: true, busy: activity.busy() });
});

router.use((req, res) => res.status(404).json({ error: `No route for ${req.method} ${req.originalUrl}` }));
// eslint-disable-next-line no-unused-vars
router.use((err, req, res, next) => {
  const status = err.status || err.statusCode || 500;
  if (status >= 500) console.error('[ECAT]', err);
  res.status(status).json({ success: false, error: err.message, sdo_return_message: err.message });
});

/** For the software update: is the controller connected, and how many drives answer. */
async function health() {
  if (!getBridge()) return { controller: false, drives: 0 };
  return drives.healthNow();
}

function shutdown() {
  nodeManager.killOnShutdown();
  getBridge()?.shutdown().catch(() => {});
}

/** Settings > System > File locations. */
function paths() {
  return [{ label: 'Drive recipes and settings', path: config.DATA_DIR }];
}

module.exports = {
  router, start, shutdown, health, paths,
  busy: () => activity.busy(),
  checkPassword: (pw) => typeof pw === 'string' && pw === config.SDO_PASSWORD,
  isMock: () => Boolean(getBridge()?.mock),
  listSlaves: drives.listSlaves,
};
