// backend/ros/LightweightROSBridge.js
//
// The web backend's single ROS 2 node.
//
// New controller stack (nextup_controllers + motion_server_pkg): commands go
// through SERVICES with a real answer and error code, and status comes from a
// few topics (supervisor status, motion status, at_home, drive state). The web
// no longer writes drive modes, overspeed SDOs, resets or emergencies itself:
// nextup_motion_supervisor is the only writer of those, and every robot motion
// goes through nextup_motion_server. Names live in ./interfaces.js.
//
// rclnodejs is optional: it only builds on a machine with ROS 2 installed.
// When it is missing, rosService.js falls back to the simulated bridge.
import { ensureBindings } from './bindings.js';

let bindings = { status: 'skipped', message: 'not checked', packages: [] };
let rclnodejs = null;
// NEXTUP_SIM=1 never loads rclnodejs (on a machine without ROS 2 its loader
// may try to rebuild the native addon).
if (process.env.NEXTUP_SIM !== '1') {
  try {
    // Check the generated message layouts BEFORE rclnodejs is loaded: stale
    // layouts corrupt the heap as soon as a changed message arrives.
    bindings = ensureBindings();
    rclnodejs = (await import('rclnodejs')).default;
  } catch {
    rclnodejs = null;
  }
}
export const RCLNODEJS_AVAILABLE = rclnodejs !== null;
import fs from 'fs';
import path from 'path';
import { EventEmitter } from 'events';
import { saveLogMessage, saveLiveLogs } from './rosHelper.js';
import { LatestGate, RATE_MS, roundAll } from './rateLimit.js';
import {
  SRV, TOPIC, CUSTOM_TYPES, PROFILE_LABEL,
  supervisorView, motionView, errorEventView, ioEventView,
  btActiveView, btTreeView, parseBtFailure, parseOperatorRequest,
  doCommandView, gpioCommandView, DO_FIELDS,
} from './interfaces.js';
import { BtMonitor, btStructureView, runnerStatusView } from './btMonitor.js';
import { SERVO_FRAME_FILE } from '../config/path.js';

const JOINT_ORDER = ['joint1', 'joint2', 'joint3', 'joint4', 'joint5', 'joint6'];
// At most this many log lines per batch sent to the browser (a flood is cut).
const MAX_LOG_LINES_PER_BATCH = 300;
// Recent robot events kept for pages opened later (supervisor + drive + IO).
const RECENT_EVENTS = 80;
// Per-joint "at home" when the server does not say the whole robot is home.
const HOME_JOINT_TOL = 0.01; // rad

/** LatestGate merge for { key: { …patch } } samples: newer fields win, nothing is lost. */
const mergeByKey = (prev, next) => {
  const out = { ...prev };
  for (const [k, v] of Object.entries(next)) out[k] = { ...(out[k] || {}), ...v };
  return out;
};

export class LightweightROSBridge {
  constructor(wsServer) {
    this.ws = wsServer;
    this.node = null;
    this.initialized = false;
    this.events = new EventEmitter();
    this.events.setMaxListeners(50);

    this.latestJointValues = [0, 0, 0, 0, 0, 0];
    this.latestCartesianValues = [0, 0, 0, 0, 0, 0];
    this.latestPositions = [0, 0, 0, 0, 0, 0];

    // Message classes and reusable objects (set in init)
    this.StringMsg = null;
    this.Bool = null;
    this.Int8 = null;
    this.Float64 = null;
    this.NextupEmergencyTrigger = null;
    this.twistMsg = null;
    this.twistStampedMsg = null;
    this.jointMsg = null;
    this.stringMsg = null;
    this.boolMsg = null;

    // Live state from the new controllers (null until the first message)
    this.supervisor = null; // supervisorView()
    this.motion = null; // motionView() of the current / last motion
    this.atHome = null; // { atHome, homeName, activeHome, atActiveHome }
    this.homes = { list: [], active: '' }; // from homing/list, refreshed on change
    this.btActive = null;
    this.btTree = null;
    this.btBlackboards = {};
    this.operatorRequest = null;
    this.recentEvents = [];
    this.recentIo = [];
    this.lastFinalMotionId = null;

    // State caches kept from the old bridge
    this.currentFrame = 'end';
    this.lastRosbridgeStatus = 'STOPPED';
    this.jointStatus = new Array(6).fill(false);
    this.faultStatus = new Array(6).fill(false);
    this.publishers = new Map();
    this.clients = new Map();
    this.lastGpioGroups = {};
    this.bindings = bindings;
    this.missingTypes = [];

    this.loadServoFrame();

    // Rate limiting (see rateLimit.js and setupSubscribers)
    this.gates = [];
    this.decodeRaw = null; // set in init() when rclnodejs can decode raw messages
    this.logGate = new LatestGate(RATE_MS.LOG_BATCH, (lines) => this.flushLogLines(lines), (prev, next) => {
      prev.push(...next);
      return prev;
    });
    this.motionGate = new LatestGate(RATE_MS.MOTION_STATUS, (v) => this.publishState('MOTION_STATUS', v));
    this.gates.push(this.motionGate);

    // NexRoot runner page: whole-tree status (see btMonitor.js). The events
    // topic is only subscribed while a runner page is open.
    this.btEventsSub = null;
    this.btMon = new BtMonitor(wsServer, { onWatchChange: (on) => this.setBtEventsSubscribed(on) });
  }

