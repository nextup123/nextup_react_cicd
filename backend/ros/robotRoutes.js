// backend/ros/robotRoutes.js
//
// REST API for the new controllers and the motion server, mounted at /robot.
// Commands are thin wrappers around the services in interfaces.js; every
// answer is JSON { ok, message, ... } (HTTP 200 for a robot "no", 503 when the
// service is not running, 400 for a bad request).

import express from 'express';
import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import yaml from 'js-yaml';
import { getROSNode } from './rosService.js';
import { ioEventView, MOTION_ERROR } from './interfaces.js';
import { TEMPLATE_PATH, XML_BASE_DIR, pointPlanningFilePath } from '../config/path.js';
import { USER_CONFIG_FILES, ACTIVE_PROJECT_DIR } from '../config/roots.js';
import { locateIssues } from './btIssues.js';
import { readPrograms, saveProgram, deletePrograms, reorderPrograms, writeRaw, createFile } from './programStore.js';
import { pointsIndex } from './programRules.js';
import {
  RECORD_FILES, readRecordFile, recordView, recordFilter, codeTable, readIoWatchFile, blackboxHeader, blackboxName,
} from './recordFiles.js';
import {
  switchProfile, startMotion, stopMotion, resetFault, triggerEmergency, setSpeedOverride,
} from './robotOps.js';

const router = express.Router();

const ERROR_CONTAINER = path.join(USER_CONFIG_FILES, 'error_container');
const PROGRAMS_DEFAULT = path.join(ACTIVE_PROJECT_DIR, 'planning_data', 'programs.yaml');

const NAME_RE = /^[A-Za-z0-9_-]{1,64}$/;

const ros = () => getROSNode();
// The simulated bridge keeps its files under backend/user_config/sim
const errorDir = () => ros()?.errorContainer || ERROR_CONTAINER;
const motionLogFile = () => path.join(errorDir(), 'motion_logs.yaml');
const blackboxDir = () => path.join(errorDir(), 'blackbox');
const programsFile = () => ros()?.programsFile || PROGRAMS_DEFAULT;
const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);

/** Send a result; 503 when the service is not available. */
function reply(res, result) {
  if (result?.unavailable) return res.status(503).json(result);
  return res.json(result);
}

/** Call a service and pass its plain response through as { ok, ...response }. */
async function passThrough(res, key, request = {}, opts = {}, map = (r) => r) {
  const bridge = ros();
  if (!bridge) return res.status(503).json({ ok: false, message: 'ROS not initialized' });
  const r = await bridge.callService(key, request, opts);
  if (!r.ok) return reply(res, { ok: false, message: r.message, unavailable: r.unavailable });
  const body = map(r.response);
  const ok = body.success ?? body.ok ?? body.accepted ?? true;
  return res.json({ ok: Boolean(ok), ...body });
}

const wrap = (fn) => async (req, res) => {
  try {
    await fn(req, res);
  } catch (err) {
    console.error(`[robot] ${req.method} ${req.originalUrl} failed:`, err);
    res.status(500).json({ ok: false, message: err.message });
  }
};

/* ───────────── snapshot / capabilities ───────────── */

router.get('/state', (req, res) => {
  const b = ros();
  res.json({
    supervisor: b?.supervisor ?? null,
    motion: b?.motion ?? null,
    atHome: b?.atHome ?? null,
    homes: b?.homes ?? { list: [], active: '' },
    btActive: b?.btActive ?? null,
    btTree: b?.btTree ?? null,
    btRunner: b?.btMon?.runner ?? null,
    operatorRequest: b?.operatorRequest ?? null,
    recentEvents: b?.recentEvents ?? [],
    recentIo: b?.recentIo ?? [],
  });
});

router.get('/capabilities', (req, res) => {
  const b = ros();
  res.json({
    simulated: Boolean(b?.simulated),
    bindings: b?.bindings ?? null,
    missingTypes: b?.missingTypes ?? [],
    services: b ? b.serviceAvailability() : {},
  });
});

/* ───────────── supervisor ───────────── */

router.post('/mode', wrap(async (req, res) => {
  const { mode } = req.body || {};
  reply(res, await switchProfile(ros(), String(mode || '').toLowerCase()));
}));

router.post('/reset-fault', wrap(async (req, res) => reply(res, await resetFault(ros()))));
router.post('/estop', wrap(async (req, res) => reply(res, await triggerEmergency(ros()))));

router.post('/latching', wrap(async (req, res) => {
  // strict: true = any fault latches a global emergency (default); false = relaxed (JOG only)
  const strict = req.body?.strict !== false;
  await passThrough(res, 'setEmergencyLatching', { data: strict });
}));

