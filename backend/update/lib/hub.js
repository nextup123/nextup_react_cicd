'use strict';

/**
 * Talks to the release server (release_hub): problem reports, update records
 * and a heartbeat. Everything is saved on this machine first and sent when
 * the internet is there, so nothing is lost on a robot PC that is offline.
 *
 *   DATA_DIR/problem_reports.json  reports made on this machine, with send state
 *   DATA_DIR/update_log.json       updates and roll-backs done on this machine
 */

const crypto = require('crypto');
const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const path = require('path');
const config = require('../config');
const settings = require('./settings');
const history = require('./history');
const { readJson, updateJson } = require('./util');

const REPORTS = () => path.join(config.DATA_DIR, 'problem_reports.json');
const UPDATES = () => path.join(config.DATA_DIR, 'update_log.json');
const IMAGES = () => path.join(config.DATA_DIR, 'report_images');
const MAX_KEPT = 300;
const MAX_IMAGES = 5;
const MAX_IMAGE_BYTES = 700 * 1024;
const IMAGE_EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };
const SEND_EVERY_MS = 60 * 1000;

const state = { online: null, lastContactAt: null, lastError: '', sending: false };

const str = (v, max) => (v === undefined || v === null ? '' : String(v).trim().slice(0, max));
const pick = (v, list, fallback) => (list.includes(v) ? v : fallback);