  loadServoFrame() {
    try {
      const dir = path.dirname(SERVO_FRAME_FILE);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      if (fs.existsSync(SERVO_FRAME_FILE)) {
        const obj = JSON.parse(fs.readFileSync(SERVO_FRAME_FILE, "utf-8"));
        this.currentFrame = obj.frame || "end";
      }
    } catch (err) {
      console.error("Failed to load servo frame:", err);
    }
  }

  saveServoFrame(frame) {
    try {
      fs.writeFileSync(SERVO_FRAME_FILE, JSON.stringify({ frame }, null, 2));
    } catch (err) {
      console.error("Failed to save servo frame:", err);
    }
  }

  getPublisher(topic, messageType, qos = null) {
    let pub = this.publishers.get(topic);
    if (!pub) {
      pub = qos
        ? this.node.createPublisher(messageType, topic, qos)
        : this.node.createPublisher(messageType, topic);
      this.publishers.set(topic, pub);
    }
    return pub;
  }

  /** QoS for the latched status topics (reliable + transient_local, depth 1). */
  latchedQos() {
    try {
      const Q = rclnodejs.QoS;
      return new Q(
        Q.HistoryPolicy.RMW_QOS_POLICY_HISTORY_KEEP_LAST,
        1,
        Q.ReliabilityPolicy.RMW_QOS_POLICY_RELIABILITY_RELIABLE,
        Q.DurabilityPolicy.RMW_QOS_POLICY_DURABILITY_TRANSIENT_LOCAL
      );
    } catch {
      return undefined;
    }
  }

  async init() {
    if (this.initialized) return;

    await rclnodejs.init();
    this.node = new rclnodejs.Node('web_backend_node');

    this.StringMsg = rclnodejs.require('std_msgs/msg/String');
    this.Bool = rclnodejs.require('std_msgs/msg/Bool');
    this.Int8 = rclnodejs.require('std_msgs/msg/Int8');
    this.Float64 = rclnodejs.require('std_msgs/msg/Float64');
    this.NextupEmergencyTrigger = rclnodejs.require('nextup_joint_interfaces/msg/NextupEmergencyTrigger');
    const Twist = rclnodejs.require('geometry_msgs/msg/Twist');
    const TwistStamped = rclnodejs.require('geometry_msgs/msg/TwistStamped');
    const Float64MultiArray = rclnodejs.require('std_msgs/msg/Float64MultiArray');

    this.twistMsg = new Twist();
    this.twistStampedMsg = new TwistStamped();
    this.jointMsg = new Float64MultiArray();
    this.stringMsg = new this.StringMsg();
    this.boolMsg = new this.Bool();

    // Which NextUp message types have generated bindings. A missing type
    // only disables its topic; the rest of the bridge keeps working.
    this.missingTypes = CUSTOM_TYPES.filter((t) => {
      try {
        rclnodejs.require(t);
        return false;
      } catch {
        return true;
      }
    });
    if (this.missingTypes.length) {
      console.warn(`[ROS] no message bindings for: ${this.missingTypes.join(', ')} (run "npx generate-ros-messages" in backend/)`);
    }
    if (this.bindings.status !== 'ok') console.log(`[ROS] bindings: ${this.bindings.message}`);

    // Raw subscriptions + decode of only the newest message (rclnodejs >= 1.8).
    // NEXTUP_RAW_SUBS=0 turns this off (every message is then decoded by rclnodejs).
    if (process.env.NEXTUP_RAW_SUBS !== '0' && typeof rclnodejs.deserializeMessage === 'function') {
      const classes = new Map();
      this.decodeRaw = (buffer, type) => {
        let Cls = classes.get(type);
        if (!Cls) classes.set(type, (Cls = rclnodejs.require(type)));
        // Same steps rclnodejs uses for a normal subscription.
        const taken = rclnodejs.deserializeMessage(buffer, Cls);
        try {
          const msg = new Cls();
          msg.deserialize(taken.refObject);
          return msg.toPlainObject(false);
        } finally {
          if (typeof Cls.destroyRawROS === 'function') Cls.destroyRawROS(taken);
        }
      };
    }

    this.setupSubscribers();

    rclnodejs.spin(this.node);
    this.initialized = true;

    // Homes are needed for the per-joint "homed" dots; the motion server may
    // still be starting, so retry a few times.
    this.refreshHomesSoon(2000, 5);
  }

  // ========== SUBSCRIPTIONS ==========
  //
  // CPU budget: while a behaviour tree runs, status topics arrive at 25-125 Hz.
  // Every high-rate subscription below is rate limited (see rateLimit.js):
  // state topics are taken as raw bytes and only the newest message is
  // decoded, 4-5 times per second; the browser gets a message only when the
  // value changed (wsServer.publishState).

  hasType(type) {
    return !this.missingTypes.includes(type);
  }

