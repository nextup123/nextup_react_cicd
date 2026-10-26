'use strict';

/**
 * Update and problem-report settings (update_settings.json) and this machine's
 * identity (machine.json), in <user_config_files>/software_update, so they
 * survive updates.
 */

const crypto = require('crypto');
const os = require('os');
const path = require('path');
const config = require('../config');
const { readJson, updateJson } = require('./util');

const FILE = () => path.join(config.DATA_DIR, 'update_settings.json');
const MACHINE_FILE = () => path.join(config.DATA_DIR, 'machine.json');

const DEFAULTS = () => ({
  repoUrl: config.UPDATE_REPO,
  tagPrefix: config.UPDATE_TAG_PREFIX,
  hubUrl: config.HUB_URL,
  machineName: os.hostname(),
  site: '',
  // Offer only versions the release check (GitHub Action) passed: it adds a tag verified/<tag>.
  onlyChecked: true,
});

const str = (v, max) => (v === undefined || v === null ? '' : String(v).trim().slice(0, max));

async function get() {
  let saved = {};
  try { saved = await readJson(FILE()); } catch { /* defaults */ }
  return { ...DEFAULTS(), ...saved };
}

/** Hide tokens: "https://ghp_abc@github.com/x/y" → "https://•••@github.com/x/y". */
function maskUrl(url) {
  return String(url || '').replace(/\/\/[^/@]+@/, '//•••@');
}

/** What the browser may see: no keys or tokens. */
async function getPublic() {
  const s = await get();
  return {
    repoUrl: maskUrl(s.repoUrl),
    repoHasToken: maskUrl(s.repoUrl) !== s.repoUrl,
    tagPrefix: s.tagPrefix,
    hubUrl: s.hubUrl,
    machineName: s.machineName,
    site: s.site,
    onlyChecked: s.onlyChecked !== false,
  };
}

/** Fields left out (or a masked repo URL sent back unchanged) keep their saved value. */
async function save(input) {
  const current = await get();
  const next = { ...current };
  if (input.repoUrl !== undefined && input.repoUrl !== maskUrl(current.repoUrl)) {
    const url = str(input.repoUrl, 400);
    if (url && !/^(https:\/\/|ssh:\/\/|git@|file:\/\/|\/)/.test(url)) {
      const err = new Error('The update source must start with https://, git@ or ssh://');
      err.status = 400;
      throw err;
    }
    next.repoUrl = url;
  }
  if (input.tagPrefix !== undefined) next.tagPrefix = str(input.tagPrefix, 40);
  if (input.hubUrl !== undefined) next.hubUrl = str(input.hubUrl, 300).replace(/\/+$/, '');
  if (input.machineName !== undefined) next.machineName = str(input.machineName, 80) || os.hostname();
  if (input.site !== undefined) next.site = str(input.site, 120);
  if (input.onlyChecked !== undefined) next.onlyChecked = input.onlyChecked !== false;
  await updateJson(FILE(), (data) => { Object.assign(data, next); return data; }, {});
  return getPublic();
}

let machineCache = null;
async function machine() {
  if (machineCache) return machineCache;
  machineCache = await updateJson(MACHINE_FILE(), (data) => {
    if (data.machineId) return null;
    data.machineId = crypto.randomUUID();
    data.createdAt = new Date().toISOString();
    return data;
  }, {}) || await readJson(MACHINE_FILE());
  return machineCache;
}

async function machineInfo() {
  const s = await get();
  const m = await machine();
  return {
    machineId: m.machineId,
    name: s.machineName,
    site: s.site,
    hostname: os.hostname(),
    os: `${os.type()} ${os.release()}`,
  };
}

module.exports = { get, getPublic, save, machine, machineInfo, maskUrl };
