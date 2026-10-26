'use strict';

// The software update of the whole console: backups, health comparison, versions, and a start
// of the console on the simulated robot with the update guards.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..', '..');

function freePort() {
  return new Promise((resolve) => {
    const srv = net.createServer().listen(0, '127.0.0.1', () => { const { port } = srv.address(); srv.close(() => resolve(port)); });
  });
}

test('settings and drive recipes are copied before an update and can be put back', () => {
  const { backupUserData, restoreUserData, prune, BACKUP_DIR } = require('../lib/backup');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nextup-backup-'));
  const ecatDir = path.join(dir, 'ethercat');
  const appDir = path.join(dir, 'app_config');
  fs.mkdirSync(ecatDir);
  fs.mkdirSync(appDir);
  fs.writeFileSync(path.join(ecatDir, 'recipe.json'), '{"v":1}');
  fs.writeFileSync(path.join(ecatDir, 'history.json'), '[1]');
  fs.writeFileSync(path.join(appDir, 'ui_prefs.json'), '{}');
  const name = backupUserData(dir, 'before version 9.9.9', { ecatDir, appDir });
  assert.ok(fs.existsSync(path.join(dir, BACKUP_DIR, name, 'app', 'ui_prefs.json')), 'the app state is in the copy');
  // The newer version changes both files.
  fs.writeFileSync(path.join(ecatDir, 'recipe.json'), '{"v":2}');
  fs.writeFileSync(path.join(ecatDir, 'history.json'), '[1,2]');
  const restored = restoreUserData(dir, name, 'before going back', { ecatDir });
  assert.deepStrictEqual(restored, ['recipe.json']);
  assert.strictEqual(fs.readFileSync(path.join(ecatDir, 'recipe.json'), 'utf8'), '{"v":1}');
  // History keeps growing; it is never put back.
  assert.strictEqual(fs.readFileSync(path.join(ecatDir, 'history.json'), 'utf8'), '[1,2]');
  // The newer files were kept in a second copy.
  const copies = fs.readdirSync(path.join(dir, BACKUP_DIR));
  assert.strictEqual(copies.length, 2);
  const newer = copies.find((c) => c.endsWith('before going back'));
  assert.strictEqual(fs.readFileSync(path.join(dir, BACKUP_DIR, newer, 'ethercat', 'recipe.json'), 'utf8'), '{"v":2}');
  prune(dir, 1);
  assert.deepStrictEqual(fs.readdirSync(path.join(dir, BACKUP_DIR)), [newer]);
  assert.throws(() => restoreUserData(dir, 'no such copy'), /not on this PC/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('health after an update only counts what worked before', () => {
  const { healthWorse } = require('../lib/probes');
  assert.strictEqual(healthWorse({ robot: true, controller: true, drives: 6 }, { robot: true, controller: true, drives: 6 }), '');
  assert.match(healthWorse({ robot: true, controller: true, drives: 6 }, { robot: false, controller: true, drives: 6 }), /robot/);
  assert.match(healthWorse({ controller: true, drives: 6 }, { controller: false, drives: 6 }), /controller/);
  assert.match(healthWorse({ controller: true, drives: 6 }, { controller: true, drives: 4 }), /only 4 of 6/);
  assert.match(healthWorse({ controller: true, drives: 6 }, { controller: true, drives: 0 }), /none of the 6/);
  // Drives switched off before the update are not held against the new version.
  assert.strictEqual(healthWorse({ controller: false, drives: 0 }, { controller: false, drives: 0 }), '');
});

test('package.json, release-notes.json and the tag name the same version', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const notes = JSON.parse(fs.readFileSync(path.join(ROOT, 'release-notes.json'), 'utf8'));
  assert.match(pkg.version, /^\d+\.\d+\.\d+(-[\w.]+)?$/);
  assert.strictEqual(notes.version, pkg.version, 'release-notes.json is for another version');
  assert.ok(Array.isArray(notes.changes) && notes.changes.length, 'release-notes.json lists no changes');
  const tag = process.env.GITHUB_REF_TYPE === 'tag' ? process.env.GITHUB_REF_NAME : '';
  if (tag) assert.strictEqual(tag, `${process.env.UPDATE_TAG_PREFIX || 'v'}${pkg.version}`, 'the tag does not match package.json');
});

test('the console starts on the simulated robot and updates wait for drive work', async (t) => {
  const port = await freePort();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'nextup-test-'));
  const child = spawn(process.execPath, ['server.js'], {
    cwd: path.join(ROOT, 'backend'),
    env: { ...process.env, NEXTUP_SIM: '1', ECAT_MOCK: '1', NEXTUP_PORT: String(port), NEXTUP_HOME: home, HUB_URL: '', RUN_SUPERVISED: '1', NEXTPLC_MODE: 'sim' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { out += d; });
  t.after(() => { child.kill(); setTimeout(() => fs.rmSync(home, { recursive: true, force: true }), 1500).unref(); });

  const call = async (method, p, body) => {
    const res = await fetch(`http://127.0.0.1:${port}${p}`, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, body: await res.json().catch(() => null) };
  };
  let health = null;
  for (let i = 0; i < 120 && !health?.ros2; i += 1) {
    health = await call('GET', '/ecat-api/health').then((r) => r.body).catch(() => null);
    if (!health?.ros2) await new Promise((r) => setTimeout(r, 250));
  }
  assert.ok(health?.ros2, `the server did not start:\n${out}`);
  assert.strictEqual(health.mock, true);
  assert.strictEqual((await call('GET', '/update-api/health')).body.version, require(path.join(ROOT, 'package.json')).version);
  assert.strictEqual((await call('GET', '/ecat-api/slaves')).body.slaves.length, 6);
  // Operator files are seeded into user_config_files/ethercat.
  assert.ok(fs.existsSync(path.join(home, 'user_config_files', 'ethercat', 'recipe.json')));

  // While a recipe runs, Restart is refused with the reason.
  const pw = process.env.ECAT_PASSWORD || process.env.SDO_PASSWORD || '123';
  await call('POST', '/ecat-api/activity', { id: 't1', what: 'Recipe "Homing" is running', active: true });
  const status = await call('GET', '/update-api/updates/status');
  assert.strictEqual(status.body.busy.busy, true);
  const restart = await call('POST', '/update-api/updates/restart', { password: pw });
  assert.strictEqual(restart.status, 409);
  assert.match(restart.body.error, /Homing/);
  await call('POST', '/ecat-api/activity', { id: 't1', active: false });
  assert.strictEqual((await call('GET', '/update-api/updates/status')).body.busy.busy, false);

  // A problem report is kept on the PC when no report server is set.
  const rep = await call('POST', '/update-api/reports', { title: 'Test report', description: 'From the test', includeDetails: false });
  assert.strictEqual(rep.status, 200, JSON.stringify(rep.body));
  assert.strictEqual(rep.body.report.sendState, 'waiting');
});
