'use strict';

/**
 * Software update of the whole console (nextup-react: backend, frontend, drive tools) from its
 * git repository, in the console's own folder.
 *
 *   Check for updates  fetch the version tags and list the newer ones with their notes
 *   Install            update/update-worker.js checks out the tag, installs what changed,
 *                      builds the screens and test-starts the new version (simulated robot,
 *                      spare port); on any failure it puts the folder back
 *   Restart now        the server exits with code 75; `npm start` (update/launcher.js)
 *                      starts it again, now the new version. Started another way (npm run
 *                      dev, a service that runs server.js), the console is restarted by hand.
 *   Go back            the worker checks out the version from before the last update
 *
 * If a new version stops within a minute of starting, the launcher puts the
 * previous one back by itself. Only tagged versions are installed (tag =
 * prefix + version, e.g. v1.1.0).
 *
 * Files (<user_config_files>/software_update): update_job.json (progress of the running or last
 * job), update_state.json (what the next start should be and how to go back), logs/*.log.
 */

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { spawn } = require('child_process');
const config = require('../config');
const settings = require('./settings');
const hub = require('./hub');
const history = require('./history');
const g = require('./gitUpdate');
const { probes, healthWorse } = require('./probes');
const { readJson, writeJsonAtomic } = require('./util');

const JOB = () => path.join(config.DATA_DIR, 'update_job.json');
const STATE = () => path.join(config.DATA_DIR, 'update_state.json');
const LOGS = () => path.join(config.DATA_DIR, 'logs');
// A new version that keeps running this long counts as working.
const CONFIRM_AFTER_MS = 60000;
// After an update the robot connection and the drives are checked at these times (s after
// start). One good check is enough; if all of them find things worse than before, it goes back.
const HEALTH_CHECKS_S = [15, 25, 35, 45];

const STARTED_AT = new Date().toISOString();
let lastCheck = null;
let lastStartupNotice = null;

const readSafe = (file) => readJson(file).catch(() => null);

function httpError(message, status) {
  const err = new Error(message);
  err.status = status;
  return err;
}

/** Refuses while the robot program runs, the robot moves, a recipe runs or drive settings are written. */
function refuseWhileBusy(action) {
  const b = probes.busy();
  if (b.busy) throw httpError(`${action} waits until the robot and the drives are free: ${b.what}. Try again when it has finished.`, 409);
}

function alive(pid) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

/** The job file, with a worker that died mid-way shown as failed. */
async function readJob() {
  const job = await readSafe(JOB());
  if (job?.state === 'running' && job.pid && !alive(job.pid)) {
    job.state = 'failed';
    job.error = 'The update stopped unexpectedly. Check the folder with "Check for updates", and try again.';
    job.finishedAt = new Date().toISOString();
    await writeJsonAtomic(JOB(), job);
  }
  return job;
}

/** Record a finished job once in History and on the report server. */
async function recordJob(job) {
  if (!job || job.state === 'running' || job.recorded) return;
  job.recorded = true;
  await writeJsonAtomic(JOB(), job);
  const v = job.target?.version;
  if (job.state === 'failed') {
    const failed = job.steps?.find((s) => s.state === 'failed');
    history.record({
      kind: 'update', outcome: 'failed',
      title: job.kind === 'rollback' ? `Going back to ${v} failed` : `Update to ${v} failed`,
      detail: `${failed?.label || ''}: ${job.error}`,
    });
    if (job.kind === 'update') {
      hub.recordUpdate({
        kind: 'update', fromVersion: config.APP_VERSION, toVersion: v, tag: job.target?.tag, result: 'failed',
        failedStep: job.failedStep, error: job.error, log: (job.log || []).slice(-80).join('\n'),
        startedAt: job.startedAt, finishedAt: job.finishedAt,
        durationSec: job.finishedAt ? Math.round((new Date(job.finishedAt) - new Date(job.startedAt)) / 1000) : null,
      }).catch(() => {});
    }
  } else if (job.state === 'ready') {
    history.record({ kind: 'update', outcome: 'info', title: `Version ${v} is ready`, detail: 'It starts the next time the console starts.' });
  }
}

async function source() {
  const info = await g.folderInfo(config.ROOT).catch(() => ({ kind: 'unpacked' }));
  const origin = info.kind === 'clone' ? await g.remoteUrl(info.top) : '';
  return { kind: info.kind, origin: g.hideToken(origin), subdir: info.subdir || '' };
}

