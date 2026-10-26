'use strict';

/**
 * Runs an update or a "go back" of the console in its own process, so it finishes even if
 * the console restarts meanwhile.
 *
 *   node backend/update/update-worker.js '<json>'
 *
 * The server starts it (Install / Go back) with the job written to jobFile,
 * and reads progress from that file. update/launcher.js also runs it, with
 * auto=true, to put the previous version back when a new one does not start.
 *
 * On success the folder holds the new version, with its screens built in
 * frontend/dist-next; the console uses it from the next start. On failure the
 * folder is put back the way it was.
 */

const fs = require('fs');
const path = require('path');
const g = require('./lib/gitUpdate');
const { backupUserData } = require('./lib/backup');

const a = JSON.parse(process.argv[2] || '{}');

function readJsonSafe(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}
function writeJson(file, data) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}

const job = readJsonSafe(a.jobFile) || {
  id: `${a.mode}-${Date.now()}`, kind: a.mode, target: a.target, steps: [], log: [], startedAt: new Date().toISOString(),
};
Object.assign(job, { state: 'running', pid: process.pid, error: null });

let saveTimer = null;
function save(now = false) {
  if (!a.jobFile) return;
  clearTimeout(saveTimer);
  if (now) writeJson(a.jobFile, job);
  else saveTimer = setTimeout(() => writeJson(a.jobFile, job), 300);
}

function log(line) {
  const clean = g.hideToken(line);
  job.log.push(clean);
  if (job.log.length > 300) job.log.splice(0, job.log.length - 300);
  if (a.logFile) fs.appendFileSync(a.logFile, `${clean}\n`);
  if (a.auto) console.log(`[UPDATE] ${clean}`);
  save();
}

const STEPS = {
  update: [
    ['download', 'Download the new version'],
    ['save', 'Remember this version for going back'],
    ['backup', 'Save a copy of the settings and drive recipes'],
    ['switch', 'Put the new files in place'],
    ['install', 'Install the parts it needs'],
    ['build', 'Build the screens'],
    ['check', 'Check that it starts'],
  ],
  rollback: [
    ['switch', 'Put the earlier version back'],
    ['install', 'Install the parts it needs'],
    ['build', 'Build the screens'],
  ],
};
job.steps = STEPS[a.mode].map(([id, label]) => ({ id, label, state: 'waiting', detail: '' }));

function step(id, state, detail) {
  const st = job.steps.find((x) => x.id === id);
  st.state = state;
  if (detail !== undefined) st.detail = detail;
  save(true);
}

function fail(message, detail) {
  const e = new Error(message);
  if (detail) e.detail = detail;
  return e;
}

/** Puts the folder back at `prev` after a failed update. */
async function restore(info, prev, { installed, target }) {
  log(`Putting version ${a.fromVersion} back`);
  await g.checkout(info, prev.branch || prev.commit, log);
  if (installed && (await g.partsChanged(info, prev.commit, target))) await g.installParts(a.root, { mock: a.mock, log });
  fs.rmSync(path.join(a.root, 'frontend', g.NEXT_DIST), { recursive: true, force: true });
  log(`Version ${a.fromVersion} is back in place`);
}