router.post('/speed-override', wrap(async (req, res) => {
  const { percent } = req.body || {};
  if (!Number.isFinite(Number(percent))) return res.status(400).json({ ok: false, message: 'percent (0..100) is required' });
  reply(res, await setSpeedOverride(ros(), percent));
}));

router.get('/speed-limits', wrap(async (req, res) => {
  const modes = req.query.mode ? [String(req.query.mode)] : ['auto', 'safeauto', 'jog'];
  const bridge = ros();
  const out = {};
  for (const mode of modes) {
    const r = await bridge.callService('getModeSpeedLimits', { mode }, { timeoutMs: 1500 });
    if (!r.ok) return reply(res, { ok: false, message: r.message, unavailable: r.unavailable });
    out[mode] = {
      joints: Array.from(r.response.joint_names || []),
      thresholds: Array.from(r.response.overspeed_threshold || []).map(Number),
      maxSpeedScale: Number(r.response.max_speed_scale),
      message: r.response.message || '',
    };
  }
  res.json({ ok: true, limits: out });
}));

router.post('/speed-limits', wrap(async (req, res) => {
  const { mode, joints, thresholds, persist } = req.body || {};
  if (!['auto', 'safeauto', 'jog'].includes(mode)) return res.status(400).json({ ok: false, message: 'mode must be auto, safeauto or jog' });
  const values = (thresholds || []).map((v) => Math.round(num(v)));
  if (!values.length || values.some((v) => v < 0 || v > 32767)) {
    return res.status(400).json({ ok: false, message: 'thresholds must be whole numbers 0..32767 (int16)' });
  }
  await passThrough(res, 'setModeSpeedLimits', {
    mode,
    joint_names: joints?.length ? joints : values.map((_, i) => `joint${i + 1}`),
    overspeed_threshold: values,
    persist: Boolean(persist),
  });
}));

/* ───────────── logs and records (services) ───────────── */

function logQuery(q) {
  return {
    joint: String(q.joint || ''),
    event: String(q.event || ''),
    since_seconds: num(q.since, 0),
    max_entries: Math.min(1000, num(q.max, 200)),
  };
}

/**
 * Supervisor events and drive errors: read from the YAML files when they are
 * on this machine (every field, also the ones the service message drops:
 * request_id, cause, file, last_error, previous_error, ...), else from the
 * service. ?from=service forces the service.
 */
async function recordsFromFileOrService(req, res, kind, serviceKey) {
  const q = logQuery(req.query);
  const max = q.max_entries || 200;
  const table = kind === 'errors' ? await codeTable(errorDir()) : null;
  if (req.query.from !== 'service') {
    const file = path.join(errorDir(), RECORD_FILES[kind]);
    const r = await readRecordFile(file, { max, filter: recordFilter({ joint: q.joint, event: q.event, sinceSeconds: q.since_seconds }) });
    if (r) {
      const entries = r.entries.map((e) => recordView(kind, e, { table }));
      // blackbox_saved events: say whether the recording is still there (the viewer opens it)
      for (const e of entries) {
        const f = e.extra?.file;
        if (typeof f === 'string' && /blackbox_[^/]+\.csv$/i.test(f)) e.blackbox = fs.existsSync(path.join(blackboxDir(), path.basename(f))) ? path.basename(f) : '';
      }
      return res.json({ ok: true, from: 'file', file, total: r.total, entries });
    }
  }
  await passThrough(res, serviceKey, q, { timeoutMs: 3000 }, (r) => ({
    success: r.success, message: r.message, from: 'service', total: Number(r.total_in_file || 0),
    entries: Array.from(r.entries || []).map((e) => recordView(kind, e, { table, fromService: true })),
  }));
}

router.get('/events', wrap(async (req, res) => recordsFromFileOrService(req, res, 'events', 'getEventLog')));
router.delete('/events', wrap(async (req, res) => passThrough(res, 'clearEventLog')));

router.get('/errors', wrap(async (req, res) => recordsFromFileOrService(req, res, 'errors', 'getErrorLog')));
router.delete('/errors', wrap(async (req, res) => passThrough(res, 'clearErrorLog')));

router.get('/fault-counters', wrap(async (req, res) => {
  await passThrough(res, 'getFaultCounters', { joint: String(req.query.joint || '') }, {}, (r) => {
    const joints = Array.from(r.joint || []);
    let details = null;
    try {
      details = r.details_yaml ? yaml.load(r.details_yaml) : null;
    } catch {
      details = null;
    }
    return {
      success: r.success,
      message: r.message,
      counters: joints.map((j, i) => ({
        joint: j,
        faults: Number(r.total_faults?.[i] || 0),
        errors: Number(r.total_errors?.[i] || 0),
        lastFault: r.last_fault_time?.[i] || '',
        details: details?.[j] ?? null,
      })),
      detailsYaml: r.details_yaml || '',
    };
  });
}));
router.delete('/fault-counters', wrap(async (req, res) => passThrough(res, 'resetFaultCounters')));
router.post('/code-table/reload', wrap(async (req, res) => passThrough(res, 'reloadCodeTable')));

