// Diagnostics summary: fetches every source once (robot state, supervisor events,
// drive errors, fault counters, motion log, black box, PLC, system) and boils it
// down to findings plus a few short sections. Each source may fail on its own;
// the summary says which ones did not answer.
import { api } from "../../lib/api";
import { robotApi } from "../../lib/robotApi";
import { useConnection } from "../../lib/ws";
import { useRobot } from "../../store/robot";
import { REST_LIMITS } from "../../layout/SystemInfo";

const DAY = 24 * 3600 * 1000;
const SOURCES = {
  state: ["Robot state", () => robotApi.state()],
  events: ["Supervisor events", () => robotApi.events({ max: 1000 })],
  errors: ["Drive errors", () => robotApi.errors({ max: 1000 })],
  counters: ["Fault counters", () => robotApi.faultCounters()],
  motions: ["Motion log", () => robotApi.motionLog(300)],
  blackbox: ["Black box", () => robotApi.blackbox()],
  plc: ["PLC", () => api.get("/plc-api/plc/status")],
  plcMode: ["PLC mode", () => api.get("/plc-api/system/mode")],
  uptime: ["System", () => api.get("/uptime", { retry: false })],
  bridge: ["Robot connection", () => api.get("/system/bridge")],
  project: ["Project", () => api.get("/api/projects/active")],
};

const causeGroup = (c = "") => c.replace(/\s*\(joint\d+\)\s*$/i, "").split(/\s+[-–]\s+/)[0].trim() || "emergency";
const isEmergencyEvent = (e) => /emergency|estop/i.test(e.event || "") && !/released|cleared/i.test(e.event || "");
const isFaultEvent = (e) => /fault_raised|error_raised|^fault$|^error$/i.test(e.event || "");
const isRejected = (e) => e.event === "request_rejected" || (e.event === "request_result" && e.extra?.result && !/^(success|ok|done)/i.test(e.extra.result));

