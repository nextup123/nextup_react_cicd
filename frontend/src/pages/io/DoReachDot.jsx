// The status dot beside an output switch: did the command reach the controller?
//   green  the controller accepted it, output ON      grey  accepted, OFF
//   amber  sent, waiting for the controller            red   not accepted (controller not running /
//                                                             not active, or the command was refused)
// The dot is driven only by the controllers' applied_commands feedback.
import { StatusDot } from "../../components/ui";
import { useDoReach } from "./ioLive";

const TEXT = {
  on: "Reached the controller: ON",
  off: "Reached the controller: OFF",
  none: "No command has reached the controller yet",
};

export function DoReachDot({ kind, a, n, label }) {
  const r = useDoReach(kind, a, n);
  const where = label ? `${label}: ` : "";
  if (r.state === "sending") return <StatusDot tone="warning" pulse title={`${where}${r.value ? "ON" : "OFF"} sent, waiting for the controller…`} />;
  if (r.state === "refused")
    return <StatusDot tone="danger" title={`${where}${r.value ? "ON" : "OFF"} did not reach the controller (is the output controller running and active?)${r.applied !== undefined ? `. The controller still has it ${r.applied ? "ON" : "OFF"}.` : ""}`} />;
  return <StatusDot tone={r.state === "on" ? "success" : "off"} title={`${where}${TEXT[r.state]}`} />;
}
