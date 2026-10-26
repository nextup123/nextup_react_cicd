// backend/ros/simBtRunner.js
//
// Simulated control_logic_bt runner for `npm run sim` (no ROS 2). It loads the
// real tree XML (includes and SubTree / SubTreePlus resolved), ticks it with
// BehaviorTree.CPP v3 semantics and follows the runner's state machine
// (control_logic_bt RunnerControl: IDLE, RUNNING, PAUSING, PAUSED, STOPPING,
// FINISHING, FAILED, NO_TREE). It produces the same data as the real runner:
// the tree structure (BtTree), one event per status change (BtEvent), the
// running leaves (BtActive) and the runner status (RunnerStatus), so the
// NexRoot runner page can be exercised without a robot.
//
// Simplifications: leaves take a fixed time per kind (motions 1.5 s, sleeps
// their msec ...), conditions succeed except IsAtPose (true when the last
// simulated motion went to that point) and AlwaysFailure; unknown nodes with
// children behave like a Sequence.

import fs from 'fs';
import path from 'path';
import xmldom from 'xmldom';
import { ST, ACTIVE_STATES } from './btMonitor.js';

const { DOMParser } = xmldom;

const SEQUENCES = /^(Sequence|SequenceStar|ReactiveSequence|SequenceWithMemory|Start|StartControlNode)$/;
const FALLBACKS = /^(Fallback|Selector|ReactiveFallback|AlternatingSelector)$/;
const DECORATORS = /^(Inverter|ForceSuccess|ForceFailure|RetryUntilSuccessful|RetryUntilSuccesful|Repeat|Timeout|Delay|KeepRunningUntilFailure|RunOnce|OneShot|GeneralOneShot|DelayTicks|WaitUntilTrue|Interlock|Precondition|BlackboardCheckInt|BlackboardCheckDouble|BlackboardCheckString)$/;
const SUBTREES = /^(SubTree|SubTreePlus)$/;
const MOTION = /Planner|Motion|Pilz|PlanAndExecute|RunProgram|RunPath|Move|Goto|Homing|Weav/i;
const CONDITION = /^(Is|Check|Has|Condition|WaitFor)/;
const PORT_TAGS = new Set(['input_port', 'output_port', 'inout_port']);

const STATE_NAMES = ['IDLE', 'RUNNING', 'SUCCESS', 'FAILURE'];
const MAX_RECENT_LINES = 30;
const STATUS_PERIOD_MS = 500; // RunnerStatus heartbeat (2 Hz, like status_rate_hz)
const ACTIVE_PERIOD_MS = 200; // BtActive (5 Hz, like bt_active_rate_hz)

const timeText = () => new Date().toLocaleString('sv-SE').replace('T', ' ');
const fix2 = (v) => Math.round(v * 100) / 100;

