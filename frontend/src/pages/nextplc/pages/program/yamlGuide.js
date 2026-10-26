// yamlGuide.js -- the reference the Guide panel shows, keyed by where the cursor is in the file.
// Condensed from nextplc/doc/LOGIC.md and BLOCKS.md.

export const SECTION_GUIDE = {
  program: { title: "program:", text: "The name of the program (shown in the PLC state and the log).", example: "program: cell1" },
  scan_ms: { title: "scan_ms:", text: "Scan time 1..1000 ms; overrides the node parameter (default 10 ms). Every scan: read inputs → rungs top to bottom → sequences → write the outputs that changed.", example: "scan_ms: 10" },
  names: { title: "names:", text: "Optional names for raw addresses (flat form: the area comes from the address). A name is just another way to write the address; the web UI and the BT may use either.", example: "names:\n  start_button: gpio1.di7\n  clamp: gpio1.do1\n  at_p1: M10\n  part_count: R0" },
  io: { title: "io:", text: "The same as names:, grouped by area I / Q / M / R (the address must be in that area).", example: "io:\n  I: {part_present: gpio1.di4}\n  Q: {clamp: gpio1.do3}\n  M: {at_p1: M10}\n  R: {part_count: R0}" },
  blocks: { title: "blocks:", text: "Library blocks with your addresses on their ports. Expanded into normal rungs at load (they run after the program's own rungs). Ports: in (a bit the block reads), out (a Q/M bit it writes — one owner), register, time, number. Locals are readable as <as>.<local>; ports as <as>.<port>.", example: "blocks:\n  - {use: cylinder, as: clamp, with: {request: M10, extend_cmd: gpio1.do1, extended: gpio1.di2, retracted: gpio1.di3, fault: M30, reset: gpio1.di8, travel_time: 2s}}" },
  retain: { title: "retain:", text: "Registers saved on the robot when they change and restored at the next start. Everything else starts at 0.", example: "retain: [R0, part_count]" },
  safe_state: { title: "safe_state:", text: "Where the controlled outputs go when an emergency is latched, the inputs are stale, no program is loaded, or the node stops. default = the value of every controlled output (0), one line per output for another value, exempt = outputs that keep following the rungs (lamps, horn).", example: "safe_state:\n  default: 0\n  gpio1.do1: 1\n  exempt: [gpio1.do7]" },
  rungs: { title: "rungs:", text: "One line of logic each, run top to bottom every scan. Exactly one of out / set / reset / toggle / count / move / calc / emergency per rung. One owner per bit: out, toggle, done and sequence outputs own their bit; set and reset may share a bit with each other.", example: "rungs:\n  - {out: gpio1.do1, when: \"gpio1.di1 AND S.AUTO\"}" },
  sequences: { title: "sequences:", text: "Step logic (SFC / GRAFCET): idle until start is true, then step 1, 2 … While a step runs its do: bits are 1 and every other bit the sequence owns is 0. A step is entered in one scan; its next is checked from the next scan on. abort → idle. An emergency puts every sequence to idle.", example: "sequences:\n  - name: pick\n    start: \"S.AUTO AND RISE(gpio1.di7)\"\n    abort: \"S.EMERGENCY OR NOT S.AUTO\"\n    steps:\n      - {name: s1, do: [gpio1.do1], next: \"gpio1.di2\", timeout: 2s, on_timeout: M30}\n      - {name: s2, do: [M11], next: \"RISE(M13)\"}" },
  alarms: { title: "alarms:", text: "When the bit goes 0→1 the text is sent as a PLC alarm and, with toast: true, shown in the app (error / warning = failure toast, info = success). The 1→0 edge is published too.", example: "alarms:\n  - {bit: M30, text: \"gpio1.di2 did not come within 2 s\", level: error, toast: true}" },
  // block files
  block: { title: "block:", text: "The block name (the name it is saved under).", example: "block: valve_with_feedback" },
  description: { title: "description:", text: "One line shown in the library.", example: "description: \"Valve output with feedback sensor and fault\"" },
  ports: { title: "ports:", text: "What the program connects. kind: in (a bit the block reads) · out (a Q/M bit the block writes, one owner) · register · time (500ms / 2s / a register in ms) · number. optional: true = may be left open (in reads 0, out gets a private M bit). default: a value or the name of another port.", example: "ports:\n  command:  {kind: in}\n  feedback: {kind: in, optional: true}\n  valve:    {kind: out}\n  fault:    {kind: out}\n  fb_time:  {kind: time, default: 1s}" },
  locals: { title: "locals:", text: "Internal bits (M) and registers (R), allocated per instance from M127 / R31 downwards; readable in the program as <as>.<local>.", example: "locals:\n  pending: M\n  count: R" },
};

