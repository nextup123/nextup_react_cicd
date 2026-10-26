// plc/tools.js -- check and simulate a program: with the real nextplc_check / nextplc_sim binaries
// when they are installed (colcon build + source), otherwise with the JS engine. Both give the
// same verdicts; the binaries are the reference, the JS engine works on any PC.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { Loader, Engine, runScenario, simSummary, formatLogLine, explainProgram } from "./engine/index.js";
import { CHECK_BIN, SIM_BIN, blockDirs } from "./paths.js";

const readFile = (p) => { try { return fs.readFileSync(p, "utf8"); } catch { return null; } };
export const loaderOpts = (sourcePath) => ({ readFile, blockDirs: blockDirs(path.isAbsolute(sourcePath || "") ? sourcePath : ""), sourcePath });

/** Program text -> the loaded program (JS engine) or an error. */
export function loadText(text, name = "program.yaml") {
  return Loader.fromTextNamed(text, name, loaderOpts(name));
}

/** Serializable description of a loaded program for the UI (rungs, sequences, alarms, blocks, ownership). */
export function describeProgram(p) {
  const N = (a) => p.displayName(a);
  return {
    name: p.name,
    scan_ms: p.scan_ms,
    rung_count: p.rungs.length,
    sequence_count: p.sequences.length,
    alarm_count: p.alarms.length,
    has_emergency: p.has_emergency,
    controls: p.used_q.map((u, q) => (u ? q : -1)).filter((q) => q >= 0).map((q) => p.canonicalName({ area: "Q", index: q, sub: 0 })),
    rungs: p.rungs.map((r, i) => ({ index: i, line: r.line, yaml_line: r.yaml_line ?? r.line, type: r.type, text: r.text, block: r.block || "", target: r.target ? N(r.target) : "", target_raw: r.target ? p.canonicalName(r.target) : "" })),
    sequences: p.sequences.map((s, i) => ({ index: i, line: s.line, name: s.name, block: s.block || "", start: s.src.start, abort: s.src.abort, steps: s.steps.map((st, j) => ({ index: j + 1, name: st.name, line: st.line, do: st.outputs.map(N), next: st.src.next, timeout: st.src.timeout || "", on_timeout: st.on_timeout ? N(st.on_timeout) : "" })) })),
    alarms: p.alarms.map((a) => ({ line: a.line, bit: N(a.bit), text: a.text, level: a.level, toast: a.toast, block: a.block || "" })),
    aliases: p.aliasTable(),
    retain: p.retain.map(N),
    safe: p.safe.value.map((v, q) => ({ name: p.canonicalName({ area: "Q", index: q, sub: 0 }), value: v ? 1 : 0, exempt: p.safe.exempt[q], controlled: p.used_q[q] })),
    blocks: p.blocks.map((b) => ({ block: b.block, as: b.as, file: b.file, description: b.description, line: b.line, ports: b.ports.map(([k, v]) => ({ port: k, value: v })), locals: b.locals.map(([k, a]) => ({ local: k, address: p.canonicalName(a) })), first_rung: b.first_rung, rung_count: b.rung_count })),
    owners: [...p.owners.entries()].map(([k, who]) => { const [area, index, sub] = k.split(":"); return { bit: p.displayName({ area, index: Number(index), sub: Number(sub) }), who }; }),
    explain: explainProgram(p).map((l) => ({
      line: l.line,
      rungs: l.rungs.map((x) => ({ index: x.index, type: x.rung.type, text: x.rung.text, ...x.explanation })),
      sequences: l.sequences.map((x) => ({ index: x.index, ...x.explanation })),
      alarms: l.alarms.map((x) => ({ index: x.index, ...x.explanation })),
      blocks: l.blocks.map((x) => ({ index: x.index, as: x.block.as, block: x.block.block, description: x.block.description, rungs: x.rungs.map((y) => ({ index: y.index, type: y.rung.type, text: y.rung.text, ...y.explanation })), sequences: x.sequences.map((y) => ({ index: y.index, ...y.explanation })) })),
    })),
  };
}