/** Fetch tags and say which newer versions exist, with their release notes. */
async function check() {
  const s = await settings.get();
  const info = await g.fetchTags(config.ROOT, s.repoUrl, null);
  const tags = (await g.listTags(info.top, s.tagPrefix)).filter((t) => g.compareVersions(t.version, config.APP_VERSION) > 0);
  const hubNotes = await hub.releaseNotes();
  const available = [];
  for (const t of tags.slice(0, 10)) {
    const fromHub = hubNotes?.find((r) => r.version === t.version);
    if (fromHub && fromHub.status === 'withdrawn') continue;
    const notes = fromHub || (await g.notesAt(info, t.tag));
    const checked = await g.isChecked(info.top, t.tag);
    available.push({ ...t, notes, notesFrom: fromHub ? 'server' : notes ? 'repository' : null, checked, installable: checked || s.onlyChecked === false });
  }
  lastCheck = { at: new Date().toISOString(), available, onlyChecked: s.onlyChecked !== false, error: null };
  return lastCheck;
}

async function launchWorker(mode, target, extra = {}) {
  const current = await readJob();
  if (current?.state === 'running') throw httpError('An update is already running', 409);
  const s = await settings.get();
  await fsp.mkdir(LOGS(), { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const logFile = path.join(LOGS(), `${mode}-${target.version}-${stamp}.log`);
  const job = {
    id: `${mode}-${Date.now()}`, kind: mode, state: 'running', target, steps: [], log: [],
    startedAt: new Date().toISOString(), error: null,
  };
  await writeJsonAtomic(JOB(), job);
  const out = fs.openSync(logFile, 'a');
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'update-worker.js'), JSON.stringify({
    mode, target, root: config.ROOT, dataDir: config.DATA_DIR, jobFile: JOB(), stateFile: STATE(), logFile,
    repoUrl: s.repoUrl, tagPrefix: s.tagPrefix, onlyChecked: s.onlyChecked !== false, mock: probes.simulated(), fromVersion: config.APP_VERSION, ...extra,
  })], { cwd: config.ROOT, detached: true, stdio: ['ignore', out, out], env: process.env });
  child.unref();
  fs.closeSync(out);
  job.pid = child.pid;
  await writeJsonAtomic(JOB(), job);
  return job;
}

async function start(version) {
  const s = await settings.get();
  const v = String(version || '').replace(/^v/i, '');
  if (!g.VERSION_RE.test(v)) throw httpError('Choose a version to install', 400);
  if (g.compareVersions(v, config.APP_VERSION) === 0) throw httpError(`Version ${v} is already running`, 400);
  const state = await readSafe(STATE());
  if (state?.pendingRestart) throw httpError(`Version ${state.toVersion} is already installed and waiting for a restart. Restart the console first.`, 409);
  refuseWhileBusy('Installing');
  // How the robot and the drives are now, so the new version can tell if it made them worse.
  const healthBefore = await probes.health().catch(() => null);
  const job = await launchWorker('update', { version: v, tag: `${s.tagPrefix}${v}` }, { healthBefore });
  history.record({ kind: 'update', outcome: 'info', title: `Updating to version ${v}`, detail: `From version ${config.APP_VERSION}` });
  return job;
}

/** Put the version from before the last update back; it runs from the next start. */
async function rollback({ restoreData = true } = {}) {
  const state = await readSafe(STATE());
  if (state?.pendingRestart) throw httpError('Restart the console first: a change is waiting for the restart.', 409);
  const prev = state?.previous;
  if (!prev?.commit) throw httpError('There is no earlier version on this PC to go back to', 400);
  refuseWhileBusy('Going back');
  const job = await launchWorker('rollback', { version: prev.version, tag: '' }, { restoreData: restoreData !== false });
  history.record({ kind: 'update', outcome: 'info', title: `Going back to version ${prev.version}`, detail: `From version ${config.APP_VERSION}` });
  return job;
}

/**
 * Called once the server is listening. If an update or "go back" was waiting
 * for this start, say how it went (here and on the report server).
 */
