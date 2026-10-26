// plc/routes.js -- the NextPLC API under /plc-api (not /nextplc: that is the page's route).
//
//   /programs   this project's program (name "@project") and the shared program library: list,
//               read, save, rename, delete, check, describe, load into the PLC, use a library
//               program in this project
//   /plc        the running PLC: status, set / pulse bits, registers, force, reset, events;
//               the simulator's virtual panel
//   /blocks     the block library (installed + the robot's own blocks), check, test
//   /sim        test scenarios (library), run a program against one
//   /docs       the manuals (Help page)
//   /system     mode (sim / real) and, for Settings, where the files are
//
// Messages never carry file names or paths: programs are named without their extension.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import express from "express";
import YAML from "yaml";
import {
  PROGRAMS_DIR, SCENARIOS_DIR, PROJECT_PROGRAM, PROJECT_RETAIN, PROJECT_NAME, BACKUPS_DIR, USER_BLOCKS_DIR, LIB_BLOCKS_DIR,
  PKG_DIR, PKG_BUNDLED, DOCS_DIR, EXAMPLES_DIR, STATE_DIR, CHECK_BIN, SIM_BIN, ensureDirs,
} from "./paths.js";
import { checkProgram, loadText, describeProgram, simulateProgram } from "./tools.js";
import { getBridge, getManager } from "./plcService.js";
import { ioUsage } from "./ioUsage.js";

