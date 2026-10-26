// Would the motion server accept a motion now? Its start checks (motion_server
// README, step 4) read from the supervisor status. Shared by the top-bar motion
// chip (short reason) and the motion panel (every check).
import { PHASE_TEXT } from "./robotText";

/** Every start check: [{ ok, label, short, tip }]. `short` is the chip's reason text. */
export function motionReadiness(sup) {
  if (!sup) return [{ ok: false, label: "Supervisor reporting", short: "no supervisor", tip: "No status from the motion supervisor: every motion is refused (E_SUPERVISOR_UNAVAILABLE)" }];
  const iso = sup.isolated?.some(Boolean);
  return [
    { ok: !sup.latched && !sup.estop, label: "No emergency", short: sup.estop ? "E-stop" : "emergency", tip: "Emergency latched or E-stop pressed (E_EMERGENCY_ACTIVE)" },
    { ok: sup.profile !== "jog", label: "Not JOG", short: "JOG", tip: "Motions are refused in JOG; switch to AUTO or SAFEAUTO (E_JOG_MODE_ACTIVE)" },
    { ok: Boolean(sup.armed), label: "Armed", short: "not armed", tip: "The supervisor is not armed (E_DRIVES_NOT_READY)" },
    { ok: Boolean(sup.allEnabled), label: "Drives enabled", short: "drives off", tip: "Not every drive is OPERATION ENABLED (E_DRIVES_NOT_READY)" },
    { ok: !sup.anyFault, label: "No fault", short: "drive fault", tip: "A drive reports a fault" },
    { ok: !iso, label: "No isolated joint", short: "joint isolated", tip: "A joint is isolated after a fault (relaxed latching): only JOG until Reset" },
    { ok: sup.phase === "running", label: "Phase running", short: (PHASE_TEXT[sup.phase] || sup.phase || "starting").toLowerCase(), tip: `Supervisor phase: ${PHASE_TEXT[sup.phase] || sup.phase}` },
  ];
}

/** The checks that fail now (empty = a motion would be accepted). */
export const motionBlockers = (sup) => motionReadiness(sup).filter((c) => !c.ok);
