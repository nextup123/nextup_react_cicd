// explain.js -- the "teacher": explains rungs, sequences and expressions line by line, the way a
// PLC teacher would ("if gpio1.di1 is 1 AND S.AUTO is 1, then gpio1.do1 goes 1"). Raw addresses
// first; an alias is shown in brackets after the address.

import { addressName, addrKey } from "./image.js";

const msText = (s) => {
  const ms = Math.round(s * 1000);
  if (ms >= 60000 && ms % 60000 === 0) return `${ms / 60000} min`;
  if (ms >= 1000 && ms % 100 === 0) return `${ms / 1000} s`;
  return `${ms} ms`;
};

/** "gpio1.di5 (door)" -- raw address first, alias in brackets. */
export function nameOf(a, program) {
  const raw = program ? program.canonicalName(a) : addressName(a);
  const al = program && program.alias_of.get(addrKey(a));
  return al && al.alias !== raw ? `${raw} (${al.alias})` : raw;
}

function seqName(a, program) {
  const s = program && program.sequences[a.index];
  return s ? s.name : `#${a.index}`;
}

/** Explain an expression node. level: 'top' adds no brackets, nested adds them where needed. */
export function explainExpr(e, program, nested = false) {
  if (!e) return "always";
  const wrap = (s) => (nested ? `(${s})` : s);
  switch (e.kind) {
    case "const":
      return typeof e.v === "boolean" ? (e.v ? "always" : "never") : String(e.v);
    case "ref": {
      const a = e.a;
      if (a.area === "R") return nameOf(a, program);
      if (a.area === "SEQ_ACTIVE") return `sequence ${seqName(a, program)} is running`;
      if (a.area === "SEQ_STEP") return `the step number of sequence ${seqName(a, program)}`;
      if (a.area === "SEQ_STEPBIT") {
        const s = program && program.sequences[a.index];
        const st = s && s.steps[a.sub - 1];
        return `sequence ${seqName(a, program)} is in step ${st ? `${a.sub} (${st.name})` : a.sub}`;
      }
      return `${nameOf(a, program)} is 1`;
    }
    case "not": {
      const x = e.x;
      if (x.kind === "ref") {
        if (x.a.area === "SEQ_ACTIVE") return `sequence ${seqName(x.a, program)} is idle`;
        if (x.a.area === "SEQ_STEPBIT") return `sequence ${seqName(x.a, program)} is not in that step`;
        if (x.a.area !== "R") return `${nameOf(x.a, program)} is 0`;
      }
      return `NOT (${explainExpr(x, program, false)})`;
    }
    case "and":
      return wrap(`${explainExpr(e.a, program, e.a.kind === "or")} AND ${explainExpr(e.b, program, e.b.kind === "or")}`);
    case "or":
      return wrap(`${explainExpr(e.a, program, false)} OR ${explainExpr(e.b, program, false)}`);
    case "cmp": {
      const ops = { "==": "equals", "!=": "is not", "<": "is less than", "<=": "is at most", ">": "is greater than", ">=": "is at least" };
      return `${explainNum(e.a, program)} ${ops[e.op]} ${explainNum(e.b, program)}`;
    }
    case "rise":
      if (e.x.kind === "ref" && e.x.a.area !== "R") return `the moment ${nameOf(e.x.a, program)} goes 0→1 (one scan)`;
      return `the moment ${explainExpr(e.x, program, e.x.kind === "and" || e.x.kind === "or")} becomes true (0→1, one scan)`;
    case "fall":
      if (e.x.kind === "ref" && e.x.a.area !== "R") return `the moment ${nameOf(e.x.a, program)} goes 1→0 (one scan)`;
      return `the moment ${explainExpr(e.x, program, e.x.kind === "and" || e.x.kind === "or")} stops being true (1→0, one scan)`;
    case "on_for":
      return `${explainExpr(e.x, program, e.x.kind === "or")} and has been for ${e.ms ? `${e.timeText} ms (register)` : msText(e.t.preset_s)} without a break`;
    case "off_for":
      return `${explainExpr(e.x, program, e.x.kind === "or")} has been false for ${e.ms ? `${e.timeText} ms (register)` : msText(e.t.preset_s)} without a break`;
    case "arith":
    case "neg":
      return explainNum(e, program);
    default:
      return "?";
  }
}

