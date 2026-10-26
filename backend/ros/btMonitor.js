// backend/ros/btMonitor.js
//
// Live status of the behaviour tree for the NexRoot runner page (Groot-like
// view of the complete tree, subtrees attached inline).
//
// Sources (all from control_logic_bt + bt_debug_pkg):
//   /control_logic_bt/tree    BtTree, latched, once per load: the structure
//   /control_logic_bt/active  BtActive, 5 Hz: RUNNING leaves, paused, cycle
//   /control_logic_bt/events  BtEvent per status change: success / failure colours
//   /control_logic_bt/status  RunnerStatus, 2 Hz: runner state machine, last failure
//
// CPU: the browser never sees single events. The monitor keeps one status per
// node and sends the whole tree's colours as one short string (one character
// per node) at most 5 times per second, and only while a runner page is open.
// The events topic is subscribed only while someone watches; its messages are
// not decoded (see peekBtEvent): only uid and status are read from the raw
// bytes, and the full message is decoded for failures only.

import { LatestGate, RATE_MS } from './rateLimit.js';

/** BtEvent / BT.CPP status values. */
export const ST = Object.freeze({ IDLE: 0, RUNNING: 1, SUCCESS: 2, FAILURE: 3 });

/**
 * Character per node in BT_LIVE.st:
 *   '.' not ticked in this cycle   'R' running   'S' success   'F' failure
 *   's' / 'f' finished in this cycle, now idle again (BT resets finished children)
 *   'h' was running and got halted
 */
const CUR_CH = ['.', 'R', 'S', 'F'];
const WAS_CH = ['.', 'h', 's', 'f'];

const MAX_RECENT_EVENTS = 300;
const MAX_EVENTS_PER_BATCH = 60;

/** Runner states that count as "a run is active" (control_logic_bt RunnerControl). */
export const ACTIVE_STATES = new Set(['RUNNING', 'PAUSING', 'PAUSED', 'STOPPING', 'FINISHING']);

const num = (v, d = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};
const arr = (v) => (Array.isArray(v) ? v : v && typeof v.length === 'number' ? Array.from(v) : []);
const round = (v, d = 2) => Math.round(num(v) * 10 ** d) / 10 ** d;

/** BtTree message → structure for the runner page (uids, parents, subtree names). */
export function btStructureView(m) {
  const nodes = arr(m?.nodes).map((n) => ({
    uid: num(n.uid),
    name: n.name || '',
    type: n.type || '',
    parent: num(n.parent_uid),
    depth: num(n.depth),
    subtree: n.subtree || '',
    leaf: Boolean(n.leaf),
  }));
  return {
    treeId: m?.tree_id || '',
    xmlFile: m?.xml_file || '',
    hash: m?.tree_hash || '',
    rootUid: num(m?.root_uid, nodes[0]?.uid || 0),
    nodes,
    warnings: arr(m?.warnings),
  };
}

/** RunnerStatus message → JSON for the browser. */
export function runnerStatusView(m) {
  const f = m?.last_failure || {};
  return {
    state: m?.state || 'UNKNOWN',
    tree: m?.tree || '',
    hasStartNode: Boolean(m?.has_start_node),
    simMode: Boolean(m?.sim_mode),
    dryRun: Boolean(m?.dry_run),
    simRun: Boolean(m?.sim_run),
    cyclesDone: num(m?.cycles_done),
    cyclesTarget: num(m?.cycles_target),
    cyclesTotal: num(m?.cycles_total),
    cycleElapsed: round(m?.cycle_elapsed_s, 1),
    lastCycle: round(m?.last_cycle_s),
    avgCycle: round(m?.avg_cycle_s),
    minCycle: round(m?.min_cycle_s),
    maxCycle: round(m?.max_cycle_s),
    running: arr(m?.running),
    message: m?.message || '',
    lastFailure: f.node
      ? {
          node: f.node,
          nodeId: f.node_id || '',
          path: f.path || '',
          error: f.error || '',
          ports: f.ports || '',
          blackboard: arr(f.blackboard),
          joints: arr(f.joints).map((v) => round(v, 4)),
          cycle: num(f.cycle),
          stepTime: round(f.step_time_s),
          time: f.time || '',
        }
      : null,
    profile: arr(m?.last_cycle_profile),
  };
}

