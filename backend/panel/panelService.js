// panel/panelService.js -- the Client Control operator panel (round 19).
//
// Layout: one JSON file per project, control_data/operator_panel.json in the active project, so
// it is saved, versioned and restored with the project like the robot program. No file = the
// browser shows its default panel.
//
// ROS topics: widgets can show and publish plain std_msgs topics (Bool, Int32, Int64, Float64,
// String). The browser asks for the topics it shows with PANEL_WATCH { topics: [{ name, type }] };
// the backend subscribes once per topic (shared by every page) and sends PANEL_TOPIC
// { name, value } at most 5 times per second per topic, and only when the value changed. The
// subscription takes raw bytes and decodes only the newest message 5 times a second (a topic
// published at 100 Hz costs almost nothing). A subscription ends when no page watches the topic
// any more (CPU). The simulator keeps the values in memory and drives a few
// demo topics so the panel can be tried without a robot.
import express from "express";
import fs from "fs";
import path from "path";
import { ACTIVE_RUNTIME_PATH } from "../utils/pm_utils/paths.js";
import { busyReasons } from "../utils/interlock.js";

const LAYOUT_FILE = () => path.join(ACTIVE_RUNTIME_PATH, "control_data", "operator_panel.json");
const MAX_LAYOUT = 256 * 1024;
const RATE_MS = 200;

/** short type -> ROS message type */
export const TOPIC_TYPES = Object.freeze({
  bool: "std_msgs/msg/Bool",
  int: "std_msgs/msg/Int32",
  int64: "std_msgs/msg/Int64",
  float: "std_msgs/msg/Float64",
  string: "std_msgs/msg/String",
});
const SHORT = Object.fromEntries(Object.entries(TOPIC_TYPES).map(([k, v]) => [v, k]));
const TOPIC_RE = /^\/?[A-Za-z_][A-Za-z0-9_/]*$/;
const normTopic = (n) => (String(n).startsWith("/") ? String(n) : `/${n}`);

function coerce(type, value) {
  if (type === "bool") return value === true || value === 1 || value === "1" || String(value).toLowerCase() === "true";
  if (type === "int" || type === "int64") { const n = Math.trunc(Number(value)); return Number.isFinite(n) ? n : 0; }
  if (type === "float") { const n = Number(value); return Number.isFinite(n) ? n : 0; }
  return String(value ?? "");
}

let wsServer = null;
let getRos = () => null;
const watchers = new Map(); // ws -> Set(topic name)
const subs = new Map(); // topic -> { type, sub, value, lastSent, timer }
const simValues = new Map(); // topic -> { type, value } (simulator)
let simTimer = null;

const ros = () => getRos();
const isSim = () => { const r = ros(); return !r || r.simulated || !r.node; };

function send(name, value) {
  const s = subs.get(name);
  if (!s) return;
  if (s.value === value && s.lastSent) return; // unchanged: nothing to draw
  s.value = value;
  const now = Date.now();
  const due = s.lastSent + RATE_MS - now;
  if (due <= 0) {
    s.lastSent = now;
    wsServer?.broadcast({ type: "PANEL_TOPIC", payload: { name, value } });
  } else if (!s.timer) {
    s.timer = setTimeout(() => { s.timer = null; s.lastSent = Date.now(); wsServer?.broadcast({ type: "PANEL_TOPIC", payload: { name, value: s.value } }); }, due);
  }
}

function ensureSub(name, type) {
  if (subs.has(name)) return;
  const entry = { type, sub: null, value: undefined, lastSent: 0, timer: null };
  subs.set(name, entry);
  if (isSim()) {
    const v = simValues.get(name);
    if (v) send(name, v.value);
    return;
  }
  try {
    const r = ros();
    const rosType = TOPIC_TYPES[type] || TOPIC_TYPES.string;
    if (typeof r.subscribeState === "function") {
      const gate = r.subscribeState(rosType, name, RATE_MS, (m) => send(name, m?.data));
      entry.sub = gate ? { destroy: () => gate.destroy?.() } : null;
    } else {
      const sub = r.node.createSubscription(rosType, name, {}, (m) => send(name, m?.data));
      entry.sub = { destroy: () => r.node.destroySubscription(sub) };
    }
  } catch (err) {
    console.error(`[panel] cannot subscribe ${name}:`, err.message);
  }
}

function dropUnwatched() {
  const wanted = new Set();
  for (const set of watchers.values()) for (const n of set) wanted.add(n);
  for (const [name, s] of subs) {
    if (wanted.has(name)) continue;
    clearTimeout(s.timer);
    try { s.sub?.destroy(); } catch { /* node gone */ }
    subs.delete(name);
  }
}

/** WS: PANEL_WATCH { topics: [{ name, type }] } (an empty list stops). Returns true when handled. */
export function handlePanelMessage(msg, ws) {
  if (msg?.type !== "PANEL_WATCH") return false;
  const list = Array.isArray(msg.payload?.topics) ? msg.payload.topics : [];
  const set = new Set();
  for (const t of list.slice(0, 64)) {
    if (!t || !TOPIC_RE.test(String(t.name || ""))) continue;
    const name = normTopic(t.name);
    const type = TOPIC_TYPES[t.type] ? t.type : "string";
    set.add(name);
    ensureSub(name, type);
    const s = subs.get(name);
    if (s?.value !== undefined) wsServer?.sendTo(ws, { type: "PANEL_TOPIC", payload: { name, value: s.value } });
  }
  if (set.size) watchers.set(ws, set); else watchers.delete(ws);
  dropUnwatched();
  return true;
}