export function explainNum(e, program) {
  if (!e) return "?";
  switch (e.kind) {
    case "const": return typeof e.v === "boolean" ? (e.v ? "1" : "0") : String(e.v);
    case "ref": return e.a.area === "SEQ_STEP" ? `the step number of sequence ${seqName(e.a, program)}` : nameOf(e.a, program);
    case "neg": return `-${explainNum(e.x, program)}`;
    case "arith": {
      const l = e.a.kind === "arith" ? `(${explainNum(e.a, program)})` : explainNum(e.a, program);
      const r = e.b.kind === "arith" ? `(${explainNum(e.b, program)})` : explainNum(e.b, program);
      return `${l} ${e.op} ${r}`;
    }
    default: return explainExpr(e, program, true);
  }
}

const timerPreset = (r) => (r.timer_ms ? `${r.timer_text} ms (read from the register every scan)` : msText(r[r.timer].preset_s));

/** Explain one rung -> { title, lines: [...] } */
export function explainRung(r, program) {
  const T = (a) => nameOf(a, program);
  const cond = () => explainExpr(r.when, program);
  // "While <level>" / "At <edge>": an edge condition is a moment, not a state
  const whileCond = () => (r.when && (r.when.kind === "rise" || r.when.kind === "fall") ? `At ${cond()}` : `While ${cond()}`);
  switch (r.type) {
    case "out": {
      const t = T(r.target);
      const lines = [];
      if (r.timer === "none") {
        lines.push(`Every scan: if ${cond()}, then ${t} = 1. Otherwise ${t} = 0.`);
        lines.push(`${t} follows the condition exactly - a coil remembers nothing.`);
      } else if (r.timer === "ton") {
        lines.push(`On-delay (TON, ${timerPreset(r)}): when ${cond()} becomes true the timer starts.`);
        lines.push(`${t} goes 1 only after the condition has stayed true for ${timerPreset(r)} without a break. If the condition drops earlier, the timer restarts from zero and ${t} stays 0.`);
        lines.push(`The moment the condition is false, ${t} = 0 at once.`);
      } else if (r.timer === "tof") {
        lines.push(`Off-delay (TOF, ${timerPreset(r)}): when ${cond()} becomes true, ${t} = 1 at once.`);
        lines.push(`When the condition goes false, ${t} STAYS 1 for ${timerPreset(r)}, then goes 0. If the condition comes back within that time, ${t} never went off.`);
      } else if (r.timer === "tp") {
        lines.push(`Pulse (TP, ${timerPreset(r)}): the moment ${cond()} becomes true, ${t} = 1 for exactly ${timerPreset(r)}, then 0.`);
        lines.push(`What the condition does during the pulse does not matter. A new trigger during the pulse is ignored.`);
      }
      return { title: `${r.type.toUpperCase()} ${t}`, lines, target: t };
    }
    case "set":
      return { title: `SET ${T(r.target)}`, target: T(r.target), lines: [
        `${whileCond()}: ${T(r.target)} = 1.`,
        `When the condition goes false, ${T(r.target)} STAYS 1 (latched). Only a RESET rung can clear it. If a SET and a RESET are both true in the same scan, the rung lower in the program wins.`,
      ] };
    case "reset":
      return { title: `RESET ${T(r.target)}`, target: T(r.target), lines: [
        `${whileCond()}: ${T(r.target)} = 0.`,
        `It stays 0 until a SET rung sets it again.`,
      ] };
    case "toggle":
      return { title: `TOGGLE ${T(r.target)}`, target: T(r.target), lines: [
        `Each time ${cond()} goes from false to true, ${T(r.target)} flips: 0→1, next time 1→0.`,
        `Holding the condition true does not flip it again.`,
      ] };
    case "count": {
      const t = T(r.target);
      const lines = [];
      if (r.up) lines.push(`Every time ${explainExpr(r.up, program)} goes 0→1: ${t} = ${t} + 1.`);
      if (r.down) lines.push(`Every time ${explainExpr(r.down, program)} goes 0→1: ${t} = ${t} - 1.`);
      if (r.reset_expr) lines.push(`While ${explainExpr(r.reset_expr, program)}: ${t} = 0 (level reset).`);
      if (r.preset) lines.push(`${r.has_done ? `${T(r.done)} = 1 while` : "The counter is 'done' while"} ${t} is at least ${explainNum(r.preset, program)}; otherwise 0.`);
      lines.push(`The register IS the counter: the web UI or the BT may write it (for example back to 0) and the rung continues from the new value.`);
      return { title: `COUNT ${t}`, target: t, lines };
    }
    case "move":
      return { title: `MOVE ${T(r.target)}`, target: T(r.target), lines: [
        r.when ? `${whileCond()}: ${T(r.target)} = ${explainNum(r.value, program)}.` : `Every scan: ${T(r.target)} = ${explainNum(r.value, program)}.`,
        r.when ? `When the condition is false the register keeps its last value.` : `Nothing else should write ${T(r.target)}.`,
      ] };
    case "calc":
      return { title: `CALC ${T(r.target)}`, target: T(r.target), lines: [
        r.when ? `While ${cond()}: ${T(r.target)} = ${explainNum(r.value, program)} (recomputed every scan).` : `Every scan: ${T(r.target)} = ${explainNum(r.value, program)}.`,
        `Whole numbers only (int32); a division by zero gives 0, never a crash.`,
      ] };
    case "emergency":
      return { title: "EMERGENCY", target: "robot", lines: [
        `The moment ${cond()} becomes true (rising edge, once): ROBOT EMERGENCY STOP - "${r.text_emergency}".`,
        `Same scan: S.PLC_EMERGENCY = 1, every controlled output goes to its safe value (exempt outputs keep following the rungs), every sequence goes idle; the rungs keep running.`,
        `The node calls the motion supervisor's trigger_emergency service (retried every second while it fails). The operator resets with the supervisor's reset_fault; a program reload also clears the PLC latch.`,
      ] };
    default:
      return { title: r.type, lines: [r.text] };
  }
}

