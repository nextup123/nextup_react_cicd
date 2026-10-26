// image.js -- the PLC image table and the fixed memory map (port of nextplc/image.hpp + address.hpp).
//
//   I  physical inputs   joint1..joint6 di1..di8 (48) + gpio1 di1..di8 (8)      read only
//   Q  physical outputs  joint1..joint6 do1,do2,do3,pi_p (24) + gpio1 do1..do8 (8) written by rungs
//   M  virtual bits      M0..M127
//   R  registers         R0..R31 (int32)
//   S  system bits       S.AUTO, S.EMERGENCY, ...
//
// Everything here is pure data: it runs in Node and in the browser.

export const kJoints = 6;
export const kJointDi = 8; // di1..di5 = drive inputs, di6..di8 = STO1, STO2, EDM
export const kJointDo = 4; // do1, do2, do3, pi_p
export const kGpioDi = 8;
export const kGpioDo = 8;

export const kI = kJoints * kJointDi + kGpioDi; // 56
export const kQ = kJoints * kJointDo + kGpioDo; // 32
export const kM = 128;
export const kR = 32;

export const kGpioDiBase = kJoints * kJointDi; // 48
export const kGpioDoBase = kJoints * kJointDo; // 24

export const SYS_NAMES = [
  "AUTO", "SAFEAUTO", "JOG", "ARMED", "EMERGENCY", "ESTOP", "STANDSTILL", "ANY_FAULT",
  "IO_FAULT", "DI_OK", "FIRST_SCAN", "BLINK_1HZ", "BLINK_2HZ", "PROGRAM_OK", "SAFE_STATE",
  "SUPERVISOR_OK", "PLC_EMERGENCY",
];
export const kS = SYS_NAMES.length; // 17
export const S = Object.fromEntries(SYS_NAMES.map((n, i) => [n, i])); // S.AUTO === 0 ...

/** The complete memory of the PLC. */
export function newImage() {
  return {
    I: new Array(kI).fill(false),
    Q: new Array(kQ).fill(false),
    M: new Array(kM).fill(false),
    R: new Array(kR).fill(0),
    S: new Array(kS).fill(false),
  };
}

// ------------------------------------------------------------------ addresses
// { area: 'I'|'Q'|'M'|'R'|'S'|'SEQ_STEP'|'SEQ_ACTIVE'|'SEQ_STEPBIT', index, sub }

export function addr(area, index, sub = 0) {
  return { area, index, sub };
}
export function addrKey(a) {
  return `${a.area}:${a.index}:${a.sub || 0}`;
}
export function addrEq(a, b) {
  return a.area === b.area && a.index === b.index && (a.sub || 0) === (b.sub || 0);
}
export function isBit(a) {
  return a.area === "I" || a.area === "Q" || a.area === "M" || a.area === "S" || a.area === "SEQ_ACTIVE" || a.area === "SEQ_STEPBIT";
}
export function isWritable(a) {
  return a.area === "Q" || a.area === "M" || a.area === "R";
}

export function normalizeName(s) {
  return String(s ?? "").trim().toLowerCase();
}

export function sysBitName(bit) {
  return bit < kS ? SYS_NAMES[bit] : "?";
}
export function sysBitFromName(name) {
  let n = String(name).toUpperCase();
  if (n.startsWith("S.")) n = n.slice(2);
  const i = SYS_NAMES.indexOf(n);
  return i >= 0 ? i : -1;
}

// "di3" -> 3 when prefix matches and the rest is a number in [lo, hi]
function channel(s, prefix, lo, hi) {
  if (s.length <= prefix.length || !s.startsWith(prefix)) return -1;
  let n = 0;
  for (let i = prefix.length; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 48 || c > 57) return -1;
    n = n * 10 + (c - 48);
    if (n > 1000) return -1;
  }
  if (n < lo || n > hi) return -1;
  return n;
}

export const jointInputIndex = (joint, di) => (joint - 1) * kJointDi + (di - 1);
export const gpioInputIndex = (di) => kGpioDiBase + (di - 1);
export const jointOutputIndex = (joint, out) => (joint - 1) * kJointDo + (out - 1);
export const gpioOutputIndex = (out) => kGpioDoBase + (out - 1);

export function inputSlot(i) {
  if (i >= kGpioDiBase) return { is_gpio: true, joint: 0, channel: i - kGpioDiBase + 1 };
  return { is_gpio: false, joint: Math.floor(i / kJointDi) + 1, channel: (i % kJointDi) + 1 };
}
export function outputSlot(q) {
  if (q >= kGpioDoBase) return { is_gpio: true, joint: 0, channel: q - kGpioDoBase + 1 };
  return { is_gpio: false, joint: Math.floor(q / kJointDo) + 1, channel: (q % kJointDo) + 1 };
}

