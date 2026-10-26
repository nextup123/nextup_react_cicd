// A small dialog with more than two answers (e.g. Save & load / Discard & load / Cancel).
// const [ask, dialog] = useChoice();  const choice = await ask({ title, message, choices: [{value,label,variant}] });
import { useCallback, useRef, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { Button, Modal } from "../../components/ui";

export function useChoice() {
  const [current, setCurrent] = useState(null);
  const resolver = useRef(null);

  const ask = useCallback(
    (opts) =>
      new Promise((resolve) => {
        resolver.current = resolve;
        setCurrent(opts);
      }),
    []
  );

  const close = (value) => {
    setCurrent(null);
    resolver.current?.(value);
    resolver.current = null;
  };

  const dialog = current ? (
    <Modal
      open
      tut="choice"
      size="sm"
      onClose={() => close(null)}
      title={current.title}
      icon={
        <span className="confirm-icon is-warning">
          <AlertTriangle size={20} />
        </span>
      }
      footer={
        <>
          <Button onClick={() => close(null)}>Cancel</Button>
          {current.choices.map((c) => (
            <Button key={c.value} variant={c.variant} onClick={() => close(c.value)} autoFocus={c.autoFocus}>
              {c.label}
            </Button>
          ))}
        </>
      }
    >
      <div className="muted" style={{ whiteSpace: "pre-line" }}>{current.message}</div>
    </Modal>
  ) : null;

  return [ask, dialog];
}