/* ───────────── IO watch ───────────── */

router.get('/io-watch', wrap(async (req, res) => {
  const bridge = ros();
  const r = bridge ? await bridge.callService('getIoWatch', {}, {}) : { ok: false, unavailable: true, message: 'ROS not initialized' };
  if (r.ok) {
    const x = r.response || {};
    return res.json({
      ok: Boolean(x.success ?? true),
      success: x.success,
      message: x.message,
      file: x.file,
      signals: Array.from(x.name || []).map((name, i) => ({
        name,
        device: x.device?.[i] || '',
        input: x.input?.[i] || '',
        logRising: Boolean(x.log_rising?.[i]),
        logFalling: Boolean(x.log_falling?.[i]),
        debounceMs: Number(x.debounce_ms?.[i] || 0),
        level: Number(x.level?.[i] ?? -1),
      })),
    });
  }
  // get_io_watch is missing on some installs: show the watch file read only
  const f = await readIoWatchFile(errorDir());
  if (f) return res.json({ ok: true, readOnly: true, message: r.message, file: f.file, signals: f.signals });
  return reply(res, { ok: false, message: r.message, unavailable: r.unavailable });
}));

router.post('/io-watch', wrap(async (req, res) => {
  const b = req.body || {};
  if (!b.name || !/^[A-Za-z0-9_.-]{1,48}$/.test(b.name)) return res.status(400).json({ ok: false, message: 'name: letters, digits, _ . - (max 48)' });
  await passThrough(res, 'setIoWatch', {
    name: b.name,
    device: String(b.device || ''),
    input: String(b.input || ''),
    log_rising: b.logRising !== false,
    log_falling: b.logFalling !== false,
    debounce_ms: Math.max(0, Math.round(num(b.debounceMs, 0))),
    remove: false,
  });
}));

router.delete('/io-watch/:name', wrap(async (req, res) => {
  await passThrough(res, 'setIoWatch', { name: req.params.name, device: '', input: '', log_rising: false, log_falling: false, debounce_ms: 0, remove: true });
}));

router.get('/io-log', wrap(async (req, res) => {
  const max = Math.min(2000, num(req.query.max, 200));
  if (req.query.from !== 'service') {
    const file = path.join(errorDir(), RECORD_FILES.io);
    const r = await readRecordFile(file, {
      max, filter: recordFilter({ signal: String(req.query.signal || ''), event: String(req.query.event || ''), sinceSeconds: num(req.query.since, 0) }),
    });
    if (r) return res.json({ ok: true, from: 'file', file, total: r.total, entries: r.entries.map((e) => recordView('io', e)) });
  }
  await passThrough(res, 'getIoLog', {
    signal: String(req.query.signal || ''),
    event: String(req.query.event || ''),
    since_seconds: num(req.query.since, 0),
    max_entries: Math.min(1000, max),
  }, { timeoutMs: 3000 }, (r) => ({
    success: r.success, message: r.message, from: 'service', total: Number(r.total_in_file || 0),
    entries: Array.from(r.entries || []).map((e) => ({ ...ioEventView(e), extra: {}, fields: recordView('io', e, { fromService: true }).fields })),
  }));
}));

router.post('/io-trace', wrap(async (req, res) => {
  const duration = Math.max(0, Math.min(1800, num(req.body?.durationS, 0)));
  await passThrough(res, 'startIoTrace', { duration_s: duration });
}));

/* ───────────── tool / jog frame ───────────── */

router.post('/tcp-offset', wrap(async (req, res) => {
  const b = req.body || {};
  // UI units: mm and degrees → service: m and rad
  await passThrough(res, 'setTcpOffset', {
    x: num(b.x) / 1000, y: num(b.y) / 1000, z: num(b.z) / 1000,
    roll: (num(b.roll) * Math.PI) / 180, pitch: (num(b.pitch) * Math.PI) / 180, yaw: (num(b.yaw) * Math.PI) / 180,
  });
}));

router.get('/jog-frame', wrap(async (req, res) => {
  await passThrough(res, 'setJogFrame', { frame: '' }, {}, (r) => ({ success: r.success, message: r.message, frame: r.frame }));
}));

/* ───────────── motions ───────────── */

const motionBody = (b) => ({
  speed_mps: Math.max(0, num(b.speed)),
  acceleration_mps2: Math.max(0, num(b.acceleration)),
  dry_run: Boolean(b.dryRun),
});

