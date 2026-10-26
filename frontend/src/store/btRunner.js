// Live behaviour-tree runner state for the NexRoot runner page.
// The backend (ros/btMonitor.js) sends, at most 5 times per second and only
// while a runner page is open:
//   BT_LIVE    one status character per node + running leaves + last failure
//   BT_EVENTS  batches of leaf status changes (for the event list)
//   BT_RUNNER  the runner state machine (RunnerStatus, 2 Hz and on change)
//   BT_STRUCT_INFO  hash / size of the loaded tree (the structure itself is
//              fetched once per hash from GET /robot/bt/structure)
import { create } from "zustand";
import { send, subscribe } from "../lib/ws";
import { robotApi } from "../lib/robotApi";

const MAX_EVENTS = 300;

export const useBtRunner = create(() => ({
  runner: null, // runnerStatusView
  live: null, // { hash, cycle, paused, ticks, st, run, lastEvent, events, bp, fail }
  info: null, // { treeId, xmlFile, hash, nodeCount, warnings }
  structure: null, // { treeId, xmlFile, hash, rootUid, nodes, warnings }
  structureError: "",
  events: [], // { t, uid, s, p, ms }, newest last
}));

let wired = false;
let watchers = 0;
let fetchingHash = null;

async function fetchStructure(hash) {
  if (fetchingHash === hash) return;
  fetchingHash = hash;
  try {
    const r = await robotApi.btStructure();
    if (r?.structure) useBtRunner.setState({ structure: r.structure, structureError: "" });
    else useBtRunner.setState({ structure: null, structureError: r?.message || "No tree from the runner yet" });
    if (r?.runner) useBtRunner.setState({ runner: r.runner });
    if (r?.recent) useBtRunner.setState({ events: r.recent });
  } catch (err) {
    useBtRunner.setState({ structureError: err?.message || "Could not read the tree" });
  } finally {
    fetchingHash = null;
  }
}

function wire() {
  if (wired) return;
  wired = true;
  subscribe("BT_RUNNER", (p) => useBtRunner.setState({ runner: p }));
  subscribe("BT_STRUCT_INFO", (p) => {
    useBtRunner.setState({ info: p });
    const cur = useBtRunner.getState().structure;
    if (watchers > 0 && p?.hash && cur?.hash !== p.hash) fetchStructure(p.hash);
  });
  subscribe("BT_LIVE", (p) => {
    useBtRunner.setState({ live: p });
    const cur = useBtRunner.getState().structure;
    if (watchers > 0 && p?.hash && cur?.hash !== p.hash) fetchStructure(p.hash);
  });
  subscribe("BT_EVENTS", (batch) => {
    if (!Array.isArray(batch) || !batch.length) return;
    const ev = useBtRunner.getState().events;
    const next = ev.length + batch.length > MAX_EVENTS ? [...ev, ...batch].slice(-MAX_EVENTS) : [...ev, ...batch];
    useBtRunner.setState({ events: next });
  });
  subscribe("__OPEN__", () => {
    if (watchers > 0) {
      send("BT_WATCH", { on: true });
      fetchStructure("reconnect");
    }
  });
}

/** Tell the backend this page wants live tree data (the events topic is subscribed only then). */
export function startBtWatch() {
  wire();
  watchers += 1;
  if (watchers === 1) {
    send("BT_WATCH", { on: true });
    fetchStructure("open");
  }
  return () => {
    watchers = Math.max(0, watchers - 1);
    if (watchers === 0) send("BT_WATCH", { on: false });
  };
}

export const refreshBtStructure = () => fetchStructure(`manual${Date.now()}`);
