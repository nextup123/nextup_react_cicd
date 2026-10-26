'use strict';

// update/config.js -- the software update of the whole console (Settings > Software Update).
// Grown from the EtherCAT Config Tool's updater: it now updates the nextup-react folder (backend,
// frontend and the drive tools in one version), from version tags of the app's git repository.
//
//   <app>/package.json             the console's version (the one place it is written)
//   <app>/release-notes.json       what the version changes (shown before installing)
//   <user_config_files>/software_update
//                                  update settings, progress, logs, the record of updates and
//                                  problem reports, copies of the operator's files (backups/)
// Only Node built-ins: the update worker loads this before it changes any program file.

const fs = require('fs');
const os = require('os');
const path = require('path');

const BACKEND = path.resolve(__dirname, '..');
const ROOT = path.resolve(BACKEND, '..');
const HOME = process.env.NEXTUP_HOME || os.homedir() || '/home/nextup';
const USER_CONFIG_FILES = process.env.NEXTUP_USER_CONFIG_FILES || path.join(HOME, 'user_config_files');

function readVersion() {
  try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version || '0.0.0'; } catch { return '0.0.0'; }
}

function envBool(name, fallback = false) {
  const v = process.env[name];
  if (v === undefined || v === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(v).toLowerCase());
}

module.exports = {
  ROOT,
  BACKEND,
  FRONTEND: path.join(ROOT, 'frontend'),
  APP_USER_CONFIG: path.join(BACKEND, 'user_config'),
  DATA_DIR: process.env.UPDATE_DATA_DIR ? path.resolve(process.env.UPDATE_DATA_DIR) : path.join(USER_CONFIG_FILES, 'software_update'),
  // The drive tools' files: copied before each update, recipes and drive settings can be put back.
  ECAT_DATA_DIR: process.env.ECAT_DATA_DIR ? path.resolve(process.env.ECAT_DATA_DIR) : path.join(USER_CONFIG_FILES, 'ethercat'),

  // Release server (release_hub): problem reports and update records. The app id names this
  // console there.
  APP_ID: process.env.UPDATE_APP_ID || 'nextup_react',
  APP_VERSION: readVersion(),

  // `npm start` (update/launcher.js) starts the server again when it exits with this code.
  RESTART_EXIT_CODE: 75,
  SUPERVISED: envBool('RUN_SUPERVISED', false),

  UPDATE_REPO: process.env.UPDATE_REPO || '',
  UPDATE_TAG_PREFIX: process.env.UPDATE_TAG_PREFIX || 'v',
  HUB_URL: process.env.HUB_URL || '',

  // Same password as the drive tools (Manual read/write).
  PASSWORD: process.env.UPDATE_PASSWORD || process.env.ECAT_PASSWORD || process.env.SDO_PASSWORD || '123',

  // Program files of a version, relative to ROOT. Lock files may change on the PC (npm install).
  PART_FILES: ['package.json', 'backend/package.json', 'frontend/package.json'],
  LOCK_FILES: ['backend/package-lock.json', 'frontend/package-lock.json'],
  // Folders inside the app the console writes while it runs (layouts, PLC state, preferences,
  // built screens). An update keeps the PC's copy of every file there that differs from the
  // released one, and they do not count as "program files changed on this PC".
  KEEP_LOCAL: ['backend/user_config/', 'backend/config/layouts/', 'backend/config/sim_records/', 'backend/points_backup.yaml', 'backend/my_bt_log.fbl', 'backend/my_bt_log.json'],
  envBool,
};