export async function compileSummary() {
  const keys = Object.keys(SOURCES);
  const settled = await Promise.allSettled(keys.map((k) => SOURCES[k][1]()));
  const d = {};
  const missing = [];
  settled.forEach((r, i) => {
    if (r.status === "fulfilled") d[keys[i]] = r.value;
    else missing.push(SOURCES[keys[i]][0]);
  });
  const live = useRobot.getState();
  const connected = useConnection.getState().status === "open";
  const now = Date.now();

  const sup = d.state?.supervisor || live.supervisor || null;
  const motion = d.state?.motion || live.motion || null;
  const runner = d.state?.btRunner || live.btRunnerStatus || null;
  const events = d.events?.entries || [];
  const errors = d.errors?.entries || [];
  const motions = d.motions?.entries || [];
  const counters = d.counters?.counters || [];
  const bb = d.blackbox?.files || [];
  const recent = (list) => list.filter((e) => e.stamp && now - e.stamp < DAY);

  // ---- joints
  const names = sup?.names?.length ? sup.names : ["joint1", "joint2", "joint3", "joint4", "joint5", "joint6"];
  const joints = names.map((name, i) => {
    const c = counters.find((x) => x.joint === name) || {};
    const lastErr = errors.find((e) => e.joint === name && e.lastError);
    return {
      name,
      state: live.driveStates?.[i] || "",
      fault: Boolean(live.fault?.[i]),
      emergency: Boolean(live.emergency?.[i]),
      isolated: Boolean(sup?.isolated?.[i]),
      faults: c.faults || 0,
      errors: c.errors || 0,
      lastError: lastErr ? { hex: lastErr.codeHex, description: lastErr.description, time: lastErr.time, detail: lastErr.detail } : null,
      liveCode: live.lastError?.[i] || 0,
    };
  });

  // ---- activity
  const emergencies = events.filter(isEmergencyEvent);
  const faults = [...events.filter(isFaultEvent), ...errors.filter((e) => /raised|fault/i.test(e.event || "") && e.lastError)].sort((a, b) => (b.stamp || 0) - (a.stamp || 0));
  const rejected = events.filter(isRejected);
  const failedMotions = motions.filter((m) => /failed|aborted|rejected/i.test(m.state || ""));
  const okMotions = motions.filter((m) => /succeeded|success/i.test(m.state || ""));
  const activity = {
    day: { emergencies: recent(emergencies).length, faults: recent(faults).length, rejected: recent(rejected).length, motionsOk: recent(okMotions).length, motionsFailed: recent(failedMotions).length, recordings: bb.filter((f) => now - (Date.parse(String(f.trigger).replace(" ", "T")) || f.mtime) < DAY).length },
    lastEmergency: emergencies[0] || null,
    lastFault: faults[0] || null,
    lastRejected: rejected[0] || null,
    lastFailedMotion: failedMotions[0] || null,
    lastMotion: motions[0] || null,
    lastRecording: bb[0] || null,
    totals: { events: d.events?.total ?? events.length, errors: d.errors?.total ?? errors.length, motions: motions.length, recordings: bb.length },
    causes: Object.entries(bb.reduce((m, f) => ((m[causeGroup(f.cause)] = (m[causeGroup(f.cause)] || 0) + 1), m), {})).sort((a, b) => b[1] - a[1]).slice(0, 5),
  };

  // ---- PLC
  const ps = d.plc?.state || null;
  const plc = d.plc
    ? {
        mode: d.plcMode?.mode || (d.plc.simulated ? "sim" : "robot"),
        program: d.plc.program?.name || ps?.program || "",
        ok: d.plc.program ? d.plc.program.ok !== false : Boolean(ps?.program_ok),
        error: d.plc.program?.error || "",
        rungs: d.plc.program?.rung_count ?? ps?.rungs?.length ?? 0,
        sequences: d.plc.program?.sequence_count ?? ps?.seqs?.length ?? 0,
        scanMs: ps?.scan_time_ms,
        periodMs: ps?.scan_period_ms,
        forced: ps?.forced_count || 0,
        safe: Boolean(ps?.safe_state),
        alarms: (d.plc.alarms || []).slice(-5).reverse(),
        sequenceSteps: (ps?.seqs || []).map((s) => ({ name: s.name, step: s.step, stepName: s.step_name })),
        ready: d.plc.ready !== false,
      }
    : null;

  // ---- system
  const up = d.uptime || null;
  const loads = Array.isArray(up?.load) ? up.load : String(up?.loadAverage || "").split(/[\s,]+/).filter(Boolean).map(Number);
  const system = {
    connected,
    simulated: Boolean(d.bridge?.simulated),
    rosReady: d.bridge ? d.bridge.ready !== false : null,
    uptimeSeconds: up?.uptimeSeconds ?? null,
    uptimeText: up?.uptime || "",
    load5: Number.isFinite(loads[1]) ? loads[1] : null,
    project: d.project?.active_project || "",
  };

  // ---- findings: most serious first
  const F = [];
  const add = (level, text, hint) => F.push({ level, text, hint });
  if (!connected) add("crit", "The browser lost the connection to the robot server", "Values below may be old. Check the network or reload the web app.");
  if (sup?.latched || sup?.estop || live.emergency?.some(Boolean)) add("crit", `Emergency stop is active${sup?.cause ? `: ${sup.cause}` : ""}${sup?.causeJoint ? ` (${sup.causeJoint})` : ""}`, "Remove the cause, then press Reset in the top bar.");
  const faulted = joints.filter((j) => j.fault);
  if (sup?.anyFault || faulted.length) add("crit", `Drive fault${faulted.length ? ` on ${faulted.map((j) => j.name).join(", ")}` : ""}`, "Look up the code under Fault lookup, then reset.");
  const iso = joints.filter((j) => j.isolated);
  if (iso.length) add("warn", `Isolated from motion: ${iso.map((j) => j.name).join(", ")}`);
  if (sup && !sup.latched && sup.armed === false) add("warn", "Drives are not armed: the robot will not move", sup.phase ? `Supervisor phase: ${sup.phase}` : "");
  if (motion?.error && motion.error !== "E_OK" && !motion.active) add("warn", `Last motion ended with ${motion.error}`, motion.message || "");
  if (runner?.lastFailure) add("warn", `The robot program stopped on a failure${runner.lastFailure.node ? ` at "${runner.lastFailure.node}"` : ""}`, runner.lastFailure.reason || "");
  if (plc && !plc.ok) add("warn", "The PLC refused its program", plc.error);
  if (plc?.safe) add("warn", "The PLC holds its outputs in the safe state");
  if (plc?.forced) add("warn", `${plc.forced} PLC bit${plc.forced === 1 ? " is" : "s are"} forced`, "Forced bits ignore the program. Release them on NextPLC › Monitor when done.");
  const errAlarms = (plc?.alarms || []).filter((a) => a.active !== false && /error/i.test(a.level || ""));
  if (errAlarms.length) add("warn", `PLC alarm: ${errAlarms[0].text}${errAlarms.length > 1 ? ` (+${errAlarms.length - 1})` : ""}`);
  if (system.uptimeSeconds != null && system.uptimeSeconds >= REST_LIMITS.uptimeWarnH * 3600) add(system.uptimeSeconds >= REST_LIMITS.uptimeCritH * 3600 ? "crit" : "warn", `Robot PC running for ${Math.floor(system.uptimeSeconds / 3600)} hours without a restart`, "Give the robot a rest and restart the PC when production allows.");
  if (system.load5 != null && system.load5 >= REST_LIMITS.loadWarn) add(system.load5 > REST_LIMITS.loadCrit ? "crit" : "warn", `High system load (${system.load5.toFixed(1)})`, "Close extra pages and tools; motion can lag.");
  if (activity.day.emergencies) add("info", `${activity.day.emergencies} emergenc${activity.day.emergencies === 1 ? "y" : "ies"} in the last 24 hours`);
  if (activity.day.motionsFailed) add("info", `${activity.day.motionsFailed} failed motion${activity.day.motionsFailed === 1 ? "" : "s"} in the last 24 hours`);
  const counted = joints.filter((j) => j.faults);
  if (counted.length) add("info", `Fault counters: ${counted.map((j) => `${j.name} ${j.faults}`).join(", ")}`);
  if (missing.length) add("info", `Not available: ${missing.join(", ")}`);
  const order = { crit: 0, warn: 1, info: 2 };
  F.sort((a, b) => order[a.level] - order[b.level]);
  const verdict = F.some((f) => f.level === "crit") ? "crit" : F.some((f) => f.level === "warn") ? "warn" : "ok";

  return {
    at: now,
    verdict,
    findings: F,
    robot: {
      profile: sup?.profile || live.mode || "",
      phase: sup?.phase || "",
      armed: sup?.armed,
      latched: Boolean(sup?.latched),
      estop: Boolean(sup?.estop),
      cause: sup?.cause || "",
      standstill: sup?.standstill,
      allEnabled: sup?.allEnabled,
      speed: sup?.speedOverride,
      atHome: d.state?.atHome || live.atHome || null,
      motion,
      runner,
    },
    joints,
    activity,
    plc,
    system,
    missing,
  };
}