const router = express.Router();
const PROGRAM_RE = /^[A-Za-z0-9_][A-Za-z0-9_.-]*\.(yaml|yml)$/i;
const SIM_RE = /^[A-Za-z0-9_][A-Za-z0-9_.-]*\.sim$/i;
const BLOCK_RE = /^[A-Za-z0-9_]+$/;
const plain = (n) => String(n || "").replace(/\.(ya?ml|sim)$/i, "");
const read = (p) => { try { return fs.readFileSync(p, "utf8"); } catch { return null; } };
const answer = (res, r) => res.status(r.ok ? 200 : 400).json(r);
const fail = (res, code, message) => res.status(code).json({ ok: false, message });
const safeProgram = (name) => { const n = path.basename(String(name || "")); return n === PROJECT_NAME || PROGRAM_RE.test(n) ? n : null; };
/** The file behind a program name: "@project" = this project's program, else the library. */
const programFile = (n) => (n === PROJECT_NAME ? PROJECT_PROGRAM : path.join(PROGRAMS_DIR, n));
const programLabel = (n) => (n === PROJECT_NAME ? "this project's program" : plain(n));
const safeScenario = (name) => { const n = path.basename(String(name || "")); return SIM_RE.test(n) ? n : null; };
const bridgeOr503 = (res) => { const b = getBridge(); if (!b) fail(res, 503, "the PLC is starting"); return b; };
/** wrap a handler: any throw (missing folder, no permission) is an answer, never a crash */
const safe = (fn) => async (req, res) => {
  try { await fn(req, res); } catch (err) { if (!res.headersSent) fail(res, 500, plain(err.message).replace(/\/[^\s'"]+/g, "")); }
};

// ================= programs =================
function describeFile(p, name, loaded, projectText) {
  const st = fs.statSync(p);
  const text = read(p) || "";
  const first = text.split("\n").find((l) => l.trim() && !l.trim().startsWith("#")) || "";
  const m = /^\s*program:\s*"?([^"\n]+)"?/i.exec(first);
  return {
    name, label: name === PROJECT_NAME ? "This project's program" : plain(name), size: st.size, modified: st.mtimeMs, program: (m && m[1]) || "",
    active: p === loaded, project: name === PROJECT_NAME, in_project: name !== PROJECT_NAME && projectText != null && projectText === text, lines: text.split("\n").length,
  };
}
function listPrograms() {
  ensureDirs();
  const loaded = getBridge()?.programInfo?.path || "";
  const projectText = read(PROJECT_PROGRAM);
  const library = fs.readdirSync(PROGRAMS_DIR).filter((f) => PROGRAM_RE.test(f)).sort().map((f) => describeFile(path.join(PROGRAMS_DIR, f), f, loaded, projectText));
  return { project: projectText != null ? describeFile(PROJECT_PROGRAM, PROJECT_NAME, loaded, null) : null, library };
}

router.get("/programs", safe((req, res) => {
  const { project, library } = listPrograms();
  res.json({ project, programs: library, project_exists: Boolean(project) });
}));
router.get("/programs/examples", safe((req, res) => {
  if (!fs.existsSync(EXAMPLES_DIR)) return res.json({ examples: [] });
  const ex = fs.readdirSync(EXAMPLES_DIR).filter((f) => /\.yaml$/.test(f) && !/^(blink_program|program_conv)\.yaml$/.test(f)).map((f) => ({ name: f, label: plain(f), text: read(path.join(EXAMPLES_DIR, f)) || "" }));
  res.json({ examples: ex });
}));

/** Check a text (not necessarily saved). Body: { text, name } */
router.post("/programs/check", safe(async (req, res) => {
  const name = safeProgram(req.body?.name) || "program.yaml";
  const r = await checkProgram(String(req.body?.text ?? ""), name === PROJECT_NAME ? "program.yaml" : name, programFile(name));
  res.json({ ...r, output: r.output ? r.output.replaceAll(name, plain(name)) : r.output });
}));
/** Describe a text: rungs, sequences, explanations, ladder (JS engine). Body: { text, name } */
router.post("/programs/describe", safe((req, res) => {
  const name = safeProgram(req.body?.name) || "program.yaml";
  const r = loadText(String(req.body?.text ?? ""), programFile(name));
  if (!r.ok) return res.json({ ok: false, error: r.err, yaml: r.yaml || "" });
  res.json({ ok: true, program: describeProgram(r.program) });
}));
/** Load a saved program into the PLC (load_program). Body: { name } or {} = reload. */
router.post("/programs/load", safe(async (req, res) => {
  const b = bridgeOr503(res); if (!b) return;
  let p = "";
  if (req.body?.name) {
    const n = safeProgram(req.body.name);
    if (!n) return fail(res, 400, "bad program name");
    p = programFile(n);
    if (!fs.existsSync(p)) return fail(res, 404, `${programLabel(n)} not found`);
  }
  const r = await b.loadProgram(p);
  res.json({ ...r, message: plain(r.message) });
}));

router.get("/programs/:name", safe((req, res) => {
  const n = safeProgram(req.params.name);
  if (!n) return fail(res, 400, "bad program name (letters, digits and _)");
  const p = programFile(n);
  if (!fs.existsSync(p)) return fail(res, 404, `${programLabel(n)} not found`);
  res.json({ ok: true, name: n, label: programLabel(n), project: n === PROJECT_NAME, text: read(p), modified: fs.statSync(p).mtimeMs });
}));
/** Save (create or overwrite). Body: { text, overwrite? } */
router.put("/programs/:name", safe((req, res) => {
  const n = safeProgram(req.params.name);
  if (!n) return fail(res, 400, "bad program name (letters, digits and _)");
  ensureDirs();
  const p = programFile(n);
  const text = String(req.body?.text ?? "");
  if (fs.existsSync(p) && req.body?.overwrite === false) return fail(res, 409, `${programLabel(n)} exists`);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, text);
  getBridge()?.log?.("info", `${n === PROJECT_NAME ? "this project's program" : `program ${plain(n)}`} saved (${text.split("\n").length} lines)`);
  res.json({ ok: true, name: n, label: programLabel(n), modified: fs.statSync(p).mtimeMs });
}));
router.post("/programs/:name/rename", safe((req, res) => {
  const n = safeProgram(req.params.name), to = safeProgram(req.body?.to);
  if (!n || !to || n === PROJECT_NAME || to === PROJECT_NAME) return fail(res, 400, "bad name");
  const p = path.join(PROGRAMS_DIR, n), q = path.join(PROGRAMS_DIR, to);
  if (!fs.existsSync(p)) return fail(res, 404, `${plain(n)} not found`);
  if (fs.existsSync(q)) return fail(res, 409, `${plain(to)} exists`);
  fs.renameSync(p, q);
  res.json({ ok: true, name: to, label: plain(to) });
}));
router.delete("/programs/:name", safe((req, res) => {
  const n = safeProgram(req.params.name);
  if (!n) return fail(res, 400, "bad name");
  if (n === PROJECT_NAME) return fail(res, 400, "this project's program cannot be deleted; replace it with Use in this project");
  const p = programFile(n);
  if (!fs.existsSync(p)) return fail(res, 404, `${plain(n)} not found`);
  if (getBridge()?.programInfo?.path === p) return fail(res, 409, `${plain(n)} is the program in the PLC; load another one first`);
  fs.unlinkSync(p);
  res.json({ ok: true });
}));
/**
 * Use a library program in this project: copied over this project's program, which the PLC runs
 * for this project (and loads when it starts). The replaced program is kept in backups/.
 */
router.post("/programs/:name/use", safe((req, res) => {
  const n = safeProgram(req.params.name);
  if (!n || n === PROJECT_NAME) return fail(res, 400, "bad name");
  const p = programFile(n);
  if (!fs.existsSync(p)) return fail(res, 404, `${plain(n)} not found`);
  fs.mkdirSync(path.dirname(PROJECT_PROGRAM), { recursive: true });
  let kept = false;
  if (fs.existsSync(PROJECT_PROGRAM)) {
    if (read(PROJECT_PROGRAM) === read(p)) return res.json({ ok: true, message: `${plain(n)} already is this project's program` });
    const d = new Date(), z = (x) => String(x).padStart(2, "0");
    fs.mkdirSync(BACKUPS_DIR, { recursive: true });
    fs.copyFileSync(PROJECT_PROGRAM, path.join(BACKUPS_DIR, `program_${d.getFullYear()}${z(d.getMonth() + 1)}${z(d.getDate())}_${z(d.getHours())}${z(d.getMinutes())}${z(d.getSeconds())}.yaml`));
    kept = true;
  }
  fs.copyFileSync(p, PROJECT_PROGRAM);
  getBridge()?.log?.("info", `${plain(n)} is now this project's program${kept ? " (the previous one was kept as a backup)" : ""}`);
  res.json({ ok: true, message: `${plain(n)} is now this project's program: the PLC runs it for this project${kept ? ". The previous one was kept as a backup." : "."}` });
}));
/** Keep this project's program in the library too, so other projects can use it. Body: { to } */
router.post("/programs/@project/to-library", safe((req, res) => {
  const to = safeProgram(req.body?.to);
  if (!to || to === PROJECT_NAME) return fail(res, 400, "name: letters, digits, - and _");
  if (!fs.existsSync(PROJECT_PROGRAM)) return fail(res, 404, "this project has no program yet");
  const q = path.join(PROGRAMS_DIR, to);
  if (fs.existsSync(q) && req.body?.overwrite !== true) return fail(res, 409, `${plain(to)} exists`);
  fs.mkdirSync(PROGRAMS_DIR, { recursive: true });
  fs.copyFileSync(PROJECT_PROGRAM, q);
  res.json({ ok: true, name: to, label: plain(to) });
}));

// ================= the running PLC =================
router.get("/plc/status", (req, res) => {
  const b = bridgeOr503(res); if (!b) return;
  res.json({ simulated: b.simulated, ready: b.ready, state: b.simulated ? b.buildState() : b.state, program: b.programInfo, alarms: b.recentAlarms.slice(-50), panel: b.simPanel() });
});
router.get("/plc/events", (req, res) => { const b = bridgeOr503(res); if (!b) return; res.json({ events: b.eventLog.slice(-300) }); });
/** Which DI / DO the running program uses (IO Control "used by PLC" marks). */
router.get("/plc/io-usage", safe((req, res) => res.json(ioUsage(getBridge()))));
router.get("/plc/alarms", (req, res) => { const b = bridgeOr503(res); if (!b) return; res.json({ alarms: b.recentAlarms }); });
/** Body: { name: [..], value: [..], pulse_ms?: [..] } or { name: "M10", value: 1, pulse_ms?: 100 } */
router.post("/plc/set-bits", safe(async (req, res) => {
  const b = bridgeOr503(res); if (!b) return;
  const body = req.body || {};
  const names = Array.isArray(body.name) ? body.name : [body.name];
  const values = Array.isArray(body.value) ? body.value : [body.value];
  const pulse = Array.isArray(body.pulse_ms) ? body.pulse_ms : names.map(() => Number(body.pulse_ms) || 0);
  if (names.some((n) => !n)) return fail(res, 400, "name is required");
  answer(res, await b.setBits(names.map(String), values.map((v) => Number(v) | 0), pulse));
}));
router.post("/plc/get-bits", safe(async (req, res) => {
  const b = bridgeOr503(res); if (!b) return;
  answer(res, await b.getBits((Array.isArray(req.body?.name) ? req.body.name : []).map(String)));
}));
/** Body: { name, value, release } */
router.post("/plc/force", safe(async (req, res) => {
  const b = bridgeOr503(res); if (!b) return;
  const { name, value, release } = req.body || {};
  if (!name) return fail(res, 400, "name is required");
  answer(res, await b.forceBit(String(name), Boolean(value), Boolean(release)));
}));
router.post("/plc/release-all", safe(async (req, res) => { const b = bridgeOr503(res); if (!b) return; answer(res, await b.releaseAllForces()); }));
router.post("/plc/reset-fault", safe(async (req, res) => { const b = bridgeOr503(res); if (!b) return; answer(res, await b.resetFault()); }));
router.post("/plc/load", safe(async (req, res) => { const b = bridgeOr503(res); if (!b) return; const r = await b.loadProgram(""); answer(res, { ...r, message: plain(r.message) }); }));
router.get("/plc/sim", (req, res) => { const b = bridgeOr503(res); if (!b) return; res.json({ simulated: b.simulated, panel: b.simPanel() }); });
router.post("/plc/sim/input", (req, res) => {
  const b = bridgeOr503(res); if (!b) return;
  const { name, value, pulse_ms } = req.body || {};
  if (!name) return fail(res, 400, "name is required");
  answer(res, pulse_ms ? b.simPulseInput(String(name), Number(pulse_ms)) : b.simSetInput(String(name), Boolean(value)));
});
router.post("/plc/sim/supervisor", safe(async (req, res) => { const b = bridgeOr503(res); if (!b) return; answer(res, await b.simSupervisor(String(req.body?.cmd || ""), req.body?.value)); }));
router.post("/plc/sim/inputs-stale", (req, res) => { const b = bridgeOr503(res); if (!b) return; answer(res, b.simInputsStale(Boolean(req.body?.stale))); });

// ================= block library =================
function describeBlock(file, source) {
  const text = fs.readFileSync(file, "utf8");
  let meta = {};
  try { meta = YAML.parse(text) || {}; } catch { meta = {}; }
  const ports = Object.entries(meta.ports || {}).map(([name, def]) => {
    const d = typeof def === "object" && def ? def : { kind: String(def) };
    return { name, kind: String(d.kind || "in"), optional: Boolean(d.optional), default: d.default !== undefined ? String(d.default) : "" };
  });
  const locals = Object.entries(meta.locals || {}).map(([name, area]) => ({ name, area: String(area) }));
  // the comment head of the file is the documentation
  const doc = text.split("\n").filter((l) => l.startsWith("#")).map((l) => l.replace(/^#\s?/, "")).join("\n");
  return {
    name: path.basename(file, ".yaml"), source, description: String(meta.description || ""), ports, locals,
    rungs: Array.isArray(meta.rungs) ? meta.rungs.length : 0, sequences: Array.isArray(meta.sequences) ? meta.sequences.length : 0, alarms: Array.isArray(meta.alarms) ? meta.alarms.length : 0,
    exempt: meta.safe_state?.exempt || [], retain: meta.retain || [], doc, text,
  };
}
function listBlocks() {
  const out = [];
  const seen = new Set();
  for (const [dir, source] of [[USER_BLOCKS_DIR, "user"], [LIB_BLOCKS_DIR, "library"]]) {
    if (!dir || !fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".yaml")).sort()) {
      const name = f.slice(0, -5);
      if (seen.has(name)) continue;
      seen.add(name);
      try { out.push(describeBlock(path.join(dir, f), source)); } catch (e) { out.push({ name, source, error: e.message, ports: [], locals: [] }); }
    }
  }
  return out;
}
router.get("/blocks", safe((req, res) => res.json({ blocks: listBlocks() })));
router.get("/blocks/:name", safe((req, res) => {
  const b = listBlocks().find((x) => x.name === req.params.name);
  if (!b) return fail(res, 404, "block not found");
  res.json({ ok: true, block: b });
}));
/** Save one of your own blocks (robot folder, shared by every project). Body: { text } */
router.put("/blocks/:name", safe((req, res) => {
  const name = String(req.params.name);
  if (!BLOCK_RE.test(name)) return fail(res, 400, "block name: letters, digits and _");
  fs.mkdirSync(USER_BLOCKS_DIR, { recursive: true });
  fs.writeFileSync(path.join(USER_BLOCKS_DIR, `${name}.yaml`), String(req.body?.text ?? ""));
  res.json({ ok: true, name });
}));
router.delete("/blocks/:name", safe((req, res) => {
  const p = path.join(USER_BLOCKS_DIR, `${path.basename(req.params.name)}.yaml`);
  if (!fs.existsSync(p)) return fail(res, 404, "only your own blocks can be deleted");
  fs.unlinkSync(p);
  res.json({ ok: true });
}));
/**
 * A block under construction: the text is written to a temporary folder and used by a wrapper
 * program `blocks: - {use: <tmp>/<name>.yaml, as: <as>, with: {...}}`, exactly how the loader
 * expands it in a real program. check = the loader's verdict + the expanded rungs; test = a
 * scenario against the wrapper.
 */
function wrapper(name, text, as, withMap) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nextplc-block-"));
  const file = path.join(dir, `${name}.yaml`);
  fs.writeFileSync(file, text);
  const withStr = Object.entries(withMap || {}).filter(([, v]) => v !== "" && v != null).map(([k, v]) => `${k}: ${v}`).join(", ");
  const program = `program: test_${name}\nblocks:\n  - {use: ${file}, as: ${as || name}${withStr ? `, with: {${withStr}}` : ""}}\n`;
  return { dir, file, program, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}
const hideTmp = (s, w) => String(s || "").replaceAll(w.file, path.basename(w.file, ".yaml")).replaceAll(w.dir, "");
router.post("/blocks/:name/check", safe((req, res) => {
  const name = String(req.params.name);
  if (!BLOCK_RE.test(name)) return res.status(400).json({ ok: false, error: "block name: letters, digits and _" });
  const w = wrapper(name, String(req.body?.text ?? ""), req.body?.as, req.body?.with);
  try {
    const r = loadText(w.program, "test.yaml");
    if (!r.ok) return res.json({ ok: false, error: hideTmp(r.error || r.err, w), program: hideTmp(w.program, w) });
    res.json({ ok: true, program: hideTmp(w.program, w), description: JSON.parse(hideTmp(JSON.stringify(describeProgram(r.program)), w)) });
  } finally { w.cleanup(); }
}));
router.post("/blocks/:name/test", safe(async (req, res) => {
  const name = String(req.params.name);
  if (!BLOCK_RE.test(name)) return res.status(400).json({ ok: false, error: "block name: letters, digits and _" });
  const w = wrapper(name, String(req.body?.text ?? ""), req.body?.as, req.body?.with);
  try {
    const t0 = Date.now();
    const r = await simulateProgram(w.program, "test.yaml", String(req.body?.scenario ?? ""), { csv: false });
    res.json({ ...r, error: hideTmp(r.error, w), log: (r.log || []).map((l) => hideTmp(l, w)), program: hideTmp(w.program, w), took_ms: Date.now() - t0 });
  } finally { w.cleanup(); }
}));

// ================= scenarios =================
router.get("/sim/scenarios", safe((req, res) => {
  ensureDirs();
  const list = fs.readdirSync(SCENARIOS_DIR).filter((f) => SIM_RE.test(f)).sort().map((f) => ({ name: f, label: plain(f), modified: fs.statSync(path.join(SCENARIOS_DIR, f)).mtimeMs }));
  res.json({ scenarios: list });
}));
router.get("/sim/scenarios/:name", safe((req, res) => {
  const n = safeScenario(req.params.name);
  if (!n) return fail(res, 400, "bad scenario name");
  const p = path.join(SCENARIOS_DIR, n);
  if (!fs.existsSync(p)) return fail(res, 404, `${plain(n)} not found`);
  res.json({ ok: true, name: n, text: read(p) });
}));
router.put("/sim/scenarios/:name", safe((req, res) => {
  const n = safeScenario(req.params.name);
  if (!n) return fail(res, 400, "bad scenario name");
  fs.mkdirSync(SCENARIOS_DIR, { recursive: true });
  fs.writeFileSync(path.join(SCENARIOS_DIR, n), String(req.body?.text ?? ""));
  res.json({ ok: true, name: n });
}));
router.delete("/sim/scenarios/:name", safe((req, res) => {
  const n = safeScenario(req.params.name);
  if (!n) return fail(res, 400, "bad name");
  const p = path.join(SCENARIOS_DIR, n);
  if (fs.existsSync(p)) fs.unlinkSync(p);
  res.json({ ok: true });
}));
/** Run. Body: { program: text, name: program name, scenario: text, csv?: bool } */
router.post("/sim/run", safe(async (req, res) => {
  const { program, name, scenario, csv } = req.body || {};
  if (typeof program !== "string" || typeof scenario !== "string") return res.status(400).json({ ok: false, error: "program and scenario texts are required" });
  const n = safeProgram(name) || "program.yaml";
  const t0 = Date.now();
  const r = await simulateProgram(program, n === PROJECT_NAME ? "program.yaml" : n, scenario, { csv: Boolean(csv), sourcePath: programFile(n) });
  res.json({ ...r, took_ms: Date.now() - t0 });
}));

// ================= manuals =================
// Help leaves out the simulator: its own manual and the simulator part of the other manuals (the
// Monitor page and its Commission tab do that job in the console).
const SIM_DOC = /simulat/i;
const TITLES = { "LOGIC.md": "How to write the logic", "BLOCKS.md": "The block library", "NEXTPLC_MANUAL.md": "Full manual" };
const ORDER = ["LOGIC.md", "BLOCKS.md", "NEXTPLC_MANUAL.md"];
function withoutSimulator(text) {
  const out = [];
  let skip = 0; // heading level of the part being skipped (0 = none)
  let fence = false;
  for (const l of text.split("\n")) {
    if (/^\s*```/.test(l)) fence = !fence;
    const h = !fence && /^(#{1,6})\s+(.*)$/.exec(l);
    if (h) {
      const level = h[1].length;
      if (skip && level <= skip) skip = 0;
      if (!skip && SIM_DOC.test(h[2])) { skip = level; continue; }
    }
    if (!skip) out.push(l);
  }
  return out.join("\n");
}
function listDocs() {
  if (!fs.existsSync(DOCS_DIR)) return [];
  return fs.readdirSync(DOCS_DIR).filter((f) => f.endsWith(".md") && !SIM_DOC.test(f))
    .sort((a, b) => (ORDER.indexOf(a) + 1 || 99) - (ORDER.indexOf(b) + 1 || 99) || a.localeCompare(b))
    .map((f) => ({ id: plain(f.replace(/\.md$/, "")), name: f, title: TITLES[f] || f.replace(/\.md$/, "").replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase()) }));
}
router.get("/docs", safe((req, res) => res.json({ docs: listDocs() })));
router.get("/docs/:name", safe((req, res) => {
  const d = listDocs().find((x) => x.name === req.params.name || x.id === req.params.name);
  if (!d) return fail(res, 404, "manual not found");
  res.json({ ok: true, ...d, text: withoutSimulator(read(path.join(DOCS_DIR, d.name)) || "") });
}));

// ================= mode and paths =================
router.get("/system/mode", (req, res) => res.json(getManager()?.status() || { mode: "sim", ready: false }));
router.post("/system/mode", safe(async (req, res) => {
  const m = getManager();
  if (!m) return fail(res, 503, "the PLC is starting");
  const r = await m.setMode(String(req.body?.mode || ""));
  res.status(r.ok ? 200 : 400).json({ ...r, status: m.status() });
}));

/** For Settings › System only: where the NextPLC files are. */
export function plcPaths() {
  return [
    { label: "NextPLC program (this project)", path: PROJECT_PROGRAM },
    { label: "NextPLC retained registers (this project)", path: PROJECT_RETAIN },
    { label: "NextPLC program library (every project)", path: PROGRAMS_DIR },
    { label: "NextPLC test scenarios (every project)", path: SCENARIOS_DIR },
    { label: "NextPLC own blocks (every project)", path: USER_BLOCKS_DIR },
    { label: `NextPLC package${PKG_BUNDLED ? " (bundled copy)" : ""}`, path: PKG_DIR },
    { label: "NextPLC console state", path: STATE_DIR },
    { label: "NextPLC check / simulate tools", path: [CHECK_BIN, SIM_BIN].filter(Boolean).join(", ") || "not installed (JS engine used)" },
  ];
}

export default router;