export function explainSequence(s, program) {
  const lines = [];
  lines.push(`Idle (step 0) until ${explainExpr(s.start, program)} - then step 1 (${s.steps[0]?.name}).`);
  if (s.abort) lines.push(`At any time while running: if ${explainExpr(s.abort, program)} - back to idle, every bit the sequence owns = 0.`);
  lines.push(`An emergency (S.EMERGENCY) puts the sequence to idle even without a stop condition.`);
  s.steps.forEach((st, i) => {
    const outs = st.outputs.length ? st.outputs.map((a) => nameOf(a, program)).join(", ") + " = 1" : "every owned bit = 0";
    let l = `Step ${i + 1} (${st.name}): ${outs}; wait until ${explainExpr(st.next, program)}`;
    l += i + 1 < s.steps.length ? ` - then step ${i + 2} (${s.steps[i + 1].name}).` : ` - then idle.`;
    if (st.timeout_s > 0) l += ` If that takes longer than ${msText(st.timeout_s)}: ${nameOf(st.on_timeout, program)} = 1 (latched) and the sequence goes idle.`;
    lines.push(l);
  });
  lines.push(`A step is entered in one scan and its outputs written at once; its transition is checked from the next scan on.`);
  return { title: `SEQUENCE ${s.name}`, lines };
}

/**
 * Explain a whole program grouped by source line.
 * Returns [{ line, rungs: [{ index, rung, explanation }], sequences: [...], alarms: [...], blocks: [...] }]
 */
export function explainProgram(program) {
  const byLine = new Map();
  const get = (line) => {
    if (!byLine.has(line)) byLine.set(line, { line, rungs: [], sequences: [], alarms: [], blocks: [] });
    return byLine.get(line);
  };
  program.rungs.forEach((r, index) => {
    if (r.block) return; // block rungs are shown under their USE line via blocks
    get(r.line).rungs.push({ index, rung: r, explanation: explainRung(r, program) });
  });
  program.sequences.forEach((s, index) => {
    if (s.block) return;
    get(s.line).sequences.push({ index, sequence: s, explanation: explainSequence(s, program) });
  });
  program.alarms.forEach((a, index) => {
    if (a.block) return;
    get(a.line).alarms.push({ index, alarm: a, explanation: { title: `ALARM ${nameOf(a.bit, program)}`, lines: [
      `When ${nameOf(a.bit, program)} goes 0→1: "${a.text}" is published on /nextplc/alarms (level ${a.level}${a.toast ? ", shown as a toast in the web UI" : ", no toast"}). The 1→0 edge is published too.`,
    ] } });
  });
  program.blocks.forEach((b, index) => {
    const rungs = program.rungs.slice(b.first_rung, b.first_rung + b.rung_count).map((rung, k) => ({ index: b.first_rung + k, rung, explanation: explainRung(rung, program) }));
    const sequences = program.sequences.map((sequence, i) => ({ index: i, sequence })).filter((x) => x.sequence.block === b.as).map((x) => ({ ...x, explanation: explainSequence(x.sequence, program) }));
    get(b.line).blocks.push({ index, block: b, rungs, sequences });
  });
  return [...byLine.values()].sort((a, b) => a.line - b.line);
}
