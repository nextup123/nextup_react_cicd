'use strict';

/**
 * Starts / stops the ethercat_manager SDO server (`ros2 run <pkg> <node>`).
 *
 * Fixes vs. the original:
 *  - package/node names were pasted into a bash string → command injection.
 *    They are now validated and passed as positional args.
 *  - /stop safety-net timers could reset state belonging to a *newer*
 *    process started in the meantime; timers now check the PID.
 *  - crashedRecently returned null/number instead of a boolean.
 */

const { spawn } = require('child_process');
const config = require('../config');

const NAME_RE = /^[A-Za-z][A-Za-z0-9_]{0,99}$/;
const CRASH_WINDOW_MS = 10000;

let proc = null;
let current = { node_name: null, package_name: null };
let lastCrash = null;
let lastExit = null;
let onExitHook = () => {};
let mockBridge = null;

function setOnExit(fn) { onExitHook = fn; }
function useMock(bridge) { mockBridge = bridge; }

function status() {
  const running = !!proc;
  return {
    running,
    pid: running ? proc.pid : null,
    node_name: running ? current.node_name : null,
    package_name: running ? current.package_name : null,
    lastCrash: lastCrash ? new Date(lastCrash).toISOString() : null,
    crashedRecently: !!lastCrash && Date.now() - lastCrash < CRASH_WINDOW_MS,
    lastExit,
  };
}

function start({ node_name, package_name } = {}) {
  const node = node_name || config.DEFAULT_NODE.node_name;
  const pkg = package_name || config.DEFAULT_NODE.package_name;

  if (!NAME_RE.test(node) || !NAME_RE.test(pkg)) {
    return Promise.resolve({ success: false, status: 400, message: 'Invalid node or package name' });
  }
  if (proc) {
    return Promise.resolve({ success: false, message: `Node ${current.node_name} is already running` });
  }

  current = { node_name: node, package_name: pkg };

  if (mockBridge) {
    proc = { pid: 40000 + Math.floor(Math.random() * 1000), mock: true };
    mockBridge.setNodeRunning(true);
    return Promise.resolve({ success: true, message: `Node ${node} started (mock, PID ${proc.pid})`, pid: proc.pid });
  }

  console.log(`[NODE] Starting: ${pkg}/${node}`);
  // "$1"/"$2" are bash positional args — never interpolated into the script.
  const overlay = config.WORKSPACE_SETUP ? ` && source "${config.WORKSPACE_SETUP}"` : '';
  const script = `source "${config.ROS_SETUP}"${overlay} && exec ros2 run "$1" "$2"`;
  // detached → own process group, so stop() can signal the whole tree with -pid.
  const child = spawn('bash', ['-c', script, 'ros2-node', pkg, node], { detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  child.unref();
  proc = child;

  child.stdout.on('data', (d) => console.log(`[NODE stdout]: ${d.toString().trim()}`));
  child.stderr.on('data', (d) => console.error(`[NODE stderr]: ${d.toString().trim()}`));

  child.on('error', (err) => {
    console.error(`[NODE] Spawn error: ${err.message}`);
    if (proc === child) { proc = null; lastExit = { code: null, signal: null, error: err.message }; }
  });

  child.on('close', (code, signal) => {
    console.log(`[NODE] Process ${child.pid} exited with code ${code}, signal ${signal}`);
    if (code !== 0 && code !== null && !child._stopping) {
      console.error(`[NODE CRASH] ${node} crashed unexpectedly (code ${code})`);
      lastCrash = Date.now();
    }
    lastExit = { code, signal, at: new Date().toISOString() };
    if (proc === child) {
      proc = null;
      onExitHook();
    }
  });

  return new Promise((resolve) => {
    setTimeout(() => {
      if (proc === child) {
        resolve({ success: true, message: `Node ${node} started (PID: ${child.pid})`, pid: child.pid });
      } else {
        resolve({ success: false, message: 'Node died immediately — check the ROS 2 environment / package' });
      }
    }, 800);
  });
}

function stop() {
  if (!proc) return { success: false, message: 'No node running' };

  if (proc.mock) {
    proc = null;
    mockBridge.setNodeRunning(false);
    onExitHook();
    return { success: true, message: 'Node stopped (mock)' };
  }

  const child = proc;
  const pid = child.pid;
  child._stopping = true;
  try {
    process.kill(-pid, 'SIGTERM');
  } catch (err) {
    console.error('[NODE] Error sending SIGTERM:', err.message);
    if (err.code === 'ESRCH') { proc = null; onExitHook(); return { success: true, message: 'Node was already gone' }; }
    return { success: false, status: 500, message: err.message };
  }

  setTimeout(() => {
    if (proc === child) {
      console.warn(`[NODE] Force killing process group ${pid}`);
      try { process.kill(-pid, 'SIGKILL'); } catch { /* already gone */ }
    }
  }, 3000);

  setTimeout(() => {
    if (proc === child) {
      console.error(`[NODE] PID ${pid} did not report exit after SIGKILL — resetting state. Check "ps -p ${pid}".`);
      proc = null;
      onExitHook();
    }
  }, 7000);

  return { success: true, message: 'Node stop signal sent' };
}

function killOnShutdown() {
  if (proc && !proc.mock) {
    try { process.kill(-proc.pid, 'SIGTERM'); } catch { /* ignore */ }
  }
}

module.exports = { start, stop, status, setOnExit, useMock, killOnShutdown };