/**
 * Parse a raw address. Returns { ok: true, addr } or { ok: false, err }.
 * Accepts joint<N>.di<K>, joint<N>.do<K>, joint<N>.pi_p, gpio1.di<K>, gpio1.do<K>, M<n>, R<n>, S.<NAME>.
 */
export function parseAddress(text) {
  const s = normalizeName(text);
  if (!s) return { ok: false, err: "empty address" };
  if (s.startsWith("s.")) {
    const bit = sysBitFromName(s);
    if (bit < 0) return { ok: false, err: `unknown system bit '${text}'` };
    return { ok: true, addr: addr("S", bit) };
  }
  if ((s[0] === "m" || s[0] === "r") && s.length > 1 && s.charCodeAt(1) >= 48 && s.charCodeAt(1) <= 57) {
    const isM = s[0] === "m";
    const n = channel(s, isM ? "m" : "r", 0, isM ? kM - 1 : kR - 1);
    if (n < 0) return { ok: false, err: `'${text}' is out of range (${isM ? `M0..M${kM - 1}` : `R0..R${kR - 1}`})` };
    return { ok: true, addr: addr(isM ? "M" : "R", n) };
  }
  const dot = s.indexOf(".");
  if (dot < 0) {
    return { ok: false, err: `'${text}' is not an address (expected joint<N>.di<K>, joint<N>.do<K>, joint<N>.pi_p, gpio1.di<K>, gpio1.do<K>, M<n>, R<n> or S.<NAME>)` };
  }
  const dev = s.slice(0, dot);
  const ch = s.slice(dot + 1);
  const joint = channel(dev, "joint", 1, kJoints);
  if (joint > 0) {
    let k = channel(ch, "di", 1, kJointDi);
    if (k > 0) return { ok: true, addr: addr("I", jointInputIndex(joint, k)) };
    k = channel(ch, "do", 1, kJointDo - 1);
    if (k > 0) return { ok: true, addr: addr("Q", jointOutputIndex(joint, k)) };
    if (ch === "pi_p") return { ok: true, addr: addr("Q", jointOutputIndex(joint, kJointDo)) };
    return { ok: false, err: `'${text}': a joint has di1..di8, do1..do3 and pi_p` };
  }
  if (dev === "gpio1") {
    let k = channel(ch, "di", 1, kGpioDi);
    if (k > 0) return { ok: true, addr: addr("I", gpioInputIndex(k)) };
    k = channel(ch, "do", 1, kGpioDo);
    if (k > 0) return { ok: true, addr: addr("Q", gpioOutputIndex(k)) };
    return { ok: false, err: `'${text}': gpio1 has di1..di8 and do1..do8` };
  }
  return { ok: false, err: `'${text}': unknown device '${dev}' (joint1..joint6 or gpio1)` };
}

/** Canonical text of an address (joint3.di2, gpio1.do4, M10, R0, S.AUTO). */
export function addressName(a) {
  switch (a.area) {
    case "I": {
      const s = inputSlot(a.index);
      return s.is_gpio ? `gpio1.di${s.channel}` : `joint${s.joint}.di${s.channel}`;
    }
    case "Q": {
      const s = outputSlot(a.index);
      if (s.is_gpio) return `gpio1.do${s.channel}`;
      return `joint${s.joint}` + (s.channel === kJointDo ? ".pi_p" : `.do${s.channel}`);
    }
    case "M": return `M${a.index}`;
    case "R": return `R${a.index}`;
    case "S": return `S.${sysBitName(a.index)}`;
    case "SEQ_STEP": return `seq#${a.index}.step`;
    case "SEQ_ACTIVE": return `seq#${a.index}.active`;
    case "SEQ_STEPBIT": return `seq#${a.index}.step${a.sub}`;
    default: return "?";
  }
}

/** All I names in state order, then Q, M, S (the order of PlcState.bit_names). */
export function allBitNames() {
  const out = [];
  for (let i = 0; i < kI; i++) out.push(addressName(addr("I", i)));
  for (let q = 0; q < kQ; q++) out.push(addressName(addr("Q", q)));
  for (let m = 0; m < kM; m++) out.push(addressName(addr("M", m)));
  for (let s = 0; s < kS; s++) out.push(addressName(addr("S", s)));
  return out;
}
export function allRegNames() {
  const out = [];
  for (let r = 0; r < kR; r++) out.push(`R${r}`);
  return out;
}