router.post('/home', wrap(async (req, res) => {
  const b = req.body || {};
  reply(res, await startMotion(ros(), 'home', { home_name: String(b.home || ''), single_stage: Boolean(b.singleStage), ...motionBody(b) }));
}));

router.post('/goto/point', wrap(async (req, res) => {
  const b = req.body || {};
  if (!b.point) return res.status(400).json({ ok: false, message: 'point is required' });
  reply(res, await startMotion(ros(), 'gotoPoint', {
    point_name: String(b.point),
    motion_type: String(b.motionType || 'PTP'),
    planner: String(b.planner || ''),
    approach_mm: Math.max(0, num(b.approachMm)),
    retract_mm: Math.max(0, num(b.retractMm)),
    use_cache: Boolean(b.useCache),
    ...motionBody(b),
  }));
}));

router.post('/goto/joints', wrap(async (req, res) => {
  const b = req.body || {};
  const joints = (b.joints || []).map(Number);
  if (joints.length !== 6 || joints.some((v) => !Number.isFinite(v))) return res.status(400).json({ ok: false, message: 'six joint values are required' });
  reply(res, await startMotion(ros(), 'gotoJoints', {
    joints, in_degrees: b.inDegrees !== false, motion_type: String(b.motionType || 'PTP'), planner: String(b.planner || ''), ...motionBody(b),
  }));
}));

router.post('/goto/pose', wrap(async (req, res) => {
  const b = req.body || {};
  reply(res, await startMotion(ros(), 'gotoPose', {
    x_cm: num(b.x), y_cm: num(b.y), z_cm: num(b.z),
    roll_deg: num(b.r), pitch_deg: num(b.p), yaw_deg: num(b.w),
    frame: String(b.frame || ''), flange: Boolean(b.flange), keep_orientation: Boolean(b.keepOrientation),
    motion_type: String(b.motionType || 'PTP'), planner: String(b.planner || ''),
    approach_mm: Math.max(0, num(b.approachMm)), retract_mm: Math.max(0, num(b.retractMm)),
    ...motionBody(b),
  }));
}));

router.post('/goto/sequence', wrap(async (req, res) => {
  const b = req.body || {};
  const steps = (b.steps || []).map((s) => ({
    point_name: String(s.point || ''),
    motion_type: String(s.motion || s.motionType || 'PTP'),
    blend_radius_mm: Math.max(0, num(s.blendMm)),
    speed_mps: Math.max(0, num(s.speed)),
    acceleration_mps2: Math.max(0, num(s.acceleration)),
  }));
  if (!steps.length || steps.some((s) => !s.point_name)) return res.status(400).json({ ok: false, message: 'steps with a point each are required' });
  steps[steps.length - 1].blend_radius_mm = 0; // the last step must stop exactly
  reply(res, await startMotion(ros(), 'runSequence', { steps, limit_blend_radius: b.limitBlend !== false, ...motionBody(b) }));
}));

router.post('/stop', wrap(async (req, res) => reply(res, await stopMotion(ros()))));
router.post('/motion-server/reset', wrap(async (req, res) => passThrough(res, 'resetMotionServer', {}, { timeoutMs: 6000 })));
router.post('/plan-cache/clear', wrap(async (req, res) => passThrough(res, 'clearPlanCache')));

/* ───────────── homes ───────────── */

router.get('/homes', wrap(async (req, res) => {
  const b = ros();
  const ok = await b.refreshHomes();
  if (!ok && !b.homes.list.length) return res.status(503).json({ ok: false, message: 'homing/list is not available', unavailable: true });
  res.json({ ok: true, ...b.homes, atHome: b.atHome });
}));

router.post('/homes/teach', wrap(async (req, res) => {
  const b = req.body || {};
  if (!NAME_RE.test(b.name || '')) return res.status(400).json({ ok: false, message: 'name: letters, digits, _ and - (max 64)' });
  const source = ['current', 'point', 'values'].includes(b.source) ? b.source : 'current';
  const request = {
    name: b.name,
    source,
    point_name: String(b.point || ''),
    joints: source === 'values' ? (b.joints || []).map(Number) : [],
    stages: (b.stages || []).map((s) => Math.max(1, Math.min(6, Math.round(num(s, 1))))),
    via_point: String(b.viaPoint || ''),
    description: String(b.description || ''),
    overwrite: Boolean(b.overwrite),
    set_active: Boolean(b.setActive),
  };
  const bridge = ros();
  const r = await bridge.callService('teachHome', request, { timeoutMs: 3000 });
  if (!r.ok) return reply(res, { ok: false, message: r.message, unavailable: r.unavailable });
  bridge.refreshHomesSoon(0, 1);
  res.json({ ok: Boolean(r.response.success), message: r.response.message || '', error: r.response.error_code ? MOTION_ERROR[r.response.error_code] || null : null });
}));

