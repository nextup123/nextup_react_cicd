// Banners and prompts that must be seen on every page:
//  - emergency latched (cause + Reset), E-stop button pressed
//  - behaviour tree paused (step mode / breakpoint) with Continue
//  - a question from the running program (WaitForOperatorAck)
import { useLocation } from "react-router-dom";
import { useEffect, useState } from "react";
import { MessageSquareWarning, Minus, OctagonAlert, PauseCircle, Play, RotateCcw, StepForward } from "lucide-react";
import { Button, IconButton, Modal } from "../components/ui";
import { send } from "../lib/ws";
import { robotApi, robotCall } from "../lib/robotApi";
import { CAUSE_TEXT } from "../lib/robotText";
import { useRobot } from "../store/robot";

export function EmergencyBanner() {
  const sup = useRobot((s) => s.supervisor);
  const modeSwitch = useRobot((s) => s.modeSwitch);
  // A floating banner can be folded into a small badge so it never hides
  // anything for good; it unfolds again on the next emergency.
  const [folded, setFolded] = useState(false);
  const key = sup ? `${sup.latched}|${sup.estop}|${sup.cause}|${sup.isolated?.join()}` : "";
  useEffect(() => setFolded(false), [key]);
  if (!sup || (!sup.latched && !sup.estop && !sup.isolated?.some(Boolean))) return null;

  const isolatedOnly = !sup.latched && !sup.estop;
  const tone = isolatedOnly ? "is-warning" : "is-danger";
  if (folded) {
    return (
      <button type="button" className={`robot-banner is-folded ${tone}`} onClick={() => setFolded(false)} title="Show the message">
        <OctagonAlert size={15} /> {isolatedOnly ? "Joint isolated" : sup.estop ? "E-stop" : "Emergency"}
      </button>
    );
  }
  const fold = <IconButton size="sm" icon={Minus} label="Fold this message" className="rb-fold" onClick={() => setFolded(true)} />;

  if (isolatedOnly) {
    const joints = sup.names.filter((_, i) => sup.isolated[i]).join(", ");
    return (
      <div className={`robot-banner ${tone}`} role="status" title="Relaxed latching: the other joints can still be jogged; only JOG is allowed until a reset.">
        <OctagonAlert size={16} />
        <span className="rb-text"><strong>{joints} isolated</strong> after a drive fault · JOG only until Reset</span>
        <Button size="sm" icon={RotateCcw} onClick={() => send("RESET_FAULT")}>Reset</Button>
        {fold}
      </div>
    );
  }
  const cause = CAUSE_TEXT[sup.cause] || sup.cause || "Emergency";
  const resetting = sup.phase?.startsWith("reset") || modeSwitch?.phase?.startsWith?.("reset");
  const help = sup.estop ? "Release the E-stop button, then press Reset." : "Drives are disabled. Check the robot, then press Reset (it comes back in JOG).";
  return (
    <div className={`robot-banner ${tone}`} role="alert" title={help}>
      <span className="rb-beacon"><OctagonAlert size={16} /></span>
      <span className="rb-text">
        <strong>{sup.estop ? "E-STOP PRESSED" : "EMERGENCY STOP"}</strong>
        <span className="rb-cause">{sup.estop ? "Release the button, then Reset" : `${cause}${sup.causeJoint ? ` (${sup.causeJoint})` : ""}`}</span>
      </span>
      <Button size="sm" className="rb-reset" icon={RotateCcw} loading={resetting} disabled={sup.estop} onClick={() => send("RESET_FAULT")}>
        Reset
      </Button>
      {fold}
    </div>
  );
}

export function BtPausedBanner() {
  const bt = useRobot((s) => s.btActive);
  const active = useRobot((s) => s.controlActive);
  const onRunner = useLocation().pathname.startsWith("/runner"); // the runner page has these buttons itself
  if (!bt?.paused || !active || onRunner) return null;
  const node = bt.running?.[0]?.name;
  return (
    <div className="robot-banner is-info" role="status">
      <PauseCircle size={18} />
      <span className="grow">
        <strong>Program paused</strong>
        {node ? ` at ${node}` : ""}
        {bt.lastEvent ? ` · ${bt.lastEvent}` : ""}
      </span>
      <Button size="sm" icon={StepForward} onClick={() => robotCall(() => robotApi.btStep(), { quietOk: true })}>Step</Button>
      <Button
        size="sm"
        variant="primary"
        icon={Play}
        onClick={() => {
          // Continue a Breakpoint node and leave step mode
          robotApi.btContinue().catch(() => {});
          robotCall(() => robotApi.btResume(), { quietOk: true });
        }}
      >
        Continue
      </Button>
    </div>
  );
}

export function OperatorPrompt() {
  const req = useRobot((s) => s.operatorRequest);
  const [left, setLeft] = useState(null);
  const [hiddenId, setHiddenId] = useState(null);

  useEffect(() => {
    if (!req?.timeoutS) return setLeft(null);
    const end = (req.at || Date.now()) + req.timeoutS * 1000;
    const tick = () => {
      const s = Math.max(0, Math.round((end - Date.now()) / 1000));
      setLeft(s);
      // The program has moved on with its default: drop the question.
      if (end - Date.now() < -1500) useRobot.setState((st) => (st.operatorRequest?.id === req.id ? { operatorRequest: null } : {}));
    };
    tick();
    const t = setInterval(tick, 500);
    return () => clearInterval(t);
  }, [req]);

  if (!req) return null;
  const answer = (choice) => {
    send("OPERATOR_REPLY", { id: req.id, choice });
    useRobot.setState({ operatorRequest: null });
  };
  if (hiddenId === req.id) {
    return (
      <button type="button" className="op-badge" onClick={() => setHiddenId(null)} title={req.question}>
        <MessageSquareWarning size={16} /> The program is waiting for an answer{left !== null ? ` · ${left} s` : ""}
      </button>
    );
  }
  return (
    <Modal
      open
      onClose={() => setHiddenId(req.id)}
      size="sm"
      title="The program needs an answer"
      description={left !== null ? `It waits ${left} s, then continues with its default.` : "The program waits until you answer. Closing this keeps the question open."}
      icon={<span className="confirm-icon is-warning"><MessageSquareWarning size={20} /></span>}
      footer={req.options.map((o, i) => (
        <Button key={o} size="lg" variant={i === 0 ? "primary" : /abort|stop|cancel/i.test(o) ? "soft-danger" : "default"} onClick={() => answer(o)}>
          {o}
        </Button>
      ))}
    >
      <p style={{ fontSize: "var(--fs-md)" }}>{req.question}</p>
    </Modal>
  );
}
