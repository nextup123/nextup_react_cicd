'use strict';

/**
 * Git and npm steps of a software update, shared by the server (Check for
 * updates) and update/update-worker.js (Install, Go back).
 *
 * The console updates its own folder (nextup-react: backend + frontend): the
 * folder is a git copy of the repository (git clone, or made into one on the
 * first update when it was unzipped), and an update checks out a version tag
 * there, installs the parts that changed and builds the screens into
 * frontend/dist-next. The server swaps dist-next in when it starts, so the
 * running console keeps its screens until the restart.
 *
 * Only Node built-ins are required here, and only at load time: the worker
 * loads this file before it changes the folder, so it keeps running the code
 * it started with.
 */

const fs = require('fs');
const fsp = require('fs/promises');
const net = require('net');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const config = require('../config');

const VERSION_RE = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;
const NOTES_FILE = 'release-notes.json';
const NEXT_DIST = 'dist-next';

const GIT_ENV = {
  GIT_TERMINAL_PROMPT: '0',
  GIT_SSH_COMMAND: process.env.GIT_SSH_COMMAND || 'ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new',
};

const hideToken = (s) => String(s).replace(/\/\/[^/@\s]+@/g, '//•••@');

function compareVersions(a, b) {
  const [ma, pa = ''] = String(a).split('-');
  const [mb, pb = ''] = String(b).split('-');
  const na = ma.split('.').map(Number);
  const nb = mb.split('.').map(Number);
  for (let i = 0; i < 3; i += 1) if ((na[i] || 0) !== (nb[i] || 0)) return (na[i] || 0) - (nb[i] || 0);
  if (pa === pb) return 0;
  if (!pa) return 1;
  if (!pb) return -1;
  return pa < pb ? -1 : 1;
}

/** Runs a command; resolves with its output, rejects with the last lines of it. */
function run(cmd, args, { cwd, env, timeoutMs = 20 * 60 * 1000, log } = {}) {
  return new Promise((resolve, reject) => {
    if (log) log(`$ ${cmd} ${args.join(' ')}`);
    const child = spawn(cmd, args, { cwd, env: { ...process.env, ...GIT_ENV, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let tail = '';
    const onData = (buf) => {
      const s = buf.toString();
      out += s;
      if (out.length > 2e6) out = out.slice(-1e6);
      tail = (tail + s).slice(-4000);
      if (log) s.split(/\r?\n/).filter(Boolean).forEach(log);
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(new Error(err.code === 'ENOENT' ? `${cmd} is not installed on this PC${cmd === 'git' ? ' (install it with: sudo apt install git)' : ''}` : err.message));
    });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      if (code === 0) return resolve(out);
      const last = hideToken(tail.trim().split('\n').slice(-3).join(' '));
      const err = new Error(signal ? `${cmd} took too long and was stopped` : `${cmd} failed: ${last || `exit ${code}`}`);
      err.output = tail;
      reject(err);
    });
  });
}

const git = (root, args, opts) => run('git', ['-C', root, ...args], opts);
const ok = (p) => p.then(() => true, () => false);

/**
 * How this folder relates to git:
 *   clone    the folder is (part of) a git copy that contains this console
 *   unpacked not a git copy yet (unzipped); the first update makes it one
 * `top` is the repository's top folder and `subdir` the console's folder inside it.
 */
async function folderInfo(root) {
  const own = fs.existsSync(path.join(root, '.git'));
  if (!own) {
    // Inside some other repository (e.g. a ROS workspace) that does not hold this console:
    // never touch that one; this folder gets its own repository on the first update.
    const top = (await git(root, ['rev-parse', '--show-toplevel']).catch(() => '')).trim();
    if (!top || !(await ok(git(root, ['ls-files', '--error-unmatch', 'package.json'])))) {
      return { kind: 'unpacked', top: root, subdir: '', tracked: false };
    }
    const subdir = path.relative(fs.realpathSync(top), fs.realpathSync(root)).split(path.sep).join('/');
    return { kind: 'clone', top, subdir, tracked: true };
  }
  const tracked = await ok(git(root, ['ls-files', '--error-unmatch', 'package.json']));
  return { kind: tracked ? 'clone' : 'unpacked', top: root, subdir: '', tracked };
}