function publish(name, type, value) {
  const v = coerce(type, value);
  if (isSim()) {
    simValues.set(name, { type, value: v });
    if (subs.has(name)) send(name, v);
    return { ok: true, message: `Sent ${String(v)}` };
  }
  const r = ros();
  const pub = r.getPublisher(name, TOPIC_TYPES[type]);
  pub.publish({ data: v });
  return { ok: true, message: `Sent ${String(v)}` };
}

/** The simulator's demo topics: a door that opens and closes, a part counter, a status text. */
function startSimTopics() {
  if (simTimer) return;
  simValues.set("/cell/door_closed", { type: "bool", value: true });
  simValues.set("/cell/part_count", { type: "int", value: 0 });
  simValues.set("/cell/status_text", { type: "string", value: "Waiting for parts" });
  simValues.set("/cell/lamp", { type: "bool", value: false });
  simValues.set("/cell/recipe", { type: "int", value: 1 });
  simValues.set("/cell/feed_rate", { type: "float", value: 0.5 });
  let tick = 0;
  simTimer = setInterval(() => {
    if (!isSim()) return;
    tick++;
    const upd = (name, value) => { const e = simValues.get(name); e.value = value; if (subs.has(name)) send(name, value); };
    if (tick % 5 === 0) upd("/cell/door_closed", !simValues.get("/cell/door_closed").value);
    if (tick % 2 === 0) upd("/cell/part_count", simValues.get("/cell/part_count").value + 1);
    if (tick % 4 === 0) upd("/cell/status_text", ["Waiting for parts", "Loading", "Machining", "Unloading"][(tick / 4) % 4]);
  }, 1000);
  simTimer.unref?.();
}

const router = express.Router();

router.get("/", (req, res) => {
  try {
    const f = LAYOUT_FILE();
    if (!fs.existsSync(f)) return res.json({ ok: true, layout: null });
    res.json({ ok: true, layout: JSON.parse(fs.readFileSync(f, "utf8")) });
  } catch (err) {
    res.json({ ok: true, layout: null, message: `The saved panel could not be read (${err.message}); the default panel is shown` });
  }
});

router.put("/", (req, res) => {
  const layout = req.body?.layout;
  if (!layout || typeof layout !== "object" || !Array.isArray(layout.widgets)) return res.status(400).json({ ok: false, message: "layout.widgets must be a list" });
  const text = JSON.stringify(layout, null, 1);
  if (text.length > MAX_LAYOUT) return res.status(413).json({ ok: false, message: "The panel is too large" });
  try {
    const f = LAYOUT_FILE();
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(`${f}.tmp`, text);
    fs.renameSync(`${f}.tmp`, f);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, message: `Could not save the panel: ${err.message}` });
  }
});

/** Delete the project's panel: the default panel is shown again. */
router.delete("/", (req, res) => {
  try { fs.rmSync(LAYOUT_FILE(), { force: true }); res.json({ ok: true }); } catch (err) { res.status(500).json({ ok: false, message: err.message }); }
});

/** Topics a widget can bind to: [{ name, type }] (std_msgs Bool / Int / Float / String only). */
router.get("/topics", async (req, res) => {
  if (isSim()) return res.json({ ok: true, simulated: true, topics: [...simValues].map(([name, v]) => ({ name, type: v.type })).sort((a, b) => a.name.localeCompare(b.name)) });
  try {
    const list = ros().node.getTopicNamesAndTypes();
    const topics = [];
    for (const t of list) for (const ty of t.types || []) if (SHORT[ty]) topics.push({ name: t.name, type: SHORT[ty] });
    res.json({ ok: true, topics: topics.sort((a, b) => a.name.localeCompare(b.name)) });
  } catch (err) {
    res.json({ ok: true, topics: [], message: `Topic list not available: ${err.message}` });
  }
});

/** Body: { name, type: bool|int|int64|float|string, value, guard }. guard = refuse while the robot works. */
router.post("/publish", (req, res) => {
  const { name, type, value, guard } = req.body || {};
  if (!TOPIC_RE.test(String(name || ""))) return res.status(400).json({ ok: false, message: "Not a valid topic name" });
  if (!TOPIC_TYPES[type]) return res.status(400).json({ ok: false, message: "type: bool, int, int64, float or string" });
  if (guard) {
    const reasons = busyReasons();
    if (reasons.length) return res.status(409).json({ ok: false, code: "ROBOT_BUSY", action: "use this control", reasons, message: `${reasons.map((r) => r.text).join(" and ")}. Stop it first, then use this control.` });
  }
  try { res.json(publish(normTopic(name), type, value)); } catch (err) { res.status(500).json({ ok: false, message: `Could not send: ${err.message}` }); }
});

export function startPanel(ws, rosGetter) {
  wsServer = ws;
  getRos = rosGetter;
  ws.onClientClose?.((client) => { if (watchers.delete(client)) dropUnwatched(); });
  startSimTopics();
}

export default router;
