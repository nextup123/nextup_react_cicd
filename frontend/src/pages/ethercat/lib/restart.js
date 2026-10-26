/**
 * Steps that restart the drive (H0D.00 software reset, 0x200D:01 = 1).
 *
 * The drive reboots while it handles the write, so it never confirms it and
 * the controller reports the write as failed even though it worked. Such
 * steps are treated as "sent", and the run waits until the drive answers
 * again before the next step.
 */
const hexNum = (v) => parseInt(String(v ?? '').trim().replace(/^0x/i, '').replace(/h$/i, ''), 16);

export const isSoftwareReset = (b) => b?.type === 'set' && hexNum(b.index) === 0x200d && hexNum(b.subindex) === 0x01 && Number(b.value) === 1;

/** `restarts` on the step wins; otherwise a software reset is recognised automatically. */
export const restartsDrive = (b) => b?.type === 'set' && (b.restarts ?? isSoftwareReset(b));

/** A refusal from the drive (SDO abort) is a real failure, not a lost confirmation. */
export const isRefusal = (msg) => /abort|refused/i.test(String(msg || ''));

export const RESTART_TIMEOUT_MS = 30000;
export const RESTART_POLL_MS = 1000;
// Statusword: every CiA402 drive has it, and reading it changes nothing.
export const ALIVE_PROBE = { sdo_index: 0x6041, sdo_subindex: 0x00, sdo_data_type: 'uint16' };