async function readList(file) {
  try {
    const data = await readJson(file);
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

async function request(method, urlPath, body, timeoutMs = 70000) {
  const s = await settings.get();
  if (!s.hubUrl) {
    const err = new Error('The report server is not set up');
    err.notSetUp = true;
    throw err;
  }
  const ctrl = new AbortController();
  // A hosted server on a free plan (Render) can take up to a minute to wake up.
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${s.hubUrl}/api/v1/apps/${config.APP_ID}${urlPath}`, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
    let data = null;
    try { data = await res.json(); } catch { /* empty */ }
    if (!res.ok) {
      const err = new Error(data?.error || `Report server answered ${res.status}`);
      err.status = res.status;
      throw err;
    }
    return data;
  } catch (err) {
    if (err.status) throw err;
    const e = new Error(err.name === 'AbortError' ? 'No answer from the report server' : 'Cannot reach the report server (no internet?)');
    e.offline = true;
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

// ── Problem reports ───────────────────────────────────────────
const CATEGORIES = ['crash', 'wrong_result', 'drive_communication', 'screen_problem', 'slow', 'update', 'other'];
const SEVERITIES = ['critical', 'high', 'medium', 'low'];
const FREQUENCIES = ['always', 'sometimes', 'once'];

/** The real type of an image from its first bytes. */
function sniffImage(buf) {
  if (buf.length > 12) {
    if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
    if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
    if (buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
    if (buf.subarray(0, 3).toString('latin1') === 'GIF') return 'image/gif';
  }
  return null;
}

/** Screenshots from the form ({ name, data: base64 }) are kept as files next to the report until they are sent. */
async function saveImages(reportId, images) {
  const list = Array.isArray(images) ? images.slice(0, MAX_IMAGES) : [];
  // Check all of them before writing any, so a refused picture leaves no files behind.
  const checked = list.map((img, i) => {
    const bytes = Buffer.from(String(img?.data || '').replace(/^data:[^,]*,/, ''), 'base64');
    const type = sniffImage(bytes);
    let problem = '';
    if (!type) problem = 'Only JPEG, PNG, WebP or GIF images can be attached';
    else if (bytes.length > MAX_IMAGE_BYTES) problem = `An image is too large (${Math.round(bytes.length / 1024)} KB, the limit is ${MAX_IMAGE_BYTES / 1024} KB)`;
    if (problem) {
      const err = new Error(problem);
      err.status = 400;
      throw err;
    }
    return { bytes, type, name: str(img.name, 120) || `image ${i + 1}` };
  });
  const saved = [];
  for (const [i, c] of checked.entries()) {
    const file = `${reportId}-${i + 1}.${IMAGE_EXT[c.type]}`;
    await fsp.mkdir(IMAGES(), { recursive: true });
    await fsp.writeFile(path.join(IMAGES(), file), c.bytes);
    saved.push({ clientAttachmentId: crypto.randomUUID(), name: c.name, type: c.type, size: c.bytes.length, file, sent: false });
  }
  return saved;
}

const removeImages = (r) => Promise.all((r.attachments || []).map((a) => fsp.rm(path.join(IMAGES(), a.file), { force: true }).catch(() => {})));

async function createReport(input, extraContext = {}) {
  const title = str(input.title, 200);
  const description = str(input.description, 8000);
  if (!title || !description) {
    const err = new Error('Please say what went wrong and describe it');
    err.status = 400;
    throw err;
  }
  const recent = input.includeDetails === false ? [] : (await history.list(20)).map((e) => ({
    at: e.at, kind: e.kind, outcome: e.outcome, title: e.title, failures: (e.failures || []).slice(0, 5),
  }));
  const report = {
    clientReportId: crypto.randomUUID(),
    appVersion: config.APP_VERSION,
    title,
    description,
    stepsToReproduce: str(input.stepsToReproduce, 4000),
    expected: str(input.expected, 2000),
    actual: str(input.actual, 2000),
    category: pick(input.category, CATEGORIES, 'other'),
    severity: pick(input.severity, SEVERITIES, 'medium'),
    frequency: pick(input.frequency, FREQUENCIES, 'once'),
    area: str(input.area, 80),
    reporter: {
      name: str(input.reporter?.name, 80),
      company: str(input.reporter?.company, 120),
      phone: str(input.reporter?.phone, 40),
      email: str(input.reporter?.email, 120),
    },
    machine: await settings.machineInfo(),
    context: input.includeDetails === false ? {} : {
      ...extraContext,
      ...(input.context && typeof input.context === 'object' ? input.context : {}),
      recentHistory: recent,
      node: process.version,
      uptimeMin: Math.round(os.uptime() / 60),
    },
    reportedAt: new Date().toISOString(),
  };
  const attachments = await saveImages(report.clientReportId, input.images);
  const entry = { ...report, attachments, sendState: 'waiting', number: null, remoteStatus: null, fixedInVersion: null, attempts: 0, lastError: '' };
  let dropped = [];
  await updateJson(REPORTS(), (list) => {
    list.unshift(entry);
    if (list.length > MAX_KEPT) dropped = list.splice(MAX_KEPT);
    return list;
  }, []);
  dropped.forEach(removeImages);
  history.record({ kind: 'report', outcome: 'info', title: `Problem reported: ${title}`, detail: description.slice(0, 300) });
  // Try straight away, but don't keep the operator waiting while a sleeping server wakes up:
  // after 8 s the report stays "waiting" and is sent in the background.
  await Promise.race([flush().catch(() => {}), new Promise((r) => setTimeout(r, 8000))]);
  return (await readList(REPORTS())).find((r) => r.clientReportId === report.clientReportId) || entry;
}

const listReports = () => readList(REPORTS());

// ── Update records ────────────────────────────────────────────
async function recordUpdate(event) {
  const entry = { clientEventId: crypto.randomUUID(), sent: false, ...event };
  await updateJson(UPDATES(), (list) => {
    list.unshift(entry);
    if (list.length > MAX_KEPT) list.length = MAX_KEPT;
    return list;
  }, []);
  flush().catch(() => {});
  return entry;
}

const listUpdates = () => readList(UPDATES());

// ── Sending ───────────────────────────────────────────────────
// One send at a time; a call made while one is running waits for it and then sends again,
// so a report made during a send is not left waiting for the timer.
let running = null;
function flush() {
  if (process.env.UPDATE_SMOKE_TEST) return status();
  if (running) return running.then(() => flush());
  running = doFlush().finally(() => { running = null; });
  return running;
}

const OLD_SERVER = 'The report server is an older version that cannot store pictures. Put the new release_hub on the server; the pictures are sent by themselves after that.';

/** Notes why the pictures of a report are still waiting. */
function markPictures(r, error) {
  return updateJson(REPORTS(), (list) => {
    const x = list.find((y) => y.clientReportId === r.clientReportId);
    for (const a of x?.attachments || []) if (!a.sent && !a.failed) a.error = error;
    return list;
  }, []);
}

async function doFlush() {
  state.sending = true;
  try {
    const m = await settings.machineInfo();
    await request('POST', '/machines/heartbeat', { ...m, version: config.APP_VERSION });
    state.online = true;
    state.lastContactAt = new Date().toISOString();
    state.lastError = '';

    for (const r of (await listReports()).filter((x) => x.sendState === 'waiting').reverse()) {
      // The images go one at a time after the report has its number.
      const { sendState, number, remoteStatus, fixedInVersion, attempts, lastError, attachments, ...payload } = r;
      let result;
      try {
        const res = await request('POST', '/bugs', payload);
        result = { sendState: 'sent', number: res.bug.number, remoteStatus: res.bug.status, sentAt: new Date().toISOString(), lastError: '' };
      } catch (err) {
        if (err.offline) throw err;
        // The server refused it (bad data): keep it, but stop retrying.
        result = { sendState: err.status >= 400 && err.status < 500 ? 'rejected' : 'waiting', lastError: err.message };
      }
      await updateJson(REPORTS(), (list) => {
        const x = list.find((y) => y.clientReportId === r.clientReportId);
        if (x) Object.assign(x, result, { attempts: (x.attempts || 0) + 1 });
        return list;
      }, []);
    }

    for (const r of (await listReports()).filter((x) => x.sendState === 'sent' && x.number && (x.attachments || []).some((a) => !a.sent && !a.failed)).reverse()) {
      for (const a of r.attachments.filter((x) => !x.sent && !x.failed)) {
        let outcome;
        try {
          const data = (await fsp.readFile(path.join(IMAGES(), a.file))).toString('base64');
          await request('POST', `/bugs/${r.number}/attachments`, { clientAttachmentId: a.clientAttachmentId, name: a.name, data }, 120000);
          outcome = { sent: true, error: '' };
        } catch (err) {
          if (err.offline) throw err;
          // A report server from before pictures existed has no address for them: keep the
          // pictures and say so; they go once the server is updated.
          if (err.status === 404 && /^No route/i.test(err.message)) {
            await markPictures(r, OLD_SERVER);
            break;
          }
          // Missing file or the server refused this image (bad type or size): stop retrying it.
          // Any other answer (server busy) leaves it for the next round.
          const refused = err.code === 'ENOENT' || [400, 404, 413, 415, 422].includes(err.status);
          if (!refused) {
            await markPictures(r, `Not sent yet: ${err.message}`);
            break;
          }
          outcome = { failed: true, error: err.message };
        }
        await updateJson(REPORTS(), (list) => {
          const x = list.find((y) => y.clientReportId === r.clientReportId)?.attachments?.find((y) => y.clientAttachmentId === a.clientAttachmentId);
          if (x) Object.assign(x, outcome);
          return list;
        }, []);
        fsp.rm(path.join(IMAGES(), a.file), { force: true }).catch(() => {});
      }
    }

    for (const e of (await listUpdates()).filter((x) => !x.sent).reverse()) {
      const { sent, ...payload } = e;
      await request('POST', '/update-events', { ...payload, machineId: m.machineId });
      await updateJson(UPDATES(), (list) => {
        const x = list.find((y) => y.clientEventId === e.clientEventId);
        if (x) x.sent = true;
        return list;
      }, []);
    }

    // What happened to the reports from this machine (received, being fixed, fixed in 3.6.0).
    const remote = await request('GET', `/machines/${m.machineId}/bugs`);
    const byId = new Map((remote.bugs || []).map((b) => [b.clientReportId, b]));
    await updateJson(REPORTS(), (list) => {
      let changed = false;
      for (const r of list) {
        const b = byId.get(r.clientReportId);
        if (b && (b.status !== r.remoteStatus || b.fixedInVersion !== r.fixedInVersion)) {
          Object.assign(r, { remoteStatus: b.status, fixedInVersion: b.fixedInVersion || null, number: b.number, sendState: 'sent' });
          changed = true;
        }
      }
      return changed ? list : null;
    }, []);
  } catch (err) {
    state.online = err.notSetUp ? null : false;
    state.lastError = err.message;
  } finally {
    state.sending = false;
  }
  return status();
}

/** Published release notes for versions after ours (null when the server is not reachable). */
async function releaseNotes() {
  try {
    // Short wait: the notes are also in the repository, so a sleeping server is not worth waiting for.
    const res = await request('GET', `/releases?after=${encodeURIComponent(config.APP_VERSION)}&status=published&limit=50`, undefined, 20000);
    return res.releases || [];
  } catch {
    return null;
  }
}

async function status() {
  const s = await settings.get();
  const reports = await listReports();
  const updates = await listUpdates();
  return {
    setUp: !!s.hubUrl,
    online: state.online,
    lastContactAt: state.lastContactAt,
    lastError: state.lastError,
    pictureProblem: reports.flatMap((r) => r.attachments || []).find((a) => !a.sent && !a.failed && a.error)?.error || '',
    waiting: reports.filter((r) => r.sendState === 'waiting' || (r.sendState === 'sent' && (r.attachments || []).some((a) => !a.sent && !a.failed))).length
      + updates.filter((u) => !u.sent).length,
  };
}

let timer = null;
function start() {
  if (timer || process.env.UPDATE_SMOKE_TEST) return;
  setTimeout(() => flush().catch(() => {}), 5000);
  timer = setInterval(() => flush().catch(() => {}), SEND_EVERY_MS);
  timer.unref();
}

module.exports = { createReport, listReports, recordUpdate, listUpdates, flush, status, releaseNotes, start };