router.post('/homes/active', wrap(async (req, res) => {
  const bridge = ros();
  const r = await bridge.callService('setActiveHome', { name: String(req.body?.name || '') });
  if (!r.ok) return reply(res, { ok: false, message: r.message, unavailable: r.unavailable });
  bridge.refreshHomesSoon(0, 1);
  res.json({ ok: Boolean(r.response.success), message: r.response.message || '' });
}));

router.delete('/homes/:name', wrap(async (req, res) => {
  const bridge = ros();
  const r = await bridge.callService('deleteHome', { name: req.params.name });
  if (!r.ok) return reply(res, { ok: false, message: r.message, unavailable: r.unavailable });
  bridge.refreshHomesSoon(0, 1);
  res.json({ ok: Boolean(r.response.success), message: r.response.message || '', error: r.response.error_code ? MOTION_ERROR[r.response.error_code] || null : null });
}));

/* ───────────── homing / go-to configuration ───────────── */

const HOMING_FIELDS = ['default_speed_mps', 'default_acceleration_mps2', 'max_speed_mps', 'max_acceleration_mps2', 'position_tolerance', 'already_home_tolerance', 'settle_timeout_s', 'planner_id'];
const GOTO_FIELDS = ['default_speed_mps', 'default_acceleration_mps2', 'max_speed_mps', 'max_acceleration_mps2', 'position_tolerance', 'settle_timeout_s', 'default_planner', 'ompl_planning_time_s', 'ompl_planning_attempts'];
const pickFields = (obj, fields) => Object.fromEntries(fields.map((f) => [f, obj?.[f]]));

router.get('/config/homing', wrap(async (req, res) => {
  await passThrough(res, 'getHomingConfig', {}, {}, (r) => ({ config: pickFields(r.config, HOMING_FIELDS), activeHome: r.active_home }));
}));
router.post('/config/homing', wrap(async (req, res) => {
  const cur = await ros().callService('getHomingConfig');
  if (!cur.ok) return reply(res, { ok: false, message: cur.message, unavailable: cur.unavailable });
  const config = { ...cur.response.config, ...pickFields(req.body?.config, HOMING_FIELDS.filter((f) => req.body?.config?.[f] !== undefined)) };
  await passThrough(res, 'setHomingConfig', { config, persist: req.body?.persist !== false }, {}, (r) => ({
    success: r.success, message: r.message, config: pickFields(r.config, HOMING_FIELDS),
  }));
}));

router.get('/config/goto', wrap(async (req, res) => {
  await passThrough(res, 'getGotoConfig', {}, {}, (r) => ({ config: pickFields(r.config, GOTO_FIELDS) }));
}));
router.post('/config/goto', wrap(async (req, res) => {
  const cur = await ros().callService('getGotoConfig');
  if (!cur.ok) return reply(res, { ok: false, message: cur.message, unavailable: cur.unavailable });
  const config = { ...cur.response.config, ...pickFields(req.body?.config, GOTO_FIELDS.filter((f) => req.body?.config?.[f] !== undefined)) };
  await passThrough(res, 'setGotoConfig', { config, persist: req.body?.persist !== false }, {}, (r) => ({
    success: r.success, message: r.message, config: pickFields(r.config, GOTO_FIELDS),
  }));
}));

/* ───────────── behaviour tree: step mode, breakpoints, operator ───────────── */

router.post('/bt/:action(pause|step|resume)', wrap(async (req, res) => {
  const key = { pause: 'btPause', step: 'btStep', resume: 'btResume' }[req.params.action];
  await passThrough(res, key);
}));

router.post('/bt/break', wrap(async (req, res) => {
  const name = String(req.body?.name || '');
  const onFailureOnly = Boolean(req.body?.onFailureOnly);
  await passThrough(res, 'btBreakAt', { name, on_failure_only: onFailureOnly }, {}, (r) => {
    if (r.ok) ros()?.btMon?.setBreakpoint(name, onFailureOnly);
    return { success: r.ok, message: r.message };
  });
}));

/* ───────────── behaviour tree runner (NexRoot runner page) ───────────── */

const RUNNER_ACTIONS = {
  stop: 'runnerStop', finish_cycle: 'runnerFinishCycle', abort: 'runnerAbort', pause: 'runnerPause',
  resume: 'runnerResume', step: 'runnerStep', reset: 'runnerReset',
};

// The whole tree (BtTree), the runner status and the recent leaf events; the
// page fetches this once per tree (hash), live colours come over the WebSocket.
router.get('/bt/structure', (req, res) => {
  const m = ros()?.btMon;
  if (!m) return res.status(503).json({ ok: false, message: 'ROS not initialized' });
  const snap = m.snapshot();
  res.json({ ok: Boolean(snap.structure), message: snap.structure ? '' : 'No tree from the runner yet (/control_logic_bt/tree)', ...snap });
});

