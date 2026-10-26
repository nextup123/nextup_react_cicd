import { useEffect } from "react";
import ControlPanel from "./ControlPanel";
import OperatorPanel from "./panel/OperatorPanel";
import { useSettings } from "../../lib/queries";
import { publishCnc, publishSpeedScale, speedForSettings, useClientState } from "./clientState";
import "./client.css";

/**
 * Operator production screen: the control deck (state, Start / Stop / Finish Cycle, speed
 * override and the production figures) on top, the project's operator panel below it (run mode,
 * CNC, inputs, outputs and whatever the integrator adds).
 */
export default function ClientPage() {
  const { data: settings } = useSettings();
  // Once per app session (as the old page did on load): send the stored mode speed and CNC to the robot.
  useEffect(() => {
    if (!settings || useClientState.getState().settingsPublished) return;
    useClientState.setState({ settingsPublished: true });
    publishSpeedScale(speedForSettings(settings));
    if (settings.cnc) publishCnc(settings.cnc);
  }, [settings]);

  return (
    <div className="page cc-page">
      <ControlPanel />
      <OperatorPanel />
    </div>
  );
}