async function remoteUrl(top) {
  return (await git(top, ['remote', 'get-url', 'origin']).catch(() => '')).trim();
}

/** Makes an unzipped folder a git copy of the repository (no files change yet). */
async function makeRepo(root, repoUrl, log) {
  if (!fs.existsSync(path.join(root, '.git'))) await git(root, ['init', '-q'], { log });
  const current = await remoteUrl(root);
  if (!current) await git(root, ['remote', 'add', 'origin', repoUrl], { log });
  else if (current !== repoUrl) await git(root, ['remote', 'set-url', 'origin', repoUrl], { log });
}

function plainFetchError(err) {
  const m = err.message;
  let plain = 'Could not download from the update source.';
  if (/is not installed/.test(m)) plain = m;
  else if (/Could not resolve host|unable to access|Network is unreachable|timed out|Connection refused|took too long/i.test(m)) plain = 'Could not reach GitHub. Check the internet connection on this PC.';
  else if (/Authentication|Permission denied|could not read Username|403|not found|Repository not found|Host key verification/i.test(m)) plain = 'GitHub refused access to the repository. Check the repository address in Update settings, and that this PC has access to it.';
  const e = new Error(plain);
  e.detail = hideToken(m);
  return e;
}

/**
 * Downloads the version tags. repoUrl (from Update settings) wins over the
 * address the folder was cloned from. Returns folderInfo.
 */
async function fetchTags(root, repoUrl, log) {
  let info = await folderInfo(root);
  if (info.kind === 'unpacked') {
    if (!repoUrl) {
      const e = new Error('Enter the repository address in "Update settings" below. This copy of the console was not downloaded with git, so it does not know where new versions come from.');
      e.status = 400;
      throw e;
    }
    await makeRepo(root, repoUrl, log);
    info = await folderInfo(root);
  } else if (!repoUrl && !(await remoteUrl(info.top))) {
    const e = new Error('This copy has no repository address. Enter it in "Update settings" below.');
    e.status = 400;
    throw e;
  }
  try {
    await git(info.top, ['fetch', '--force', '--no-recurse-submodules', repoUrl || 'origin', '+refs/tags/*:refs/tags/*'], { log, timeoutMs: 10 * 60 * 1000 });
  } catch (err) {
    throw plainFetchError(err);
  }
  return info;
}

async function listTags(top, prefix) {
  const out = await git(top, ['tag', '-l', `${prefix}*`]);
  return out.split('\n').map((t) => t.trim()).filter(Boolean)
    .map((tag) => ({ tag, version: tag.slice(prefix.length) }))
    .filter((t) => VERSION_RE.test(t.version))
    .sort((a, b) => compareVersions(b.version, a.version));
}

// The release check (GitHub Action) marks a tag it passed with a second tag, verified/<tag>,
// on the same commit. A tag moved after the check no longer counts as checked.
const CHECKED_PREFIX = 'verified/';

async function isChecked(top, tag) {
  try {
    const [a, b] = await Promise.all([
      git(top, ['rev-parse', '--verify', '--quiet', `refs/tags/${tag}^{commit}`]),
      git(top, ['rev-parse', '--verify', '--quiet', `refs/tags/${CHECKED_PREFIX}${tag}^{commit}`]),
    ]);
    return !!a.trim() && a.trim() === b.trim();
  } catch {
    return false;
  }
}

const inRepo = (info, file) => (info.subdir ? `${info.subdir}/${file}` : file);

async function fileAt(info, ref, file) {
  return git(info.top, ['show', `${ref}:${inRepo(info, file)}`]);
}

async function notesAt(info, tag) {
  try { return JSON.parse(await fileAt(info, tag, NOTES_FILE)); } catch { return null; }
}

async function versionAt(info, ref) {
  try { return JSON.parse(await fileAt(info, ref, 'package.json')).version || null; } catch { return null; }
}

/** Where the folder is now: commit, and branch when one is checked out. */
async function headOf(info) {
  if (!info.tracked) return { commit: null, branch: null };
  const commit = (await git(info.top, ['rev-parse', 'HEAD']).catch(() => '')).trim() || null;
  const branch = (await git(info.top, ['symbolic-ref', '-q', '--short', 'HEAD']).catch(() => '')).trim() || null;
  return { commit, branch };
}

