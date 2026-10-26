// plc/ioUsage.js -- which digital inputs and outputs the PLC program uses, for the
// "used by PLC" marks on IO Control and the operator panel.
//
// The program is the one the PLC runs: the simulator's loaded program, else the file
// the robot's PLC reports, else this project's program. Every I / Q address found in
// a rung, sequence, alarm or block counts; an output the program writes is "driven"
// (a manual change is overwritten on the next scan), any other use is "read".
// Computed once per program: the answer is cached until another program is loaded or the
// file changes (every IO card asks for it).
import fs from "node:fs";
import { PROJECT_PROGRAM } from "./paths.js";
import { loadText } from "./tools.js";
import { addressName, addrKey } from "./engine/image.js";

const isIo = (v) => v && typeof v === "object" && (v.area === "I" || v.area === "Q") && Number.isInteger(v.index);

/** Every I/Q address inside a value (expression trees, targets, lists). */
function collect(v, out, seen = new WeakSet()) {
  if (!v || typeof v !== "object" || seen.has(v)) return out;
  seen.add(v);
  if (isIo(v)) {
    out.set(addrKey(v), v);
    return out;
  }
  for (const k of Object.keys(v)) {
    if (k === "ton" || k === "tof" || k === "tp" || k === "counter" || k === "toggle_edge") continue; // runtime state
    collect(v[k], out, seen);
  }
  return out;
}

function currentProgram(bridge) {
  if (bridge?.simulated && bridge.engine?.program) return { program: bridge.engine.program, from: "loaded" };
  const file = bridge?.programInfo?.path && fs.existsSync(bridge.programInfo.path) ? bridge.programInfo.path : PROJECT_PROGRAM;
  let text = null;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return { program: null, from: "none" };
  }
  const r = loadText(text, file);
  return r.ok ? { program: r.program, from: file === PROJECT_PROGRAM ? "project" : "loaded" } : { program: null, from: "error", error: r.err };
}

let cache = { key: null, value: null };

/** What identifies the program the answer is for (no file is read or parsed). */
function programKey(bridge) {
  if (bridge?.simulated && bridge.engine?.program) return bridge.engine.program;
  const file = bridge?.programInfo?.path && fs.existsSync(bridge.programInfo.path) ? bridge.programInfo.path : PROJECT_PROGRAM;
  let mtime = 0;
  try { mtime = fs.statSync(file).mtimeMs; } catch { /* none */ }
  return `${file}|${mtime}`;
}

export function ioUsage(bridge) {
  const key = programKey(bridge);
  if (cache.value && cache.key === key) return cache.value;
  const value = computeIoUsage(bridge);
  cache = { key, value };
  return value;
}

function computeIoUsage(bridge) {
  const { program: p, from, error } = currentProgram(bridge);
  if (!p) return { ok: true, program: "", from, error: error || "", signals: {} };
  const signals = {};
  const add = (a, where, write) => {
    const name = addressName(a);
    const alias = p.alias_of?.get(addrKey(a))?.alias || "";
    const s = (signals[name] ||= { name, kind: a.area === "I" ? "di" : "do", alias, driven: false, uses: [] });
    if (write) s.driven = true;
    if (s.uses.length < 8 && !s.uses.includes(where)) s.uses.push(where);
  };
  p.rungs.forEach((r, i) => {
    const where = `${r.block ? `${r.block}: ` : ""}rung ${i + 1}${r.text ? ` (${String(r.text).slice(0, 60)})` : ""}`;
    const writes = r.target ? addrKey(r.target) : "";
    for (const [k, a] of collect(r, new Map())) add(a, where, k === writes && r.type !== "move" && r.type !== "calc");
  });
  p.sequences.forEach((s) => {
    const where = `${s.block ? `${s.block}: ` : ""}sequence ${s.name}`;
    const outs = new Set((s.outputs || []).map(addrKey));
    for (const [k, a] of collect(s, new Map())) add(a, where, outs.has(k));
  });
  p.alarms.forEach((al) => {
    if (isIo(al.bit)) add(al.bit, `alarm "${al.text}"`, false);
  });
  // whatever the program controls (used_q) is driven, even if a rung above was missed
  (p.used_q || []).forEach((u, q) => {
    if (!u) return;
    const a = { area: "Q", index: q, sub: 0 };
    if (signals[addressName(a)]) signals[addressName(a)].driven = true;
    else add(a, "controlled by the program", true);
  });
  return { ok: true, program: p.name || "", from, signals };
}
