// backend/ros/SimROSBridge.js
//
// Simulated ROS bridge used when ROS 2 / rclnodejs is not available
// (development laptops, CI) or when NEXTUP_SIM=1 is set.
//
// It keeps the public interface of LightweightROSBridge and simulates the new
// controller stack behind it: the motion supervisor (profiles, phased mode
// changes and resets, emergency latching, speed override), the motion server
// (homes, go-to point / joints / pose, sequences, programs, dry runs, stop),
// the drive state broadcaster (error log, fault counters, IO watch) and the
// behaviour tree runner (running node, step mode, breakpoints, operator
// questions). Every service goes through callService(), exactly like the
// real bridge, so robotOps, the routes and the WS handler run unchanged.
// Nothing here touches hardware.

import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { fileURLToPath } from 'url';
import { LightweightROSBridge } from './LightweightROSBridge.js';
import { roundAll } from './rateLimit.js';
import { SRV, TOPIC, MOTION_ERROR, errorEventView, ioEventView, parseOperatorRequest, doCommandView } from './interfaces.js';
import { XML_BASE_DIR, pointPlanningFilePath } from '../config/path.js';
import { SimBtRunner } from './simBtRunner.js';
import { runnerStatusView } from './btMonitor.js';
import { Chain, axisAngle, fromXyzRpy, mul, poseError, rotate, rpyOf } from '../robotModel/kinematics.js';
import { loadModel, onModelSelected, selectedModelId } from '../robotModel/robotModels.js';
import { normalizeProgram, checkProgram, pointsIndex, describeStep } from './programRules.js';
import { buildPath } from './programPath.js';
import { readPrograms, DEFAULT_PROGRAMS_FILE } from './programStore.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKEND = path.resolve(__dirname, '..');
const SIM_DIR = path.join(BACKEND, 'user_config', 'sim');
// Record files copied from a real robot (error_container): the sim starts with them
const SIM_RECORDS = path.join(BACKEND, 'config', 'sim_records');
const PHASES = ['startup', 'running', 'mode_settle', 'mode_write', 'mode_confirm', 'mode_rollback', 'reset_release', 'reset_pulse', 'reset_wait', 'emergency'];
const pad2 = (n) => String(n).padStart(2, '0');
/** "2026-10-14 11:07:02.440" local time, like the nodes write. */
const localTime = (d = new Date()) =>
  `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}.${String(d.getMilliseconds()).padStart(3, '0')}`;