async function onStartup() {
  if (process.env.UPDATE_SMOKE_TEST) return;
  await recordJob(await readJob()).catch(() => {});
  const state = await readSafe(STATE());
  if (!state?.pendingRestart) return;
  const base = {
    kind: state.kind, fromVersion: state.fromVersion, toVersion: state.toVersion, tag: state.tag,
    startedAt: state.startedAt, finishedAt: new Date().toISOString(),
    durationSec: state.startedAt ? Math.round((Date.now() - new Date(state.startedAt).getTime()) / 1000) : null,
  };
  if (state.toVersion !== config.APP_VERSION) return; // Files not switched (an older copy was started by hand).

  const restored = state.dataRestored?.length ? ' Drive recipes and settings from before the update were put back; the ones from the newer version are kept in a copy (software_update/backups).' : '';
  const restoreProblem = state.dataRestoreError ? ` Recipes and settings could not be put back: ${state.dataRestoreError}` : '';

  if (state.autoRolledBack) {
    const why = state.autoRolledBack.reason || 'The new version stopped right after starting.';
    lastStartupNotice = { tone: 'danger', text: `Version ${state.autoRolledBack.version} did not work, so version ${config.APP_VERSION} was put back. ${why}${restored}${restoreProblem}` };
    history.record({ kind: 'update', outcome: 'failed', title: `Version ${state.autoRolledBack.version} did not work`, detail: `${why} Version ${config.APP_VERSION} was put back.` });
    await hub.recordUpdate({ ...base, kind: 'update', fromVersion: config.APP_VERSION, toVersion: state.autoRolledBack.version, result: 'rolled_back', failedStep: 'start', error: why });
    await writeJsonAtomic(STATE(), { ...state, pendingRestart: false, confirmedAt: new Date().toISOString() });
    return;
  }

  lastStartupNotice = {
    tone: restoreProblem ? 'warn' : 'ok',
    text: state.kind === 'rollback' ? `Went back to version ${config.APP_VERSION}.${restored}${restoreProblem}` : `Updated from version ${state.fromVersion} to ${config.APP_VERSION}.`,
  };
  // Keep the state until the new version has run for a minute and the drives look no worse
  // than before the update: if it stops before, the launcher puts the previous version back.
  await writeJsonAtomic(STATE(), { ...state, pendingRestart: false });
  const worse = state.kind === 'update' && state.healthBefore ? await checkHealth(state.healthBefore) : '';
  if (worse) {
    await healthFailed(state, worse, base);
    return;
  }
  setTimeout(async () => {
    await writeJsonAtomic(STATE(), { ...state, pendingRestart: false, confirmedAt: new Date().toISOString() });
    history.record({
      kind: 'update', outcome: 'ok',
      title: state.kind === 'rollback' ? `Went back to version ${config.APP_VERSION}` : `Updated to version ${config.APP_VERSION}`,
      detail: `Was version ${state.fromVersion}`,
    });
    await hub.recordUpdate({ ...base, result: 'success' }).catch(() => {});
  }, Math.max(0, CONFIRM_AFTER_MS - (Date.now() - PROCESS_START))).unref();
}

const PROCESS_START = Date.now();
const wait = (ms) => new Promise((r) => { setTimeout(r, ms).unref(); });

/** '' when the robot and drives are as good as before the update at one of the checks; otherwise what got worse. */
async function checkHealth(before) {
  let worse = '';
  for (const atS of HEALTH_CHECKS_S) {
    await wait(Math.max(0, atS * 1000 - (Date.now() - PROCESS_START)));
    const now = await probes.health().catch(() => ({ robot: false, controller: false, drives: 0 }));
    worse = healthWorse(before, now);
    if (!worse) return '';
    console.log(`[UPDATE] health check after ${atS} s: ${worse}`);
  }
  return worse;
}

/** The new version made the robot connection or the drives worse: go back by itself (npm start) or say so. */
async function healthFailed(state, worse, base) {
  const why = `Version ${config.APP_VERSION} started, but ${worse} (they did before the update).`;
  history.record({ kind: 'update', outcome: 'failed', title: `Version ${config.APP_VERSION} failed its check after starting`, detail: why });
  await writeJsonAtomic(STATE(), { ...state, pendingRestart: false, healthFailure: `${worse} (they did before the update)` });
  if (config.SUPERVISED) {
    console.error(`[UPDATE] ${why} Putting the previous version back.`);
    // The launcher sees the quick stop and puts the previous version back.
    process.exit(1);
  }
  lastStartupNotice = { tone: 'danger', text: `${why} Press "Go back to ${state.previous?.version || 'the previous version'}" below.` };
  await hub.recordUpdate({ ...base, result: 'failed', failedStep: 'check', error: why }).catch(() => {});
}

/** A job is shown while it runs, while it waits for the restart, or when it failed since this start. */
function showJob(job, state) {
  if (!job) return false;
  if (job.state === 'running') return true;
  if (job.state === 'ready') return !!state?.pendingRestart;
  return (job.finishedAt || '') > STARTED_AT;
}

async function status() {
  const job = await readJob();
  await recordJob(job).catch(() => {});
  const state = await readSafe(STATE());
  const src = await source();
  const s = await settings.get();
  let setupNote = '';
  if (src.kind === 'unpacked' && !s.repoUrl) setupNote = 'Enter the repository address in "Update settings" below to get updates.';
  return {
    version: config.APP_VERSION,
    canUpdate: !setupNote,
    setupNote,
    source: src,
    supervised: config.SUPERVISED,
    previousVersion: !state?.pendingRestart && state?.previous?.commit ? state.previous.version : null,
    previousBackup: !state?.pendingRestart && state?.previous?.backup ? state.previous.backup : null,
    busy: probes.busy(),
    waitingForRestart: state?.pendingRestart ? state.toVersion : null,
    job: showJob(job, state) ? { ...job, log: (job.log || []).slice(-200) } : null,
    lastCheck,
    notice: lastStartupNotice,
  };
}

module.exports = { check, start, rollback, status, onStartup, refuseWhileBusy, compareVersions: g.compareVersions };