  /**
   * Subscribe to a state topic, handling at most one message per interval.
   * With rclnodejs >= 1.8 the subscription is raw (no per-message decode);
   * if raw decoding ever fails it falls back to a normal subscription.
   * `onMessage()` (optional) runs for every message without decoding it (a
   * cheap "last seen" time). `decode(buffer)` (optional) reads the raw bytes
   * itself (much cheaper than rclnodejs for big messages); if it throws, the
   * rclnodejs decode is used from then on. The returned gate has destroy().
   */
  subscribeState(type, topic, intervalMs, handle, { qos, onMessage, decode } = {}) {
    if (!this.hasType(type)) return null;
    let raw = typeof this.decodeRaw === 'function';
    let ownDecode = typeof decode === 'function' ? decode : null;
    let sub = null;
    const gate = new LatestGate(intervalMs, (sample) => {
      if (raw && Buffer.isBuffer(sample)) {
        let msg;
        if (ownDecode) {
          try {
            this.safeHandle(topic, handle, ownDecode(sample));
            return;
          } catch (err) {
            console.warn(`[ROS] own decode failed on ${topic} (${err.message}); using the rclnodejs decode`);
            ownDecode = null;
          }
        }
        try {
          msg = this.decodeRaw(sample, type);
        } catch (err) {
          console.warn(`[ROS] raw decode failed on ${topic} (${err.message}); using a normal subscription`);
          raw = false;
          try { this.node.destroySubscription(sub); } catch { /* already gone */ }
          sub = create();
          return;
        }
        this.safeHandle(topic, handle, msg);
        return;
      }
      this.safeHandle(topic, handle, sample);
    });
    const create = () => {
      const opts = raw ? { isRaw: true } : {};
      if (qos) opts.qos = qos;
      return this.node.createSubscription(type, topic, opts, onMessage ? (m) => { onMessage(); gate.push(m); } : (m) => gate.push(m));
    };
    sub = create();
    this.gates.push(gate);
    gate.destroy = () => {
      gate.stop();
      try { this.node.destroySubscription(sub); } catch { /* already gone */ }
      sub = null;
      this.gates = this.gates.filter((g) => g !== gate);
    };
    return gate;
  }

  /** Normal (decoded) subscription for low-rate or event topics. */
  subscribe(type, topic, handle, { qos } = {}) {
    if (!this.hasType(type)) return null;
    const opts = qos ? { qos } : {};
    return this.node.createSubscription(type, topic, opts, (m) => this.safeHandle(topic, handle, m));
  }

  safeHandle(topic, handle, msg) {
    try {
      handle(msg);
    } catch (err) {
      console.error(`[ROS] handler for ${topic} failed:`, err);
    }
  }

  /** State message to the browser (deduplicated, replayed to new clients). */
  publishState(type, payload) {
    if (this.ws.publishState) this.ws.publishState(type, payload);
    else this.ws.broadcast({ type, payload });
  }

  /** Queue log lines; sent to the browser and saved in batches. */
  queueLogLine(line) {
    const failure = parseBtFailure(line);
    if (failure) this.ws.broadcast({ type: 'BT_FAILURE', payload: failure });
    this.logGate.push([line]);
  }

  flushLogLines(lines) {
    if (!lines || lines.length === 0) return;
    let out = lines;
    if (out.length > MAX_LOG_LINES_PER_BATCH) {
      const skipped = out.length - MAX_LOG_LINES_PER_BATCH;
      out = [`WARN | web | ${skipped} log lines skipped (log flood)`, ...out.slice(-MAX_LOG_LINES_PER_BATCH)];
    }
    this.ws.broadcast({ type: 'LOG_MESSAGES', payload: out });
    saveLiveLogs(out);
  }

