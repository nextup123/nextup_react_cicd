// The control process on / off switch (process_control: starts or stops the
// program process on the robot PC). Shared by Client Control, the NexRoot
// Runner and the program panel. The switch moves at once and follows the
// reported status (/control_process_control_bt_status) as soon as it changes.
import { useEffect, useState } from "react";
import { Switch } from "../ui";
import { send } from "../../lib/ws";
import { useRobot } from "../../store/robot";

/** Is the control process on (its status says "running …")? */
export const processRunning = (status) => String(status ?? "").trim().split(/\s+/)[0].toLowerCase() === "running";

const PENDING_MS = 6000;

export function ProcessSwitch({ size, label = "Process", className }) {
  const status = useRobot((s) => s.processStatus);
  const reported = processRunning(status);
  const [pending, setPending] = useState(null); // requested value until the status follows

  useEffect(() => {
    if (pending === null) return;
    if (pending === reported) return setPending(null);
    const t = setTimeout(() => setPending(null), PENDING_MS);
    return () => clearTimeout(t);
  }, [pending, reported, status]);

  const on = pending ?? reported;
  const toggle = (next) => {
    setPending(next);
    send("UI_COMMANDS", { command: "process_control", value: next ? "start" : "stop" });
  };
  return (
    <Switch
      size={size}
      className={className}
      checked={on}
      onChange={toggle}
      tone="success"
      label={label}
      title={`${on ? "Stop" : "Start"} the control process (it loads and runs the robot program)${status ? `\nReported: ${status}` : ""}`}
    />
  );
}
