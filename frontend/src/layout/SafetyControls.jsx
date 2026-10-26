// HOME / RESET / EMERGENCY STOP, always visible in the top bar.
// Every button goes through the new controllers: HOME is the motion server's
// home service (active home unless another is chosen), RESET and E-STOP the
// supervisor's services. A running motion is stopped from the motion chip.
// Homes are managed in Settings › Point teach.
import { useEffect, useRef, useState } from "react";
import { ChevronDown, FlaskConical, Home, Layers, OctagonX, RotateCcw } from "lucide-react";
import { Button, Menu } from "../components/ui";
import { send } from "../lib/ws";
import { useWsMessage } from "../lib/useWs";
import { PHASE_TEXT } from "../lib/robotText";
import { toast } from "../store/toast";
import { useRobot, selectAllOperational, selectAnyEmergency, selectAnyFault, selectLatched } from "../store/robot";

export function SafetyControls() {
  const allOperational = useRobot(selectAllOperational);
  const anyEmergency = useRobot(selectAnyEmergency);
  const latched = useRobot(selectLatched);
  const anyFault = useRobot(selectAnyFault);
  const sup = useRobot((s) => s.supervisor);
  const motion = useRobot((s) => s.motion);
  const homes = useRobot((s) => s.homes);
  const atHome = useRobot((s) => s.atHome);
  const [starting, setStarting] = useState(false);
  const [resetting, setResetting] = useState(false);
  const timer = useRef(null);

  useEffect(() => () => clearTimeout(timer.current), []);

  useWsMessage("ACTION_RESULT", (p) => {
    if (p?.action === "home") {
      clearTimeout(timer.current);
      setStarting(false);
      // Success is shown by the motion chip; only a refusal needs a toast here.
      if (!p.ok) toast.error(`HOME: ${p.message || "refused"}`);
      else if (p.switched) toast.info("Switched to SAFEAUTO for homing");
    }
    if (p?.action === "reset") {
      setResetting(false);
      if (p.ok) toast.success(p.message || "Reset complete");
      else toast.error(`RESET: ${p.message || "failed"}`);
    }
    if (p?.action === "estop" && p.ok === false) toast.error(`E-STOP: ${p.message}`);
  });

  const homing = motion?.active && motion.kind === "home";
  const homeBlockedReason = latched
    ? "Emergency is latched: press Reset first"
    : anyEmergency
      ? "Emergency stop is active"
      : !allOperational
        ? "Not all joints are operational"
        : sup && sup.phase !== "running"
          ? PHASE_TEXT[sup.phase] || sup.phase
          : motion?.active
            ? "Another motion is running"
            : null;

  const startHome = (opts = {}) => {
    if (starting) return;
    if (homeBlockedReason && !opts.dryRun) {
      toast.warning(`Cannot HOME: ${homeBlockedReason}`);
      return;
    }
    setStarting(true);
    send("UI_COMMANDS", { command: "home", ...opts });
    timer.current = setTimeout(() => setStarting(false), 10000);
  };

  const onReset = () => {
    if (anyEmergency && !latched) {
      toast.warning("Release the emergency stop button first.");
      return;
    }
    if (sup?.estop) {
      toast.warning("Release the E-stop button first, then press Reset.");
      return;
    }
    setResetting(true);
    send("RESET_FAULT");
    setTimeout(() => setResetting(false), 9000);
  };

  const active = homes.active || "home";
  const others = homes.list.filter((h) => h.name !== active);
  const homeTitle = homeBlockedReason
    ? `HOME unavailable: ${homeBlockedReason}`
    : `Move to home "${active}"${atHome?.atActiveHome ? " (already there)" : ""}. From JOG it switches to SAFEAUTO first.`;

  return (
    <div className="topbar-actions">
      <div className="split-btn">
        <Button icon={Home} onClick={() => startHome()} loading={starting || homing} disabled={!!homeBlockedReason} title={homeTitle}>
          <span className="lbl">Home</span>
        </Button>
        <Menu
          trigger={({ toggle }) => <Button className="split-btn-caret" icon={ChevronDown} onClick={toggle} title="Homing options" aria-label="Homing options" />}
          items={[
            { header: `Active home: ${active}` },
            { label: `Home to ${active}`, icon: Home, onClick: () => startHome(), disabled: !!homeBlockedReason, hint: atHome?.atActiveHome ? "here" : undefined },
            { label: "Home all joints at once", icon: Layers, onClick: () => startHome({ singleStage: true }), disabled: !!homeBlockedReason, title: "Skip the stages of this home and move every joint together" },
            { label: "Test homing (dry run)", icon: FlaskConical, onClick: () => startHome({ dryRun: true }), disabled: latched, title: "Plan and check the homing motion without moving" },
            others.length ? "-" : null,
            others.length ? { header: "Other homes" } : null,
            ...others.slice(0, 6).map((h) => ({
              label: h.name,
              icon: Home,
              hint: atHome?.homeName === h.name ? "here" : undefined,
              title: h.description || undefined,
              disabled: !!homeBlockedReason,
              onClick: () => startHome({ home: h.name }),
            })),
          ]}
        />
      </div>
      <Button
        icon={RotateCcw}
        onClick={onReset}
        loading={resetting}
        disabled={sup?.estop}
        variant={anyFault || latched ? "warning" : "default"}
        title={sup?.estop ? "Release the E-stop button first" : "Reset drive faults and the emergency latch (ends in JOG)"}
      >
        <span className="lbl">Reset</span>
      </Button>
      <button className="estop-btn" data-tut="estop" onClick={() => send("EMERGENCY_TRIGGER")} title="Software emergency stop: disables every drive">
        <OctagonX size={20} />
        E-STOP
      </button>
    </div>
  );
}