  setupSubscribers() {
    const latched = this.latchedQos();

    // ── Supervisor: profile, phase, emergency, speed scale (25 Hz → 4 Hz) ──
    this.subscribeState('nextup_joint_interfaces/msg/NextupSupervisorStatus', TOPIC.SUPERVISOR_STATUS, RATE_MS.SUPERVISOR,
      (msg) => this.onSupervisor(supervisorView(msg)));

    // ── Motion server: the current motion (5 Hz while moving) and at_home ──
    this.subscribe('nextup_utility_interface/msg/MotionStatus', TOPIC.MOTION_STATUS,
      (msg) => this.onMotionStatus(motionView(msg)), { qos: latched });
    this.subscribe('nextup_utility_interface/msg/AtHome', TOPIC.AT_HOME, (msg) => this.onAtHome({
      atHome: Boolean(msg.at_home),
      homeName: msg.home_name || '',
      activeHome: msg.active_home || '',
      atActiveHome: Boolean(msg.at_active_home),
    }), { qos: latched });

    // ── Joint positions: /joint_states (positions moved here from /nextup_joint_states) ──
    this.subscribeState('sensor_msgs/msg/JointState', TOPIC.JOINT_STATES, RATE_MS.JOINT_STATES, (msg) => {
      const names = msg.name || [];
      const pos = msg.position || [];
      const positions = roundAll(JOINT_ORDER.map((n, i) => {
        const idx = names.indexOf(n);
        return idx >= 0 ? pos[idx] : (names.length ? 0 : pos[i] ?? 0);
      }), 5);
      this.onPositions(positions);
    });

    this.subscribeState('std_msgs/msg/Float64MultiArray', TOPIC.JOINT_VALUES, RATE_MS.JOINT_VALUES, (msg) => {
      if (msg.data?.length >= 6) {
        this.latestJointValues = roundAll(msg.data, 3);
        this.publishState('JOINT_VALUES', { values: this.latestJointValues });
      }
    });

    this.subscribeState('std_msgs/msg/Float64MultiArray', TOPIC.CARTESIAN_VALUES, RATE_MS.CARTESIAN_VALUES, (msg) => {
      if (msg.data?.length >= 6) {
        this.latestCartesianValues = roundAll(msg.data, 3);
        this.publishState('CARTESIAN_VALUES', { values: this.latestCartesianValues });
      }
    });

    // ── TCP speed from the Cartesian broadcaster (50 Hz → 4 Hz) ──
    this.subscribeState('nextup_joint_interfaces/msg/NextupCartesianState', TOPIC.CARTESIAN_STATE, RATE_MS.TCP_STATE, (msg) => {
      this.publishState('TCP_STATE', {
        speed: Math.round(Number(msg.linear_speed || 0) * 1000) / 1000,
        angular: Math.round(Number(msg.angular_speed || 0) * 1000) / 1000,
        frame: msg.tcp_frame || '',
      });
    });

    // ── Drive state per joint: /nextup_joint_states (replaces /nextup_driver_status) ──
    this.subscribeState('nextup_joint_interfaces/msg/NextupJointState', TOPIC.NEXTUP_JOINT_STATES, RATE_MS.DRIVER_STATUS,
      (msg) => this.onDriveState(msg));

    // ── Digital inputs (DI1..DI8 per drive; DI5 = E-stop) ──
    this.subscribeState('nextup_joint_interfaces/msg/NextupDigitalInputs', TOPIC.DIGITAL_INPUTS, RATE_MS.DIGITAL_INPUTS, (msg) => {
      const jointCount = msg.name?.length || 0;
      // di6 / di7 / di8 are STO1 / STO2 / EDM (the old code read sto1/sto2/edm, which do not exist)
      const diMap = [msg.di1, msg.di2, msg.di3, msg.di4, msg.di5, msg.di6, msg.di7, msg.di8];
      const payload = [];
      for (let drv = 0; drv < jointCount; drv++) {
        const driverData = [];
        for (let di = 0; di < diMap.length; di++) driverData.push(Boolean(diMap[di]?.[drv] ?? false));
        payload.push(driverData);
      }
      this.publishState('DI_STATUS', payload);
      if (msg.di5) this.publishState('EMERGENCY_STATUS', { jointStatus: Array.from(msg.di5, Boolean) });
    });

    // Cycle count (event: one message per finished cycle)
    let lastCycleTime = null;
    this.node.createSubscription('std_msgs/msg/Int32', '/cycle_count', () => {
      const now = Date.now();
      const delta = lastCycleTime !== null ? (now - lastCycleTime) / 1000 : null;
      lastCycleTime = now;
      this.ws.broadcast({ type: 'CYCLE_TIME', payload: delta });
    });

    // Digital outputs: everything (this console, the PLC, the tree nodes) commands them on the
    // controller's single topic; the commands are echoed to the switches here. The status dots
    // come only from applied_commands: the commands the controllers ACCEPTED (a refused one,
    // e.g. controller not active, never shows up there).
    const allDoGate = new LatestGate(RATE_MS.DO_ECHO, (byDriver) => {
      for (const [driver, outs] of Object.entries(byDriver)) this.ws.broadcast({ type: 'DO_STATUS', payload: { driver: Number(driver), ...outs } });
    }, mergeByKey);
    this.gates.push(allDoGate);
    this.subscribe('nextup_joint_interfaces/msg/NextupDigitalOutputsCommand', TOPIC.DO_COMMANDS, (msg) => {
      const v = doCommandView(msg, JOINT_ORDER);
      if (Object.keys(v).length) allDoGate.push(v);
    });
    this.doApplied = { drivers: {}, gpio: {} };
    const appliedGate = new LatestGate(RATE_MS.DO_ECHO, () => this.publishDoApplied());
    this.gates.push(appliedGate);
    this.subscribe('nextup_joint_interfaces/msg/NextupDigitalOutputsCommand', TOPIC.DO_APPLIED, (msg) => {
      for (const [d, outs] of Object.entries(doCommandView(msg, JOINT_ORDER))) this.doApplied.drivers[d] = { ...this.doApplied.drivers[d], ...outs };
      appliedGate.push(true);
    });
    this.subscribe('control_msgs/msg/DynamicInterfaceGroupValues', TOPIC.GPIO_APPLIED, (msg) => {
      for (const [g, outs] of Object.entries(gpioCommandView(msg))) this.doApplied.gpio[g] = { ...this.doApplied.gpio[g], ...outs };
      appliedGate.push(true);
    });

    // Logs: every line is kept, sent and saved in batches
    this.node.createSubscription('std_msgs/msg/String', '/logs_topic', (msg) => this.queueLogLine(msg.data));

    // ── Behaviour tree runner ──
    this.subscribeState('std_msgs/msg/String', '/control_process_control_bt_status', RATE_MS.BT_STATUS, (msg) => {
      this.publishState('PROCESS_STATUS', msg.data);
    });
    this.subscribeState('std_msgs/msg/Bool', '/control_start_bt_active', RATE_MS.BT_STATUS, (msg) => {
      this.controlActive = Boolean(msg.data);
      this.publishState('CONTROL_ACTIVE', this.controlActive);
    });
    // bt_debug_pkg live status: running nodes (5 Hz), structure (latched), blackboards (2 Hz)
    this.subscribeState('nextup_utility_interface/msg/BtActive', TOPIC.BT_ACTIVE, RATE_MS.BT_STATUS,
      (msg) => this.onBtActive(btActiveView(msg)), { qos: latched });
    this.subscribe('nextup_utility_interface/msg/BtTree', TOPIC.BT_TREE, (msg) => {
      this.btTree = btTreeView(msg);
      this.publishState('BT_TREE', this.btTree);
      this.btMon.setStructure(btStructureView(msg));
    }, { qos: latched });
    // control_logic_bt runner state machine (2 Hz and on change)
    this.subscribeState('control_logic_bt_interfaces/msg/RunnerStatus', TOPIC.BT_STATUS, RATE_MS.BT_RUNNER,
      (msg) => this.btMon.onRunnerStatus(runnerStatusView(msg)), { qos: latched });
    const bbGate = new LatestGate(RATE_MS.BT_BLACKBOARD, () => this.publishState('BT_BLACKBOARD', { ...this.btBlackboards }));
    this.gates.push(bbGate);
    this.subscribe('nextup_utility_interface/msg/BtBlackboard', TOPIC.BT_BLACKBOARD, (msg) => {
      const keys = Array.from(msg.keys || []);
      const values = Array.from(msg.values || []);
      const types = Array.from(msg.types || []);
      this.btBlackboards[msg.blackboard || 'main'] = keys.map((k, i) => ({ key: k, value: values[i] ?? '', type: types[i] ?? '' }));
      bbGate.push(true);
    });
    // WaitForOperatorAck: a question for the operator ("id,question,opt1|opt2,timeout_s")
    this.node.createSubscription('std_msgs/msg/String', TOPIC.BT_OPERATOR_REQUEST, (msg) => {
      this.setOperatorRequest(parseOperatorRequest(msg.data));
    });

    // Toasts (also from the motion server and supervisor)
    this.node.createSubscription("std_msgs/msg/String", "/bt_toast_popup", (msg) => this.onToast(msg.data));

    // ── Event streams (rare): supervisor events, drive errors, IO watch edges ──
    this.subscribe('nextup_joint_interfaces/msg/NextupErrorEvent', TOPIC.SUPERVISOR_EVENTS,
      (msg) => this.onRobotEvent(errorEventView(msg)));
    this.subscribe('nextup_joint_interfaces/msg/NextupErrorEvent', TOPIC.ERROR_EVENTS,
      (msg) => this.onRobotEvent(errorEventView(msg)));
    this.subscribe('nextup_joint_interfaces/msg/NextupIoEvent', TOPIC.IO_EVENTS,
      (msg) => this.onIoEvent(ioEventView(msg)));

    // ── GPIO ──
    this.subscribeState("control_msgs/msg/DynamicInterfaceGroupValues", "/nextup_gpio_command_controller/gpio_states", RATE_MS.GPIO_STATE, (msg) => {
      const groups = {};
      const grpNames = msg.interface_groups || [];
      const values = msg.interface_values || [];
      grpNames.forEach((g, gi) => {
        const iv = values[gi];
        if (!iv) return;
        const names = iv.interface_names || [];
        const vals = iv.values || [];
        // Merge onto cached state: this topic only carries DI on this hardware.
        const gState = this.lastGpioGroups[g] || (this.lastGpioGroups[g] = { di: {}, do: {} });
        names.forEach((name, i) => {
          const v = !!vals[i];
          const diMatch = /^di0*(\d+)$/i.exec(name);
          const doMatch = /^do0*(\d+)$/i.exec(name);
          if (diMatch) gState.di[Number(diMatch[1])] = v;
          if (doMatch) gState.do[Number(doMatch[1])] = v;
        });
        groups[g] = gState;
      });
      this.publishState('GPIO_STATE', { groups });
    });

    const gpioEcho = new LatestGate(RATE_MS.DO_ECHO, (byGroup) => {
      for (const [group, doPatch] of Object.entries(byGroup)) {
        this.ws.broadcast({ type: 'GPIO_PUBLISH_CONFIRM', payload: { group, do: doPatch } });
      }
    }, (prev, next) => {
      const out = { ...prev };
      for (const [g, patch] of Object.entries(next)) out[g] = { ...(out[g] || {}), ...patch };
      return out;
    });
    this.gates.push(gpioEcho);
    this.node.createSubscription("control_msgs/msg/DynamicInterfaceGroupValues", TOPIC.GPIO_COMMANDS, (msg) => {
      const group = msg.interface_groups?.[0];
      const iv = msg.interface_values?.[0];
      if (!group || !iv) return;
      const names = iv.interface_names || [];
      const vals = iv.values || [];
      const doPatch = {};
      names.forEach((name, i) => {
        const m = /^do0*(\d+)$/i.exec(name);
        if (m) doPatch[Number(m[1])] = !!vals[i];
      });
      if (Object.keys(doPatch).length === 0) return;
      const gState = this.lastGpioGroups[group] || (this.lastGpioGroups[group] = { di: {}, do: {} });
      Object.assign(gState.do, doPatch);
      gpioEcho.push({ [group]: doPatch });
    });

    // Rosbridge process status
    this.subscribeState('std_msgs/msg/String', '/control_process_rosbridge_status', RATE_MS.ROSBRIDGE_STATUS, (msg) => {
      this.lastRosbridgeStatus = msg.data;
      this.publishState('ROSBRIDGE_STATUS', msg.data);
    });
  }