function run(bin, args, { timeoutMs = 20000 } = {}) {
  return new Promise((resolve) => {
    execFile(bin, args, { timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({ code: err && typeof err.code === "number" ? err.code : err ? 1 : 0, stdout: String(stdout || ""), stderr: String(stderr || "") });
    });
  });
}
function tmpFile(name, text) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nextplc-web-"));
  const p = path.join(dir, name);
  fs.writeFileSync(p, text);
  return { path: p, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

/**
 * Check a program text. Returns { ok, error, tool: 'nextplc_check'|'js', output, program? (described) }.
 * The JS engine always runs (it gives the structured description); the binary adds its verdict.
 */
export async function checkProgram(text, name = "program.yaml", sourcePath = "") {
  const js = loadText(text, sourcePath || name);
  const out = { ok: js.ok, error: js.ok ? "" : js.err, tool: "js", output: "", program: js.ok ? describeProgram(js.program) : null, yaml: js.yaml || "" };
  if (CHECK_BIN) {
    const f = tmpFile(path.basename(name), text);
    try {
      const args = [];
      for (const d of blockDirs(sourcePath)) args.push("--blocks", d);
      const r = await run(CHECK_BIN, [...args, f.path]);
      out.tool = "nextplc_check";
      out.output = (r.stdout + r.stderr).replace(new RegExp(f.path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"), name);
      if (r.code !== 0) { out.ok = false; out.error = out.output.trim().replace(/^.*?: /, "") || out.error; }
    } finally { f.cleanup(); }
  }
  return out;
}

/** Simulate: returns { ok (ran), passed, summary, log: [strings], checks, csv, tool, error } */
export async function simulateProgram(programText, programName, scenarioText, { csv = false, sourcePath = "" } = {}) {
  if (SIM_BIN) {
    const f = tmpFile(path.basename(programName || "program.yaml"), programText);
    const s = tmpFile("scenario.sim", scenarioText);
    try {
      const args = [];
      for (const d of blockDirs(sourcePath)) args.push("--blocks", d);
      const csvPath = csv ? path.join(path.dirname(f.path), "trace.csv") : null;
      if (csvPath) args.push("--csv", csvPath);
      const r = await run(SIM_BIN, [...args, f.path, s.path]);
      const lines = (r.stdout + r.stderr).split("\n").filter(Boolean);
      const summaryLine = lines.find((l) => l.startsWith("RESULT:")) || "";
      const checks = lines.filter((l) => /^\s*\d+ ms\s+(OK|FAIL)\s/.test(l)).map((l) => ({ ok: /\sOK\s/.test(l), text: l.replace(/^\s*\d+ ms\s+(OK|FAIL)\s+/, ""), t_ms: Number(/^\s*(\d+) ms/.exec(l)[1]) }));
      return { ok: r.code !== 2, passed: r.code === 0, summary: summaryLine.replace(/^RESULT:\s*/, ""), log: lines.filter((l) => !l.startsWith("RESULT:") && !l.startsWith("program ")), checks, csv: csvPath && fs.existsSync(csvPath) ? fs.readFileSync(csvPath, "utf8") : "", tool: "nextplc_sim", error: r.code === 2 ? lines[lines.length - 1] : "" };
    } finally { f.cleanup(); s.cleanup(); }
  }
  const js = loadText(programText, sourcePath || programName);
  if (!js.ok) return { ok: false, passed: false, summary: "", log: [], checks: [], csv: "", tool: "js", error: js.err };
  const eng = new Engine();
  eng.load(js.program);
  const r = runScenario(eng, scenarioText, { csv });
  const log = r.result.log.map(formatLogLine);
  if (!r.ok) return { ok: false, passed: false, summary: "", log, checks: r.result.checks, csv: "", tool: "js", error: r.err };
  return { ok: true, passed: r.result.ok, summary: simSummary(r.result), log, checks: r.result.checks, csv: r.result.csv, tool: "js", error: "" };
}
