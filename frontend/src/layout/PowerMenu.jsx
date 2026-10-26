import { useEffect, useState } from "react";
import { Power, PowerOff, RotateCw, Zap } from "lucide-react";
import { Alert, Button, Modal } from "../components/ui";
import { api, errorMessage } from "../lib/api";

const ACTIONS = {
  shutdown: { label: "Shut down", url: "/shutdown", icon: PowerOff },
  reboot: { label: "Reboot", url: "/reboot", icon: RotateCw },
  force: { label: "Force shutdown", url: "/force-shutdown", icon: Zap, danger: true },
};
const COUNTDOWN = 15;

export function PowerMenu({ open, onClose }) {
  const [action, setAction] = useState(null);
  const [left, setLeft] = useState(COUNTDOWN);
  const [status, setStatus] = useState(null);

  useEffect(() => {
    if (!open) {
      setAction(null);
      setStatus(null);
    }
  }, [open]);

  // Same behaviour as before: once chosen, the action runs automatically after
  // 15 s unless cancelled.
  useEffect(() => {
    if (!action || status) return;
    setLeft(COUNTDOWN);
    const t = setInterval(() => setLeft((s) => s - 1), 1000);
    return () => clearInterval(t);
  }, [action, status]);

  useEffect(() => {
    if (action && !status && left <= 0) execute();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [left]);

  async function execute() {
    const a = ACTIONS[action];
    setStatus({ tone: "info", text: `${a.label} in progress…` });
    try {
      await api.post(a.url);
      setStatus({ tone: "success", text: `${a.label} command sent. The robot computer will go offline.` });
    } catch (err) {
      setStatus({ tone: "danger", text: `${a.label} failed: ${errorMessage(err)}` });
    }
  }

  const a = action && ACTIONS[action];
  return (
    <Modal open={open} onClose={onClose} title="Power" description="Shut down or restart the robot computer" size="sm">
      {!action ? (
        <div className="power-options">
          {Object.entries(ACTIONS).map(([key, it]) => (
            <button key={key} className={`power-option ${it.danger ? "is-danger" : ""}`} onClick={() => setAction(key)}>
              <it.icon size={22} />
              {it.label}
            </button>
          ))}
        </div>
      ) : status ? (
        <Alert tone={status.tone}>{status.text}</Alert>
      ) : (
        <div className="col" style={{ gap: 14 }}>
          <Alert tone="warning" title={`${a.label}?`}>
            This runs automatically in <strong className="tabular">{left}</strong> seconds unless you cancel.
          </Alert>
          <div className="row" style={{ justifyContent: "flex-end" }}>
            <Button onClick={() => setAction(null)}>Cancel</Button>
            <Button variant="danger" icon={Power} onClick={execute}>
              {a.label} now
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