/**
 * Read uid, prev_status, status and failure from a raw (CDR serialized)
 * BtEvent without decoding the message. Layout (BtEvent.msg):
 *   stamp {int32 sec, uint32 nanosec}, uint64 cycle, uint32 uid, string name,
 *   string type, uint8 prev_status, uint8 status, float64 ms_in_prev_status,
 *   bool failure, ...
 * Returns null when the bytes do not look like a BtEvent.
 */
export function peekBtEvent(buf) {
  if (!buf || buf.length < 40) return null;
  const le = buf[1] === 1 || buf[1] === 3; // CDR_LE / PL_CDR_LE
  if (!le && buf[1] !== 0 && buf[1] !== 2) return null;
  const B = 4; // encapsulation header; alignment is relative to the data start
  const u32 = (o) => (le ? buf.readUInt32LE(B + o) : buf.readUInt32BE(B + o));
  const align = (o, n) => (o + n - 1) & ~(n - 1);
  try {
    const cycle = Number(le ? buf.readBigUInt64LE(B + 8) : buf.readBigUInt64BE(B + 8));
    const uid = u32(16);
    let o = 20;
    const nameLen = u32(o);
    o += 4;
    if (nameLen > 4096 || B + o + nameLen > buf.length) return null;
    const name = nameLen > 0 ? buf.toString('utf8', B + o, B + o + nameLen - 1) : '';
    o += nameLen;
    o = align(o, 4);
    const typeLen = u32(o);
    o += 4;
    if (typeLen > 4096 || B + o + typeLen + 2 > buf.length) return null;
    o += typeLen;
    const prev = buf[B + o];
    const status = buf[B + o + 1];
    o = align(o + 2, 8);
    const ms = le ? buf.readDoubleLE(B + o) : buf.readDoubleBE(B + o);
    const failure = buf[B + o + 8] === 1;
    if (prev > 3 || status > 3) return null;
    return { cycle, uid, name, prev, status, ms, failure };
  } catch {
    return null;
  }
}

/** No runner status for this long: the runner is gone. */
const RUNNER_STALE_MS = 6000;

export class BtMonitor {
  /**
   * @param {object} ws  wsServer (publishState, broadcast)
   * @param {object} hooks { onWatchChange(watching: boolean) }: subscribe / unsubscribe the events topic
   */
  constructor(ws, hooks = {}) {
    this.ws = ws;
    this.hooks = hooks;
    this.structure = null; // btStructureView
    this.index = new Map(); // uid → position in structure.nodes
    this.cur = new Uint8Array(0); // current status per node
    this.was = new Uint8Array(0); // last non-idle status in this cycle
    this.cycle = 0;
    this.active = null; // btActiveView
    this.runner = null; // runnerStatusView
    this.failure = null; // last leaf failure (events)
    this.runFailure = null; // the failure that stopped the run, located in the tree
    this.breakpoint = { name: '', onFailureOnly: false };
    this.recent = []; // recent leaf events, newest last
    this.pendingEvents = [];
    this.eventsSeen = false; // an event arrived since the tree was loaded
    this.peekMismatch = 0;
    this.watchers = new Set();
    this.watching = false;
    this.liveGate = new LatestGate(RATE_MS.BT_LIVE, () => this.flushLive());
    this.runnerGate = new LatestGate(RATE_MS.BT_RUNNER, (v) => this.ws.publishState?.('BT_RUNNER', v));
    // The runner publishes its status at 2 Hz; a latched last status from a
    // runner that has gone away (process closed) must not read as "Idle".
    this.runnerAt = 0;
    this.runnerWatch = setInterval(() => {
      if (!this.runner || Date.now() - this.runnerAt < RUNNER_STALE_MS) return;
      this.runner = null;
      this.runnerGate.push(null);
      this.markDirty();
    }, 2000);
    this.runnerWatch.unref?.();
  }

  /* ─────────── who is watching ─────────── */

  watch(client, on) {
    if (on) this.watchers.add(client);
    else this.watchers.delete(client);
    const now = this.watchers.size > 0;
    if (now === this.watching) {
      if (on) this.markDirty();
      return;
    }
    this.watching = now;
    try {
      this.hooks.onWatchChange?.(now);
    } catch (err) {
      console.error('[bt] watch hook failed:', err);
    }
    if (now) {
      this.ws.resetState?.('BT_LIVE');
      this.markDirty();
    }
  }

  /* ─────────── inputs ─────────── */

