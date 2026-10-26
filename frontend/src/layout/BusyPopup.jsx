// "Stop the robot first": shown when a change would take effect inside the running cycle
// (lib/interlock.js). Nothing was changed; the user stops the program, then tries again.
import { useNavigate } from "react-router-dom";
import { Hand, Workflow } from "lucide-react";
import { Button, Modal } from "../components/ui";
import { busyReasons, closeBusy, useBusyPopup } from "../lib/interlock";
import { useRobot } from "../store/robot";

export function BusyPopup() {
  const { open, action, reasons } = useBusyPopup();
  const stillBusy = useRobot((s) => busyReasons(s).length > 0);
  const navigate = useNavigate();
  if (!open) return null;
  const program = reasons.some((r) => r.key === "program");
  return (
    <Modal
      open
      onClose={closeBusy}
      size="sm"
      icon={<span className="busy-pop-icon"><Hand size={20} /></span>}
      title="Stop the robot first"
      description={`You cannot ${action} right now.`}
      footer={
        <>
          {program && (
            <Button icon={Workflow} onClick={() => { closeBusy(); navigate("/runner"); }}>
              Open the runner
            </Button>
          )}
          <span className="grow" />
          <Button variant="primary" onClick={closeBusy}>OK</Button>
        </>
      }
    >
      <ul className="busy-pop-list">
        {reasons.map((r) => <li key={r.key}>{r.text}</li>)}
      </ul>
      <p className="small muted">
        The change would take effect in the middle of the running cycle, so nothing was changed. Stop the program and wait until
        the robot stands still, then try again.
      </p>
      {!stillBusy && <p className="small busy-pop-ok">The robot is idle now: you can try again.</p>}
    </Modal>
  );
}
