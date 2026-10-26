// yamlPatterns.js -- tested idioms of the manual, added to the document as rows (names + rungs +
// sequences + alarms), so they land in the right sections of the file.
export const PATTERNS = [
  { id: "coil", title: "Output follows an input (coil)", hint: "DO is 1 exactly while the condition is true", rungs: [{ out: "gpio1.do1", when: "gpio1.di1 AND S.AUTO" }] },
  { id: "latch", title: "Latch with reset", hint: "remember a start button until a stop button", rungs: [{ set: "M1", when: "RISE(gpio1.di7)" }, { reset: "M1", when: "RISE(gpio1.di8) OR NOT S.AUTO" }, { out: "gpio1.do1", when: "M1" }] },
  { id: "interlock", title: "Interlock with the robot (BT handshake)", hint: "the BT sets M10 at P1; the clamp closes only with a part and in AUTO", names: { part_present: "gpio1.di1", at_p1: "M10" }, rungs: [{ out: "gpio1.do1", when: "ON_FOR(part_present, 300ms) AND at_p1 AND S.AUTO" }] },
  { id: "feedback", title: "Fault when the feedback does not come", hint: "output commanded, sensor still 0 after 2 s -> latched alarm", rungs: [{ set: "M30", when: "ON_FOR(gpio1.do1 AND NOT gpio1.di2, 2s)" }, { reset: "M30", when: "RISE(gpio1.di8)" }], alarms: [{ bit: "M30", text: "gpio1.di2 did not come within 2 s", level: "error", toast: "true" }] },
  { id: "ondelay", title: "On-delay (ton)", hint: "DO goes 1 after the input has been 1 for 2 s", rungs: [{ out: "gpio1.do2", when: "gpio1.di1", ton: "2s" }] },
  { id: "offdelay", title: "Off-delay (tof)", hint: "keep a lamp or blower on 5 s longer", rungs: [{ out: "gpio1.do3", when: "M1", tof: "5s" }] },
  { id: "pulse", title: "Pulse (tp)", hint: "a 300 ms ready signal when something turns on", rungs: [{ out: "gpio1.do4", when: "RISE(gpio1.di1)", tp: "300ms" }] },
  { id: "blink", title: "Blinking lamp", hint: "red lamp blinks at 1 Hz while an alarm is on; keeps blinking in an emergency", rungs: [{ out: "gpio1.do7", when: "(M30 OR S.EMERGENCY) AND S.BLINK_1HZ" }], exempt: ["gpio1.do7"] },
  { id: "counter", title: "Batch counter with a setting", hint: "count picks into R0, done at R2 (default 10, retained), cleared by the start button", names: { part_count: "R0", batch_size: "R2" }, retain: ["part_count", "batch_size"], rungs: [{ move: "batch_size", value: "10", when: "S.FIRST_SCAN AND batch_size == 0" }, { count: "part_count", up: "RISE(M13)", reset: "RISE(gpio1.di7)", preset: "batch_size", done: "M14" }], alarms: [{ bit: "M14", text: "Batch finished", level: "info", toast: "true" }] },
  { id: "toggle", title: "Toggle with one button", hint: "each press flips the output", rungs: [{ toggle: "gpio1.do5", when: "gpio1.di6" }] },
  { id: "lamps", title: "Tower lamp", hint: "green in AUTO without fault, yellow outside AUTO, red on fault / emergency", rungs: [{ out: "gpio1.do6", when: "S.AUTO AND NOT M30 AND NOT S.EMERGENCY" }, { out: "gpio1.do5", when: "NOT S.AUTO AND NOT S.EMERGENCY" }, { out: "gpio1.do7", when: "(M30 OR S.EMERGENCY) AND S.BLINK_1HZ" }], exempt: ["gpio1.do7"] },
  { id: "door", title: "Door guard -> robot emergency stop", hint: "opening the door while the robot runs in AUTO stops it", names: { door_closed: "gpio1.di5" }, rungs: [{ emergency: "NOT door_closed AND S.AUTO AND S.ARMED", text: "Door opened while running" }] },
  { id: "sequence", title: "Sequence (steps)", hint: "a pick cycle: clamp, ask the robot (BT: WaitBit M11 / PulseBit M13), release", sequences: [{ head: { name: "pick", start: "S.AUTO AND RISE(gpio1.di7)", abort: "S.EMERGENCY OR NOT S.AUTO" }, steps: [{ name: "clamp", do: ["gpio1.do1"], next: "gpio1.di2", timeout: "2s", on_timeout: "M30" }, { name: "ask", do: ["gpio1.do1", "M11"], next: "RISE(M13)", timeout: "30s", on_timeout: "M31" }, { name: "release", do: [], next: "NOT gpio1.di2", timeout: "2s", on_timeout: "M30" }] }] },
  { id: "block", title: "Use a library block (cylinder)", hint: "a cylinder with end sensors and a travel-time fault", blocks: [{ use: "cylinder", as: "clamp", with: { request: "M10", extend_cmd: "gpio1.do1", extended: "gpio1.di2", retracted: "gpio1.di3", fault: "M30", reset: "gpio1.di8", travel_time: "2s" } }] },
];

/** Apply a pattern to a YamlProgram document. */
export function applyPattern(y, p) {
  for (const [k, v] of Object.entries(p.names || {})) y.setName(k, v);
  for (const b of p.blocks || []) y.addRow("blocks", b);
  for (const r of p.rungs || []) y.addRow("rungs", r);
  for (const s of p.sequences || []) y.setSequence(-1, s.head, s.steps);
  for (const a of p.alarms || []) y.addRow("alarms", a);
  if (p.exempt) { const safe = y.safeState(); y.setSafeState({ ...safe, exempt: [...new Set([...safe.exempt, ...p.exempt])] }); }
  if (p.retain) y.setStrings("retain", [...new Set([...y.strings("retain"), ...p.retain])]);
}