/**
 * Changed program files that an update would overwrite. The folders the
 * console writes while it runs (config.KEEP_LOCAL, kept by checkout()), the
 * built screens and the lock files may differ; anything else means someone
 * edited the program.
 */
async function changedProgramFiles(info) {
  if (!info.tracked) return [];
  const out = await git(info.top, ['status', '--porcelain', '--untracked-files=no']);
  const base = info.subdir ? `${info.subdir}/` : '';
  const allowed = [`${base}frontend/dist/`, ...config.KEEP_LOCAL.map((f) => base + f), ...LOCK_FILES.map((f) => base + f)];
  return out.split('\n').filter(Boolean).map((l) => l.slice(3).replace(/^.* -> /, ''))
    .filter((p) => !allowed.some((a) => p.startsWith(a)));
}

/** The installed parts a version needs: its lock files without the version number of the console itself. */
async function partsOf(info, ref) {
  const out = {};
  for (const f of [...config.PART_FILES, ...LOCK_FILES]) {
    try {
      const d = JSON.parse(await fileAt(info, ref, f));
      delete d.version;
      if (d.packages?.['']) delete d.packages[''].version;
      delete d.scripts;
      delete d.description;
      out[f] = d;
    } catch { out[f] = null; }
  }
  return JSON.stringify(out);
}

/** Do two versions need different installed parts? (A new version number alone does not.) */
async function partsChanged(info, from, to) {
  if (!from) return true;
  return (await partsOf(info, from)) !== (await partsOf(info, to));
}

/**
 * Files in the folders the console writes while it runs (config.KEEP_LOCAL) that differ from
 * the version checked out now: the PC's own layouts, PLC state, preferences. Absolute paths.
 */
async function localFiles(info) {
  if (!info.tracked) return [];
  const base = info.subdir ? `${info.subdir}/` : '';
  const out = await git(info.top, ['status', '--porcelain=v1', '-z', '--ignored', '--untracked-files=all', '--', ...config.KEEP_LOCAL.map((f) => base + f)]).catch(() => '');
  const files = [];
  const parts = out.split('\0');
  for (let i = 0; i < parts.length; i += 1) {
    const e = parts[i];
    if (!e) continue;
    const code = e.slice(0, 2);
    if (code[0] === 'R' || code[0] === 'C') i += 1; // the old name follows
    if (code.includes('D')) continue;
    const abs = path.join(info.top, e.slice(3));
    try { if (fs.statSync(abs).isFile()) files.push(abs); } catch { /* gone */ }
  }
  return files;
}

/** git checkout of `ref`, keeping the PC's own copies of the files listed by localFiles(). */
async function checkout(info, ref, log) {
  const keep = await localFiles(info);
  const tmp = keep.length ? await fsp.mkdtemp(path.join(os.tmpdir(), 'nextup-keep-')) : null;
  for (const [i, f] of keep.entries()) await fsp.copyFile(f, path.join(tmp, String(i)));
  if (keep.length && log) log(`Keeping ${keep.length} file(s) this PC changed (layouts, preferences, PLC state)`);
  try {
    await git(info.top, ['-c', 'advice.detachedHead=false', 'checkout', '-f', ref], { log });
  } finally {
    for (const [i, f] of keep.entries()) {
      await fsp.mkdir(path.dirname(f), { recursive: true }).catch(() => {});
      await fsp.copyFile(path.join(tmp, String(i)), f).catch((err) => log?.(`Could not keep ${f}: ${err.message}`));
    }
    if (tmp) await fsp.rm(tmp, { recursive: true, force: true }).catch(() => {});
  }
}

const LOCK_FILES = config.LOCK_FILES;

/**
 * npm install in backend/ and frontend/. On the robot the controller library (rclnodejs) builds
 * against the ROS 2 the console was started with; without ROS 2 (mock) its build step is skipped.
 */