  /** DO_APPLIED: the outputs as the controllers accepted them, per driver and GPIO group. */
  publishDoApplied() {
    const a = this.doApplied;
    this.publishState('DO_APPLIED', { drivers: a.drivers, gpio: a.gpio });
  }

  // ========== STATE HANDLERS (shared with the simulated bridge) ==========

  onSupervisor(view) {
    const prev = this.supervisor;
    this.supervisor = view;
    this.events.emit('supervisor', view, prev);
    this.publishState('SUPERVISOR_STATUS', view);
    // Mode for the existing pages (Teach Points mode switch, status bar).
    if (!prev || prev.profile !== view.profile || prev.driveMode !== view.driveMode) {
      this.publishState('MODE_STATE', {
        driveMode: view.driveMode ?? (view.profile === 'jog' ? 9 : view.profile ? 8 : null),
        mode: view.profile,
        label: PROFILE_LABEL[view.profile] || null,
        source: 'supervisor',
      });
    }
    if (prev && !prev.latched && view.latched) {
      this.publishLogMessage(`ERROR | supervisor | emergency latched: ${view.cause || 'unknown'}${view.causeJoint ? ` (${view.causeJoint})` : ''}`);
    }
  }

  onMotionStatus(view) {
    this.motion = view;
    this.motionAt = Date.now();
    this.events.emit('motion', view);
    // A final state goes out at once (a quick next motion must not hide it).
    if (view.final && view.id && view.id !== this.lastFinalMotionId) {
      this.lastFinalMotionId = view.id;
      // A "verifying" status may still be waiting in the gate; it must not
      // be delivered after (and on top of) the final state.
      this.motionGate.drop();
      this.ws.broadcast({ type: 'MOTION_RESULT', payload: view });
      this.publishState('MOTION_STATUS', view);
      return;
    }
    this.motionGate.push(view);
  }