export const RUNG_KEYS = {
  out: [["out", "the Q or M bit; = condition every scan (1 and 0)"], ["when", "the condition"], ["ton", "on-delay: 1 after the condition has been true for this long (500ms, 2s, or a register in ms)"], ["tof", "off-delay: stays 1 this long after the condition ends"], ["tp", "pulse: 1 for exactly this long when the condition becomes true"]],
  set: [["set", "the bit; = 1 while the condition is true, stays 1 (latched)"], ["when", "the condition"]],
  reset: [["reset", "the bit; = 0 while the condition is true"], ["when", "the condition"]],
  toggle: [["toggle", "the bit; flips on every 0→1 of the condition"], ["when", "the condition"]],
  count: [["count", "the register that IS the counter"], ["up", "+1 on every rising edge"], ["down", "−1 on every rising edge (optional)"], ["reset", "count = 0 while true (level, optional)"], ["preset", "number or register; done = count >= preset"], ["done", "the bit = 1 while count >= preset (optional, needs preset)"]],
  move: [["move", "the register"], ["value", "number or register"], ["when", "optional: write only while true (RISE(x) = once at the edge)"]],
  calc: [["calc", "\"R2 = R0 * 2 + R1\" — + - * / % and brackets; whole numbers; /0 gives 0"], ["when", "optional"]],
  emergency: [["emergency", "the condition; fires once on its rising edge → robot emergency stop + safe state"], ["text", "shown with the request (toast, alarm, log)"]],
};
export const STEP_KEYS = [["name", "step name, used as seq.<seq>.<name> in conditions"], ["do", "bits that are 1 while the step runs: [gpio1.do1, M11]"], ["next", "go to the next step when this is true (last step: to idle)"], ["timeout", "optional: if next does not come in time → on_timeout = 1 and idle"], ["on_timeout", "the bit set by the timeout (latched; reset it with a rung)"]];
export const EXPR_HELP = [
  ["a AND b, a OR b, NOT a, ( )", "contacts in series / parallel / normally closed; AND binds before OR"],
  ["RISE(x), FALL(x)", "1 for exactly one scan at the 0→1 / 1→0 change; needs to have seen the other value first"],
  ["ON_FOR(x, 2s), OFF_FOR(x, R10)", "x has been 1 / 0 for that long without a break; the time may come from a register in ms"],
  ["R0 >= 10, R0 == R2, M10 != 0", "compare numbers (== != < <= > >=); a bit counts as 0 / 1"],
  ["seq.pick.step == 2, seq.pick.active, seq.pick.weld", "the state of a sequence (step number, running, in that step)"],
  ["TRUE, FALSE, S.AUTO, S.FIRST_SCAN, S.BLINK_1HZ", "constants and system bits"],
];
export const S_BITS = [["S.AUTO / S.SAFEAUTO / S.JOG", "the supervisor profile"], ["S.ARMED", "motion commands reach the drives"], ["S.EMERGENCY", "an emergency is latched (also when the supervisor status is missing)"], ["S.ESTOP", "hardware e-stop pressed"], ["S.STANDSTILL", "all joints stand still"], ["S.ANY_FAULT", "a drive reports a fault"], ["S.IO_FAULT", "an output was not applied / inputs stale"], ["S.DI_OK / S.SUPERVISOR_OK", "the input topics / supervisor status are fresh"], ["S.FIRST_SCAN", "only the first scan after a load (initial values)"], ["S.BLINK_1HZ / S.BLINK_2HZ", "toggle every 500 / 250 ms"], ["S.PROGRAM_OK / S.SAFE_STATE", "a program runs / outputs held safe"], ["S.PLC_EMERGENCY", "an emergency: rung fired, supervisor not confirmed yet"]];

/** Where is the cursor? -> { section, rungType?, inStep? } from the lines above the cursor. */
export function contextAt(lines, cursorLine) {
  let section = "", rungType = "", inStep = false, item = "";
  for (let i = Math.min(cursorLine, lines.length) - 1; i >= 0; i--) {
    const l = lines[i];
    if (!item && /^\s+-\s/.test(l)) { item = l; if (/^\s{6,}-\s/.test(l) || /\bname:\s*\S+.*\bnext:/.test(l)) inStep = true; }
    const m = /^([A-Za-z_]+):/.exec(l);
    if (m) { section = m[1]; break; }
  }
  if (section === "rungs" && item) {
    const keys = [...item.matchAll(/\b(out|set|reset|toggle|count|move|calc|emergency)\s*:/g)].map((x) => x[1]);
    rungType = keys.includes("count") ? "count" : keys[0] || "";
  }
  return { section, rungType, inStep };
}
