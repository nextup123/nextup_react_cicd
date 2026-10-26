// backend/ros/bindings.js
//
// rclnodejs reads every message through JavaScript layouts generated from the
// installed .msg / .srv files (`generate-ros-messages`). When an interface
// package changes (nextup_joint_interfaces, nextup_utility_interface) and the
// layouts are not regenerated, the native code writes a bigger message into a
// smaller buffer and the whole Node process dies with heap corruption; no
// try/catch can stop that (this is what crashed the controller test web).
//
// So before rclnodejs is loaded, this hashes the installed interface files of
// the NextUp packages and, when they changed since the last generation (or the
// generated files are missing), runs generate-ros-messages once.
// NEXTUP_AUTOGEN_BINDINGS=0 turns the automatic generation off (the check and
// the warning stay).

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKEND = path.resolve(__dirname, '..');
const HASH_FILE = path.join(BACKEND, 'user_config', '.ros_bindings_hash');
const PACKAGES = ['nextup_joint_interfaces', 'nextup_utility_interface', 'control_logic_bt_interfaces', 'nextplc', 'ethercat_msgs'];

/** Every .msg / .srv / .idl file of the NextUp interface packages found on AMENT_PREFIX_PATH. */
function interfaceFiles() {
  const prefixes = String(process.env.AMENT_PREFIX_PATH || '').split(':').filter(Boolean);
  const files = [];
  const seen = new Set();
  for (const pkg of PACKAGES) {
    for (const prefix of prefixes) {
      const share = path.join(prefix, 'share', pkg);
      if (!fs.existsSync(share) || seen.has(pkg)) continue;
      seen.add(pkg); // the first prefix wins, like ROS itself
      for (const sub of ['msg', 'srv', 'action']) {
        const dir = path.join(share, sub);
        if (!fs.existsSync(dir)) continue;
        for (const f of fs.readdirSync(dir).sort()) {
          if (/\.(msg|srv|action)$/.test(f)) files.push(path.join(dir, f));
        }
      }
    }
  }
  return { files, found: [...seen] };
}

function hashFiles(files) {
  const h = crypto.createHash('sha256');
  for (const f of files) {
    h.update(path.basename(f));
    h.update(fs.readFileSync(f));
  }
  return h.digest('hex');
}

function generatedDir() {
  return path.join(BACKEND, 'node_modules', 'rclnodejs', 'generated');
}

function generatedFor(pkg) {
  return fs.existsSync(path.join(generatedDir(), pkg));
}

/**
 * Check (and if needed regenerate) the rclnodejs bindings. Never throws.
 * @returns {{ status: 'ok'|'regenerated'|'stale'|'skipped', message: string, packages: string[] }}
 */
export function ensureBindings() {
  try {
    if (!fs.existsSync(path.join(BACKEND, 'node_modules', 'rclnodejs'))) {
      return { status: 'skipped', message: 'rclnodejs is not installed', packages: [] };
    }
    const { files, found } = interfaceFiles();
    if (!files.length) {
      return { status: 'skipped', message: 'NextUp interface packages not found on AMENT_PREFIX_PATH (source the workspaces first)', packages: [] };
    }
    const hash = hashFiles(files);
    let previous = '';
    try {
      previous = fs.readFileSync(HASH_FILE, 'utf8').trim();
    } catch {
      /* first start */
    }
    const missing = found.filter((p) => !generatedFor(p));
    if (hash === previous && missing.length === 0) {
      return { status: 'ok', message: 'message bindings match the installed interfaces', packages: found };
    }

    const why = missing.length ? `no bindings for ${missing.join(', ')}` : 'interface files changed since the last generation';
    if (process.env.NEXTUP_AUTOGEN_BINDINGS === '0') {
      return { status: 'stale', message: `${why}; run "npx generate-ros-messages" in backend/ and restart`, packages: found };
    }

    console.log(`[ROS] ${why}: regenerating rclnodejs message bindings (one time, may take a minute)…`);
    const script = path.join(BACKEND, 'node_modules', 'rclnodejs', 'scripts', 'generate_messages.js');
    const run = fs.existsSync(script)
      ? spawnSync(process.execPath, [script], { cwd: BACKEND, stdio: 'inherit', timeout: 10 * 60 * 1000 })
      : spawnSync('npx', ['generate-ros-messages'], { cwd: BACKEND, stdio: 'inherit', timeout: 10 * 60 * 1000 });
    if (run.status !== 0) {
      return { status: 'stale', message: `${why}; automatic generation failed (exit ${run.status}). Run "npx generate-ros-messages" in backend/`, packages: found };
    }
    fs.mkdirSync(path.dirname(HASH_FILE), { recursive: true });
    fs.writeFileSync(HASH_FILE, hash);
    return { status: 'regenerated', message: `${why}; bindings regenerated`, packages: found };
  } catch (err) {
    return { status: 'stale', message: `bindings check failed: ${err.message}`, packages: [] };
  }
}