function hashText(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/* ─────────────────────────── XML → tree ─────────────────────────── */

function elementChildren(el) {
  const out = [];
  for (let c = el.firstChild; c; c = c.nextSibling) if (c.nodeType === 1 && !PORT_TAGS.has(c.nodeName)) out.push(c);
  return out;
}

function attrsOf(el) {
  const a = {};
  for (let i = 0; i < el.attributes.length; i++) a[el.attributes[i].name] = el.attributes[i].value;
  return a;
}

/** Read a tree file and its includes: { mainId, trees: Map(id → element), files, errors }. */
function readTreeFiles(file) {
  const trees = new Map();
  const files = [];
  const errors = [];
  let mainId = '';
  const seen = new Set();
  const visit = (f, top) => {
    const abs = path.resolve(f);
    if (seen.has(abs)) return;
    seen.add(abs);
    if (!fs.existsSync(abs)) {
      errors.push(`${path.basename(f)}: <include> not found`);
      return;
    }
    files.push(abs);
    const parseErrors = [];
    const doc = new DOMParser({
      errorHandler: { warning: () => {}, error: (m) => parseErrors.push(m), fatalError: (m) => parseErrors.push(m) },
    }).parseFromString(fs.readFileSync(abs, 'utf8'), 'text/xml');
    const root = doc?.documentElement;
    if (!root || parseErrors.length) {
      errors.push(`${path.basename(abs)}: XML syntax error ${String(parseErrors[0] || '').split('\n')[0]}`);
      if (!root) return;
    }
    if (top) mainId = root.getAttribute('main_tree_to_execute') || '';
    for (const el of elementChildren(root)) {
      if (el.nodeName === 'include') {
        const p = el.getAttribute('path');
        if (p) visit(path.isAbsolute(p) ? p : path.join(path.dirname(abs), p), false);
      } else if (el.nodeName === 'BehaviorTree') {
        const id = el.getAttribute('ID');
        if (id && !trees.has(id)) trees.set(id, el);
      }
    }
  };
  visit(file, true);
  if (!mainId) mainId = trees.has('MainTree') ? 'MainTree' : trees.keys().next().value || '';
  return { mainId, trees, files, errors };
}

/** Build the runtime tree with every SubTree attached (uids in creation order, like BT.CPP). */
function buildTree(file) {
  const { mainId, trees, files, errors } = readTreeFiles(file);
  const warnings = [];
  const nodes = [];
  if (!trees.has(mainId)) {
    errors.push(`main_tree_to_execute '${mainId || '?'}' not found`);
    return { errors, warnings, files };
  }
  const nameCount = new Map();
  const make = (el, parent, depth, subtree, stack) => {
    const type = el.nodeName;
    const attrs = attrsOf(el);
    const n = {
      uid: nodes.length + 1,
      name: attrs.name || (SUBTREES.test(type) ? attrs.ID : '') || type,
      type,
      parent: parent ? parent.uid : 0,
      depth,
      subtree,
      attrs,
      children: [],
      status: ST.IDLE,
      since: 0,
      idx: 0,
      count: 0,
    };
    if (!attrs.name && !SUBTREES.test(type)) warnings.push(`node uid ${n.uid} (${type}) has no name`);
    nameCount.set(n.name, (nameCount.get(n.name) || 0) + 1);
    nodes.push(n);
    if (SUBTREES.test(type)) {
      n.kind = 'subtree';
      const id = attrs.ID;
      const def = trees.get(id);
      if (!def) errors.push(`SubTree ID '${id}' does not exist`);
      else if (stack.includes(id)) errors.push(`SubTree '${id}' includes itself`);
      else {
        const inner = elementChildren(def);
        if (inner[0]) n.children.push(make(inner[0], n, depth + 1, n.name, [...stack, id]));
      }
    } else {
      const kids = elementChildren(el);
      for (const k of kids) n.children.push(make(k, n, depth + 1, subtree, stack));
      if (DECORATORS.test(type)) {
        n.kind = 'decorator';
        if (kids.length !== 1) errors.push(`Node '${n.name}': decorator ${type} needs exactly one child (has ${kids.length})`);
      } else if (SEQUENCES.test(type) || FALLBACKS.test(type) || /Parallel|IfThenElse|WhileDoElse|Recovery|Switch/.test(type) || kids.length) {
        n.kind = 'control';
        if (!kids.length) errors.push(`Node '${n.name}': control node ${type} has no children`);
      } else n.kind = 'leaf';
    }
    return n;
  };
  const top = elementChildren(trees.get(mainId));
  if (!top.length) {
    errors.push(`BehaviorTree '${mainId}' is empty`);
    return { errors, warnings, files };
  }
  const root = make(top[0], null, 0, '', [mainId]);
  for (const [name, c] of nameCount) if (c > 1) warnings.push(`name '${name}' is used by ${c} nodes`);
  const used = new Set(nodes.filter((n) => n.kind === 'subtree').map((n) => n.attrs.ID));
  const unused = [...trees.keys()].filter((id) => id !== mainId && !used.has(id));
  const structure = nodes.map((n) => `${n.uid}:${n.name}:${n.type}:${n.parent}`).join('|');
  return { mainId, root, nodes, errors, warnings, files, unused, hash: hashText(structure), trees: [...trees.keys()] };
}

/* ─────────── validation (like control_logic_bt tree_validator.cpp) ─────────── */
// Same text as the real validator: "file.xml:LINE Type 'name': what is wrong".
const CONTROLS = /^(Sequence|SequenceStar|ReactiveSequence|SequenceWithMemory|Fallback|Selector|ReactiveFallback|AlternatingSelector|Parallel|ParallelAll|IfThenElse|WhileDoElse|Switch\d|Recovery|Start|StartControlNode)$/;
const NUMBER_PORTS = /^(speed|acceleration|forward_speed|msec|num_attempts|num_cycles|timeout_ms|delay_msec|offset_[a-z]+(_mm|_deg)?)$/;
const POINT_PORTS = new Set(['pose_goal', 'pose', 'point_name', 'points', 'pose_goals', 'frame', 'start_name', 'goal_name', 'interim_name', 'start_weld', 'end_weld', 'target_name', 'required_points']);

function lintTree(file, { pointNames = null } = {}) {
  const issues = [];
  const add = (error, base, line, label, text) => issues.push({ error, s: `${base}${line > 0 ? `:${line}` : ''}${label ? ` ${label}` : ''}: ${text}` });
  const trees = new Map(); // id → { el, base }
  const docs = [];
  const seen = new Set();
  let mainId = '';
  const visit = (f, top) => {
    const abs = path.resolve(f);
    if (seen.has(abs)) return;
    seen.add(abs);
    const base = path.basename(abs);
    if (!fs.existsSync(abs)) return add(true, base, 0, '', 'cannot read the file');
    let parseErr = null;
    const doc = new DOMParser({
      locator: {},
      errorHandler: { warning: () => {}, error: (m) => (parseErr ||= m), fatalError: (m) => (parseErr ||= m) },
    }).parseFromString(fs.readFileSync(abs, 'utf8'), 'text/xml');
    if (parseErr) {
      const m = /line:(\d+)/.exec(String(parseErr));
      add(true, base, m ? Number(m[1]) : 0, '', `XML error: ${String(parseErr).split('\n')[0].replace(/^\[xmldom \w+\]\s*/, '')}`);
    }
    const root = doc?.documentElement;
    if (!root) return;
    if (root.nodeName !== 'root') add(true, base, root.lineNumber, root.nodeName, 'the root element must be <root>');
    if (top) mainId = root.getAttribute('main_tree_to_execute') || '';
    docs.push({ base, root });
    for (const el of elementChildren(root)) {
      if (el.nodeName === 'include') {
        const p = el.getAttribute('path');
        if (!p) add(true, base, el.lineNumber, 'include', '<include> without path');
        else if (el.getAttribute('ros_pkg')) add(false, base, el.lineNumber, 'include', `ros_pkg include not checked: ${p}`);
        else {
          const ip = path.isAbsolute(p) ? p : path.join(path.dirname(abs), p);
          if (!fs.existsSync(ip)) add(true, base, el.lineNumber, 'include', `included file not found: ${p}`);
          else visit(ip, false);
        }
      } else if (el.nodeName === 'BehaviorTree') {
        const id = el.getAttribute('ID');
        if (!id) add(true, base, el.lineNumber, 'BehaviorTree', '<BehaviorTree> without ID');
        else if (trees.has(id)) add(true, base, el.lineNumber, id, `BehaviorTree ID '${id}' defined twice`);
        else trees.set(id, { el, base });
      }
    }
  };
  visit(file, true);
  const mainBase = path.basename(file);
  if (!trees.size) add(true, mainBase, 0, '', 'no <BehaviorTree> in the file');
  if (!mainId) {
    if (trees.size > 1 && !trees.has('MainTree')) add(true, mainBase, 1, 'root', 'several BehaviorTrees and no main_tree_to_execute');
    mainId = trees.has('MainTree') ? 'MainTree' : trees.keys().next().value || '';
  } else if (!trees.has(mainId)) add(true, mainBase, 1, 'root', `main_tree_to_execute '${mainId}' is not a BehaviorTree ID`);

  const points = pointNames ? new Set(pointNames) : null;
  let nodes = 0;
  let motion = 0;
  let hasStart = false;
  const used = new Set();
  const pointsUsed = new Set();
  const node = (el, base) => {
    let id = el.nodeName;
    if (/^(Action|Condition|Control|Decorator)$/.test(id)) {
      if (!el.getAttribute('ID')) return add(true, base, el.lineNumber, id, `<${id}> without ID`);
      id = el.getAttribute('ID');
    }
    nodes += 1;
    const inst = el.getAttribute('name') || '';
    const label = !inst || inst === id ? id : `${id} '${inst}'`;
    const kids = elementChildren(el);
    if (SUBTREES.test(id)) {
      const sid = el.getAttribute('ID');
      if (!sid) add(true, base, el.lineNumber, label, 'SubTree without ID');
      else if (!trees.has(sid)) add(true, base, el.lineNumber, label, `SubTree ID '${sid}' does not exist (no <BehaviorTree ID="${sid}">)`);
      else used.add(sid);
      if (kids.length) add(true, base, el.lineNumber, label, 'SubTree must not have children');
      return;
    }
    if (/^(Start|StartControlNode)$/.test(id)) hasStart = true;
    if (MOTION.test(id)) motion += 1;
    if (DECORATORS.test(id)) {
      if (kids.length !== 1) add(true, base, el.lineNumber, label, `a decorator needs exactly one child (has ${kids.length})`);
    } else if (CONTROLS.test(id)) {
      if (!kids.length) add(true, base, el.lineNumber, label, 'control node without children');
    } else if (kids.length && (MOTION.test(id) || CONDITION.test(id) || /^(Sleep|SetBlackboard|AlwaysSuccess|AlwaysFailure)$/.test(id))) {
      add(true, base, el.lineNumber, label, 'an action / condition must not have children');
    }
    for (let i = 0; i < el.attributes.length; i++) {
      const { name: k, value: v } = el.attributes[i];
      if (NUMBER_PORTS.test(k) && !/^\{.*\}$/.test(v)) {
        if (v === '' || !Number.isFinite(Number(v))) add(true, base, el.lineNumber, label, `'${k}' must be a number, got '${v}'`);
        else if (Number(v) < 0 && /^(speed|acceleration|forward_speed)$/.test(k)) add(true, base, el.lineNumber, label, `'${k}' must not be negative`);
      }
      if (POINT_PORTS.has(k) && v) {
        for (const raw of v.split(',')) {
          const pn = raw.replace(/\[.*$/, '').trim(); // "p1[0.3]": per-point speed
          if (!pn || /^\{.*\}$/.test(pn)) continue;
          pointsUsed.add(pn);
          if (points && !points.has(pn)) add(true, base, el.lineNumber, label, `point '${pn}' (${k}) is not in points.yaml`);
        }
      }
    }
    for (const k of kids) node(k, base);
  };
  // every BehaviorTree is checked, reached or not (like the real validator)
  for (const [id, { el, base }] of trees) {
    const top = elementChildren(el);
    if (top.length !== 1) add(true, base, el.lineNumber, id, `a BehaviorTree must have exactly one root node (has ${top.length})`);
    for (const t of top) node(t, base);
  }
  // reachability from the main tree
  const reached = new Set([mainId]);
  const todo = [mainId];
  while (todo.length) {
    const t = trees.get(todo.pop());
    if (!t) continue;
    const stack = [t.el];
    while (stack.length) {
      const e = stack.pop();
      if (SUBTREES.test(e.nodeName)) {
        const sid = e.getAttribute('ID');
        if (sid && trees.has(sid) && !reached.has(sid)) {
          reached.add(sid);
          todo.push(sid);
        }
      }
      stack.push(...elementChildren(e));
    }
  }
  const unused = [...trees.keys()].filter((id) => !reached.has(id));
  for (const id of unused) {
    const t = trees.get(id);
    add(false, t.base, t.el.lineNumber, id, `BehaviorTree '${id}' is never used by the main tree '${mainId}'`);
  }
  if (!hasStart) add(false, mainBase, 0, '', 'no StartControlNode (<Start>): the runner starts / stops the whole tree itself');
  return { issues, nodes, motion, hasStart, unused, pointsUsed: [...pointsUsed], used: [...used] };
}

/* ─────────────────────────── the runner ─────────────────────────── */

export class SimBtRunner {
  /**
   * host: {
   *   monitor,                       BtMonitor
   *   controlDir,                    folder of the tree files
   *   defaultTree,                   file loaded at start-up
   *   log(level, text), toast(text, kind, s),
   *   motionBlocked() → '' | reason  why a real motion would be refused now
   *   onMotion(target)               a simulated motion started
   *   onActive(view), onRunner(view), onBlackboard(obj), onCycleTime(s), onActiveFlag(bool)
   * }
   */
  constructor(host) {
    this.host = host;
    this.tree = null; // buildTree() result
    this.file = '';
    this.state = 'NO_TREE';
    this.message = 'no tree loaded';
    this.flags = { pause: false, stop: false, finish: false, step: false, abort: false };
    this.run = { cycles: 0, done: 0, dryRun: false, sim: false, started: 0 };
    this.total = 0;
    this.cycleCount = 0; // /cycle_count
    this.cycleStart = 0;
    this.cycleTimes = [];
    this.lastCycle = 0;
    this.profile = [];
    this.leafTimes = [];
    this.lastFailure = null;
    this.failedLeaf = null;
    this.failNext = '';
    this.dbg = { paused: false, step: false, breakAt: '', onFailureOnly: false };
    this.ticks = 0;
    this.lastEvent = '';
    this.recentLines = [];
    this.blackboard = { fast: '1.0', slow: '0.1' };
    this.lastTarget = 'home';
    this.seq = 0;
    this.publishedSeq = -1;
    this.lastStatusAt = 0;
    this.lastActiveAt = 0;
    this.activeSig = '';
  }

  /* ─────────── files ─────────── */

  resolve(xml) {
    if (!xml) return this.file || this.host.defaultTree;
    if (path.isAbsolute(xml)) return xml;
    return path.join(this.host.controlDir, xml.endsWith('.xml') ? xml : `${xml}.xml`);
  }

  load(file) {
    const t = buildTree(file);
    if (t.errors.length) {
      const summary = `invalid: ${t.errors.length} error(s), ${t.warnings.length} warning(s)`;
      return { ok: false, message: `${summary} | ${t.errors.join('; ')}`, hint: hintFor(t.errors[0]) };
    }
    this.tree = t;
    this.file = file;
    this.byUid = new Map(t.nodes.map((n) => [n.uid, n]));
    this.state = 'IDLE';
    this.lastFailure = null;
    this.touch(`tree loaded: ${path.basename(file)}`);
    this.host.monitor.setStructure({
      treeId: t.mainId,
      xmlFile: file,
      hash: t.hash,
      rootUid: t.root.uid,
      nodes: t.nodes.map((n) => ({ uid: n.uid, name: n.name, type: n.type, parent: n.parent, depth: n.depth, subtree: n.subtree, leaf: n.kind === 'leaf' })),
      warnings: t.warnings.slice(0, 50),
    });
    this.host.onTree?.({ treeId: t.mainId, xmlFile: file, hash: t.hash, nodeCount: t.nodes.length, warnings: t.warnings.slice(0, 50) });
    this.host.log('INFO', `[bt] tree loaded: ${file} (${t.nodes.length} nodes, ${t.nodes.filter((n) => n.kind === 'subtree').length} subtrees)`);
    return { ok: true, message: `loaded ${path.basename(file)}` };
  }

  init() {
    const file = this.host.defaultTree;
    const r = file ? this.load(file) : { ok: false, message: 'no tree file' };
    if (!r.ok) {
      this.state = 'NO_TREE';
      this.touch(`No tree loaded - fix the XML and call load_tree (${r.message})`);
      this.host.log('ERROR', `BT XML validation failed: ${r.message}`);
    }
    this.publishStatus(true);
    this.publishActive(true);
  }

  /* ─────────── state ─────────── */

  touch(message) {
    if (message) this.message = message;
    this.seq += 1;
  }

  setState(state, message) {
    if (state !== this.state || (message && message !== this.message)) {
      this.state = state;
      this.touch(message);
    }
  }

  get active() {
    return ACTIVE_STATES.has(this.state);
  }

  /* ─────────── runner services (control_logic_bt_interfaces) ─────────── */

  start({ cycles = 0, tree = '', dry_run = false, sim_mode = false } = {}) {
    if (tree) {
      if (this.active) return { accepted: false, message: `already ${this.state}` };
      const r = this.load(this.resolve(tree));
      if (!r.ok) return { accepted: false, message: r.message };
    }
    if (this.state === 'NO_TREE') return { accepted: false, message: 'no tree loaded - call load_tree first' };
    if (this.active) {
      if (this.flags.pause) return { accepted: false, message: 'paused - call resume to continue (or abort, then start)' };
      return { accepted: false, message: `already ${this.state}` };
    }
    if (cycles < 0) return { accepted: false, message: 'cycles must be >= 0 (0 = run until stopped)' };
    this.flags = { pause: false, stop: false, finish: false, step: false, abort: false };
    this.run = { cycles: Number(cycles) || 0, done: 0, dryRun: Boolean(dry_run), sim: Boolean(sim_mode), started: Date.now() };
    this.cycleTimes = [];
    this.lastFailure = null;
    this.failedLeaf = null;
    this.haltAll();
    this.beginCycle();
    const what = this.run.sim ? 'SIM RUN: ' : this.run.dryRun ? 'DRY RUN: ' : '';
    this.setState('RUNNING', `${what}start requested: ${this.run.cycles > 0 ? `${this.run.cycles} cycle(s)` : 'run until stopped'}`);
    if (this.run.sim) this.host.log('WARN', 'SIM RUN: motions are not sent to the motion server, outputs are not written, inputs are assumed OK');
    else if (this.run.dryRun) this.host.log('WARN', 'DRY RUN: motions are only planned, outputs are not written, inputs are assumed OK');
    this.host.toast(this.run.cycles > 0 ? `BT started (${this.run.cycles} cycles)` : 'BT started', 'success', 3);
    this.host.onActiveFlag(true);
    this.publishStatus(true);
    return { accepted: true, message: this.message };
  }

  stop() {
    if (!this.active) return { success: false, message: `not running (${this.state})` };
    if (this.state === 'STOPPING') return { success: true, message: 'already stopping' };
    this.flags.stop = true;
    this.touch('stop requested: the running step finishes, then the run ends');
    this.host.toast('BT will stop after the current step', 'warn', 3);
    return { success: true, message: this.message };
  }

  finishCycle() {
    if (!this.active) return { success: false, message: `not running (${this.state})` };
    if (this.state === 'STOPPING') return { success: false, message: 'already stopping after the current step' };
    this.flags.finish = true;
    this.touch('finish_cycle requested: the current cycle runs to the end, then the run ends');
    this.host.toast('BT will exit after the current cycle', 'warn', 3);
    return { success: true, message: this.message };
  }

  abort(word = 'abort') {
    this.flags.pause = false;
    this.flags.step = false;
    if (!this.active) {
      if (this.state === 'FAILED') {
        this.setState('IDLE', 'failure acknowledged');
        this.publishStatus(true);
      }
      return { success: true, message: `nothing to abort (${this.state})` };
    }
    this.haltAll();
    this.endRun(`${word}: running steps were halted`);
    return { success: true, message: `${word} requested: running steps are halted now` };
  }

  pause() {
    if (!this.active) return { success: false, message: `not running (${this.state})` };
    if (this.state === 'STOPPING') return { success: false, message: 'stopping - cannot pause' };
    if (this.flags.pause) return { success: true, message: `already ${this.state}` };
    this.flags.pause = true;
    this.flags.step = false;
    this.touch('pause requested: the running step finishes, nothing new starts');
    return { success: true, message: this.message };
  }

  resume() {
    if (!this.flags.pause) return { success: false, message: `not paused (${this.state})` };
    this.flags.pause = false;
    this.flags.step = false;
    this.touch('resume requested');
    this.host.toast('BT resumed', 'success', 2);
    return { success: true, message: this.message };
  }

  step() {
    if (!this.flags.pause || !this.active) return { success: false, message: `step works only while PAUSED (${this.state})` };
    if (this.state !== 'PAUSED') return { success: false, message: `still ${this.state} - wait until PAUSED` };
    this.flags.step = true;
    this.touch('step: the next action runs, then pause again');
    return { success: true, message: this.message };
  }

  reset() {
    this.flags.pause = false;
    this.flags.step = false;
    if (this.active) return this.abort('reset');
    if (this.state === 'FAILED') {
      this.setState('IDLE', 'failure acknowledged - IDLE');
      this.publishStatus(true);
      return { success: true, message: this.message };
    }
    return { success: true, message: `nothing to reset (${this.state})` };
  }

  loadTree({ xml = '' } = {}) {
    if (!['IDLE', 'FAILED', 'NO_TREE'].includes(this.state)) return { success: false, message: `load_tree refused while ${this.state}`, hint: 'stop the run first', tree: '' };
    const file = this.resolve(xml);
    const r = this.load(file);
    this.publishStatus(true);
    return { success: r.ok, message: r.message, hint: r.hint || '', tree: r.ok ? file : '' };
  }

  validateTree({ xml = '', strict = false, check_points = true } = {}) {
    const file = this.resolve(xml);
    const t = lintTree(file, { pointNames: check_points ? this.host.pointNames?.() || null : null });
    const errors = t.issues.filter((i) => i.error).map((i) => i.s);
    const warnings = t.issues.filter((i) => !i.error).map((i) => i.s);
    const valid = errors.length === 0 && (!strict || warnings.length === 0);
    return {
      valid,
      summary: `${valid ? 'valid' : 'invalid'}: ${errors.length} error(s), ${warnings.length} warning(s); ${t.nodes} nodes, ${t.motion} motion, ${t.pointsUsed.length} point(s)`,
      errors,
      warnings,
      error_count: errors.length,
      warning_count: warnings.length,
      nodes: t.nodes,
      motion_nodes: t.motion,
      points_used: t.pointsUsed,
      programs_used: [],
      subtrees_unused: t.unused,
      has_start_node: t.hasStart,
    };
  }

  /* ─────────── step mode (bt_debug_pkg ~/debug/...) ─────────── */

  dbgPause() {
    this.dbg.paused = true;
    this.dbg.step = false;
    this.lastEvent = 'debug: paused';
    this.publishActive(true);
    return { success: true, message: 'paused after the current tick; ~/debug/step ticks once, ~/debug/resume continues' };
  }

  dbgStep() {
    if (!this.active) return { success: false, message: `the runner is ${this.state}` };
    this.dbg.paused = true;
    this.dbg.step = true;
    return { success: true, message: 'one tick' };
  }

  dbgResume() {
    this.dbg.paused = false;
    this.dbg.step = false;
    this.lastEvent = 'debug: resumed';
    this.publishActive(true);
    return { success: true, message: 'ticking again' };
  }

  breakAt({ name = '', on_failure_only = false } = {}) {
    this.dbg.breakAt = String(name || '');
    this.dbg.onFailureOnly = Boolean(on_failure_only);
    if (this.dbg.breakAt && this.tree && !this.tree.nodes.some((n) => n.name === this.dbg.breakAt)) {
      return { ok: true, message: `breakpoint set on '${this.dbg.breakAt}' (no node with this name in the loaded tree)` };
    }
    return { ok: true, message: this.dbg.breakAt ? `pause when '${this.dbg.breakAt}' ${this.dbg.onFailureOnly ? 'fails' : 'starts'}` : 'breakpoint cleared' };
  }

  /* ─────────── simulation hooks ─────────── */

  /** The running leaf (or the next one that starts) fails. */
  injectFailure(reason = 'Part not detected (simulated)') {
    if (!this.active) return { ok: false, message: `the runner is ${this.state}` };
    this.failNext = reason;
    return { ok: true, message: 'the running step fails now' };
  }

  emergency() {
    if (this.active) this.failNext = 'E_EMERGENCY: emergency stop, motion aborted';
  }

  /* ─────────── ticking ─────────── */

  beginCycle() {
    this.cycleCount += 1;
    this.cycleStart = Date.now();
    this.leafTimes = [];
  }

  tick(now = Date.now()) {
    if (!this.tree) return;
    if (this.active && (!this.dbg.paused || this.dbg.step)) {
      this.dbg.step = false;
      this.ticks += 1;
      this.tickRoot(now);
    }
    if (now - this.lastStatusAt >= STATUS_PERIOD_MS || this.seq !== this.publishedSeq) this.publishStatus();
    if (now - this.lastActiveAt >= ACTIVE_PERIOD_MS) this.publishActive();
  }

  tickRoot(now) {
    const st = this.exec(this.tree.root, now);
    if (!this.active) return; // aborted from inside (emergency)
    const running = this.runningLeaves().length;
    if (st === ST.FAILURE) {
      this.cycleFailed(now);
      return;
    }
    if (st === ST.SUCCESS) {
      this.cycleDone(now);
      return;
    }
    if (this.flags.stop) {
      this.setState('STOPPING', 'stopping after the current step');
      if (running === 0) {
        this.haltAll();
        this.endRun('stopped after the current step');
      }
    } else if (this.flags.pause) {
      if (running === 0) this.setState('PAUSED', 'paused - call resume to continue');
      else this.setState('PAUSING', this.message.startsWith('step') ? this.message : 'pausing after the current step');
    } else {
      this.setState(this.flags.finish ? 'FINISHING' : 'RUNNING', this.state === 'PAUSED' || this.state === 'PAUSING' ? 'resumed' : undefined);
    }
  }

  cycleDone(now) {
    this.haltAll();
    const s = (now - this.cycleStart) / 1000;
    this.run.done += 1;
    this.total += 1;
    this.cycleTimes.push(s);
    this.lastCycle = s;
    this.profile = [...this.leafTimes].sort((a, b) => b.s - a.s).slice(0, 8).map((x) => `${x.name} (${x.type}) ${x.s.toFixed(2)} s`);
    this.host.onCycleTime(fix2(s));
    this.host.log('INFO', `[bt] cycle ${this.cycleCount}: ${s.toFixed(2)} s; ${this.profile.slice(0, 3).join('; ')}`);
    if (this.flags.finish) return this.endRun('exit requested, cycle completed');
    if (this.flags.stop) return this.endRun('stopped after the current step');
    if (this.run.cycles > 0 && this.run.done >= this.run.cycles) return this.endRun(`${this.run.done} cycle(s) done`);
    this.beginCycle();
    this.touch(`cycle ${this.run.done} complete`);
  }

  cycleFailed(now) {
    const leaf = this.failedLeaf;
    this.haltAll();
    const f = leaf || { name: this.tree.root.name, type: this.tree.root.type, uid: this.tree.root.uid, reason: 'the tree returned FAILURE' };
    const n = this.byUid.get(f.uid);
    this.lastFailure = {
      node: f.name,
      node_id: f.type,
      path: this.pathOf(n).map((x) => x.name).join(' -> '),
      error: f.reason || '',
      ports: n ? Object.entries(n.attrs).filter(([k]) => k !== 'name' && k !== 'ID').map(([k, v]) => `${k}=${v}`).join(' ') : '',
      blackboard: Object.entries(this.blackboard).map(([k, v]) => `${k}=${v}`),
      joints: this.host.joints?.() || [],
      cycle: this.run.done + 1,
      step_time_s: f.stepS || 0,
      time: timeText(),
    };
    const lf = this.lastFailure;
    this.host.log('ERROR', `CYCLE ${lf.cycle} FAILED at ${lf.node} (${lf.node_id})  [${lf.time}]\n  error:  ${lf.error}\n  path:   ${lf.path}\n  ports:  ${lf.ports}\n  step:   ${lf.step_time_s} s`);
    this.host.toast(`${lf.node} failed: ${lf.error || 'FAILURE'}`, 'failure', 6);
    this.flags = { pause: false, stop: false, finish: false, step: false, abort: false };
    this.setState('FAILED', `cycle ${lf.cycle} failed at ${lf.node}: ${lf.error || 'FAILURE'}`);
    this.host.onActiveFlag(false);
    this.publishStatus(true);
  }

  endRun(message) {
    this.flags = { pause: false, stop: false, finish: false, step: false, abort: false };
    this.setState('IDLE', message);
    this.host.toast(`BT stopped: ${message}`, 'success', 3);
    this.host.onActiveFlag(false);
    this.publishStatus(true);
  }

  /* BT.CPP v3 node semantics */

  setStatus(n, st, now = Date.now(), extra = null) {
    if (n.status === st) return;
    const prev = n.status;
    const ms = n.since ? now - n.since : 0;
    n.status = st;
    n.since = now;
    const failure = n.kind === 'leaf' && st === ST.FAILURE;
    const line = `${n.name} (${n.type}) ${STATE_NAMES[prev]} -> ${STATE_NAMES[st]}${ms ? ` ${ms} ms` : ''}`;
    if (n.kind === 'leaf' && st !== ST.IDLE) {
      this.lastEvent = line;
      this.recentLines.push(line);
      if (this.recentLines.length > MAX_RECENT_LINES) this.recentLines.shift();
    }
    const ev = { uid: n.uid, name: n.name, type: n.type, prev_status: prev, status: st, ms_in_prev_status: ms, cycle: this.cycleCount, failure };
    if (failure) {
      const p = this.pathOf(n);
      ev.path = p.map((x) => x.name);
      ev.path_uids = p.map((x) => x.uid);
      ev.reason = extra?.reason || '';
      ev.recent = this.recentLines.slice(0, -1);
      this.host.log('ERROR', `[bt][failure]FAILED_NODE: ${n.name} TRACE: ${ev.path.join(' -> ')} TIME: ${timeText()} REASON: ${ev.reason}`);
    }
    this.host.monitor.onEvent(ev);
    // breakpoints (bt_debug_pkg break_at)
    if (this.dbg.breakAt && n.name === this.dbg.breakAt && ((st === ST.RUNNING && !this.dbg.onFailureOnly) || (st === ST.FAILURE && this.dbg.onFailureOnly))) {
      this.dbg.paused = true;
      this.lastEvent = `breakpoint: ${n.name} ${STATE_NAMES[st]}`;
      this.host.log('WARN', `[bt][breakpoint] paused at ${n.name} (${STATE_NAMES[st]})`);
    }
  }

  halt(n, now = Date.now()) {
    for (const c of n.children) if (c.status !== ST.IDLE) this.halt(c, now);
    n.idx = 0;
    n.count = 0;
    n.finishAt = 0;
    n.phase = 0;
    this.setStatus(n, ST.IDLE, now);
  }

  haltChildren(n, now) {
    for (const c of n.children) if (c.status !== ST.IDLE) this.halt(c, now);
  }

  haltAll() {
    if (this.tree) this.halt(this.tree.root);
  }

  exec(n, now) {
    let st;
    switch (n.kind) {
      case 'leaf':
        return this.tickLeaf(n, now); // sets its own status (a held leaf stays IDLE)
      case 'decorator':
        st = this.tickDecorator(n, now);
        break;
      case 'subtree':
        st = n.children[0] ? this.exec(n.children[0], now) : ST.SUCCESS;
        break;
      default:
        st = this.tickControl(n, now);
    }
    if (st !== ST.IDLE) this.setStatus(n, st, now);
    return st;
  }

  tickControl(n, now) {
    const kids = n.children;
    if (!kids.length) return ST.SUCCESS;
    const t = n.type;
    if (FALLBACKS.test(t)) {
      if (n.status === ST.IDLE) n.idx = 0;
      while (n.idx < kids.length) {
        const st = this.exec(kids[n.idx], now);
        if (st === ST.RUNNING) return ST.RUNNING;
        if (st === ST.SUCCESS) {
          this.haltChildren(n, now);
          n.idx = 0;
          return ST.SUCCESS;
        }
        n.idx += 1;
      }
      this.haltChildren(n, now);
      n.idx = 0;
      return ST.FAILURE;
    }
    if (/Parallel/.test(t)) {
      let ok = 0;
      let bad = 0;
      for (const c of kids) {
        const st = c.status === ST.SUCCESS || c.status === ST.FAILURE ? c.status : this.exec(c, now);
        if (st === ST.SUCCESS) ok += 1;
        else if (st === ST.FAILURE) bad += 1;
      }
      const need = Number(n.attrs.success_threshold ?? n.attrs.success_count ?? kids.length);
      if (ok >= (need < 0 ? kids.length + need + 1 : need)) {
        this.haltChildren(n, now);
        return ST.SUCCESS;
      }
      if (bad > 0) {
        this.haltChildren(n, now);
        return ST.FAILURE;
      }
      return ST.RUNNING;
    }
    if (/^Recovery$/.test(t) && kids.length >= 2) {
      // work; when it fails the recover branch runs, then the node fails
      if (!n.phase) {
        const st = this.exec(kids[0], now);
        if (st !== ST.FAILURE) {
          if (st === ST.SUCCESS) this.haltChildren(n, now);
          return st;
        }
        n.phase = 1;
        n.cause = this.failedLeaf;
      }
      const st = this.exec(kids[1], now);
      if (st === ST.RUNNING) return ST.RUNNING;
      this.failedLeaf = n.cause || this.failedLeaf;
      this.haltChildren(n, now);
      n.phase = 0;
      return ST.FAILURE;
    }
    if (/IfThenElse|WhileDoElse/.test(t) && kids.length >= 2) {
      if (!n.phase) {
        const c = this.exec(kids[0], now);
        if (c === ST.RUNNING) return ST.RUNNING;
        n.phase = c === ST.SUCCESS ? 1 : 2;
      }
      const branch = kids[n.phase];
      if (!branch) {
        this.haltChildren(n, now);
        n.phase = 0;
        return ST.FAILURE;
      }
      const st = this.exec(branch, now);
      if (st !== ST.RUNNING) {
        this.haltChildren(n, now);
        n.phase = 0;
      }
      return st;
    }
    // Sequence (and every other node with children)
    if (n.status === ST.IDLE) n.idx = 0;
    while (n.idx < kids.length) {
      const st = this.exec(kids[n.idx], now);
      if (st === ST.RUNNING) return ST.RUNNING;
      if (st === ST.FAILURE) {
        this.haltChildren(n, now);
        n.idx = 0;
        return ST.FAILURE;
      }
      n.idx += 1;
    }
    this.haltChildren(n, now);
    n.idx = 0;
    return ST.SUCCESS;
  }

  tickDecorator(n, now) {
    const c = n.children[0];
    if (!c) return ST.SUCCESS;
    const t = n.type;
    if (/^Retry/.test(t)) {
      const max = Number(n.attrs.num_attempts ?? 1);
      for (;;) {
        const st = this.exec(c, now);
        if (st !== ST.FAILURE) {
          if (st === ST.SUCCESS) n.count = 0;
          return st;
        }
        n.count += 1;
        this.halt(c, now);
        if (max >= 0 && n.count >= max) {
          n.count = 0;
          return ST.FAILURE;
        }
        return ST.RUNNING; // try again next tick
      }
    }
    if (t === 'Repeat') {
      const max = Number(n.attrs.num_cycles ?? 1);
      const st = this.exec(c, now);
      if (st === ST.SUCCESS) {
        n.count += 1;
        this.halt(c, now);
        if (max >= 0 && n.count >= max) {
          n.count = 0;
          return ST.SUCCESS;
        }
        return ST.RUNNING;
      }
      if (st === ST.FAILURE) n.count = 0;
      return st;
    }
    const st = this.exec(c, now);
    if (st === ST.RUNNING) return st;
    if (t === 'Inverter') return st === ST.SUCCESS ? ST.FAILURE : ST.SUCCESS;
    if (t === 'ForceSuccess') return ST.SUCCESS;
    if (t === 'ForceFailure') return ST.FAILURE;
    return st;
  }

  /** How long a leaf runs (ms); 0 = finishes in the same tick. */
  durationOf(n) {
    const t = n.type;
    const a = n.attrs;
    if (/^(Sleep|Delay|Wait)/i.test(t)) return Number(a.msec ?? a.delay_msec ?? a.ms ?? 500) || 500;
    if (MOTION.test(t)) {
      if (this.run.sim) return 600;
      if (this.run.dryRun) return 400;
      return /RunProgram|RunPath|Weav/i.test(t) ? 3200 : 1500;
    }
    if (/^D[OI]|Gpio|Grip|DIControl|DoControl/i.test(t)) return this.run.sim || this.run.dryRun ? 0 : Number(a.push_wait ?? 300) || 300;
    if (/Preflight/.test(t)) return 300;
    return 0;
  }

  /** Result of a leaf when it finishes: [status, reason]. */
  resultOf(n) {
    const t = n.type;
    if (this.failNext) {
      const r = this.failNext;
      this.failNext = '';
      return [ST.FAILURE, r];
    }
    if (/AlwaysFailure|FailureNode/.test(t)) return [ST.FAILURE, ''];
    if (t === 'IsAtPose') {
      const target = n.attrs.target_name || n.attrs.pose_goal || '';
      return target && target === this.lastTarget ? [ST.SUCCESS, ''] : [ST.FAILURE, `robot is not at '${target}' (at '${this.lastTarget}')`];
    }
    if (MOTION.test(t) && !this.run.sim && !this.run.dryRun) {
      const why = this.host.motionBlocked?.() || '';
      if (why) return [ST.FAILURE, why];
    }
    if (t === 'SetVar' && n.attrs.key) this.blackboard[n.attrs.key] = String(n.attrs.value ?? '');
    return [ST.SUCCESS, ''];
  }

  /** May a leaf start now? The runner's soft-stop gate holds new steps while pausing / stopping. */
  mayStart() {
    if (!this.flags.pause && !this.flags.stop) return true;
    if (this.flags.step && this.flags.pause && !this.flags.stop) {
      this.flags.step = false;
      this.touch('step: waiting for the started action to finish');
      return true;
    }
    return false;
  }

  tickLeaf(n, now) {
    if (n.status === ST.RUNNING) {
      if (this.failNext) {
        const [st, reason] = this.resultOf(n);
        this.finishLeaf(n, st, reason, now);
        return st;
      }
      if (now < n.finishAt) return ST.RUNNING;
      const [st, reason] = this.resultOf(n);
      this.finishLeaf(n, st, reason, now);
      return st;
    }
    if (!this.mayStart()) return ST.RUNNING; // held: stays IDLE, the parent waits
    const d = this.durationOf(n);
    if (d <= 0 && !this.failNext) {
      const [st, reason] = this.resultOf(n);
      this.finishLeaf(n, st, reason, now, 0);
      return st;
    }
    n.startedAt = now;
    n.finishAt = now + Math.max(d, 1);
    this.setStatus(n, ST.RUNNING, now);
    if (MOTION.test(n.type) && !this.run.sim && !this.run.dryRun) this.host.onMotion?.(n.attrs.pose_goal || n.attrs.program || '');
    return ST.RUNNING;
  }

  finishLeaf(n, st, reason, now, ms = now - (n.startedAt || now)) {
    if (st === ST.SUCCESS && MOTION.test(n.type) && n.attrs.pose_goal) this.lastTarget = n.attrs.pose_goal;
    this.leafTimes.push({ name: n.name, type: n.type, s: ms / 1000 });
    if (st === ST.FAILURE) this.failedLeaf = { uid: n.uid, name: n.name, type: n.type, reason, stepS: fix2(ms / 1000) };
    this.setStatus(n, st, now, { reason });
    n.finishAt = 0;
  }

  /* ─────────── helpers ─────────── */

  pathOf(n) {
    const out = [];
    while (n) {
      out.unshift(n);
      n = n.parent ? this.byUid.get(n.parent) : null;
    }
    return out;
  }

  runningLeaves() {
    return this.tree ? this.tree.nodes.filter((n) => n.kind === 'leaf' && n.status === ST.RUNNING) : [];
  }

  statusView() {
    const now = Date.now();
    const times = this.cycleTimes;
    return {
      state: this.state,
      tree: this.file,
      has_start_node: Boolean(this.tree?.nodes.some((n) => /^(Start|StartControlNode)$/.test(n.type))),
      sim_mode: true,
      dry_run: this.run.dryRun && this.active,
      sim_run: this.run.sim && this.active,
      cycles_done: this.run.done,
      cycles_target: this.run.cycles,
      cycles_total: this.total,
      cycle_elapsed_s: this.active ? (now - this.cycleStart) / 1000 : 0,
      last_cycle_s: this.lastCycle,
      avg_cycle_s: times.length ? times.reduce((a, b) => a + b, 0) / times.length : 0,
      min_cycle_s: times.length ? Math.min(...times) : 0,
      max_cycle_s: times.length ? Math.max(...times) : 0,
      running: this.runningLeaves().map((n) => `${n.name} (${n.type})`),
      message: this.message,
      last_failure: this.lastFailure || {},
      last_cycle_profile: this.profile,
    };
  }

  publishStatus(force = false) {
    if (!force && this.seq === this.publishedSeq && Date.now() - this.lastStatusAt < STATUS_PERIOD_MS) return;
    this.lastStatusAt = Date.now();
    this.publishedSeq = this.seq;
    this.host.onRunner(this.statusView());
  }

  publishActive(force = false) {
    const now = Date.now();
    this.lastActiveAt = now;
    const leaves = this.runningLeaves();
    const first = leaves[0];
    const view = {
      cycle: this.cycleCount,
      treeId: this.tree?.mainId || '',
      paused: this.dbg.paused,
      ticks: this.ticks,
      running: leaves.map((n) => ({ uid: n.uid, name: n.name, type: n.type, ms: now - n.since })),
      ancestors: first ? this.pathOf(first).slice(0, -1).map((x) => x.name) : [],
      lastEvent: this.lastEvent,
    };
    const sig = `${view.cycle}|${view.paused}|${leaves.map((n) => n.uid).join(',')}|${view.lastEvent}`;
    if (!force && sig === this.activeSig && !leaves.length) return;
    this.activeSig = sig;
    this.host.onActive(view);
    this.host.onBlackboard?.(this.blackboard);
  }
}

function hintFor(error) {
  const e = String(error || '');
  if (/SubTree ID/.test(e)) return 'Every <SubTree ID="..."> must name a <BehaviorTree ID="..."> in the file or one of its <include>s.';
  if (/no children/.test(e)) return 'A Sequence / Fallback needs at least one child: add a step or delete the empty node.';
  if (/exactly one child/.test(e)) return 'A decorator wraps exactly one node.';
  if (/syntax/.test(e)) return 'The XML file is not well formed: check the tags around the reported line.';
  return 'Check the tree in the Robot Program editor.';
}