async function installParts(root, { mock, log }) {
  await run('npm', ['install', '--no-audit', '--no-fund', ...(mock ? ['--ignore-scripts'] : [])], { cwd: path.join(root, 'backend'), log });
  await run('npm', ['install', '--no-audit', '--no-fund'], { cwd: path.join(root, 'frontend'), log });
  // npm may rewrite the lock files (e.g. the version number); keep the program files as released.
  await git(root, ['checkout', '--', ...LOCK_FILES]).catch(() => {});
}

/** Builds the screens into frontend/dist-next; the server swaps it in when it starts. */
async function buildScreens(root, log) {
  const out = path.join(root, 'frontend', NEXT_DIST);
  await fsp.rm(out, { recursive: true, force: true });
  await run('npm', ['run', 'build', '--', '--outDir', NEXT_DIST, '--emptyOutDir'], { cwd: path.join(root, 'frontend'), log });
  if (!fs.existsSync(path.join(out, 'index.html'))) throw new Error('The build did not produce the screens');
}

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => { const { port } = srv.address(); srv.close(() => resolve(port)); });
    srv.on('error', reject);
  });
}

/**
 * Starts the new version from `root` on a spare port, with the simulated robot and drives and an
 * empty home folder (the robot's projects and files are not touched), and asks it for a page.
 */
async function smokeTest(root, dataDir, log) {
  const home = await fsp.mkdtemp(path.join(os.tmpdir(), 'nextup-check-'));
  const port = await freePort();
  log(`Starting the new version on port ${port} with the simulated robot to check it`);
  const child = spawn(process.execPath, ['server.js'], {
    cwd: path.join(root, 'backend'),
    env: {
      ...process.env, NEXTUP_SIM: '1', ECAT_MOCK: '1', NEXTUP_PORT: String(port), NEXTUP_HOME: home,
      NEXTUP_USER_CONFIG_FILES: '', NEXTUP_ACTIVE_PROJECT: '', ECAT_DATA_DIR: '', UPDATE_DATA_DIR: path.join(home, 'software_update'),
      FRONTEND_DIST: path.join(root, 'frontend', NEXT_DIST), RUN_SUPERVISED: '', UPDATE_SMOKE_TEST: '1', NEXTPLC_MODE: 'sim',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (b) => { output = (output + b).slice(-8000); });
  child.stderr.on('data', (b) => { output = (output + b).slice(-8000); });
  let exited = null;
  child.on('close', (code) => { exited = code; });
  try {
    const until = Date.now() + 60000;
    while (Date.now() < until) {
      if (exited !== null) throw new Error(`The new version stopped while starting: ${output.trim().split('\n').slice(-3).join(' ')}`);
      try {
        const h = await fetch(`http://127.0.0.1:${port}/system/bridge`);
        const page = await fetch(`http://127.0.0.1:${port}/`, { headers: { Accept: 'text/html' } });
        const html = await page.text();
        if (h.ok && page.ok && html.includes('id="root"')) {
          log('The new version started and answered');
          return;
        }
      } catch { /* not up yet */ }
      await new Promise((r) => setTimeout(r, 500));
    }
    throw new Error('The new version did not answer within 60 seconds');
  } finally {
    if (exited === null) child.kill('SIGTERM');
    setTimeout(() => fsp.rm(home, { recursive: true, force: true }).catch(() => {}), 2000).unref();
  }
}

/**
 * Called by the server when it starts: screens built by an update replace
 * frontend/dist. Returns true when it swapped.
 */
function swapInNewScreens(root) {
  const next = path.join(root, 'frontend', NEXT_DIST);
  const dist = path.join(root, 'frontend', 'dist');
  if (!fs.existsSync(path.join(next, 'index.html'))) return false;
  const old = path.join(root, 'frontend', `dist-old-${Date.now()}`);
  if (fs.existsSync(dist)) fs.renameSync(dist, old);
  fs.renameSync(next, dist);
  fs.rmSync(old, { recursive: true, force: true });
  return true;
}

module.exports = {
  CHECKED_PREFIX, isChecked,
  VERSION_RE, NEXT_DIST, LOCK_FILES, compareVersions, hideToken, run, folderInfo, remoteUrl, fetchTags, listTags,
  notesAt, versionAt, headOf, changedProgramFiles, localFiles, partsChanged, checkout, installParts, buildScreens, smokeTest,
  swapInNewScreens,
};