  onAtHome(view) {
    const prev = this.atHome;
    this.atHome = view;
    this.publishState('AT_HOME', view);
    if (!prev || prev.activeHome !== view.activeHome) this.refreshHomesSoon(0, 1);
    this.onPositions(this.latestPositions, true);
  }

  /** Joint positions → JOINT_STATES with per-joint "at home" dots. */
  onPositions(positions, force = false) {
    if (!force) this.latestPositions = positions;
    const home = this.activeHomeJoints();
    let homingStatus;
    if (this.atHome?.atHome) homingStatus = positions.map(() => true);
    else if (home) homingStatus = positions.map((p, i) => Math.abs(p - home[i]) < HOME_JOINT_TOL);
    else homingStatus = positions.map((p) => Math.abs(p) < 0.001);
    this.publishState('JOINT_STATES', { positions, homingStatus });
  }

  activeHomeJoints() {
    const name = this.atHome?.activeHome || this.homes.active;
    const h = this.homes.list.find((x) => x.name === name);
    return h && h.joints?.length >= 6 ? h.joints : null;
  }

  onDriveState(msg) {
    const names = Array.from(msg.name || []);
    const pick = (arr, i, f) => (i >= 0 && arr ? f(arr[i]) : f(undefined));
    const states = [];
    const lastError = [];
    const modes = [];
    const followingError = [];
    for (let i = 0; i < JOINT_ORDER.length; i++) {
      const idx = names.indexOf(JOINT_ORDER[i]);
      this.jointStatus[i] = pick(msg.op_status, idx, Boolean);
      this.faultStatus[i] = pick(msg.fault, idx, Boolean);
      states.push(pick(msg.state, idx, (v) => v || ''));
      lastError.push(pick(msg.lasterror, idx, (v) => Number(v) || 0));
      modes.push(pick(msg.modeofoperation, idx, (v) => Number(v) || 0));
      followingError.push(pick(msg.positionfoerror, idx, (v) => (Number.isFinite(Number(v)) ? Math.round(Number(v) * 1e4) / 1e4 : null)));
    }
    this.publishState('DRIVER_STATUS', {
      jointStatus: [...this.jointStatus],
      faultStatus: [...this.faultStatus],
      states,
      lastError,
      modes,
      followingError,
    });
  }

  onBtActive(view) {
    this.btActive = view;
    this.publishState('BT_ACTIVE', view);
    this.btMon.onActive(view);
  }

  /**
   * /control_logic_bt/events, only while a runner page is open. Raw bytes:
   * uid and status are read without decoding (btMonitor.peekBtEvent); only
   * failures, and anything that does not look right, are decoded.
   */
  setBtEventsSubscribed(on) {
    const type = 'nextup_utility_interface/msg/BtEvent';
    if (!this.node || !this.hasType(type)) return;
    if (!on) {
      if (this.btEventsSub) {
        try {
          this.node.destroySubscription(this.btEventsSub);
        } catch {
          /* already gone */
        }
      }
      this.btEventsSub = null;
      return;
    }
    if (this.btEventsSub) return;
    const raw = typeof this.decodeRaw === 'function';
    let warned = false;
    const opts = raw ? { isRaw: true } : {};
    try {
      this.btEventsSub = this.node.createSubscription(type, TOPIC.BT_EVENTS, opts, (m) => {
        try {
          if (!raw) return this.btMon.onEvent(m);
          if (this.btMon.peekMismatch < 20 && this.btMon.onRawEvent(m)) return;
          if (this.btMon.peekMismatch >= 20 && !warned) {
            warned = true;
            console.warn('[bt] events: raw layout did not match the tree, decoding every message');
          }
          this.btMon.onEvent(this.decodeRaw(m, type));
        } catch (err) {
          console.error('[bt] event handler failed:', err.message);
        }
      });
    } catch (err) {
      console.warn(`[bt] cannot subscribe ${TOPIC.BT_EVENTS}: ${err.message}`);
      this.btEventsSub = null;
    }
  }

  onToast(data) {
    saveLogMessage(data);
    const [message, messageType, duration] = String(data).split(",");
    const type = messageType?.trim().toLowerCase();
    // Failures always pop up; the motion server's own success / progress
    // toasts are covered by MOTION_RESULT, so they are not repeated here.
    if (type === "failure" || type === "error") {
      this.ws.broadcast({
        type: "BT_TOAST_POPUP",
        payload: { message: message?.trim(), messageType: 'failure', duration: Number(duration) || 0 },
      });
    }
  }