async function update() {
  const { version, tag } = a.target;
  let info;
  let prev = null;
  let switched = false;
  let installed = false;
  try {
    step('download', 'running');
    info = await g.fetchTags(a.root, a.repoUrl, log);
    const tags = await g.listTags(info.top, a.tagPrefix);
    if (!tags.some((t) => t.tag === tag)) throw fail(`Version ${version} (tag ${tag}) is not in the repository`);
    if (a.onlyChecked && !(await g.isChecked(info.top, tag))) {
      throw fail(`Version ${version} has not passed the release check yet (no ${g.CHECKED_PREFIX}${tag} tag). Wait for the check on GitHub to finish, then try again.`);
    }
    const inside = await g.versionAt(info, tag);
    if (!inside) throw fail(`No package.json for this console in ${tag}. Is the repository address right?`);
    if (inside !== version) throw fail(`${tag} contains version ${inside} in package.json. Set package.json to ${version} before tagging.`);
    step('download', 'done');

    step('save', 'running');
    const changed = await g.changedProgramFiles(info);
    if (changed.length) {
      throw fail(`Program files on this PC were changed (${changed.slice(0, 5).join(', ')}${changed.length > 5 ? ' …' : ''}). An update would overwrite them, so nothing was done. On a development PC, commit or undo those changes first.`);
    }
    if (!info.tracked) {
      // Unzipped copy: record it as a commit first, so "Go back" and a failed update can return to it.
      log('Recording this copy so it can be restored');
      await g.run('git', ['-C', info.top, 'add', '-A'], { log });
      await g.run('git', ['-C', info.top, '-c', 'user.name=NextUp console', '-c', 'user.email=console@localhost', 'commit', '-q', '--allow-empty', '-m', `Version ${a.fromVersion} as it was on this PC`], { log });
      info = await g.folderInfo(a.root);
    }
    prev = { ...(await g.headOf(info)), version: a.fromVersion };
    if (!prev.commit) throw fail('Could not record the current version');
    step('save', 'done', prev.branch ? `branch ${prev.branch}` : prev.commit.slice(0, 8));

    step('backup', 'running');
    prev.backup = backupUserData(a.dataDir, `before version ${version}`);
    log(`Copy of the settings and drive recipes saved in ${path.join(path.basename(a.dataDir), 'backups', prev.backup)}`);
    step('backup', 'done', prev.backup);

    step('switch', 'running');
    await g.checkout(info, tag, log);
    switched = true;
    step('switch', 'done');

    step('install', 'running');
    const needInstall = !fs.existsSync(path.join(a.root, 'backend', 'node_modules')) || !fs.existsSync(path.join(a.root, 'frontend', 'node_modules'))
      || (await g.partsChanged(info, prev.commit, tag));
    if (needInstall) {
      await g.installParts(a.root, { mock: a.mock, log });
      installed = true;
      step('install', 'done', 'installed');
    } else {
      log('Same parts as before, nothing to install');
      step('install', 'done', 'nothing new needed');
    }

    step('build', 'running');
    await g.buildScreens(a.root, log);
    step('build', 'done');

    step('check', 'running');
    if (!a.mock && a.healthBefore?.robot) {
      await g.run(process.execPath, ['-e', "require('rclnodejs')"], { cwd: path.join(a.root, 'backend'), timeoutMs: 60000 })
        .catch((err) => { throw fail(`The robot connection part of the new version does not load: ${err.message}`); });
    }
    await g.smokeTest(a.root, a.dataDir, log);
    step('check', 'done');

    writeJson(a.stateFile, {
      pendingRestart: true, kind: 'update', fromVersion: a.fromVersion, toVersion: version, tag,
      startedAt: job.startedAt, preparedAt: new Date().toISOString(), previous: prev,
      // How the PC was before, so the new version can tell if it broke something (see updater.onStartup).
      healthBefore: a.healthBefore || null,
    });
    job.state = 'ready';
  } catch (err) {
    const failed = job.steps.find((x) => x.state === 'running');
    if (failed) { failed.state = 'failed'; failed.detail = err.message; }
    job.failedStep = failed?.id || '';
    job.error = err.message;
    log(`FAILED: ${err.message}${err.detail ? ` (${err.detail})` : ''}`);
    if (switched) {
      try {
        await restore(info, prev, { installed, target: tag });
      } catch (e2) {
        job.error = `${err.message} Putting version ${a.fromVersion} back also failed: ${e2.message}`;
        job.restoreFailed = true;
        log(`Could not put the earlier version back: ${e2.message}`);
      }
    }
    job.state = 'failed';
  }
}

/** Go back to the version saved before the last update (by hand, or automatically when it did not start). */
async function rollback() {
  const state = readJsonSafe(a.stateFile);
  const prev = state?.previous;
  try {
    step('switch', 'running');
    if (!prev?.commit) throw fail('There is no earlier version on this PC to go back to');
    const info = await g.folderInfo(a.root);
    const here = await g.headOf(info);
    await g.checkout(info, prev.branch || prev.commit, log);
    step('switch', 'done');

    step('install', 'running');
    if (await g.partsChanged(info, here.commit, prev.commit)) {
      await g.installParts(a.root, { mock: a.mock, log });
      step('install', 'done', 'installed');
    } else {
      step('install', 'done', 'nothing new needed');
    }

    step('build', 'running');
    await g.buildScreens(a.root, log);
    step('build', 'done');

    writeJson(a.stateFile, {
      pendingRestart: true, kind: 'rollback', fromVersion: a.fromVersion, toVersion: prev.version, tag: '',
      startedAt: job.startedAt, preparedAt: new Date().toISOString(),
      // The version left behind, so it can be switched to again, unless it failed to start.
      previous: a.auto ? null : { ...here, version: a.fromVersion },
      ...(a.auto ? { autoRolledBack: { version: a.fromVersion, reason: a.reason || '', at: new Date().toISOString() } } : {}),
      // Recipes and settings from before the update go back too (at the next start, so the
      // running version cannot write over them). Always after a failed start; by choice otherwise.
      restoreData: prev.backup && (a.auto || a.restoreData !== false) ? prev.backup : null,
    });
    job.state = 'ready';
  } catch (err) {
    const failed = job.steps.find((x) => x.state === 'running');
    if (failed) { failed.state = 'failed'; failed.detail = err.message; }
    job.error = err.message;
    job.state = 'failed';
    log(`FAILED: ${err.message}`);
  }
}

(a.mode === 'rollback' ? rollback() : update()).then(() => {
  job.finishedAt = new Date().toISOString();
  save(true);
  process.exit(job.state === 'ready' ? 0 : 1);
});