router.post('/bt/runner/start', wrap(async (req, res) => {
  const b = req.body || {};
  const cycles = Math.max(0, Math.floor(num(b.cycles, 0)));
  const tree = String(b.tree || '');
  if (tree && !/^[\w./ -]{1,200}$/.test(tree)) return res.status(400).json({ ok: false, message: 'invalid tree name' });
  await passThrough(res, 'runnerStart', { cycles, tree, dry_run: Boolean(b.dryRun), sim_mode: Boolean(b.simMode) }, { timeoutMs: 4000 });
}));

router.post('/bt/runner/:action(stop|finish_cycle|abort|pause|resume|step|reset)', wrap(async (req, res) => {
  await passThrough(res, RUNNER_ACTIONS[req.params.action], {}, { timeoutMs: 3000 });
}));

// The program the robot runs: control_data/main_tree.xml (it includes the
// editor's file). Load and Validate on the runner page always use it.
const MAIN_TREE_FILE = 'main_tree.xml';
const btControlDir = () => ros()?.btControlDir || XML_BASE_DIR;

router.post('/bt/runner/load', wrap(async (req, res) => {
  const xml = req.body?.main ? MAIN_TREE_FILE : String(req.body?.xml || '');
  if (!xml || !/^[\w./ -]{1,200}$/.test(xml)) return res.status(400).json({ ok: false, message: 'xml (tree file name) is required' });
  await passThrough(res, 'runnerLoadTree', { xml }, { timeoutMs: 15000 });
}));

router.post('/bt/runner/validate', wrap(async (req, res) => {
  const b = req.body || {};
  const xml = b.main ? MAIN_TREE_FILE : String(b.xml || '');
  if (xml && !/^[\w./ -]{1,200}$/.test(xml)) return res.status(400).json({ ok: false, message: 'invalid tree name' });
  // issues: every error / warning with the node it names (see btIssues.js)
  const file = !xml ? path.join(btControlDir(), MAIN_TREE_FILE) : path.isAbsolute(xml) ? xml : path.join(btControlDir(), xml.endsWith('.xml') ? xml : `${xml}.xml`);
  await passThrough(res, 'runnerValidateTree', {
    xml, check_points: b.checkPoints !== false, strict: Boolean(b.strict),
    max_speed_mps: num(b.maxSpeed, 0), max_acceleration_mps2: num(b.maxAcceleration, 0),
  }, { timeoutMs: 15000 }, (r) => locateIssues({ ...r, success: Boolean(r.valid) }, { mainFile: file, editorFile: TEMPLATE_PATH }));
}));

// Tree files the runner can load (names in control_data/)
router.get('/bt/trees', wrap(async (req, res) => {
  const dir = btControlDir();
  let files = [];
  try {
    files = (await fsp.readdir(dir)).filter((f) => f.endsWith('.xml') && !/(_undo|_backup|\.bak)/.test(f)).sort();
  } catch {
    /* folder missing */
  }
  res.json({ ok: true, dir, files });
}));

router.post('/bt/continue', wrap(async (req, res) => {
  // Breakpoint BT node: publish true on its topic to continue
  const topic = String(req.body?.topic || '/bt_breakpoint_continue');
  if (!/^\/[A-Za-z0-9_/]+$/.test(topic)) return res.status(400).json({ ok: false, message: 'invalid topic' });
  ros().publishBoolTopic(topic, true);
  res.json({ ok: true, message: 'Continue sent' });
}));

router.post('/bt/operator-reply', wrap(async (req, res) => {
  const { id, choice } = req.body || {};
  if (!choice) return res.status(400).json({ ok: false, message: 'choice is required' });
  ros().answerOperator(String(id || ''), String(choice));
  res.json({ ok: true });
}));

/* ───────────── motion log and black box (files) ───────────── */

/**
 * motion_logs.yaml is a crash-safe YAML event log: one entry per line
 * ("- {id: ..., kind: ..., ...}"). Newest entries are at the end.
 */
