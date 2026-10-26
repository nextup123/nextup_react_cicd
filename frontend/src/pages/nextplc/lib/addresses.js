// The fixed memory map as lists for pickers and grids.
import { kI, kQ, kM, kR, SYS_NAMES, allBitNames, addressName } from "nextplc-engine";

const names = allBitNames();
export const I_NAMES = names.slice(0, kI);
export const Q_NAMES = names.slice(kI, kI + kQ);
export const M_NAMES = names.slice(kI + kQ, kI + kQ + kM);
export const S_NAMES = SYS_NAMES.map((n) => `S.${n}`);
export const R_NAMES = Array.from({ length: kR }, (_, i) => `R${i}`);
export { addressName };

/** Inputs / outputs grouped by device (joint1..6, gpio1) for the grids. */
export const I_GROUPS = [...Array.from({ length: 6 }, (_, j) => ({ device: `joint${j + 1}`, names: I_NAMES.slice(j * 8, j * 8 + 8) })), { device: "gpio1", names: I_NAMES.slice(48) }];
export const Q_GROUPS = [...Array.from({ length: 6 }, (_, j) => ({ device: `joint${j + 1}`, names: Q_NAMES.slice(j * 4, j * 4 + 4) })), { device: "gpio1", names: Q_NAMES.slice(24) }];

/** What a system bit means (for tooltips and the picker). */
export const S_HELP = {
  "S.AUTO": "supervisor profile AUTO (production)",
  "S.SAFEAUTO": "profile SAFEAUTO (manual, reduced speed)",
  "S.JOG": "profile JOG",
  "S.ARMED": "the supervisor passes motion commands to the drives",
  "S.EMERGENCY": "an emergency is latched (also when the supervisor status is missing)",
  "S.ESTOP": "the hardware e-stop input is pressed",
  "S.STANDSTILL": "all joints stand still",
  "S.ANY_FAULT": "a drive reports a fault",
  "S.IO_FAULT": "an output was not applied by its controller, or the inputs are stale",
  "S.DI_OK": "the inputs are fresh",
  "S.FIRST_SCAN": "only in the first scan after a program load",
  "S.BLINK_1HZ": "toggles every 500 ms",
  "S.BLINK_2HZ": "toggles every 250 ms",
  "S.PROGRAM_OK": "a program is loaded and running",
  "S.SAFE_STATE": "the outputs are held in their safe state",
  "S.SUPERVISOR_OK": "the supervisor status is fresh",
  "S.PLC_EMERGENCY": "an EMERGENCY rung fired and the supervisor has not confirmed yet",
};
/** joint di6..di8 are the safety inputs. */
export const I_HELP = (name) => {
  const m = /^joint(\d)\.di(\d)$/.exec(name);
  if (m) return ["", "drive input 1", "drive input 2", "drive input 3", "drive input 4", "drive input 5", "STO1", "STO2", "EDM"][Number(m[2])];
  return "";
};

/** alias map from a state / described program: canonical -> alias */
export function aliasMap(aliases) {
  const m = new Map();
  for (const a of aliases || []) if (!m.has(a.target)) m.set(a.target, a.alias);
  return m;
}