  onRobotEvent(ev) {
    this.recentEvents = [ev, ...this.recentEvents].slice(0, RECENT_EVENTS);
    this.ws.broadcast({ type: 'ROBOT_EVENT', payload: ev });
  }

  onIoEvent(ev) {
    this.recentIo = [ev, ...this.recentIo].slice(0, RECENT_EVENTS);
    this.ws.broadcast({ type: 'IO_EVENT', payload: ev });
  }

  setOperatorRequest(req) {
    clearTimeout(this.operatorTimer);
    this.operatorRequest = req;
    this.publishState('OPERATOR_REQUEST', req);
    if (req?.timeoutS > 0) {
      this.operatorTimer = setTimeout(() => {
        if (this.operatorRequest?.id === req.id) this.setOperatorRequest(null);
      }, req.timeoutS * 1000 + 500);
    }
  }

  answerOperator(id, choice) {
    const clean = String(choice).replace(/,/g, ';');
    this.publishStringTopic(TOPIC.BT_OPERATOR_REPLY, `${id || '*'},${clean}`);
    if (!id || this.operatorRequest?.id === id) this.setOperatorRequest(null);
  }

  /** Resolve when `test(supervisorView)` is true, or with null after timeoutMs. */
  waitForSupervisor(test, timeoutMs, onEach) {
    return new Promise((resolve) => {
      let done = false;
      const finish = (v) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        this.events.off('supervisor', listener);
        resolve(v);
      };
      const listener = (s) => {
        onEach?.(s);
        if (test(s)) finish(s);
      };
      const timer = setTimeout(() => finish(null), timeoutMs);
      this.events.on('supervisor', listener);
      if (this.supervisor && test(this.supervisor)) finish(this.supervisor);
    });
  }

  /** Resolve with the final motion status of `motionId`, or null after timeoutMs. */
  waitForMotion(motionId, timeoutMs) {
    return new Promise((resolve) => {
      let done = false;
      const finish = (v) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        this.events.off('motion', listener);
        resolve(v);
      };
      const listener = (m) => m.id === motionId && m.final && finish(m);
      const timer = setTimeout(() => finish(null), timeoutMs);
      this.events.on('motion', listener);
      if (this.motion?.id === motionId && this.motion.final) finish(this.motion);
    });
  }

  // ========== SERVICES ==========

  client(key) {
    let c = this.clients.get(key);
    if (!c) {
      const [type, name] = SRV[key];
      c = this.node.createClient(type, name);
      this.clients.set(key, c);
    }
    return c;
  }

  /**
   * Call a service from interfaces.js SRV by key.
   * @returns {Promise<{ok: true, response: object} | {ok: false, unavailable?: boolean, timeout?: boolean, message: string}>}
   */
  async callService(key, request = {}, { timeoutMs = 3000, waitMs = 300 } = {}) {
    if (!SRV[key]) return { ok: false, message: `unknown service ${key}` };
    const [type, name] = SRV[key];
    if (!this.node) return { ok: false, unavailable: true, message: 'ROS is not initialized' };
    let c;
    try {
      c = this.client(key);
    } catch (err) {
      return { ok: false, unavailable: true, message: `No message bindings for ${type} (${err.message}). Run "npx generate-ros-messages" in backend/ and restart.` };
    }
    if (!c.isServiceServerAvailable()) {
      if (waitMs > 0) {
        try {
          await c.waitForService(waitMs);
        } catch {
          /* fall through */
        }
      }
      if (!c.isServiceServerAvailable()) return { ok: false, unavailable: true, message: `${name} is not available` };
    }
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve({ ok: false, timeout: true, message: `${name} did not answer within ${timeoutMs} ms` }), timeoutMs);
      try {
        c.sendRequest(request, (response) => {
          clearTimeout(timer);
          const plain = typeof response?.toPlainObject === 'function' ? response.toPlainObject() : response;
          resolve({ ok: true, response: plain || {} });
        });
      } catch (err) {
        clearTimeout(timer);
        resolve({ ok: false, message: `${name}: ${err.message}` });
      }
    });
  }

  /** { key: { name, type, available } } for every known service (for the UI). */
  serviceAvailability() {
    const out = {};
    for (const [key, [type, name]] of Object.entries(SRV)) {
      let available = false;
      try {
        available = this.node ? Boolean(this.client(key).isServiceServerAvailable()) : false;
      } catch {
        available = false;
      }
      out[key] = { name, type, available };
    }
    return out;
  }

  /** Re-read the homes list (homing/list) after `delayMs`, retrying `tries` times. */
  refreshHomesSoon(delayMs = 0, tries = 1) {
    clearTimeout(this.homesTimer);
    this.homesTimer = setTimeout(async () => {
      const ok = await this.refreshHomes();
      if (!ok && tries > 1) this.refreshHomesSoon(3000, tries - 1);
    }, delayMs);
  }

  async refreshHomes() {
    const r = await this.callService('listHomes', {}, { timeoutMs: 2000 });
    if (!r.ok) return false;
    const list = Array.from(r.response.homes || []).map((h) => ({
      name: h.name,
      description: h.description || '',
      locked: Boolean(h.locked),
      joints: Array.from(h.joints || []).map(Number),
      stages: Array.from(h.stages || []).map(Number),
      viaPoint: h.via_point || '',
    }));
    this.homes = { list, active: r.response.active_home || '' };
    this.publishState('HOMES', this.homes);
    this.onPositions(this.latestPositions, true);
    return true;
  }

  // ========== PUBLISH METHODS ==========

  publishServoTwist(linear, angular) {
    const pub = this.getPublisher('/servo_node/delta_twist_cmds', 'geometry_msgs/msg/TwistStamped');
    const now = Date.now();
    this.twistStampedMsg.header.frame_id = this.currentFrame;
    this.twistStampedMsg.header.stamp.sec = Math.floor(now / 1000);
    this.twistStampedMsg.header.stamp.nanosec = (now % 1000) * 1_000_000;
    this.twistStampedMsg.twist.linear.x = linear?.x ?? 0;
    this.twistStampedMsg.twist.linear.y = linear?.y ?? 0;
    this.twistStampedMsg.twist.linear.z = linear?.z ?? 0;
    this.twistStampedMsg.twist.angular.x = angular?.x ?? 0;
    this.twistStampedMsg.twist.angular.y = angular?.y ?? 0;
    this.twistStampedMsg.twist.angular.z = angular?.z ?? 0;
    pub.publish(this.twistStampedMsg);
  }

  publishServoJoint(data) {
    const pub = this.getPublisher('/robot_manipulator_velocity_controller/commands', 'std_msgs/msg/Float64MultiArray');
    this.jointMsg.data = data;
    pub.publish(this.jointMsg);
  }

  /** One output of one joint drive, on the controller's single command topic (others left as they are). */
  publishDO(driver, doId, state) {
    const field = DO_FIELDS[doId - 1];
    const joint = JOINT_ORDER[driver - 1];
    if (!field || !joint) {
      console.warn(`publishDO: unknown output ${driver}/${doId}`);
      return;
    }
    const pub = this.getPublisher(TOPIC.DO_COMMANDS, 'nextup_joint_interfaces/msg/NextupDigitalOutputsCommand');
    const msg = { name: [joint], do1: [], do2: [], do3: [], pi_p: [] };
    msg[field] = [state ? 1 : 0];
    pub.publish(msg);
  }

  /**
   * Publishes a single DO channel command to the dynamic-group GPIO
   * controller. `group` is the group name (e.g. "gpio1"), `channel` is 1-8.
   */
  publishGPIOCommand(group, channel, value) {
    if (!this.node) return;
    const pub = this.getPublisher(TOPIC.GPIO_COMMANDS, 'control_msgs/msg/DynamicInterfaceGroupValues');
    pub.publish({
      header: { stamp: { sec: 0, nanosec: 0 }, frame_id: '' },
      interface_groups: [group],
      interface_values: [{ interface_names: ['do' + channel], values: [value ? 1 : 0] }],
    });
  }

  /** Software emergency through the supervisor's compatibility topic (fallback only). */
  publishCompatEmergency() {
    const pub = this.getPublisher(TOPIC.COMPAT_EMERGENCY, 'nextup_joint_interfaces/msg/NextupEmergencyTrigger');
    const msg = new this.NextupEmergencyTrigger();
    msg.emergencytrigger = true;
    pub.publish(msg);
  }

  publishMoveitStopCommand() {
    this.publishStringTopic('/trajectory_execution_event', 'stop');
  }

  publishUiCommand(command) {
    const pub = this.getPublisher('/ui_commands', 'std_msgs/msg/String');
    this.stringMsg.data = command;
    pub.publish(this.stringMsg);
  }

  publishStringTopic(topic, value) {
    const pub = this.getPublisher(topic, 'std_msgs/msg/String');
    this.stringMsg.data = value;
    pub.publish(this.stringMsg);
  }

  publishBoolTopic(topic, value) {
    const pub = this.getPublisher(topic, 'std_msgs/msg/Bool');
    this.boolMsg.data = value;
    pub.publish(this.boolMsg);
  }

  publishProcessControl(command) {
    this.publishStringTopic('/control_process_control_bt', command);
  }

  publishRosbridgeControl(command) {
    this.publishStringTopic('/control_process_rosbridge', command);
  }

  publishSpeedScale(value) {
    const pub = this.getPublisher('/dynamic_speed_scale', 'std_msgs/msg/Float64');
    const msg = new this.Float64();
    msg.data = value;
    pub.publish(msg);
  }

  publishCNCSelection(selection) {
    this.publishStringTopic('/select_cnc', selection);
  }

  async callTrigger(name) {
    const key = `trigger:${name}`;
    let c = this.clients.get(key);
    if (!c) this.clients.set(key, (c = this.node.createClient('std_srvs/srv/Trigger', name)));
    if (!c.isServiceServerAvailable()) return { success: false, message: `${name} is not available` };
    return new Promise((resolve) => {
      const t = setTimeout(() => resolve({ success: false, message: `${name} timed out` }), 5000);
      c.sendRequest({}, (r) => {
        clearTimeout(t);
        resolve(r || { success: false });
      });
    });
  }

  publishLogMessage(logData) {
    const pub = this.getPublisher('/logs_topic', 'std_msgs/msg/String');
    this.stringMsg.data = logData;
    pub.publish(this.stringMsg);
  }

  getCurrentFrame() {
    return this.currentFrame;
  }

  getRosbridgeStatus() {
    return this.lastRosbridgeStatus;
  }

  getLastGpioState() {
    return { groups: this.lastGpioGroups };
  }

  async shutdown() {
    for (const gate of this.gates) gate.stop();
    this.btMon?.stop();
    this.logGate.stop();
    clearTimeout(this.homesTimer);
    clearTimeout(this.operatorTimer);
    if (this.node) await this.node.destroy();
  }
}