router.get('/motion-log', wrap(async (req, res) => {
  const max = Math.min(1000, num(req.query.max, 200));
  let text = '';
  try {
    text = await fsp.readFile(motionLogFile(), 'utf8');
  } catch {
    return res.json({ ok: true, entries: [], total: 0, message: 'No motion log yet' });
  }
  const lines = text.split('\n').filter((l) => /^\s*-\s*\{/.test(l));
  const entries = [];
  for (let i = lines.length - 1; i >= 0 && entries.length < max; i--) {
    try {
      const e = yaml.load(lines[i], { schema: yaml.JSON_SCHEMA });
      if (Array.isArray(e) && e[0]) entries.push(recordView('motions', e[0]));
    } catch {
      /* a half-written last line after a power cut: skip */
    }
  }
  if (!lines.length) {
    // Fallback: a plain YAML list or { entries: [...] }
    try {
      const doc = yaml.load(text);
      const list = Array.isArray(doc) ? doc : doc?.entries || doc?.motions || [];
      return res.json({ ok: true, entries: list.slice(-max).reverse().map((e) => recordView('motions', e)), total: list.length });
    } catch {
      /* fall through */
    }
  }
  res.json({ ok: true, from: 'file', file: motionLogFile(), entries, total: lines.length });
}));

const BB_NAME = /^[A-Za-z0-9_.-]+\.csv$/;

/** "Drive left OPERATION_ENABLED (joint1)" from the header, else from the file name. */
function causeText(meta, slug) {
  if (meta.cause) return meta.cause;
  if (!slug) return '';
  const s = slug.replace(/_/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

router.get('/blackbox', wrap(async (req, res) => {
  let files = [];
  try {
    files = await fsp.readdir(blackboxDir());
  } catch {
    return res.json({ ok: true, files: [], dir: blackboxDir() });
  }
  const out = [];
  for (const f of files.filter((x) => x.endsWith('.csv'))) {
    try {
      const full = path.join(blackboxDir(), f);
      const st = await fsp.stat(full);
      const { meta, columns } = await blackboxHeader(full);
      const n = blackboxName(f);
      const jm = /\((joint\d+)\)/i.exec(meta.cause || '');
      out.push({
        file: f,
        size: st.size,
        mtime: st.mtimeMs,
        trigger: meta.trigger_time || n.time || '',
        cause: causeText(meta, n.slug),
        slug: n.slug,
        joint: jm ? jm[1] : n.joint,
        window: meta.window || '',
        columns: columns.length,
        edited: /_edited(_\d+)?\.csv$/i.test(f),
        // rows ≈ size / bytes per line, refined by the viewer once it loads
        rowsApprox: columns.length ? Math.max(0, Math.round(st.size / Math.max(40, columns.length * 8.5))) : 0,
      });
    } catch {
      /* removed meanwhile */
    }
  }
  out.sort((a, b) => (b.trigger || '').localeCompare(a.trigger || '') || b.mtime - a.mtime);
  res.json({ ok: true, files: out, dir: blackboxDir() });
}));

router.get('/blackbox/:file', (req, res) => {
  const f = path.basename(req.params.file);
  if (!BB_NAME.test(f)) return res.status(400).json({ ok: false, message: 'not a black-box file' });
  const full = path.join(blackboxDir(), f);
  if (!fs.existsSync(full)) return res.status(404).json({ ok: false, message: 'file not found' });
  if (req.query.download) return res.download(full, f);
  res.type('text/csv').sendFile(full);
});

/**
 * Save an edited recording as a new file next to the original
 * (<name>_edited.csv, _edited_2.csv, ...). The original is never changed.
 */
router.post('/blackbox/:file/copy', express.text({ type: '*/*', limit: '64mb' }), wrap(async (req, res) => {
  const f = path.basename(req.params.file);
  if (!BB_NAME.test(f)) return res.status(400).json({ ok: false, message: 'not a black-box file' });
  const text = typeof req.body === 'string' ? req.body : '';
  if (!text.trim()) return res.status(400).json({ ok: false, message: 'empty file' });
  const base = f.replace(/(_edited(_\d+)?)?\.csv$/i, '');
  let name = `${base}_edited.csv`;
  for (let i = 2; fs.existsSync(path.join(blackboxDir(), name)); i++) name = `${base}_edited_${i}.csv`;
  await fsp.writeFile(path.join(blackboxDir(), name), text.endsWith('\n') ? text : `${text}\n`);
  res.json({ ok: true, file: name, message: `Saved as ${name}` });
}));

/** Only edited copies can be deleted from the UI; the supervisor's recordings stay. */
router.delete('/blackbox/:file', wrap(async (req, res) => {
  const f = path.basename(req.params.file);
  if (!BB_NAME.test(f) || !/_edited(_\d+)?\.csv$/i.test(f)) return res.status(400).json({ ok: false, message: 'only edited copies can be deleted' });
  await fsp.unlink(path.join(blackboxDir(), f));
  res.json({ ok: true, message: `Deleted ${f}` });
}));

/* ───────────── programs (planning_data/programs.yaml) ───────────── */
//
// Motion programs of the motion server (run_program), edited by the Motion
// Programs page. programStore.js edits the file as a YAML document (comments
// and other programs stay as they are); programRules.js holds the checks the
// server makes. The server re-reads the file on every call: no restart.

async function pointsForCheck() {
  const b = ros();
  if (typeof b?.readPoints === 'function') return pointsIndex(b.readPoints());
  try {
    const doc = yaml.load(await fsp.readFile(pointPlanningFilePath.POINTS_YAML_FILE, 'utf8'));
    return pointsIndex(Array.isArray(doc?.points) ? doc.points : []);
  } catch {
    return null;
  }
}

/** The server's own view (list_programs: problems it sees); null when the service is not there. */
async function serverPrograms() {
  const b = ros();
  if (!b?.serviceAvailability?.().listPrograms?.available) return null;
  const r = await b.callService('listPrograms', {}, { timeoutMs: 2000 });
  if (!r.ok) return { ok: false, message: r.message };
  const x = r.response || {};
  return { ok: Boolean(x.success), message: x.message || '', file: x.file || '', problems: Array.from(x.problems || []).map(String) };
}

const storeError = (res, err) => {
  if (err.status === 400 || err.code === 'YAML_PARSE' || err.code === 'YAML_SHAPE') return res.status(400).json({ ok: false, message: err.message });
  throw err;
};

router.get('/programs', wrap(async (req, res) => {
  const b = ros();
  const avail = b?.serviceAvailability?.() || {};
  const data = await readPrograms(programsFile(), await pointsForCheck());
  const server = req.query.server === '0' ? null : await serverPrograms().catch((e) => ({ ok: false, message: e.message }));
  res.json({
    ok: true,
    ...data,
    canRun: Boolean(avail.runProgram?.available),
    canFinish: Boolean(avail.finishProgram?.available),
    server,
  });
}));

router.post('/programs', wrap(async (req, res) => {
  const p = req.body?.program;
  if (!p || typeof p !== 'object') return res.status(400).json({ ok: false, message: 'program is required' });
  try {
    const name = await saveProgram(programsFile(), p, String(req.body?.oldName || ''));
    res.json({ ok: true, name, message: `Program "${name}" saved` });
  } catch (err) {
    storeError(res, err);
  }
}));

router.delete('/programs/:name', wrap(async (req, res) => {
  const n = await deletePrograms(programsFile(), [req.params.name]);
  if (!n) return res.status(404).json({ ok: false, message: 'Program not found' });
  res.json({ ok: true, message: `Program "${req.params.name}" deleted` });
}));

router.post('/programs/order', wrap(async (req, res) => {
  const names = Array.isArray(req.body?.names) ? req.body.names.map(String) : null;
  if (!names) return res.status(400).json({ ok: false, message: 'names is required' });
  await reorderPrograms(programsFile(), names);
  res.json({ ok: true, message: 'Order saved' });
}));

// Whole file as text (YAML view of the page)
router.get('/programs/raw', wrap(async (req, res) => {
  const f = programsFile();
  const text = fs.existsSync(f) ? await fsp.readFile(f, 'utf8') : '';
  res.json({ ok: true, file: f, exists: fs.existsSync(f), text });
}));

router.put('/programs/raw', wrap(async (req, res) => {
  if (typeof req.body?.text !== 'string') return res.status(400).json({ ok: false, message: 'text is required' });
  try {
    await writeRaw(programsFile(), req.body.text);
    res.json({ ok: true, message: 'programs.yaml saved' });
  } catch (err) {
    storeError(res, err);
  }
}));

// programs.yaml with the starter program (projects made before the page existed)
router.post('/programs/create-file', wrap(async (req, res) => {
  try {
    await createFile(programsFile());
    res.json({ ok: true, message: 'programs.yaml created with a starter program' });
  } catch (err) {
    storeError(res, err);
  }
}));

router.post('/programs/run', wrap(async (req, res) => {
  const b = req.body || {};
  if (!b.name) return res.status(400).json({ ok: false, message: 'name is required' });
  const o = b.offset || {};
  const lim = (v, m) => Math.max(-m, Math.min(m, num(v)));
  reply(res, await startMotion(ros(), 'runProgram', {
    name: String(b.name),
    repeat: Math.round(num(b.repeat, -1)),
    refuse_endless: false,
    offset_x_mm: lim(o.x, 5000),
    offset_y_mm: lim(o.y, 5000),
    offset_z_mm: lim(o.z, 5000),
    offset_rx_deg: lim(o.rx, 360),
    offset_ry_deg: lim(o.ry, 360),
    offset_rz_deg: lim(o.rz, 360),
    ...motionBody(b),
  }));
}));

router.post('/programs/finish', wrap(async (req, res) => passThrough(res, 'finishProgram')));

/* ───────────── simulator test hooks ───────────── */

router.post('/sim/:kind', (req, res) => {
  const b = ros();
  if (!b?.simulated) return res.status(404).json({ ok: false, message: 'only available with the simulated robot' });
  res.json(b.simInject(req.params.kind, req.body?.arg));
});

export default router;
