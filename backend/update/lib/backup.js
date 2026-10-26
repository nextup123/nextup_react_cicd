'use strict';

/**
 * Copies of the operator's files (<user_config_files>/software_update/backups/<time> <why>/),
 * made before every update and before going back:
 *   ethercat/   the drive tools' recipes, drive settings, history and fault snapshots
 *   app/        the console's own state inside the program folder (backend/user_config:
 *               preferences, PLC state, bundled templates as this PC has them)
 *   update_settings.json
 * "Go back" can put the recipes and drive settings from before the update back, in case the
 * newer version changed them. History, the fault log and app/ are only kept as a copy.
 */

const fs = require('fs');
const path = require('path');
const config = require('../config');

const DIR = 'backups';
const KEEP = 10;
// Put back on "go back" (drive tools).
const RESTORED = ['driver_config.json', 'recipe.json', 'sequence.json', 'drive_profiles.json'];
// Copied, never put back.
const ALSO_COPIED = ['history.json', 'error_log.json'];
const OWN = ['update_settings.json', 'machine.json'];

const safeName = (s) => String(s).replace(/[^A-Za-z0-9._ -]+/g, '_').slice(0, 80);

function copyDir(from, to, skip = () => false) {
  if (!fs.existsSync(from)) return;
  fs.mkdirSync(to, { recursive: true });
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    const a = path.join(from, e.name);
    if (skip(e.name)) continue;
    if (e.isDirectory()) copyDir(a, path.join(to, e.name), skip);
    else if (e.isFile()) fs.copyFileSync(a, path.join(to, e.name));
  }
}

/** Copies the operator's files into a new backup folder; returns the folder's name. */
function backupUserData(dataDir, why, { ecatDir = config.ECAT_DATA_DIR, appDir = config.APP_USER_CONFIG } = {}) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').replace('T', ' ').slice(0, 19);
  const name = safeName(`${stamp} ${why}`);
  let target = path.join(dataDir, DIR, name);
  for (let i = 2; fs.existsSync(target); i += 1) target = path.join(dataDir, DIR, `${name} (${i})`);
  fs.mkdirSync(path.join(target, 'ethercat'), { recursive: true });
  const copied = [];
  for (const file of [...RESTORED, ...ALSO_COPIED]) {
    const src = path.join(ecatDir, file);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, path.join(target, 'ethercat', file));
      copied.push(`ethercat/${file}`);
    }
  }
  for (const file of OWN) {
    const src = path.join(dataDir, file);
    if (fs.existsSync(src)) { fs.copyFileSync(src, path.join(target, file)); copied.push(file); }
  }
  if (appDir && fs.existsSync(appDir)) {
    copyDir(appDir, path.join(target, 'app'), (n) => n === 'node_modules' || n.startsWith('.'));
    copied.push('app/');
  }
  fs.writeFileSync(path.join(target, 'backup.json'), JSON.stringify({ why, at: new Date().toISOString(), files: copied }, null, 2));
  prune(dataDir);
  return path.basename(target);
}

/** Keeps the newest backups; older ones are removed. */
function prune(dataDir, keep = KEEP) {
  const root = path.join(dataDir, DIR);
  let names = [];
  try { names = fs.readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name); } catch { return; }
  // Oldest first, by the time written inside (two copies can share a name's second).
  const at = (n) => { try { return JSON.parse(fs.readFileSync(path.join(root, n, 'backup.json'), 'utf8')).at || n; } catch { return n; } };
  names = names.map((n) => [at(n), n]).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)).map(([, n]) => n);
  for (const old of names.slice(0, Math.max(0, names.length - keep))) fs.rmSync(path.join(root, old), { recursive: true, force: true });
}

/**
 * Puts the recipes and drive settings of backup `name` (and the update settings) back. The files
 * as they are now are copied first ("before going back"), so nothing is lost. Returns the files
 * put back.
 */
function restoreUserData(dataDir, name, why = 'before going back', { ecatDir = config.ECAT_DATA_DIR } = {}) {
  const from = path.join(dataDir, DIR, safeName(name));
  if (!name || !fs.existsSync(from)) throw new Error(`The copy "${name}" is not on this PC any more`);
  backupUserData(dataDir, why, { ecatDir });
  const restored = [];
  const put = (src, dst, label) => {
    if (!fs.existsSync(src)) return;
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    const tmp = `${dst}.${process.pid}.restore`;
    fs.copyFileSync(src, tmp);
    fs.renameSync(tmp, dst);
    restored.push(label);
  };
  for (const file of RESTORED) put(path.join(from, 'ethercat', file), path.join(ecatDir, file), file);
  put(path.join(from, 'update_settings.json'), path.join(dataDir, 'update_settings.json'), 'update_settings.json');
  return restored;
}

module.exports = { backupUserData, restoreUserData, prune, RESTORED, ALSO_COPIED, BACKUP_DIR: DIR };