const fmtSecs = (s) => {
  if (s == null) return "–";
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  return d ? `${d} d ${h} h` : h ? `${h} h ${m} min` : `${m} min`;
};
export { fmtSecs };

/** Plain text of the summary (Copy button), for a message to service. */
export function summaryText(s) {
  const L = [];
  L.push(`NextUp diagnostics summary · ${new Date(s.at).toLocaleString()}`);
  L.push(`Overall: ${s.verdict === "ok" ? "healthy" : s.verdict === "warn" ? "needs attention" : "action needed"}`);
  s.findings.forEach((f) => L.push(`  [${f.level}] ${f.text}${f.hint ? ` — ${f.hint}` : ""}`));
  const r = s.robot;
  L.push("", "Robot", `  mode ${r.profile || "–"} · ${r.armed ? "armed" : "not armed"} · ${r.latched || r.estop ? `EMERGENCY ${r.cause}` : "no emergency"} · speed ${r.speed ?? "–"} %`);
  if (r.runner) L.push(`  program ${r.runner.state || "–"} · cycles ${r.runner.cyclesDone ?? 0}${r.runner.cyclesTotal ? ` (total ${r.runner.cyclesTotal})` : ""}`);
  L.push("", "Joints");
  s.joints.forEach((j) => L.push(`  ${j.name}: ${j.state || "–"}${j.fault ? " FAULT" : ""}${j.isolated ? " isolated" : ""} · faults ${j.faults} · errors ${j.errors}${j.lastError ? ` · last ${j.lastError.hex} ${j.lastError.description || ""} (${j.lastError.time})` : ""}`));
  const a = s.activity;
  L.push("", "Last 24 hours", `  emergencies ${a.day.emergencies} · faults ${a.day.faults} · rejected requests ${a.day.rejected} · motions ok ${a.day.motionsOk} / failed ${a.day.motionsFailed} · recordings ${a.day.recordings}`);
  if (a.lastEmergency) L.push(`  last emergency ${a.lastEmergency.time}: ${a.lastEmergency.detail || a.lastEmergency.event}`);
  if (a.lastRecording) L.push(`  last recording ${a.lastRecording.trigger}: ${a.lastRecording.cause}`);
  if (s.plc) L.push("", "PLC", `  ${s.plc.mode} · ${s.plc.program || "no program"} ${s.plc.ok ? "running" : "REFUSED"} · forced ${s.plc.forced}${s.plc.safe ? " · SAFE STATE" : ""}`);
  const y = s.system;
  L.push("", "System", `  up ${fmtSecs(y.uptimeSeconds)} · load ${y.load5 ?? "–"} · ${y.simulated ? "simulated robot" : "real robot"} · project ${y.project || "–"}`);
  return L.join("\n");
}