  setStructure(view) {
    if (!view?.nodes?.length) {
      this.structure = view || null;
      this.index = new Map();
      this.cur = new Uint8Array(0);
      this.was = new Uint8Array(0);
      this.markDirty();
      return;
    }
    const same = this.structure?.hash && this.structure.hash === view.hash && this.structure.nodes.length === view.nodes.length;
    this.structure = view;
    this.index = new Map(view.nodes.map((n, i) => [n.uid, i]));
    if (!same) {
      this.cur = new Uint8Array(view.nodes.length);
      this.was = new Uint8Array(view.nodes.length);
      this.eventsSeen = false;
      this.failure = null;
      this.recent = [];
      if (this.runFailure) this.runFailure = { ...this.runFailure, uid: 0, pathUids: [] };
    }
    this.ws.publishState?.('BT_STRUCT_INFO', this.structureInfo());
    this.markDirty();
  }

  structureInfo() {
    const s = this.structure;
    return s ? { treeId: s.treeId, xmlFile: s.xmlFile, hash: s.hash, nodeCount: s.nodes?.length || 0, warnings: s.warnings || [] } : null;
  }

  /** A raw BtEvent (Buffer). Returns false when the bytes must be decoded instead. */
  onRawEvent(buf) {
    const e = peekBtEvent(buf);
    if (!e) return false;
    const i = this.index.get(e.uid);
    if (i === undefined || this.structure.nodes[i].name !== e.name) {
      this.peekMismatch += 1;
      return false;
    }
    if (e.failure) return false; // the failure details need the full message
    this.applyEvent(i, e.prev, e.status, e.cycle, e.ms);
    return true;
  }

  /** A decoded BtEvent (or the simulator's equivalent). */
  onEvent(m) {
    const uid = num(m.uid);
    const i = this.index.get(uid);
    if (i === undefined) return;
    const status = num(m.status);
    this.applyEvent(i, num(m.prev_status), status, num(m.cycle), num(m.ms_in_prev_status));
    if (m.failure) {
      this.failure = {
        source: 'events',
        uid,
        node: m.name || this.structure.nodes[i].name,
        type: m.type || this.structure.nodes[i].type,
        cycle: num(m.cycle),
        pathUids: arr(m.path_uids).map(Number),
        path: arr(m.path),
        reason: m.reason || '',
        recent: arr(m.recent).slice(-30),
        at: Date.now(),
      };
      this.markDirty();
    }
  }

  applyEvent(i, prev, status, cycle, ms) {
    this.eventsSeen = true;
    if (cycle && cycle !== this.cycle) this.newCycle(cycle);
    this.cur[i] = status;
    if (status !== ST.IDLE) this.was[i] = status;
    else if (prev === ST.RUNNING) this.was[i] = ST.RUNNING; // halted while running
    const n = this.structure.nodes[i];
    if (n.leaf && status !== ST.IDLE) {
      const ev = { t: Date.now(), uid: n.uid, s: status, p: prev, ms: Math.round(ms) };
      this.recent.push(ev);
      if (this.recent.length > MAX_RECENT_EVENTS) this.recent.splice(0, this.recent.length - MAX_RECENT_EVENTS);
      if (this.watching) {
        this.pendingEvents.push(ev);
        if (this.pendingEvents.length > MAX_EVENTS_PER_BATCH) this.pendingEvents.shift();
      }
    }
    this.markDirty();
  }

  newCycle(cycle) {
    this.cycle = cycle;
    // a new cycle starts with a clean tree; nodes running across the boundary keep their state
    for (let i = 0; i < this.was.length; i++) this.was[i] = this.cur[i];
  }

  onActive(view) {
    this.active = view;
    if (view && num(view.cycle) && num(view.cycle) !== this.cycle && !this.eventsSeen) this.cycle = num(view.cycle);
    this.markDirty();
  }

  onRunnerStatus(view) {
    this.runnerAt = Date.now();
    const prevState = this.runner?.state;
    this.runner = view;
    const lf = view?.lastFailure;
    if (!lf) this.runFailure = null;
    else if (!this.runFailure || this.runFailure.node !== lf.node || this.runFailure.cycle !== lf.cycle || this.runFailure.time !== lf.time) {
      // the failure that stopped the run: find its node in the tree (events give the exact uid)
      const ev = this.failure && this.failure.node === lf.node ? this.failure : null;
      const uid = ev?.uid || this.uidOfPath(lf.path, lf.node);
      this.runFailure = { uid, node: lf.node, cycle: lf.cycle, time: lf.time, pathUids: ev?.pathUids?.length ? ev.pathUids : this.pathUidsOf(uid) };
    }
    if (view?.state === 'RUNNING' && prevState && !ACTIVE_STATES.has(prevState)) {
      // a new run: clear the colours of the last one
      this.cur.fill(0);
      this.was.fill(0);
      this.failure = null;
    }
    this.runnerGate.push(view);
    this.markDirty();
  }

