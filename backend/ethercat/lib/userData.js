'use strict';

/**
 * The operator's own files of the drive tools (recipes, drive settings, history, fault
 * snapshots) live in <user_config_files>/ethercat, outside the program files, so a software
 * update never replaces them. The first start copies the starter files from
 * backend/ethercat/data, or, when this PC ran the separate EtherCAT Config Tool before, that
 * tool's files (its user-data/ folder), so recipes and drive settings carry over.
 */

const fs = require('fs');
const path = require('path');
const config = require('../config');

// Starter files every PC gets.
const SEED_FILES = ['driver_config.json', 'recipe.json', 'error_log.json', 'sequence.json'];
// Files the separate tool made on each PC (the update ones now belong to the whole console).
const OWN_FILES = ['history.json', 'drive_profiles.json'];

// Where the separate EtherCAT Config Tool kept them (ECAT_IMPORT_FROM names another folder).
function oldToolDirs() {
  const list = [];
  if (process.env.ECAT_IMPORT_FROM) list.push(process.env.ECAT_IMPORT_FROM);
  for (const name of ['ethercat_config_tool', 'ethercat_config_tool_react', 'ethercat-config-tool']) {
    list.push(path.join(config.HOME, name, 'user-data'), path.join(config.HOME, name, 'data'));
  }
  return list.filter((d) => fs.existsSync(path.join(d, 'recipe.json')));
}

function seedUserData() {
  const fresh = !fs.existsSync(config.DATA_DIR);
  fs.mkdirSync(config.DATA_DIR, { recursive: true });
  const from = fresh ? oldToolDirs()[0] : null;
  if (from) console.log(`[ECAT] first start: taking recipes and drive settings from ${from}`);
  for (const name of [...SEED_FILES, ...OWN_FILES]) {
    const target = path.join(config.DATA_DIR, name);
    if (fs.existsSync(target)) continue;
    const source = [from && path.join(from, name), path.join(config.BUNDLED_DATA_DIR, name)].find((f) => f && fs.existsSync(f));
    if (source) fs.copyFileSync(source, target);
  }
}

module.exports = { seedUserData, SEED_FILES, OWN_FILES };