/** One YAML flow-map line the way the nodes write them. */
function yamlLine(obj) {
  const val = (v) => {
    if (Array.isArray(v)) return `[${v.map(val).join(', ')}]`;
    if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(Math.round(v * 1000) / 1000);
    if (typeof v === 'boolean') return v ? 'true' : 'false';
    const t = String(v ?? '');
    return t === '' || /[:,{}\[\]#"]|^\s|\s$|^(true|false|null|-?\d)/i.test(t) ? JSON.stringify(t) : t;
  };
  return `  - {${Object.entries(obj).filter(([, v]) => v !== undefined).map(([k, v]) => `${k}: ${val(v)}`).join(', ')}}\n`;
}
const HOMES_FILE = path.join(SIM_DIR, 'homes.json');

// Added to the simulator's programs.yaml: one program per motion type, on the
// points of backend/points_backup.yaml (home, p1 ... p8).
const SIM_DEMO_PROGRAMS = `
  # ---- SIMULATOR DEMO: every motion type on the demo points ----
  - name: demo_all_motions
    description: PTP, LIN with offsets, arc, circle, spline and spiral on the demo points
    repeat: 1
    speed_mps: 0.3
    acceleration_mps2: 1.5
    steps:
      - {point: home, motion: PTP}
      - {point: p3, offset: {z: 60}, motion: PTP, blend_mm: 20}         # above p3
      - {point: p3, motion: LIN, speed_mps: 0.1, dwell_s: 0.5}           # down
      - {point: p5, via: p4, motion: CIRC}                               # 3-point arc
      - {center: p5, radius_mm: 40, motion: CIRCLE}                      # circle around p5
      - {points: [p6, p7, p4], motion: SPLINE}                           # smooth curve
      - {center: p4, radius_mm: 30, turns: 3, motion: SPIRAL}            # spiral out
      - {offset: {z: 80}, motion: LIN, speed_mps: 0.2}                   # retract up
      - {point: home, motion: PTP}
`;

const TICK_MS = 100;
const JOINT_JOG_RAD = 0.35; // rad/s at full jog command
const CART_JOG_CM = 4; // cm/s for Cartesian jog
const CART_JOG_DEG = 20; // deg/s for Cartesian rotation jog
const HOME_TOL = 0.01; // rad
const NAMES = ['joint1', 'joint2', 'joint3', 'joint4', 'joint5', 'joint6'];
const PROFILE_BY_ID = { 1: 'auto', 2: 'safeauto', 3: 'jog' };
const ERR = Object.fromEntries(MOTION_ERROR.map((e, i) => [e, i]));

// Minimal stand-ins for the rclnodejs message classes the parent uses.
class SimMsg {
  constructor() {
    this.data = null;
    this.header = { frame_id: '', stamp: { sec: 0, nanosec: 0 } };
    this.twist = { linear: { x: 0, y: 0, z: 0 }, angular: { x: 0, y: 0, z: 0 } };
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clone = (v) => JSON.parse(JSON.stringify(v));
const stampNow = () => {
  const t = Date.now();
  return { sec: Math.floor(t / 1000), nanosec: (t % 1000) * 1e6 };
};
const timeText = () => new Date().toISOString().replace('T', ' ').slice(0, 19);
const smooth = (x) => x * x * (3 - 2 * x); // S-curve 0..1

export class SimROSBridge extends LightweightROSBridge {
  constructor(wsServer) {
    super(wsServer);
    this.simulated = true;
    // Files the /robot routes read (motion log, black box, programs)
    this.errorContainer = path.join(SIM_DIR, 'error_container');
    // programs.yaml next to points.yaml when the active project is on this
    // machine (like the real motion server), else a copy in the sim folder
    // seeded with the starter program and a demo of every motion type.
    const projectPrograms = path.join(path.dirname(pointPlanningFilePath.POINTS_YAML_FILE), 'programs.yaml');
    this.programsFile = fs.existsSync(path.dirname(projectPrograms)) ? projectPrograms : path.join(SIM_DIR, 'programs.yaml');
    if (this.programsFile.startsWith(SIM_DIR)) this.seedPrograms();

    this.positions = [0.35, -0.6, 0.9, 0.1, 0.5, -0.2]; // rad
    this.jointVelocity = [0, 0, 0, 0, 0, 0];
    this.twistCmd = { linear: { x: 0, y: 0, z: 0 }, angular: { x: 0, y: 0, z: 0 } };
    this.lastJogCmdAt = 0;
    this.cartOffset = [0, 0, 0, 0, 0, 0];
    this.history = []; // positions at 10 Hz, for the black box

    // Supervisor
    this.sup = {
      profile: 'jog',
      target: 'jog',
      phase: 'startup',
      latched: false,
      cause: 0,
      causeJoint: -1,
      estop: false,
      strict: true,
      speedOverride: 100,
      isolated: [false, false, false, false, false, false],
      requestId: 0,
      result: 0,
      failure: 0,
    };
    this.supJob = null;
    this.limits = {
      auto: { thresholds: [600, 600, 600, 700, 700, 800], max: 100 },
      safeauto: { thresholds: [250, 250, 250, 300, 300, 300], max: 30 },
      jog: { thresholds: [400, 400, 400, 500, 500, 500], max: 100 },
    };

    // Drives
    this.op = [true, true, true, true, true, true];
    this.fault = [false, false, false, false, false, false];
    this.lastErr = [0, 0, 0, 0, 0, 0];

    // Motion server
    this.job = null;
    this.motionSeq = 0;
    this.homeData = this.loadHomes();
    this.homingConfig = {
      default_speed_mps: 0.25, default_acceleration_mps2: 0.5, max_speed_mps: 1.0, max_acceleration_mps2: 2.0,
      position_tolerance: 0.01, already_home_tolerance: 0.005, settle_timeout_s: 3.0, planner_id: 'PTP',
    };
    this.gotoConfig = {
      default_speed_mps: 0.25, default_acceleration_mps2: 0.5, max_speed_mps: 1.5, max_acceleration_mps2: 3.0,
      position_tolerance: 0.01, settle_timeout_s: 3.0, default_planner: 'PILZ', ompl_planning_time_s: 2.0, ompl_planning_attempts: 3,
    };
    this.planCache = new Set();

    // Logs and IO watch
    this.eventLog = [];
    this.errorLog = [];
    this.counters = NAMES.map(() => ({ faults: 0, errors: 0, last: '' }));
    this.ioWatch = [];
    this.ioLog = [];
    this.ioCounts = {};
    this.ioSince = {};
    this.traceUntil = 0;

    // GPIO / IO pages
    this.lastGpioGroups = {
      gpio1: { di: { 1: true, 2: false, 3: false, 4: true }, do: { 1: false, 2: false, 3: false, 4: false } },
    };

    // Behaviour tree runner (simBtRunner.js, created in init)
    this.btRunner = null;
    this.controlActive = false;
    this.processStatus = 'stopped';
    this.lastRosbridgeStatus = 'STOPPED';
    this.timer = null;
  }

  async init() {
    if (this.initialized) return;

    for (const k of ['StringMsg', 'Bool', 'Int8', 'Float64', 'NextupDigitalOutputs', 'NextupEmergencyTrigger']) this[k] = SimMsg;
    this.twistMsg = new SimMsg();
    this.twistStampedMsg = new SimMsg();
    this.jointMsg = new SimMsg();
    this.stringMsg = new SimMsg();
    this.boolMsg = new SimMsg();

    // Stand-in node so code that checks `this.node` keeps working.
    this.node = { destroy: async () => {} };
    this.bindings = { status: 'skipped', message: 'simulated robot (no ROS 2)', packages: [] };
    fs.mkdirSync(path.join(this.errorContainer, 'blackbox'), { recursive: true });
    this.seedRecords();
    this.loadIoWatch();

    this.initialized = true;
    this.timer = setInterval(() => this.tick(), TICK_MS);
    this.publishDoApplied();

    console.log('[SIM] ROS 2 not available: running the simulated robot bridge');
    // Joints, limits and kinematics come from the robot model chosen in the 3D view.
    try {
      this.applyModel(await loadModel(selectedModelId()));
    } catch (err) {
      console.warn('[SIM] no robot model loaded, using simplified kinematics:', err.message);
    }
    this.offModel = onModelSelected((model) => this.applyModel(model));
    this.publishSupervisor();
    this.refreshHomes();
    this.startBtRunner();
    this.publishMotion();
    setTimeout(() => {
      this.sup.phase = 'running';
      this.supEvent('startup', 'Supervisor running: drives enabled, JOG');
      this.emitLog('INFO | sim | Simulated robot bridge started (supervisor, motion server, BT runner)');
    }, 1500);
  }

  // Every publisher returns a fake whose publish() feeds the simulation.
  getPublisher(topic) {
    let pub = this.publishers.get(topic);
    if (!pub) {
      pub = { publish: (msg) => this.onPublish(topic, clone(msg)) };
      this.publishers.set(topic, pub);
    }
    return pub;
  }

  emitLog(line) {
    this.queueLogLine(line);
  }

  emitToast(message, messageType = 'success', duration = 3) {
    this.ws.broadcast({ type: 'BT_TOAST_POPUP', payload: { message, messageType, duration } });
  }

  // ───────────────────────── simulation loop ─────────────────────────

  tick() {
    const dt = TICK_MS / 1000;
    const now = Date.now();
    this.tickCount = (this.tickCount || 0) + 1;
    const prevCart = this.latestCartesianValues;

    // Jog stops when the UI stops streaming commands (dead-man behaviour).
    if (now - this.lastJogCmdAt > 300) {
      this.jointVelocity.fill(0);
      this.twistCmd = { linear: { x: 0, y: 0, z: 0 }, angular: { x: 0, y: 0, z: 0 } };
    }

    this.stepSupervisorJob(now);
    this.stepMotion(now, dt);

    const canJog = !this.sup.latched && this.sup.profile === 'jog' && this.sup.phase === 'running' && !this.job;
    if (canJog) {
      const next = this.positions.map((p, i) => (this.sup.isolated[i] ? p : p + this.jointVelocity[i] * JOINT_JOG_RAD * dt));
      this.positions = this.clampToLimits(next, 'jog');
      const t = this.twistCmd;
      const lin = [t.linear.x, t.linear.y, t.linear.z].map((v) => Number(v) || 0);
      const ang = [t.angular.x, t.angular.y, t.angular.z].map((v) => Number(v) || 0);
      if (lin.some(Boolean) || ang.some(Boolean)) {
        if (this.chain) this.cartesianJog(lin, ang, dt);
        else {
          for (let i = 0; i < 3; i++) this.cartOffset[i] += lin[i] * CART_JOG_CM * 10 * dt;
          for (let i = 0; i < 3; i++) this.cartOffset[i + 3] += ang[i] * CART_JOG_DEG * dt;
        }
      }
    }
    this.stepBt(now);

    const cart = this.chain ? this.cartesianOf(this.positions) : this.looseCartesian();
    this.latestCartesianValues = cart;
    this.latestJointValues = this.positions.map((r) => (r * 180) / Math.PI);
    this.history.push([Date.now(), ...this.positions]);
    if (this.history.length > 60) this.history.shift();

    // Live values at 5 Hz, status at 4 Hz (the limits the real bridge applies).
    if (this.tickCount % 2 === 0) {
      this.onPositions(roundAll(this.positions, 5));
      this.publishState('CARTESIAN_VALUES', { values: cart });
      this.publishState('JOINT_VALUES', { values: roundAll(this.latestJointValues, 3) });
      const d = prevCart ? Math.hypot(cart[0] - prevCart[0], cart[1] - prevCart[1], cart[2] - prevCart[2]) : 0;
      // cm per tick → m/s
      this.publishState('TCP_STATE', { speed: Math.round((d / 100 / dt) * 1000) / 1000, angular: 0, frame: this.currentFrame });
      this.checkAtHome();
      if (this.job) this.publishMotion();
    }

    if (now - (this.lastStatusAt || 0) >= 250) {
      this.lastStatusAt = now;
      this.publishSupervisor();
      this.publishDrives();
      const di = [];
      for (let d = 0; d < 6; d++) di.push([d % 2 === 0, false, d === 3, false, this.sup.estop, true, true, false]);
      this.publishState('DI_STATUS', di);
      this.publishState('EMERGENCY_STATUS', { jointStatus: NAMES.map(() => this.sup.estop) });
      this.publishState('GPIO_STATE', { groups: this.lastGpioGroups });
      this.publishState('CONTROL_ACTIVE', this.controlActive);
      this.publishState('PROCESS_STATUS', this.processStatus);
    }
    if (now - (this.lastIoAt || 0) >= 3500) {
      this.lastIoAt = now;
      this.toggleWatchedInput();
    }
  }

  // ───────────────────────── robot model ─────────────────────────

  /** Takes limits and kinematics from a robot model (see robotModel/). */
  applyModel(model) {
    const chain = new Chain(model);
    if (chain.dof !== NAMES.length) {
      this.emitLog(`WARN | sim | ${model.label} has ${chain.dof} moving joints; the simulator needs ${NAMES.length}, keeping the previous model`);
      return;
    }
    const renamed = chain.names.some((n, i) => n !== NAMES[i]);
    this.chain = chain;
    this.model = { id: model.id, label: model.label };
    this.cartOffset = [0, 0, 0, 0, 0, 0];
    if (this.job) this.endMotion('aborted', ERR.E_INVALID_TARGET ?? 0, 'Robot model changed');
    this.positions = this.clampToLimits(this.positions);
    const lim = chain.lower.map((lo, i) => `${NAMES[i]} ${(lo * 180 / Math.PI).toFixed(0)}..${(chain.upper[i] * 180 / Math.PI).toFixed(0)}°`).join(', ');
    console.log(`[SIM] robot model ${model.id}: tool link '${chain.tip}', ${lim}`);
    this.emitLog(`INFO | sim | Simulating ${model.label} (${model.file}): tool link ${chain.tip}${renamed ? `, joints ${chain.names.join(' ')} mapped to ${NAMES.join(' ')} by order` : ''}`);
  }

  /** Keeps joints inside the model's limits; logs once per joint when a jog hits one. */
  clampToLimits(q, reason) {
    if (!this.chain) return q;
    const out = this.chain.clamp(q);
    if (reason === 'jog') {
      out.forEach((v, i) => {
        if (v !== q[i] && Date.now() - (this.limitWarnAt?.[i] || 0) > 3000) {
          this.limitWarnAt = this.limitWarnAt || {};
          this.limitWarnAt[i] = Date.now();
          this.emitLog(`WARN | sim | ${NAMES[i]} at its ${v >= this.chain.upper[i] ? 'upper' : 'lower'} limit (${((v * 180) / Math.PI).toFixed(1)}°)`);
        }
      });
    }
    return out;
  }

  /** Tool pose with the TCP offset applied, as 4x4. */
  toolPose(q) {
    const T = this.chain.fk(q);
    const o = this.tcpOffset;
    if (!o) return T;
    return mul(T, fromXyzRpy([Number(o.x) || 0, Number(o.y) || 0, Number(o.z) || 0], [o.roll || 0, o.pitch || 0, o.yaw || 0].map(Number)));
  }

  /** [x y z (cm), roll pitch yaw (deg)] of the tool in the base frame. */
  cartesianOf(q) {
    const T = this.toolPose(q);
    const rpy = rpyOf(T).map((r) => (r * 180) / Math.PI);
    return [T[3] * 100, T[7] * 100, T[11] * 100, ...rpy].map((v) => Math.round(v * 100) / 100);
  }

  /** Simplified values when no model could be loaded (the old behaviour). */
  looseCartesian() {
    const [j1, j2, j3, , j5, j6] = this.positions;
    const reach = 40 + 20 * Math.cos(j2) + 15 * Math.cos(j2 + j3);
    return [
      reach * Math.cos(j1) + this.cartOffset[0],
      reach * Math.sin(j1) + this.cartOffset[1],
      30 + 20 * Math.sin(-j2) + 15 * Math.sin(-(j2 + j3)) + this.cartOffset[2],
      180 + this.cartOffset[3],
      this.cartOffset[4] + (j5 * 180) / Math.PI,
      90 + this.cartOffset[5] + (j6 * 180) / Math.PI,
    ].map((v) => Math.round(v * 100) / 100);
  }

  /**
   * Cartesian jog through the model's kinematics, in the base frame or, when
   * the jog frame is the tool ('end'), in the tool frame. A goal pose moves
   * with the command and the joints follow it (damped least squares), so
   * the tool keeps a straight line without drifting; near a singularity or a
   * joint limit the goal is pulled back to where the robot is.
   */
  cartesianJog(lin, ang, dt) {
    const now = Date.now();
    const T = this.chain.fk(this.positions);
    if (!this.jogGoal || now - (this.jogGoalAt || 0) > 400) this.jogGoal = T;
    this.jogGoalAt = now;
    const G = this.jogGoal;
    let v = lin.map((x) => (x * CART_JOG_CM) / 100);
    let w = ang.map((x) => (x * CART_JOG_DEG * Math.PI) / 180);
    if (this.currentFrame === 'end' || this.currentFrame === 'tool0' || this.currentFrame === this.chain.tip) {
      v = rotate(G, v);
      w = rotate(G, w);
    }
    // Move the goal: translate, then rotate about the tool point.
    const wn = Math.hypot(...w);
    const R = wn > 0 ? axisAngle(w, wn * dt) : null;
    const next = R ? mul(R, [G[0], G[1], G[2], 0, G[4], G[5], G[6], 0, G[8], G[9], G[10], 0, 0, 0, 0, 1]) : G;
    this.jogGoal = [
      next[0], next[1], next[2], G[3] + v[0] * dt,
      next[4], next[5], next[6], G[7] + v[1] * dt,
      next[8], next[9], next[10], G[11] + v[2] * dt,
      0, 0, 0, 1,
    ];
    const e = poseError(T, this.jogGoal);
    const dq = this.chain.velocityIk(this.positions, e, 0.03);
    const max = Math.max(...dq.map(Math.abs));
    const lim = JOINT_JOG_RAD * 2 * dt; // the joints never go faster than twice the joint-jog speed
    const k = max > lim ? lim / max : 1;
    this.positions = this.clampToLimits(this.positions.map((p, i) => (this.sup.isolated[i] ? p : p + dq[i] * k)), 'jog');
    // Could not follow (singularity, limit): do not let the goal run away.
    const after = poseError(this.chain.fk(this.positions), this.jogGoal);
    if (Math.hypot(after[0], after[1], after[2]) > 0.01 || Math.hypot(after[3], after[4], after[5]) > 0.05) {
      this.jogGoal = this.chain.fk(this.positions);
      if (now - (this.singularWarnAt || 0) > 3000) {
        this.singularWarnAt = now;
        this.emitLog('WARN | sim | Cartesian jog slowed: near a singularity or a joint limit');
      }
    }
  }

  // ───────────────────────── supervisor ─────────────────────────

  speedScale() {
    const max = this.limits[this.sup.profile]?.max ?? 100;
    return Math.min(this.sup.speedOverride, max) / 100;
  }

  publishSupervisor() {
    const s = this.sup;
    const all = this.op.every(Boolean);
    this.onSupervisor({
      profile: s.profile,
      targetProfile: s.target,
      driveMode: s.profile === 'jog' ? 9 : 8,
      phase: s.phase,
      armed: s.phase !== 'startup' && !s.latched,
      latched: s.latched,
      cause: [null, 'estop_input', 'drive_fault', 'drive_disabled', 'external', 'position_jump', 'reset_failed', 'mode_rollback_failed'][s.cause] ?? null,
      causeJoint: s.causeJoint >= 0 ? NAMES[s.causeJoint] : null,
      estop: s.estop,
      allEnabled: all,
      anyFault: this.fault.some(Boolean),
      standstill: !this.job || this.job.state !== 'executing',
      strict: s.strict,
      speedOverride: s.speedOverride,
      speedScale: Math.round(this.speedScale() * 100), // percent, like the real message
      names: NAMES,
      thresholds: [...(this.limits[s.profile]?.thresholds || [])],
      isolated: [...s.isolated],
      request: {
        id: s.requestId,
        result: [null, 'in_progress', 'success', 'failed', 'rejected'][s.result] ?? null,
        failure: [null, 'busy', 'emergency_latched', 'drives_not_ready', 'not_standstill', 'estop_active',
          'settle_timeout', 'mode_confirm_timeout', 'reset_timeout', 'invalid_request', 'aborted_by_emergency', 'jog_only_isolated'][s.failure] ?? null,
      },
    });
  }

  /** Run a phased supervisor job (mode change or reset). */
  startSupJob(kind, steps, done) {
    this.sup.requestId += 1;
    this.sup.result = 1;
    this.sup.failure = 0;
    this.supJob = { kind, steps, idx: 0, until: Date.now() + steps[0].ms, done, started: Date.now() };
    this.sup.phase = steps[0].phase;
    this.publishSupervisor();
    return this.sup.requestId;
  }

  stepSupervisorJob(now) {
    const j = this.supJob;
    if (!j || now < j.until) return;
    const step = j.steps[j.idx];
    // mode_settle waits for standstill (the running motion), at most 2 s
    if (step.phase === 'mode_settle' && this.job?.state === 'executing') {
      if (now - j.started < 2000) return;
      this.finishSupJob(3, 6);
      return;
    }
    j.idx += 1;
    if (j.idx >= j.steps.length) {
      j.done();
      this.finishSupJob(2, 0);
      return;
    }
    this.sup.phase = j.steps[j.idx].phase;
    j.until = now + j.steps[j.idx].ms;
    this.publishSupervisor();
  }

  finishSupJob(result, failure) {
    this.supJob = null;
    this.sup.result = result;
    this.sup.failure = failure;
    if (!this.sup.latched) this.sup.phase = 'running';
    this.sup.target = this.sup.profile;
    this.publishSupervisor();
  }

  supEvent(event, detail, joint = '', fields) {
    this.addEvent(this.eventLog, { source: 'supervisor', joint, event, description: detail, state: this.sup.phase, fields });
  }

  addEvent(list, e) {
    const raw = {
      stamp: stampNow(), time: timeText(), source: e.source || '', joint: e.joint || '', event: e.event || '',
      code: e.code || 0, code_hex: e.code ? `0x${e.code.toString(16).toUpperCase().padStart(4, '0')}` : '',
      previous_code: 0, description: e.description || '', state: e.state || '', statusword: e.statusword || 0,
      mode: this.sup.profile === 'jog' ? 9 : 8, count: e.count || 1, detail: e.detail || '',
    };
    list.unshift(raw);
    if (list.length > 500) list.length = 500;
    this.onRobotEvent(errorEventView(raw));
    // the same line in the record file, with the extra fields the real nodes write
    const t = Date.now() / 1000;
    if (list === this.eventLog) {
      this.appendRecord('event_logs.yaml', {
        time: localTime(), joint: raw.joint, event: raw.event, stamp: t, source: raw.source || 'supervisor', profile: this.sup.profile,
        phase: Math.max(0, PHASES.indexOf(this.sup.phase)), ...(e.fields || {}), detail: e.detail || e.description || '',
      });
    } else if (list === this.errorLog) {
      const j = NAMES.indexOf(raw.joint);
      const prev = j >= 0 ? this.prevErr?.[j] || 0 : 0;
      this.appendRecord('error_logs.yaml', {
        time: localTime(), joint: raw.joint, last_error: raw.code, stamp: t, source: 'drive', event: raw.event, code_hex: raw.code_hex || '0x0000',
        previous_error: prev, state: raw.state, statusword: raw.state === 'FAULT' ? '0x1638' : '0x1637', mode: raw.mode, ...(e.fields || {}),
        ...(e.detail ? { detail: e.detail } : {}),
      });
    }
  }

  /** First start: copy the record files of a real robot into the sim's error_container. */
  seedRecords() {
    try {
      if (!fs.existsSync(SIM_RECORDS)) return;
      for (const f of fs.readdirSync(SIM_RECORDS)) {
        const src = path.join(SIM_RECORDS, f);
        const dst = path.join(this.errorContainer, f);
        if (fs.statSync(src).isFile() && !fs.existsSync(dst)) fs.copyFileSync(src, dst);
      }
      const bbDir = path.join(this.errorContainer, 'blackbox');
      for (const f of fs.readdirSync(path.join(SIM_RECORDS, 'blackbox'))) {
        if (!fs.existsSync(path.join(bbDir, f))) fs.copyFileSync(path.join(SIM_RECORDS, 'blackbox', f), path.join(bbDir, f));
      }
    } catch (err) {
      console.warn('[SIM] record files not seeded:', err.message);
    }
  }

  appendRecord(file, obj) {
    try {
      const full = path.join(this.errorContainer, file);
      if (!fs.existsSync(full)) fs.writeFileSync(full, `${file.replace(/\.yaml$/, '')}:\n`);
      fs.appendFileSync(full, yamlLine(obj));
    } catch {
      /* the sim keeps working without its files */
    }
  }

  resetRecord(file, obj) {
    try {
      fs.writeFileSync(path.join(this.errorContainer, file), `${file.replace(/\.yaml$/, '')}:\n${obj ? yamlLine(obj) : ''}`);
    } catch {
      /* ignore */
    }
  }

  loadIoWatch() {
    try {
      const doc = yaml.load(fs.readFileSync(path.join(this.errorContainer, 'io_watch.yaml'), 'utf8')) || {};
      this.ioWatch = (doc.signals || []).filter((w) => w?.name).map((w) => ({
        name: String(w.name), device: String(w.device || ''), input: String(w.input || ''),
        log_rising: w.log_rising !== false, log_falling: w.log_falling !== false, debounce_ms: Number(w.debounce_ms || 0), level: -1,
      }));
    } catch {
      this.ioWatch = [{ name: 'part_present', device: 'gpio1', input: 'di1', log_rising: true, log_falling: true, debounce_ms: 20, level: -1 }];
    }
  }

  saveIoWatch() {
    const lines = ['# Digital signals watched by nextup_drive_state_broadcaster (edit by hand or with ~/set_io_watch).', 'signals:'];
    for (const w of this.ioWatch) {
      lines.push(`  - name: ${w.name}`, `    device: ${w.device}`, `    input: ${w.input}`, `    log_rising: ${w.log_rising}`, `    log_falling: ${w.log_falling}`, `    debounce_ms: ${w.debounce_ms || 20}`);
    }
    if (!this.ioWatch.length) lines[1] = 'signals: []';
    try {
      fs.writeFileSync(path.join(this.errorContainer, 'io_watch.yaml'), `${lines.join('\n')}\n`);
    } catch {
      /* ignore */
    }
  }

  /** Global emergency: drives disabled, motion aborted, BT stopped, black box written. */
  latch(cause, joint = -1) {
    if (this.sup.latched) return;
    const causeId = { estop_input: 1, drive_fault: 2, drive_disabled: 3, external: 4 }[cause] || 4;
    Object.assign(this.sup, { latched: true, cause: causeId, causeJoint: joint, phase: 'emergency' });
    if (this.supJob) this.finishSupJob(3, 10);
    this.sup.phase = 'emergency';
    this.op.fill(false);
    this.jointVelocity.fill(0);
    if (this.job) this.endMotion('aborted', ERR.E_EMERGENCY_ACTIVE, 'Aborted by an emergency');
    if (this.btRunner?.active) this.btRunner.emergency();
    const causeText = { estop_input: 'Emergency button pressed', drive_fault: 'Drive fault', drive_disabled: 'Drive left OPERATION_ENABLED', external: 'External emergency trigger' }[cause] || cause;
    const full = joint >= 0 ? `${causeText} (${NAMES[joint]})` : causeText;
    this.supEvent('emergency', full, joint >= 0 ? NAMES[joint] : '', { code: causeId, cause: full });
    const file = this.writeBlackbox(cause, full, joint);
    if (file) this.supEvent('blackbox_saved', `${file} (${this.history.length} rows)`, '', { code: causeId, file });
    this.publishSupervisor();
  }

  /** Black box in the supervisor's format (header, then one row per sample). Returns the full path. */
  writeBlackbox(cause, causeText = cause, joint = -1) {
    try {
      const d = new Date();
      const p = pad2;
      const slug = `${cause === 'estop_input' ? 'emergency_button_pressed' : cause === 'drive_disabled' ? 'drive_left_operation_enabled' : cause === 'external' ? 'external_emergency_trigger' : cause}${joint >= 0 ? `_${NAMES[joint]}` : ''}`;
      const name = `blackbox_${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}_${slug}.csv`;
      const per = (k) => NAMES.map((n) => `${k}_${n}`);
      const cols = ['t_rel_s', 'phase', 'profile', 'drive_mode', 'armed', 'latched', 'estop', ...per('q'), ...per('qd'), ...per('pos_ref'), ...per('pos_out'), ...per('jog_ref'), ...per('jog_out'), ...per('statusword'), ...per('mode')];
      const t0 = Date.now();
      const prof = { auto: 1, safeauto: 2, jog: 3 }[this.sup.profile] || 0;
      const dm = this.sup.profile === 'jog' ? 9 : 8;
      const rows = this.history.map(([t, ...q], i) => {
        const prev = this.history[i - 1];
        const qd = q.map((v, j) => (prev ? (v - prev[j + 1]) / Math.max(0.001, (t - prev[0]) / 1000) : 0));
        const last = i === this.history.length - 1;
        const f6 = (v) => v.toFixed(6);
        return [
          ((t - t0) / 1000).toFixed(4), last ? 9 : 1, prof, dm, last ? 0 : 1, last ? 1 : 0, last && cause === 'estop_input' ? 1 : 0,
          ...q.map(f6), ...qd.map(f6), ...q.map((v) => (dm === 8 ? f6(v) : '')), ...q.map(f6),
          ...q.map(() => (dm === 9 ? '0.000000' : '')), ...q.map(() => '0.000000'),
          ...NAMES.map((_, j) => (last && j === joint ? '0x1638' : last ? '0x1633' : '0x1637')), ...NAMES.map(() => dm),
        ].join(',');
      });
      const head = [
        '# Nextup motion supervisor black box (simulated)',
        `# trigger_time: ${localTime(d)}`,
        `# cause: ${causeText}`,
        '# window: 6.0 s before to 0.0 s after the trigger',
        "# units: q / pos_ref / pos_out rad, qd rad/s, jog in the drives' jogvelocity unit; pos_ref/jog_ref empty = no command that cycle",
        '# phase: 0 startup 1 running 2-5 mode change 6-8 reset 9 emergency | profile: 1 auto 2 safeauto 3 jog',
      ];
      const full = path.join(this.errorContainer, 'blackbox', name);
      fs.writeFileSync(full, `${head.join('\n')}\n${cols.join(',')}\n${rows.join('\n')}\n`);
      return full;
    } catch (err) {
      console.warn('[SIM] black box not written:', err.message);
      return '';
    }
  }

  // ───────────────────────── drives ─────────────────────────

  publishDrives() {
    const moving = this.job?.state === 'executing';
    this.onDriveState({
      name: NAMES,
      op_status: [...this.op],
      fault: [...this.fault],
      state: NAMES.map((_, i) => (this.fault[i] ? 'FAULT' : this.op[i] ? 'OPERATION_ENABLED' : 'SWITCH_ON_DISABLED')),
      lasterror: [...this.lastErr],
      modeofoperation: NAMES.map(() => (this.sup.profile === 'jog' ? 9 : 8)),
      positionfoerror: NAMES.map(() => (moving ? Math.random() * 0.002 : Math.random() * 0.0002)),
    });
  }

  driveFault(j, code = 0x7500) {
    this.fault[j] = true;
    this.op[j] = false;
    this.lastErr[j] = code;
    const c = this.counters[j];
    c.faults += 1;
    c.errors += 1;
    c.last = timeText();
    this.prevErr = this.prevErr || NAMES.map(() => 0);
    this.addEvent(this.errorLog, { source: 'drive', joint: NAMES[j], event: 'error_raised', code, state: 'FAULT' });
    this.addEvent(this.errorLog, { source: 'drive', joint: NAMES[j], event: 'fault_raised', code, state: 'FAULT', fields: { count: 1 }, detail: 'simulated fault' });
    this.prevErr[j] = code;
    if (!this.sup.strict && this.sup.profile === 'jog') {
      // Relaxed latching (JOG only): the faulted joint is isolated, the others keep moving
      this.sup.isolated[j] = true;
      this.supEvent('joint_isolated', `${NAMES[j]} isolated (relaxed latching)`, NAMES[j]);
      if (this.job) this.endMotion('aborted', ERR.E_DRIVES_NOT_READY, `${NAMES[j]} faulted`);
    } else {
      this.latch('drive_fault', j);
    }
  }

  // ───────────────────────── motion server ─────────────────────────

  loadHomes() {
    try {
      return JSON.parse(fs.readFileSync(HOMES_FILE, 'utf8'));
    } catch {
      return {
        active: 'home',
        homes: [
          { name: 'home', description: 'Factory home', locked: true, joints: [0, 0, 0, 0, 0, 0], stages: [2, 1, 1, 2, 2, 2], via_point: '' },
          { name: 'park', description: 'Folded for transport', locked: false, joints: [0, -0.8, 1.4, 0, 0.9, 0], stages: [], via_point: '' },
        ],
      };
    }
  }

  saveHomes() {
    try {
      fs.mkdirSync(SIM_DIR, { recursive: true });
      fs.writeFileSync(HOMES_FILE, JSON.stringify(this.homeData, null, 2));
    } catch (err) {
      console.warn('[SIM] homes not saved:', err.message);
    }
  }

  checkAtHome() {
    const near = (h) => h.joints.every((v, i) => Math.abs(v - this.positions[i]) < HOME_TOL);
    const hit = this.homeData.homes.find(near);
    const view = {
      atHome: Boolean(hit),
      homeName: hit?.name || '',
      activeHome: this.homeData.active,
      atActiveHome: Boolean(hit && hit.name === this.homeData.active),
    };
    const prev = this.atHome;
    if (!prev || prev.atHome !== view.atHome || prev.homeName !== view.homeName || prev.activeHome !== view.activeHome) this.onAtHome(view);
  }

  readPoints() {
    for (const f of [pointPlanningFilePath.POINTS_YAML_FILE, path.join(BACKEND, 'points_backup.yaml')]) {
      try {
        const doc = yaml.load(fs.readFileSync(f, 'utf8'));
        if (Array.isArray(doc?.points)) return doc.points;
      } catch {
        /* next */
      }
    }
    return [];
  }

  pointJoints(name) {
    const p = this.readPoints().find((x) => x.name === name);
    const jv = p?.joints_values;
    if (!jv) return null;
    const j = NAMES.map((n) => Number(jv[n]));
    return j.every(Number.isFinite) ? j : null;
  }

  /** Common checks of every motion start; returns an error answer or null. */
  motionRefusal(dryRun) {
    if (this.job) return this.refuse(ERR.E_BUSY, `Another motion is running (${this.job.kind} ${this.job.target})`);
    if (this.sup.latched || this.sup.estop) return this.refuse(ERR.E_EMERGENCY_ACTIVE);
    if (dryRun) return null;
    if (this.sup.phase !== 'running') return this.refuse(ERR.E_DRIVES_NOT_READY, `Supervisor is busy (${this.sup.phase})`);
    if (this.sup.profile === 'jog') return this.refuse(ERR.E_JOG_MODE_ACTIVE);
    if (this.sup.isolated.some(Boolean) || !this.op.every(Boolean)) return this.refuse(ERR.E_DRIVES_NOT_READY);
    return null;
  }

  refuse(code, message) {
    return { accepted: false, motion_id: '', error_code: code, message: message || '', target_joints: [] };
  }

  /**
   * Start a simulated motion. segments: [{ to: [6 rad], label, joints?: [indices that move] }].
   * Goes checking → planning → executing (S-curve per segment) → verifying → succeeded.
   */
  beginMotion({ kind, target, motionType = 'PTP', planner = '', speed, acceleration, dryRun, segments, loops = 1, makeSegments }) {
    const id = `sim-${kind}-${++this.motionSeq}`;
    const cfg = kind === 'home' ? this.homingConfig : this.gotoConfig;
    const spd = Math.min(speed || cfg.default_speed_mps, cfg.max_speed_mps);
    const cacheKey = `${kind}:${target}:${motionType}`;
    this.job = {
      id, kind, target, motionType, planner: planner || (kind === 'home' ? cfg.planner_id : cfg.default_planner),
      speed: spd, acceleration: Math.min(acceleration || cfg.default_acceleration_mps2, cfg.max_acceleration_mps2),
      dryRun: Boolean(dryRun), segments, seg: 0, segStart: 0, from: [...this.positions],
      state: 'checking', until: Date.now() + 120, started: Date.now(), message: 'Checking the target',
      loops, loop: 1, makeSegments, finishing: false, cached: this.planCache.has(cacheKey), cacheKey,
    };
    this.publishMotion();
    return { accepted: true, motion_id: id, error_code: 0, message: dryRun ? 'Dry run started' : 'Motion started', target_joints: segments.at(-1)?.to || [] };
  }

  segmentDuration(seg, from) {
    const delta = Math.max(...seg.to.map((v, i) => Math.abs(v - from[i])));
    const radPerS = Math.min(1.6, Math.max(0.15, this.job.speed * 3)) * Math.max(0.05, this.speedScale());
    return Math.max(seg.minMs ?? 400, (delta / radPerS) * 1000);
  }

  stepMotion(now) {
    const j = this.job;
    if (!j) return;
    if (j.state === 'checking' && now >= j.until) {
      j.state = 'planning';
      j.message = `Planning with ${j.planner}`;
      j.until = now + (j.cached ? 60 : 250);
      this.publishMotion();
    } else if (j.state === 'planning' && now >= j.until) {
      this.planCache.add(j.cacheKey);
      if (j.dryRun) {
        let t = 0;
        let from = [...this.positions];
        for (const s of j.segments) {
          t += this.segmentDuration(s, from);
          from = s.to;
        }
        this.endMotion('succeeded', 0, `Dry run OK: ${j.segments.length} segment(s), about ${(t / 1000).toFixed(1)} s at the current speed`);
        return;
      }
      j.state = 'executing';
      this.startSegment(now);
    } else if (j.state === 'executing') {
      const s = j.segments[j.seg];
      const x = Math.min(1, (now - j.segStart) / j.segDuration);
      const k = smooth(x);
      this.positions = this.positions.map((p, i) => (s.joints && !s.joints.includes(i) ? p : j.from[i] + (s.to[i] - j.from[i]) * k));
      if (x >= 1) {
        j.seg += 1;
        if (j.seg < j.segments.length) {
          this.startSegment(now);
        } else if (j.makeSegments && (j.loops === 0 ? !j.finishing : j.loop < j.loops)) {
          j.loop += 1;
          j.segments = j.makeSegments();
          j.seg = 0;
          this.startSegment(now);
        } else {
          j.state = 'verifying';
          j.message = 'Verifying the final position';
          j.until = now + 200;
          this.publishMotion();
        }
      }
    } else if (j.state === 'verifying' && now >= j.until) {
      this.endMotion('succeeded', 0, `${j.kind === 'home' ? 'Homing' : 'Motion'} complete`);
    }
  }

  startSegment(now) {
    const j = this.job;
    const s = j.segments[j.seg];
    j.from = [...this.positions];
    j.segStart = now;
    j.segDuration = this.segmentDuration(s, j.from);
    j.message = s.label || `Moving to ${j.target}`;
    this.publishMotion();
  }

  endMotion(state, code, message) {
    const j = this.job;
    if (!j) return;
    j.state = state;
    j.error = code;
    j.message = message;
    j.ended = Date.now();
    this.publishMotion();
    this.appendMotionLog(j);
    if (state === 'failed' || state === 'aborted') this.emitLog(`ERROR | motion_server | ${j.kind} ${j.target}: ${message}`);
    else this.emitLog(`INFO | motion_server | ${j.kind} ${j.target}: ${message}`);
    this.lastJob = j;
    this.job = null;
  }

  publishMotion() {
    const j = this.job || this.lastJob;
    if (!j) {
      this.onMotionStatus({ id: '', kind: '', target: '', motionType: '', planner: '', state: 'idle', active: false, final: false, stage: 0, stageCount: 0, stageLabel: '', progress: 0, speed: 0, acceleration: 0, achievedSpeed: 0, speedScale: this.speedScale() * 100, dryRun: false, errorCode: 0, error: null, message: '', targetJoints: [], elapsed: 0, cached: false, pathFraction: 0, pathLength: 0 });
      return;
    }
    const executing = j.state === 'executing';
    const segFrac = executing ? Math.min(1, (Date.now() - j.segStart) / (j.segDuration || 1)) : 0;
    const finalOk = j.state === 'succeeded' && !j.dryRun;
    const done = finalOk ? 1 : (j.seg + segFrac) / Math.max(1, j.segments.length);
    const code = j.error || 0;
    this.onMotionStatus({
      id: j.id,
      kind: j.kind,
      target: j.target,
      motionType: j.motionType,
      planner: j.planner,
      state: j.state,
      active: ['checking', 'planning', 'executing', 'verifying'].includes(j.state),
      final: ['succeeded', 'failed', 'canceled', 'aborted'].includes(j.state),
      stage: Math.min(j.seg + 1, j.segments.length),
      stageCount: j.segments.length,
      stageLabel: j.segments[Math.min(j.seg, j.segments.length - 1)]?.label || '',
      progress: Math.round(done * 1000) / 1000,
      speed: j.speed,
      acceleration: j.acceleration,
      achievedSpeed: executing ? Math.round(j.speed * this.speedScale() * Math.sin(Math.PI * segFrac) * 1000) / 1000 : 0,
      speedScale: Math.round(this.speedScale() * 100),
      dryRun: j.dryRun,
      errorCode: code,
      error: code ? MOTION_ERROR[code] : null,
      message: j.loops !== 1 && executing ? `${j.message} (loop ${j.loop}${j.loops ? `/${j.loops}` : ''})` : j.message,
      targetJoints: (j.segments.at(-1)?.to || []).map((v) => Math.round(v * 1e5) / 1e5),
      elapsed: Math.round(((j.ended || Date.now()) - j.started) / 100) / 10,
      cached: j.cached,
      pathFraction: j.motionType === 'LIN' ? 1 : 0,
      pathLength: 0,
    });
  }

  appendMotionLog(j) {
    try {
      const entry = {
        id: j.id, time: timeText(), kind: j.kind, target: j.target, motion_type: j.motionType, planner: j.planner,
        state: j.state, error: MOTION_ERROR[j.error || 0], duration_s: Math.round(((j.ended || Date.now()) - j.started) / 100) / 10,
        speed_mps: j.speed, dry_run: j.dryRun, message: j.message,
      };
      const line = `- ${yaml.dump(entry, { flowLevel: 0, lineWidth: 400 }).trim()}\n`;
      fs.appendFileSync(path.join(this.errorContainer, 'motion_logs.yaml'), line);
    } catch (err) {
      console.warn('[SIM] motion log not written:', err.message);
    }
  }

  homeSegments(home, singleStage) {
    const stages = home.stages?.length === 6 && !singleStage ? home.stages : null;
    if (!stages) return [{ to: [...home.joints], label: `Moving to ${home.name}` }];
    const order = [...new Set(stages)].sort((a, b) => a - b);
    let pos = [...this.positions];
    return order.map((st, k) => {
      const joints = stages.map((s, i) => (s === st ? i : -1)).filter((i) => i >= 0);
      pos = pos.map((v, i) => (joints.includes(i) ? home.joints[i] : v));
      return { to: [...pos], joints, label: `Stage ${k + 1}/${order.length}: ${joints.map((i) => `J${i + 1}`).join(' ')}` };
    });
  }

  withApproach(to, approachMm, retractMm, name) {
    const off = (mm) => to.map((v, i) => (i === 1 ? v - mm / 400 : v));
    const segs = [];
    if (approachMm > 0) segs.push({ to: off(approachMm), label: `Approach ${name} (${approachMm} mm)` });
    segs.push({ to: [...to], label: `Moving to ${name}` });
    if (retractMm > 0) segs.push({ to: off(retractMm), label: `Retract from ${name} (${retractMm} mm)` });
    return segs;
  }

  readProgram(name) {
    try {
      const doc = yaml.load(fs.readFileSync(this.programsFile, 'utf8')) || {};
      let list = doc.programs || [];
      if (!Array.isArray(list)) list = Object.entries(list).map(([n, p]) => ({ name: n, ...(p || {}) }));
      return list.find((p) => p.name === name) || null;
    } catch {
      return null;
    }
  }

  seedPrograms() {
    if (fs.existsSync(this.programsFile)) return;
    try {
      fs.mkdirSync(path.dirname(this.programsFile), { recursive: true });
      const starter = fs.existsSync(DEFAULT_PROGRAMS_FILE) ? fs.readFileSync(DEFAULT_PROGRAMS_FILE, 'utf8') : 'programs:\n';
      fs.writeFileSync(this.programsFile, `${starter.trimEnd()}\n${SIM_DEMO_PROGRAMS}`);
    } catch (err) {
      console.warn(`[sim] could not create ${this.programsFile}: ${err.message}`);
    }
  }

  /** Flange pose of a taught point from its joints (mm, rotation), for the program path. */
  pointPose(name) {
    const j = this.pointJoints(name);
    if (!j) return null;
    if (this.chain) {
      const T = this.chain.fk(j);
      return { p: [T[3] * 1000, T[7] * 1000, T[11] * 1000], R: [T[0], T[1], T[2], T[4], T[5], T[6], T[8], T[9], T[10]], joints: j };
    }
    const c = this.readPoints().find((x) => x.name === name)?.coordinate;
    return c ? { p: [c.x * 10, c.y * 10, c.z * 10], R: null, joints: j } : null;
  }

  /**
   * Joint segments of one loop of a program: the tool path of programPath.js,
   * solved point by point with the model's IK (orientation of the step's
   * target point, else kept). PTP steps to a plain point use its taught joints.
   * Returns { segments } or { error, code }.
   */
  programSegments(p, req, loop = 1) {
    const callOffset = { x: Number(req.offset_x_mm) || 0, y: Number(req.offset_y_mm) || 0, z: Number(req.offset_z_mm) || 0 };
    const shifted = callOffset.x || callOffset.y || callOffset.z;
    const poses = new Map();
    const lookup = (n) => {
      if (!poses.has(n)) poses.set(n, this.pointPose(n));
      return poses.get(n);
    };
    const path = buildPath(p, lookup, { callOffset: shifted ? callOffset : null });
    const n = p.steps.length;
    const segs = [];
    let q = [...this.positions];
    let R = this.chain ? (() => { const T = this.chain.fk(q); return [T[0], T[1], T[2], T[4], T[5], T[6], T[8], T[9], T[10]]; })() : null;
    const solve = (pt, rot) => {
      if (!this.chain) return null;
      const r = rot || R;
      const G = [r[0], r[1], r[2], pt[0] / 1000, r[3], r[4], r[5], pt[1] / 1000, r[6], r[7], r[8], pt[2] / 1000, 0, 0, 0, 1];
      return this.chain.ik(G, q, { iters: 120 });
    };
    const dwell = (seg, k) => {
      const st = p.steps[seg.step];
      const lastOfStep = path.segments[k + 1]?.step !== seg.step;
      if (lastOfStep && Number(st.dwell_s) > 0) segs.push({ to: [...q], label: `loop ${loop} / step ${seg.step + 1} of ${n}: dwell ${st.dwell_s} s`, minMs: Number(st.dwell_s) * 1000 });
    };
    for (const [k, seg] of path.segments.entries()) {
      const st = p.steps[seg.step];
      const label = `loop ${loop} / step ${seg.step + 1} of ${n}: ${st.motion} ${describeStep(st)}${seg.approach ? ' (approach)' : ''}`;
      const target = st.point ? lookup(st.point) : null;
      if (seg.kind === 'ptp' && st.point && !st.offset && !shifted && target) {
        q = [...target.joints];
        if (target.R) R = target.R;
        segs.push({ to: [...q], label });
        dwell(seg, k);
        continue;
      }
      if (!this.chain) {
        if (target) {
          q = [...target.joints];
          segs.push({ to: [...q], label });
          dwell(seg, k);
        }
        continue;
      }
      const rot = target?.R && (seg.kind === 'ptp' || seg.kind === 'lin') ? target.R : R;
      const pts = seg.kind === 'ptp' ? [seg.pts[seg.pts.length - 1]] : seg.pts.slice(1);
      const every = Math.max(1, Math.ceil(pts.length / 36));
      for (let k = 0; k < pts.length; k++) {
        if (k % every !== 0 && k !== pts.length - 1) continue;
        const sol = solve(pts[k], rot);
        if (!sol) return { error: `${p.name} step ${seg.step + 1} (${describeStep(st)}): not reachable`, code: ERR.E_UNREACHABLE };
        q = sol;
        segs.push({ to: [...q], label, minMs: seg.kind === 'ptp' ? 400 : 40 });
      }
      R = rot;
      dwell(seg, k);
    }
    if (path.missing.size) return { error: `${p.name}: not in points.yaml: ${[...path.missing].join(', ')}`, code: ERR.E_UNKNOWN_TARGET };
    if (!segs.length) return { error: `${p.name}: nothing to move`, code: ERR.E_INVALID_TARGET };
    return { segments: segs };
  }

  // ───────────────────────── services ─────────────────────────

  async callService(key, req = {}) {
    if (!SRV[key]) return { ok: false, message: `unknown service ${key}` };
    await sleep(15);
    const fn = this.services[key];
    if (!fn) return { ok: false, unavailable: true, message: `${SRV[key][1]} is not available (simulated)` };
    try {
      return { ok: true, response: (await fn.call(this, req || {})) || {} };
    } catch (err) {
      return { ok: false, message: `${SRV[key][1]}: ${err.message}` };
    }
  }

  serviceAvailability() {
    const out = {};
    for (const [key, [type, name]] of Object.entries(SRV)) out[key] = { name, type, available: Boolean(this.services[key]) };
    return out;
  }

  get services() {
    return SIM_SERVICES;
  }

  // ───────────────────────── IO watch ─────────────────────────

  /** Every 3.5 s one watched signal changes (all while a tree runs): logged like the real broadcaster. */
  toggleWatchedInput() {
    const g = this.lastGpioGroups.gpio1;
    this.ioLevels = this.ioLevels || {};
    this.ioTurn = (this.ioTurn || 0) + 1;
    this.ioWatch.forEach((w, n) => {
      if (!this.btRunner?.active && n !== this.ioTurn % Math.max(1, this.ioWatch.length)) return;
      const m = /^(di|do)(\d)$/.exec(w.input) || /^bit:(\d+)$/.exec(w.input);
      const pin = Number(m?.[2] ?? m?.[1] ?? 0);
      const v = !(this.ioLevels[w.name] ?? (w.level === 1));
      this.ioLevels[w.name] = v;
      if (w.device === 'gpio1' && /^di/.test(w.input) && pin) g.di[pin] = v;
      w.level = v ? 1 : 0;
      const now = Date.now();
      const wasFor = this.ioSince[w.name] ? (now - this.ioSince[w.name]) / 1000 : 0;
      this.ioSince[w.name] = now;
      if ((v && !w.log_rising) || (!v && !w.log_falling)) return;
      if (v) this.ioCounts[w.name] = (this.ioCounts[w.name] || 0) + 1;
      const bit = w.device === 'gpio1' ? pin - 1 : /^di/.test(w.input) ? [16, 17, 18, 19, 20, 27, 28, 29][pin - 1] ?? pin : pin;
      const ev = v ? 'HIGH' : 'LOW';
      const positions = this.positions.map((r) => Math.round(((r * 180) / Math.PI) * 100) / 100);
      const phase = Math.max(0, PHASES.indexOf(this.sup.phase));
      const detail = `${w.name} ${ev} after ${wasFor.toFixed(3)} s ${v ? 'LOW' : 'HIGH'}${Date.now() < this.traceUntil ? ' (trace)' : ''}`;
      const raw = {
        stamp: stampNow(), time: localTime(), signal: w.name, device: w.device, input: w.input, bit,
        event: ev, value: v, was_for_s: wasFor, count: this.ioCounts[w.name] || 0,
        positions_deg: positions, profile: this.sup.profile, phase, detail,
      };
      this.ioLog.unshift(raw);
      if (this.ioLog.length > 500) this.ioLog.length = 500;
      this.onIoEvent(ioEventView(raw));
      this.appendRecord('io_logs.yaml', {
        time: raw.time, signal: w.name, event: ev, stamp: now / 1000, source: 'io', device: w.device, input: w.input, bit, value: v ? 1 : 0,
        was_for_s: wasFor, count: raw.count, positions_deg: positions, profile: this.sup.profile, phase, detail,
      });
    });
  }

  // ───────────────────────── behaviour tree ─────────────────────────

  /** Folder of the tree files: the robot's control_data when present, else the bundled demo trees. */
  btControlDirPath() {
    if (fs.existsSync(path.join(XML_BASE_DIR, 'main_tree.xml'))) return XML_BASE_DIR;
    return path.join(BACKEND, 'config', 'sim_trees');
  }

  startBtRunner() {
    this.btControlDir = this.btControlDirPath();
    const round4 = (v) => Math.round(v * 1e4) / 1e4;
    this.btRunner = new SimBtRunner({
      monitor: this.btMon,
      controlDir: this.btControlDir,
      defaultTree: path.join(this.btControlDir, 'main_tree.xml'),
      pointNames: () => this.readPoints().map((p) => p.name),
      log: (level, text) => this.emitLog(`${level} | control_logic_bt | ${text}`),
      toast: (text, kind, s) => this.emitToast(text, kind, s),
      motionBlocked: () => {
        if (this.sup.latched) return 'E_EMERGENCY_ACTIVE: emergency latched, reset it first';
        if (this.sup.profile === 'jog') return 'E_WRONG_MODE: the robot is in JOG; motions need AUTO or SAFEAUTO';
        if (this.job) return 'E_BUSY: another motion is running';
        return '';
      },
      joints: () => this.positions.map(round4),
      onActive: (view) => this.onBtActive(view),
      onRunner: (view) => this.btMon.onRunnerStatus(runnerStatusView(view)),
      onTree: (info) => {
        this.btTree = info;
        this.publishState('BT_TREE', info);
      },
      onBlackboard: (bb) => this.publishState('BT_BLACKBOARD', { main: Object.entries(bb).map(([key, value]) => ({ key, value: String(value), type: 'string' })) }),
      onCycleTime: (s) => this.ws.broadcast({ type: 'CYCLE_TIME', payload: s }),
      onActiveFlag: (on) => {
        this.controlActive = on;
        if (on) this.processStatus = 'running'; // the process stays on when a run ends
        this.publishState('CONTROL_ACTIVE', on);
      },
    });
    this.btRunner.init();
  }

  stepBt(now) {
    const r = this.btRunner;
    if (!r) return;
    r.tick(now);
    // a little motion while a real (not simulated / dry) run moves, so TCP speed and positions live
    if (r.active && !r.run.sim && !r.run.dryRun && !this.job && this.sup.profile !== 'jog' && !this.sup.latched) {
      const w = (now - r.cycleStart) / 1000;
      this.positions = this.positions.map((p, i) => p + Math.sin(w * 1.3 + i) * 0.004);
    }
  }

  /** Test hooks for the simulator (POST /robot/sim/:kind). */
  /**
   * The output controllers of the new install: an accepted command is republished on
   * applied_commands one control cycle later (DO_APPLIED); a refused one never is.
   */
  applyDo(drivers, gpio) {
    if (!this.doApplied) this.doApplied = { drivers: {}, gpio: {} };
    if (this.doRefuse) return;
    setTimeout(() => {
      const a = this.doApplied;
      for (const [d, outs] of Object.entries(drivers || {})) a.drivers[d] = { ...a.drivers[d], ...outs };
      for (const [g, outs] of Object.entries(gpio || {})) a.gpio[g] = { ...a.gpio[g], ...outs };
      this.publishDoApplied();
    }, 30);
  }

  publishDoApplied() {
    const a = this.doApplied || { drivers: {}, gpio: {} };
    this.publishState('DO_APPLIED', { drivers: a.drivers, gpio: a.gpio });
  }

  simInject(kind, arg) {
    switch (kind) {
      case 'fault': {
        const j = Math.max(0, Math.min(5, Number.isFinite(Number(arg)) ? Number(arg) : 2));
        this.driveFault(j);
        return { ok: true, message: `Drive fault on ${NAMES[j]}` };
      }
      case 'estop':
        this.sup.estop = !this.sup.estop;
        if (this.sup.estop) this.latch('estop_input');
        else this.supEvent('estop_released', 'E-stop button released');
        return { ok: true, message: this.sup.estop ? 'E-stop pressed' : 'E-stop released' };
      case 'operator':
        this.setOperatorRequest(parseOperatorRequest(`op${Date.now() % 10000},Part missing in the fixture. What now?,Retry|Skip|Abort,60`));
        return { ok: true, message: 'Operator question sent' };
      case 'btfail':
        return this.btRunner.injectFailure();
      case 'dorefuse':
        // the output controllers refuse every command (as when they are not active)
        this.doRefuse = !this.doRefuse;
        return { ok: true, message: this.doRefuse ? 'Output controllers refuse commands' : 'Output controllers accept commands again' };
      default:
        return { ok: false, message: `unknown sim event '${kind}' (fault, estop, operator, btfail, dorefuse)` };
    }
  }

  // ───────────────────────── published topics ─────────────────────────

  onPublish(topic, msg) {
    const data = msg?.data;

    if (topic === '/robot_manipulator_velocity_controller/commands') {
      this.jointVelocity = (Array.isArray(data) ? data : []).slice(0, 6).map(Number);
      while (this.jointVelocity.length < 6) this.jointVelocity.push(0);
      this.lastJogCmdAt = Date.now();
      return;
    }
    if (topic === '/servo_node/delta_twist_cmds') {
      this.twistCmd = msg.twist;
      this.lastJogCmdAt = Date.now();
      return;
    }
    if (topic === '/ui_commands') {
      // Step jog: "+j1" / "-cx" while held, "0j1" on release
      const m = /^([+-]?|0)(j[1-6]|c[xyzrpw])$/.exec(String(data));
      if (!m) {
        this.emitLog(`INFO | sim | ui_command "${data}" received`);
        return;
      }
      if (this.sup.profile !== 'jog' && m[1] !== '0') {
        if (Date.now() - (this.jogWarnAt || 0) > 3000) {
          this.jogWarnAt = Date.now();
          this.emitLog(`WARN | ui_command_node | jog ignored: robot is in ${this.sup.profile.toUpperCase()}, switch to JOG`);
        }
        return;
      }
      const dir = m[1] === '-' ? -1 : m[1] === '0' ? 0 : 1;
      if (m[2][0] === 'j') {
        this.jointVelocity.fill(0);
        this.jointVelocity[Number(m[2][1]) - 1] = dir;
      } else {
        const axis = { x: ['linear', 'x'], y: ['linear', 'y'], z: ['linear', 'z'], r: ['angular', 'x'], p: ['angular', 'y'], w: ['angular', 'z'] }[m[2][1]];
        this.twistCmd = { linear: { x: 0, y: 0, z: 0 }, angular: { x: 0, y: 0, z: 0 } };
        this.twistCmd[axis[0]][axis[1]] = dir;
      }
      this.lastJogCmdAt = dir ? Date.now() : 0;
      return;
    }
    if (topic === TOPIC.COMPAT_EMERGENCY) {
      this.latch('external');
      return;
    }
    if (topic === '/change_mode' || topic === '/reset_fault') {
      this.emitLog(`WARN | sim | ${topic} is a compatibility topic; the web uses the supervisor services`);
      return;
    }
    if (topic === TOPIC.DO_COMMANDS) {
      // NextupDigitalOutputsCommand: name = joints changed (empty = all), 1 on / 0 off / -1 as is
      const byDriver = doCommandView(msg, NAMES);
      for (const [driver, outs] of Object.entries(byDriver)) this.ws.broadcast({ type: 'DO_STATUS', payload: { driver: Number(driver), ...outs } });
      this.applyDo(byDriver);
      return;
    }
    if (topic === TOPIC.GPIO_COMMANDS) {
      const group = msg.interface_groups?.[0];
      const iv = msg.interface_values?.[0];
      if (!group || !iv) return;
      const g = this.lastGpioGroups[group] || (this.lastGpioGroups[group] = { di: {}, do: {} });
      const patch = {};
      (iv.interface_names || []).forEach((name, i) => {
        const m = /^do0*(\d+)$/i.exec(name);
        if (m) patch[Number(m[1])] = !!iv.values[i];
      });
      Object.assign(g.do, patch);
      this.ws.broadcast({ type: 'GPIO_PUBLISH_CONFIRM', payload: { group, do: patch } });
      this.applyDo(null, { [group]: patch });
      return;
    }
    // Old runner topics, mapped like control_logic_bt does (docs/RUNNER.md)
    if (topic === '/control_start_bt') {
      if (data) this.btRunner.start({ cycles: 0 });
      else this.btRunner.stop();
      return;
    }
    if (topic === '/control_stop_bt') {
      this.btRunner.stop();
      return;
    }
    if (topic === '/control_exit_bt') {
      this.btRunner.finishCycle();
      return;
    }
    if (topic === '/control_reset_bt') {
      this.btRunner.abort();
      return;
    }
    if (topic === TOPIC.BT_BREAKPOINT_CONTINUE) {
      this.btRunner.dbgResume();
      return;
    }
    if (topic === TOPIC.BT_OPERATOR_REPLY) {
      const [id, choice] = String(data).split(',');
      this.emitLog(`INFO | control_logic_bt | operator answered "${choice}" (${id})`);
      if (/abort/i.test(choice || '') && this.btRunner?.active) this.btRunner.abort();
      return;
    }
    if (topic === '/control_process_control_bt') {
      // like the real status topic: "running" while the process is on
      this.processStatus = String(data) === 'start' ? 'running' : String(data) === 'stop' ? 'stopped' : String(data);
      return;
    }
    if (topic === '/control_process_rosbridge') {
      this.lastRosbridgeStatus = data === 'start' ? 'RUNNING' : 'STOPPED';
      this.publishState('ROSBRIDGE_STATUS', this.lastRosbridgeStatus);
      return;
    }
    if (topic === '/logs_topic') {
      this.emitLog(String(data));
      return;
    }
    if (topic === '/trajectory_execution_event') {
      if (this.job) this.endMotion('canceled', ERR.E_CANCELED, 'Stopped');
    }
    // Everything else is accepted silently.
  }

  async shutdown() {
    if (this.timer) clearInterval(this.timer);
    for (const gate of this.gates) gate.stop();
    this.logGate.stop();
  }
}

/* ───────────── simulated services (this = SimROSBridge) ───────────── */

const ok = (message = '', extra = {}) => ({ success: true, message, ...extra });
const no = (message, extra = {}) => ({ success: false, message, ...extra });

function logReply(list, req, matchField) {
  const since = Number(req.since_seconds) > 0 ? Date.now() / 1000 - Number(req.since_seconds) : 0;
  const entries = list.filter((e) =>
    (!req[matchField] || e[matchField === 'signal' ? 'signal' : 'joint'] === req[matchField]) &&
    (!req.event || e.event === req.event) &&
    (!since || e.stamp.sec >= since)
  ).slice(0, Number(req.max_entries) || 200);
  return ok('', { entries, total_in_file: list.length });
}

const SIM_SERVICES = {
  /* supervisor */
  setOperationMode(req) {
    const target = PROFILE_BY_ID[req.profile];
    if (!target) return { accepted: false, request_id: 0, message: 'invalid profile' };
    if (this.supJob) return { accepted: false, request_id: 0, message: 'The supervisor is busy with another request' };
    if (this.sup.estop) return { accepted: false, request_id: 0, message: 'The E-stop button is pressed' };
    if (this.sup.latched && target !== 'jog') return { accepted: false, request_id: 0, message: 'Emergency is latched: press Reset first' };
    if (target !== 'jog' && this.sup.isolated.some(Boolean)) return { accepted: false, request_id: 0, message: 'A joint is isolated: only JOG is allowed until it is reset' };
    const from = this.sup.profile;
    this.sup.target = target;
    const id = this.startSupJob('mode', [
      { phase: 'mode_settle', ms: 350 },
      { phase: 'mode_write', ms: 300 },
      { phase: 'mode_confirm', ms: 400 },
    ], () => {
      this.sup.profile = target;
      this.supEvent('mode_change', `${from.toUpperCase()} → ${target.toUpperCase()}`);
    });
    return { accepted: true, request_id: id, message: `Switching to ${target.toUpperCase()}` };
  },

  resetFault() {
    if (this.sup.estop) return no('Release the E-stop button first');
    if (this.supJob) return no('The supervisor is busy');
    this.startSupJob('reset', [
      { phase: 'reset_release', ms: 300 },
      { phase: 'reset_pulse', ms: 300 },
      { phase: 'reset_wait', ms: 600 },
    ], () => {
      Object.assign(this.sup, { latched: false, cause: 0, causeJoint: -1, profile: 'jog', target: 'jog' });
      this.sup.isolated.fill(false);
      this.fault.fill(false);
      this.op.fill(true);
      this.supEvent('reset', 'Fault reset: drives enabled, JOG');
    });
    return ok('Reset started');
  },

  triggerEmergency() {
    this.latch('external');
    return ok('Emergency triggered');
  },

  setEmergencyLatching(req) {
    this.sup.strict = Boolean(req.data);
    this.supEvent('latching', this.sup.strict ? 'Strict latching: any fault stops all joints' : 'Relaxed latching (JOG only): a faulted joint is isolated');
    return ok(this.sup.strict ? 'Strict latching' : 'Relaxed latching (JOG only)');
  },

  setSpeedOverride(req) {
    this.sup.speedOverride = Math.max(0, Math.min(100, Math.round(Number(req.percent))));
    return ok('', { effective_percent: Math.round(this.speedScale() * 100) });
  },

  getModeSpeedLimits(req) {
    const l = this.limits[req.mode];
    if (!l) return no(`unknown mode ${req.mode}`);
    return ok('', { joint_names: NAMES, overspeed_threshold: [...l.thresholds], max_speed_scale: l.max });
  },

  setModeSpeedLimits(req) {
    const l = this.limits[req.mode];
    if (!l) return no(`unknown mode ${req.mode}`);
    l.thresholds = NAMES.map((n, i) => {
      const k = (req.joint_names || []).indexOf(n);
      return k >= 0 ? Number(req.overspeed_threshold[k]) : l.thresholds[i];
    });
    this.supEvent('speed_limits', `${req.mode.toUpperCase()} overspeed limits changed${req.persist ? ' (saved)' : ''}`);
    return ok(`${req.mode.toUpperCase()} limits ${req.mode === this.sup.profile ? 'written to the drives' : 'stored'}`);
  },

  getEventLog(req) {
    return logReply(this.eventLog, req, 'joint');
  },
  clearEventLog() {
    this.eventLog = [];
    this.resetRecord('event_logs.yaml', { time: localTime(), joint: '', event: 'log_cleared', stamp: Date.now() / 1000, source: 'supervisor', profile: this.sup.profile, phase: Math.max(0, PHASES.indexOf(this.sup.phase)), detail: 'event log cleared by service call' });
    return ok('Event log cleared');
  },

  /* drive state broadcaster */
  getErrorLog(req) {
    return logReply(this.errorLog, req, 'joint');
  },
  clearErrorLog() {
    this.errorLog = [];
    this.resetRecord('error_logs.yaml');
    return ok('Error log cleared');
  },
  getFaultCounters(req) {
    const idx = NAMES.map((n, i) => i).filter((i) => !req.joint || NAMES[i] === req.joint);
    const details = Object.fromEntries(idx.map((i) => [NAMES[i], this.lastErr[i] ? { [`0x${this.lastErr[i].toString(16).toUpperCase()}`]: this.counters[i].errors } : {}]));
    return ok('', {
      joint: idx.map((i) => NAMES[i]),
      total_faults: idx.map((i) => this.counters[i].faults),
      total_errors: idx.map((i) => this.counters[i].errors),
      last_fault_time: idx.map((i) => this.counters[i].last),
      details_yaml: yaml.dump(details),
    });
  },
  resetFaultCounters() {
    this.counters = NAMES.map(() => ({ faults: 0, errors: 0, last: '' }));
    return ok('Fault counters reset');
  },
  reloadCodeTable() {
    return ok('Error code table reloaded (142 codes)');
  },
  getIoWatch() {
    const w = this.ioWatch;
    return ok('', {
      file: path.join(this.errorContainer, 'io_watch.yaml'),
      name: w.map((x) => x.name), device: w.map((x) => x.device), input: w.map((x) => x.input),
      log_rising: w.map((x) => x.log_rising), log_falling: w.map((x) => x.log_falling),
      debounce_ms: w.map((x) => x.debounce_ms), level: w.map((x) => x.level),
    });
  },
  setIoWatch(req) {
    const i = this.ioWatch.findIndex((x) => x.name === req.name);
    if (req.remove) {
      if (i < 0) return no(`No watch named ${req.name}`);
      this.ioWatch.splice(i, 1);
      this.saveIoWatch();
      return ok(`Stopped watching ${req.name}`, { watch_count: this.ioWatch.length });
    }
    const device = String(req.device || '').replace(/^driver(\d)$/, 'joint$1');
    const input = String(req.input || '').toLowerCase();
    if (!/^(gpio1|joint[1-6])$/.test(device)) return no('device must be joint1..joint6 or gpio1');
    const okInput = /^bit:\d+$/.test(input) || (device === 'gpio1' ? /^(di|do)[1-8]$/.test(input) : /^(di[1-8]|do[1-3]|pi_p)$/.test(input));
    if (!okInput) return no(device === 'gpio1' ? 'input must be di1..di8, do1..do8 or bit:<n>' : 'input must be di1..di8, do1..do3, pi_p or bit:<n>');
    const w = { name: req.name, device, input, log_rising: req.log_rising, log_falling: req.log_falling, debounce_ms: req.debounce_ms || 20, level: -1 };
    if (i >= 0) this.ioWatch[i] = w;
    else this.ioWatch.push(w);
    this.saveIoWatch();
    return ok(`Watching ${req.name}`, { watch_count: this.ioWatch.length });
  },
  getIoLog(req) {
    return logReply(this.ioLog, req, 'signal');
  },
  startIoTrace(req) {
    const s = Number(req.duration_s) || 0;
    this.traceUntil = s ? Date.now() + s * 1000 : 0;
    return ok(s ? `Tracing every IO change for ${s} s` : 'Trace stopped');
  },

  setTcpOffset(req) {
    this.tcpOffset = req;
    return ok(`TCP offset set (${(req.x * 1000).toFixed(1)}, ${(req.y * 1000).toFixed(1)}, ${(req.z * 1000).toFixed(1)}) mm`);
  },

  /* motion server */
  home(req) {
    const name = req.home_name || this.homeData.active;
    const home = this.homeData.homes.find((h) => h.name === name);
    if (!home) return this.refuse(ERR.E_UNKNOWN_TARGET, `Unknown home '${name}'`);
    const r = this.motionRefusal(req.dry_run);
    if (r) return r;
    if (home.joints.every((v, i) => Math.abs(v - this.positions[i]) < this.homingConfig.already_home_tolerance)) {
      const a = this.beginMotion({ kind: 'home', target: name, speed: req.speed_mps, dryRun: req.dry_run, segments: [{ to: [...home.joints], label: 'Already at home' }] });
      this.endMotion('succeeded', 0, 'Already at home');
      return { ...a, message: 'Already at home' };
    }
    return this.beginMotion({ kind: 'home', target: name, speed: req.speed_mps, acceleration: req.acceleration_mps2, dryRun: req.dry_run, segments: this.homeSegments(home, req.single_stage) });
  },

  gotoPoint(req) {
    const to = this.pointJoints(req.point_name);
    if (!to) return this.refuse(ERR.E_UNKNOWN_TARGET, `Unknown point '${req.point_name}'`);
    const r = this.motionRefusal(req.dry_run);
    if (r) return r;
    const type = String(req.motion_type || 'PTP').toUpperCase();
    if (type === 'LIN' && Math.abs(to[0] - this.positions[0]) > 2.5) return this.refuse(ERR.E_LIN_NOT_FEASIBLE);
    return this.beginMotion({
      kind: 'goto_point', target: req.point_name, motionType: type, planner: req.planner,
      speed: req.speed_mps, acceleration: req.acceleration_mps2, dryRun: req.dry_run,
      segments: this.withApproach(to, Number(req.approach_mm) || 0, Number(req.retract_mm) || 0, req.point_name),
    });
  },

  gotoJoints(req) {
    const to = (req.joints || []).map((v) => (req.in_degrees ? (Number(v) * Math.PI) / 180 : Number(v)));
    if (to.length !== 6 || to.some((v) => !Number.isFinite(v) || Math.abs(v) > 2 * Math.PI)) return this.refuse(ERR.E_INVALID_TARGET, 'Joint values out of limits');
    const out = this.chain ? to.findIndex((v, i) => v < this.chain.lower[i] - 1e-6 || v > this.chain.upper[i] + 1e-6) : -1;
    if (out >= 0) return this.refuse(ERR.E_INVALID_TARGET, `${NAMES[out]} target is outside its limits (${((this.chain.lower[out] * 180) / Math.PI).toFixed(0)}..${((this.chain.upper[out] * 180) / Math.PI).toFixed(0)}°)`);
    const r = this.motionRefusal(req.dry_run);
    if (r) return r;
    return this.beginMotion({ kind: 'goto_joints', target: 'joints', motionType: req.motion_type, planner: req.planner, speed: req.speed_mps, acceleration: req.acceleration_mps2, dryRun: req.dry_run, segments: [{ to, label: 'Moving to joint target' }] });
  },

  gotoPose(req) {
    let to;
    if (this.chain) {
      // Inverse kinematics of the selected model, from the current joints, then a few other seeds.
      const rad = (d) => ((Number(d) || 0) * Math.PI) / 180;
      let G = fromXyzRpy([req.x_cm / 100, req.y_cm / 100, req.z_cm / 100], [rad(req.roll_deg), rad(req.pitch_deg), rad(req.yaw_deg)]);
      const o = this.tcpOffset;
      if (o) {
        // Target is the TCP: the flange goes to G · offset⁻¹ (offset without rotation is enough for the simulator)
        G = mul(G, fromXyzRpy([-(Number(o.x) || 0), -(Number(o.y) || 0), -(Number(o.z) || 0)]));
      }
      const seeds = [this.positions, this.positions.map((v, i) => (i === 0 ? Math.atan2(req.y_cm, req.x_cm) : v)), [0, -0.5, 0.8, 0, 0.6, 0], [0, 0.5, -0.8, 0, -0.6, 0]];
      for (const seed of seeds) {
        to = this.chain.ik(G, seed);
        if (to) break;
      }
      if (!to) return this.refuse(ERR.E_UNREACHABLE, `No joint solution for x ${req.x_cm} y ${req.y_cm} z ${req.z_cm} cm with this orientation (${this.model?.label || 'robot'})`);
      // Shortest way for each joint (within its limits)
      to = to.map((v, i) => {
        let best = v;
        for (const k of [-2, -1, 1, 2]) {
          const c = v + k * 2 * Math.PI;
          if (c >= this.chain.lower[i] && c <= this.chain.upper[i] && Math.abs(c - this.positions[i]) < Math.abs(best - this.positions[i])) best = c;
        }
        return best;
      });
    } else {
      const reach = Math.hypot(req.x_cm, req.y_cm);
      if (reach > 110 || reach < 5) return this.refuse(ERR.E_UNREACHABLE, `The pose is ${reach.toFixed(0)} cm from the base (reach 5..110 cm)`);
      to = [...this.positions];
      to[0] = Math.atan2(req.y_cm, req.x_cm);
      to[5] = (Number(req.yaw_deg) * Math.PI) / 180 - to[0];
    }
    const r = this.motionRefusal(req.dry_run);
    if (r) return r;
    const label = `x ${req.x_cm} y ${req.y_cm} z ${req.z_cm}`;
    return this.beginMotion({ kind: 'goto_pose', target: label, motionType: req.motion_type, planner: req.planner, speed: req.speed_mps, acceleration: req.acceleration_mps2, dryRun: req.dry_run, segments: this.withApproach(to, Number(req.approach_mm) || 0, Number(req.retract_mm) || 0, 'pose') });
  },

  runSequence(req) {
    const segs = [];
    for (const s of req.steps || []) {
      const to = this.pointJoints(s.point_name);
      if (!to) return this.refuse(ERR.E_UNKNOWN_TARGET, `Unknown point '${s.point_name}'`);
      segs.push({ to, label: `${s.motion_type} ${s.point_name}` });
    }
    const r = this.motionRefusal(req.dry_run);
    if (r) return r;
    return { ...this.beginMotion({ kind: 'sequence', target: `${segs.length} points`, speed: req.speed_mps, acceleration: req.acceleration_mps2, dryRun: req.dry_run, segments: segs }), step_count: segs.length };
  },

  runProgram(req) {
    const raw = this.readProgram(req.name);
    if (!raw) return this.refuse(ERR.E_UNKNOWN_TARGET, `Unknown program '${req.name}'`);
    const p = normalizeProgram(raw);
    const bad = checkProgram(p, { points: pointsIndex(this.readPoints()) }).find((i) => i.level === 'error');
    if (bad) {
      const where = bad.step === null || bad.step === undefined ? p.name : `${p.name} step ${bad.step + 1} (${describeStep(p.steps[bad.step])})`;
      return this.refuse(bad.message.startsWith('not in points.yaml') ? ERR.E_UNKNOWN_TARGET : ERR.E_INVALID_TARGET, `${where}: ${bad.message}`);
    }
    const loops = Number(req.repeat) >= 0 ? Number(req.repeat) : Number(p.repeat ?? 1);
    if (req.refuse_endless && loops === 0) return this.refuse(ERR.E_INVALID_TARGET, `${p.name}: repeat 0 (until stopped) is refused here`);
    const first = this.programSegments(p, req, 1);
    if (first.error) return this.refuse(first.code, first.error);
    const r = this.motionRefusal(req.dry_run);
    if (r) return r;
    const make = () => {
      const next = this.programSegments(p, req, this.job?.loop || 1);
      return next.segments || first.segments;
    };
    return {
      ...this.beginMotion({ kind: 'program', target: p.name, motionType: 'MIXED', planner: 'sequence', speed: req.speed_mps || p.speed_mps, acceleration: req.acceleration_mps2 || p.acceleration_mps2, dryRun: req.dry_run, segments: first.segments, loops, makeSegments: make }),
      loops, step_count: p.steps.length,
    };
  },

  async listPrograms() {
    const data = await readPrograms(this.programsFile, pointsIndex(this.readPoints()));
    if (data.parseError) return no(data.parseError, { file: this.programsFile, programs: [], problems: [] });
    const problems = data.problems
      .filter((x) => x.level === 'error')
      .map((x) => `${x.program}: ${x.step === null || x.step === undefined ? '' : `step ${x.step + 1}: `}${x.message}`);
    return ok(`${data.programs.length} program(s)`, { file: this.programsFile, programs: [], problems });
  },

  finishProgram() {
    if (this.job?.kind !== 'program') return no('No program is running');
    this.job.finishing = true;
    this.job.loops = this.job.loop;
    return ok('The program stops after this loop');
  },

  stopMotion() {
    if (!this.job) return ok('Nothing to stop');
    this.endMotion('canceled', ERR.E_CANCELED, 'Stopped by the operator');
    return ok('Motion stopped');
  },

  resetMotionServer() {
    if (this.job) this.endMotion('aborted', ERR.E_CANCELED, 'Motion server reset');
    this.lastJob = null;
    this.publishMotion();
    return ok('Motion server reset');
  },

  clearPlanCache() {
    const n = this.planCache.size;
    this.planCache.clear();
    return ok(`Plan cache cleared (${n} plans)`);
  },

  listPoints() {
    return ok('', { names: this.readPoints().map((p) => p.name) });
  },

  listHomes() {
    return ok('', { homes: clone(this.homeData.homes), active_home: this.homeData.active });
  },

  teachHome(req) {
    const exists = this.homeData.homes.find((h) => h.name === req.name);
    if (exists?.locked) return no(`Home '${req.name}' is locked`, { error_code: ERR.E_HOME_LOCKED });
    if (exists && !req.overwrite) return no(`Home '${req.name}' already exists (tick overwrite to replace it)`, { error_code: ERR.E_INVALID_TARGET });
    let joints;
    if (req.source === 'point') joints = this.pointJoints(req.point_name);
    else if (req.source === 'values') joints = (req.joints || []).map(Number);
    else joints = [...this.positions].map((v) => Math.round(v * 1e5) / 1e5);
    if (!joints || joints.length !== 6) return no('No valid joint values for the home', { error_code: ERR.E_INVALID_TARGET });
    const home = { name: req.name, description: req.description || '', locked: false, joints, stages: req.stages?.length === 6 ? req.stages : [], via_point: req.via_point || '' };
    if (exists) Object.assign(exists, home);
    else this.homeData.homes.push(home);
    if (req.set_active) this.homeData.active = req.name;
    this.saveHomes();
    this.atHome = null; // re-evaluate at the next tick
    return ok(`Home '${req.name}' ${exists ? 'updated' : 'taught'}${req.set_active ? ' and set active' : ''}`, { error_code: 0 });
  },

  setActiveHome(req) {
    if (!this.homeData.homes.some((h) => h.name === req.name)) return no(`Unknown home '${req.name}'`);
    this.homeData.active = req.name;
    this.saveHomes();
    this.atHome = null;
    return ok(`Active home: ${req.name}`);
  },

  deleteHome(req) {
    const h = this.homeData.homes.find((x) => x.name === req.name);
    if (!h) return no(`Unknown home '${req.name}'`, { error_code: ERR.E_UNKNOWN_TARGET });
    if (h.locked) return no(`Home '${req.name}' is locked`, { error_code: ERR.E_HOME_LOCKED });
    if (this.homeData.active === req.name) return no('The active home cannot be deleted: choose another active home first', { error_code: ERR.E_INVALID_TARGET });
    this.homeData.homes = this.homeData.homes.filter((x) => x !== h);
    this.saveHomes();
    return ok(`Home '${req.name}' deleted`, { error_code: 0 });
  },

  getHomingConfig() {
    return ok('', { config: { ...this.homingConfig }, active_home: this.homeData.active });
  },
  setHomingConfig(req) {
    Object.assign(this.homingConfig, req.config || {});
    return ok(req.persist ? 'Homing settings saved' : 'Homing settings applied', { config: { ...this.homingConfig } });
  },
  getGotoConfig() {
    return ok('', { config: { ...this.gotoConfig } });
  },
  setGotoConfig(req) {
    Object.assign(this.gotoConfig, req.config || {});
    return ok(req.persist ? 'Go-to settings saved' : 'Go-to settings applied', { config: { ...this.gotoConfig } });
  },

  /* jog frame and servo */
  setJogFrame(req) {
    if (!req.frame) return ok('', { frame: this.currentFrame });
    if (!/^[A-Za-z0-9_]+$/.test(req.frame)) return no(`Unknown frame '${req.frame}'`, { frame: this.currentFrame });
    this.currentFrame = req.frame;
    return ok(`Jog frame: ${req.frame}`, { frame: req.frame });
  },
  startServo() {
    return ok('Servo started (simulated)');
  },

  /* BT runner step mode (bt_debug_pkg ~/debug/...) */
  btPause() {
    return this.btRunner.dbgPause();
  },
  btStep() {
    return this.btRunner.dbgStep();
  },
  btResume() {
    return this.btRunner.dbgResume();
  },
  btBreakAt(req) {
    return this.btRunner.breakAt(req);
  },

  /* control_logic_bt runner commands */
  runnerStart(req) {
    return this.btRunner.start(req);
  },
  runnerStop() {
    return this.btRunner.stop();
  },
  runnerFinishCycle() {
    return this.btRunner.finishCycle();
  },
  runnerAbort() {
    return this.btRunner.abort();
  },
  runnerPause() {
    return this.btRunner.pause();
  },
  runnerResume() {
    return this.btRunner.resume();
  },
  runnerStep() {
    return this.btRunner.step();
  },
  runnerReset() {
    return this.btRunner.reset();
  },
  runnerLoadTree(req) {
    return this.btRunner.loadTree(req);
  },
  runnerValidateTree(req) {
    return this.btRunner.validateTree(req);
  },
};
