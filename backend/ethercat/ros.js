'use strict';

/**
 * ROS 2 bridge of the drive tools — the only module here that talks to rclnodejs.
 *
 * Inside NextUp it uses the web backend's own ROS 2 node (rclnodejs is initialised once per
 * process, so no second node is made). Pooled service clients, ethercat_msgs SetSdo / GetSdo.
 * Fixes kept from the EtherCAT Config Tool:
 *  - a timed-out call destroyed the pooled client while other calls were
 *    still waiting on it (they then hung until their own timeout);
 *  - SDO calls are now serialised, so a fault-log "select slot, then read"
 *    sequence can't be interleaved with another tab's writes.
 */

const config = require('./config');
const { createLock } = require('./lib/util');

let rclnodejs = null;
let rosNode = null;
let ready = false;
let initError = null;
// Short code the UI turns into plain advice; the console gets the full story.
let issue = null;
const clients = new Map();
const sdoLock = createLock();

const FIXES = {
  no_ros_env: [
    'This process was started from a shell where ROS 2 is not sourced.',
    `Run: source ${config.ROS_SETUP} && source <your workspace>/install/setup.bash && npm start`,
  ],
  not_installed: [
    'rclnodejs is not installed in backend/, or it failed to build. It must be installed from a shell where ROS 2 is sourced.',
    `Run in backend/: source ${config.ROS_SETUP} && source <your workspace>/install/setup.bash && npm install`,
  ],
  no_msg_types: [
    'rclnodejs is running but has no ethercat_msgs types, so SetSdo/GetSdo calls cannot be built.',
    'Source the workspace that contains ethercat_msgs before npm start; the console then generates them',
    '(ros/bindings.js), or run in backend/: npx generate-ros-messages',
  ],
  init_failed: ['The robot connection (the web backend ROS 2 node) is not ready. The error above is the reason.'],
};

function report(code, err) {
  issue = code;
  console.error('\n  ┌─ Controller connection problem ─────────────────────');
  if (err) console.error(`  │ ${err}`);
  for (const line of FIXES[code]) console.error(`  │ ${line}`);
  console.error(`  │ ROS_DISTRO=${process.env.ROS_DISTRO || '(not set)'}  AMENT_PREFIX_PATH=${process.env.AMENT_PREFIX_PATH ? 'set' : '(not set)'}`);
  console.error('  └─────────────────────────────────────────────────────\n');
}

/** Can rclnodejs build the SDO request messages? (ros/bindings.js generates them at start.) */
function checkMessageTypes() {
  try {
    for (const { type } of [config.SDO_SET_SERVICE, config.SDO_GET_SERVICE]) {
      if (!rclnodejs.createMessageObject(`${type}_Request`)) throw new Error(`no ${type}_Request`);
    }
  } catch (err) {
    report('no_msg_types', err.message);
  }
}

/** appRos: the web backend's ROS bridge (ros/LightweightROSBridge.js), which owns the node. */
async function init(appRos) {
  try {
    // Required lazily so the console still runs (and says "controller offline") where
    // rclnodejs isn't built.
    rclnodejs = require('rclnodejs');
  } catch (err) {
    initError = err.message;
    report('not_installed', err.message.split('\n')[0]);
    return;
  }
  if (!appRos?.node) {
    initError = 'the robot connection is not ready';
    report(process.env.AMENT_PREFIX_PATH ? 'init_failed' : 'no_ros_env', initError);
    return;
  }
  rosNode = appRos.node;
  ready = true;
  console.log('[ECAT] Drive tools use the web backend ROS 2 node');
  checkMessageTypes();
}

function getClient(type, name) {
  const cached = clients.get(name);
  if (cached && !cached.destroyed) return cached;
  const client = rosNode.createClient(type, name);
  clients.set(name, client);
  console.log(`[SERVICE POOL] Created client for ${name}`);
  return client;
}

function dropClient(name) {
  const client = clients.get(name);
  clients.delete(name);
  try {
    if (client && typeof client.destroy === 'function') client.destroy();
  } catch (err) {
    console.error(`[SERVICE POOL] Error destroying client ${name}:`, err.message);
  }
}

function destroyAllClients() {
  if (clients.size) console.log(`[SERVICE POOL] Destroying ${clients.size} clients`);
  for (const name of [...clients.keys()]) dropClient(name);
}

function rawCall(type, name, request, timeoutMs) {
  return new Promise((resolve, reject) => {
    if (!ready || !rosNode) return reject(new Error('ROS2 node not available'));

    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn(value);
    };

    const timer = setTimeout(() => {
      // Calls are serialised, so nobody else is waiting on this client:
      // safe to drop it and start clean next time.
      dropClient(name);
      finish(reject, new Error(`Service call timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    let client;
    try {
      client = getClient(type, name);
    } catch (err) {
      return finish(reject, err);
    }

    client.waitForService(timeoutMs).then((available) => {
      if (settled) return;
      if (!available) return finish(reject, new Error(`Service '${name}' not available`));
      try {
        const msg = rclnodejs.createMessageObject(`${type}_Request`);
        if (!msg) throw new Error(`Failed to create message object for ${type}_Request`);
        Object.assign(msg, request);
        client.sendRequest(msg, (response) => {
          if (!response) return finish(reject, new Error('Service returned null response'));
          finish(resolve, response);
        });
      } catch (err) {
        finish(reject, err);
      }
    }).catch((err) => finish(reject, err));
  });
}

/** Serialised service call. Don't call this from inside exclusive() — use the `call` it hands you. */
function callService(type, name, request, timeoutMs = config.SERVICE_TIMEOUT_MS) {
  return sdoLock(() => rawCall(type, name, request, timeoutMs));
}

/** Run several raw calls as one uninterruptible sequence (e.g. select slot + read registers). */
function exclusive(fn) {
  return sdoLock(() => fn((type, name, request, timeoutMs = config.SERVICE_TIMEOUT_MS) =>
    rawCall(type, name, request, timeoutMs)));
}

// The node belongs to the web backend, which shuts it down.
async function shutdown() {
  destroyAllClients();
}

module.exports = {
  init,
  callService,
  exclusive,
  destroyAllClients,
  shutdown,
  isReady: () => ready,
  initError: () => initError,
  issue: () => issue,
  clientCount: () => clients.size,
  mock: false,
};