  pathUidsOf(uid) {
    const out = [];
    let i = this.index.get(uid);
    let guard = 0;
    while (i !== undefined && guard++ < 256) {
      out.unshift(this.structure.nodes[i].uid);
      i = this.index.get(this.structure.nodes[i].parent);
    }
    return out;
  }

  /** uid of the node `name` whose ancestors best match "a -> b -> name". */
  uidOfPath(pathText, name) {
    const s = this.structure;
    if (!s?.nodes?.length || !name) return 0;
    const names = String(pathText || '').split('->').map((x) => x.trim()).filter(Boolean);
    let best = 0;
    let bestScore = -1;
    for (const n of s.nodes) {
      if (n.name !== name) continue;
      let score = 0;
      let p = this.index.get(n.parent);
      let k = names.length - 2;
      while (p !== undefined && k >= 0) {
        const pn = s.nodes[p];
        if (pn.name === names[k]) {
          score += 1;
          k -= 1;
        }
        p = this.index.get(pn.parent);
      }
      if (score > bestScore) {
        bestScore = score;
        best = n.uid;
      }
    }
    return best;
  }

  setBreakpoint(name, onFailureOnly) {
    this.breakpoint = { name: name || '', onFailureOnly: Boolean(name && onFailureOnly) };
    this.markDirty();
  }

  /* ─────────── output ─────────── */

  markDirty() {
    if (this.watching) this.liveGate.push(true);
  }

  /** The status character string: events when they arrive, else RUNNING leaves + their ancestors. */
  statusString() {
    const s = this.structure;
    const n = s?.nodes?.length || 0;
    if (!n) return '';
    const out = new Array(n);
    for (let i = 0; i < n; i++) out[i] = this.cur[i] !== ST.IDLE ? CUR_CH[this.cur[i]] : WAS_CH[this.was[i]];
    if (!this.eventsSeen) {
      // no events (topic off / older runner): orange chain from every running leaf to the root
      const running = this.active?.running || [];
      const runState = this.runner?.state;
      if (!runState || ACTIVE_STATES.has(runState)) {
        for (const r of running) {
          let i = this.index.get(num(r.uid));
          if (i === undefined) i = s.nodes.findIndex((x) => x.name === r.name);
          let guard = 0;
          while (i !== undefined && i >= 0 && guard++ < 256) {
            out[i] = 'R';
            i = this.index.get(s.nodes[i].parent);
          }
        }
      }
      for (const f of [this.failure, this.runFailure]) {
        const i = f?.uid ? this.index.get(f.uid) : undefined;
        if (i !== undefined) out[i] = 'F';
      }
    }
    return out.join('');
  }

  flushLive() {
    const a = this.active;
    const f = this.failure;
    const live = {
      hash: this.structure?.hash || '',
      cycle: this.cycle || num(a?.cycle),
      paused: Boolean(a?.paused),
      ticks: num(a?.ticks),
      st: this.statusString(),
      run: (a?.running || []).map((r) => [num(r.uid), num(r.ms), r.name]),
      lastEvent: a?.lastEvent || '',
      events: this.eventsSeen,
      bp: this.breakpoint,
      // last leaf that failed (also failures a Fallback handled)
      fail: f
        ? { uid: f.uid || 0, node: f.node, type: f.type || '', cycle: f.cycle || 0, path: f.path || [], pathUids: f.pathUids || [], reason: f.reason || '', recent: f.recent || [], at: f.at }
        : null,
      // the failure that stopped the run (RunnerStatus.last_failure)
      runFail: this.runFailure,
    };
    this.ws.publishState?.('BT_LIVE', live);
    if (this.pendingEvents.length) {
      const batch = this.pendingEvents;
      this.pendingEvents = [];
      this.ws.broadcast?.({ type: 'BT_EVENTS', payload: batch });
    }
  }

  snapshot() {
    return {
      structure: this.structure,
      runner: this.runner,
      recent: this.recent.slice(-MAX_RECENT_EVENTS),
      breakpoint: this.breakpoint,
    };
  }

  stop() {
    this.liveGate.stop();
    this.runnerGate.stop();
    clearInterval(this.runnerWatch);
  }
}
