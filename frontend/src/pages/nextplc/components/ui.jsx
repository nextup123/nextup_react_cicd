// The small UI kit the NextPLC pages were written against, on top of NextUp's own components:
// dialogs are NextUp dialogs (themed, closable, Esc), confirmations go through the app's confirm
// host and toasts through the app's toast stack. Only the compact PLC primitives (LED, the small
// tab strip) are drawn here, styled in nextplc.css under .nxplc.
import { useState } from "react";
import { Modal as AppModal, cx } from "../../../components/ui";
import { confirm as appConfirm } from "../../../store/confirm";

export { cx };

export function Led({ on, kind, blink, size, title }) {
  return <span className={cx("led", on && (kind || "on"), blink && "blink", size === "lg" && "lg")} title={title} />;
}

export function Tabs({ value, onChange, items }) {
  return (
    <div className="ptabs" role="tablist">
      {items.map((it) => (
        <button key={it.id} role="tab" aria-selected={value === it.id} className={cx(value === it.id && "active")} onClick={() => onChange(it.id)}>
          {it.label}{it.badge != null && <span className="pill" style={{ marginLeft: 6, height: 18 }}>{it.badge}</span>}
        </button>
      ))}
    </div>
  );
}

const sizeFor = (width) => (!width || width <= 560 ? undefined : width <= 780 ? "lg" : "xl");

/** A NextUp dialog; `width` (px) picks the dialog size. Always closable (X, Esc, backdrop). */
export function Modal({ title, onClose, children, footer, width, tut }) {
  return (
    <AppModal open onClose={onClose} title={title} size={sizeFor(width)} footer={footer} className="nxplc" bodyClassName="nxplc-modal-body" tut={tut}>
      {children}
    </AppModal>
  );
}

/** confirm({ title, message, okLabel, danger }) -> Promise<boolean>, via NextUp's confirm host. */
export function confirm({ title, message, okLabel = "OK", danger = false }) {
  return appConfirm({ title, message, confirmLabel: okLabel, tone: danger ? "danger" : undefined });
}

/** A prompt for one text value. */
export function PromptModal({ title, label, initial = "", placeholder, okLabel = "OK", validate, onClose, onSubmit, suffix, tut }) {
  const [v, setV] = useState(initial);
  const err = validate ? validate(v) : "";
  return (
    <Modal title={title} tut={tut} onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={Boolean(err) || !v.trim()} onClick={() => onSubmit(v.trim())}>{okLabel}</button></>}>
      <div className="field"><label>{label}</label>
        <div className="row"><input className="input mono grow" autoFocus value={v} placeholder={placeholder} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !err && v.trim()) onSubmit(v.trim()); }} />{suffix}</div>
      </div>
      {err && <div className="small" style={{ color: "var(--danger-text)" }}>{err}</div>}
    </Modal>
  );
}

export function Loading({ label = "Loading…" }) {
  return <div className="empty">{label}</div>;
}
