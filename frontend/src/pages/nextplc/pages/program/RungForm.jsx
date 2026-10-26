// RungForm -- one rung as a form: type, target, condition, the extras of that type. Produces
// the row object written into the YAML ({out, when, ton} ...). Also used for block rungs, where
// port and local names are allowed as addresses (extra).
import { useState } from "react";
import { Modal, cx } from "../../components/ui";
import AddressPicker from "../../components/AddressPicker";
import { ExprField } from "../../components/ConditionBuilder";

export const RUNG_TYPES = [
  { id: "out", label: "out — coil: target follows the condition every scan", target: "bit" },
  { id: "set", label: "set — latch 1 while the condition is true", target: "bit" },
  { id: "reset", label: "reset — latch 0 while the condition is true", target: "bit" },
  { id: "toggle", label: "toggle — flip on every rising edge of the condition", target: "bit" },
  { id: "count", label: "count — counter in a register (up / down / reset / preset / done)", target: "reg" },
  { id: "move", label: "move — register = value while the condition is true", target: "reg" },
  { id: "calc", label: "calc — register = formula (+ - * / %)", target: "reg" },
  { id: "emergency", label: "emergency — robot emergency stop on the rising edge", target: null },
];

const TIMERS = [
  { id: "", label: "no timer" },
  { id: "ton", label: "ton — on-delay: 1 after the condition has been true for…" },
  { id: "tof", label: "tof — off-delay: stays 1 for … after the condition ends" },
  { id: "tp", label: "tp — pulse: 1 for exactly … when the condition becomes true" },
];

/** YAML row -> form state */
function fromRow(r) {
  const type = r ? (r.count !== undefined ? "count" : ["out", "set", "reset", "toggle", "move", "calc", "emergency"].find((k) => r[k] !== undefined) || "out") : "out";
  const timer = r ? (r.ton !== undefined ? "ton" : r.tof !== undefined ? "tof" : r.tp !== undefined ? "tp" : "") : "";
  let target = r ? r[type] ?? "" : "";
  let calcExpr = "";
  if (type === "calc" && r) { const eq = String(r.calc).indexOf("="); target = String(r.calc).slice(0, eq).trim(); calcExpr = String(r.calc).slice(eq + 1).trim(); }
  return {
    type, target: String(target), when: String(r?.when ?? (type === "emergency" ? r?.emergency ?? "" : "")),
    timer, time: String(r?.[timer] ?? ""),
    up: String(r?.up ?? ""), down: String(r?.down ?? ""), reset: String(r?.reset ?? ""), preset: String(r?.preset ?? ""), done: String(r?.done ?? ""),
    value: type === "calc" ? calcExpr : String(r?.value ?? ""), text: String(r?.text ?? ""),
  };
}
/** form state -> YAML row (key order like the manual) */
export function toRow(f) {
  switch (f.type) {
    case "count": return { count: f.target, up: f.up || undefined, down: f.down || undefined, reset: f.reset || undefined, preset: f.preset || undefined, done: f.done || undefined };
    case "move": return { move: f.target, value: f.value, when: f.when || undefined };
    case "calc": return { calc: `${f.target} = ${f.value}`, when: f.when || undefined };
    case "emergency": return { emergency: f.when, text: f.text || undefined };
    default: { const row = { [f.type]: f.target, when: f.when }; if (f.type === "out" && f.timer) row[f.timer] = f.time; return row; }
  }
}
export function describeRow(r) {
  const t = r.count !== undefined ? "count" : ["out", "set", "reset", "toggle", "move", "calc", "emergency"].find((k) => r[k] !== undefined);
  switch (t) {
    case "count": return [`count ${r.count}`, [r.up && `up ${r.up}`, r.down && `down ${r.down}`, r.reset && `reset ${r.reset}`, r.preset && `preset ${r.preset}`, r.done && `done ${r.done}`].filter(Boolean).join(" · ")];
    case "move": return [`move ${r.move} = ${r.value}`, r.when ? `when ${r.when}` : "every scan"];
    case "calc": return [`calc ${r.calc}`, r.when ? `when ${r.when}` : "every scan"];
    case "emergency": return [`EMERGENCY "${r.text || ""}"`, `when ${r.emergency}`];
    default: return [`${t} ${r[t]}`, `when ${r.when}${r.ton ? ` · ton ${r.ton}` : r.tof ? ` · tof ${r.tof}` : r.tp ? ` · tp ${r.tp}` : ""}`];
  }
}

export default function RungForm({ row, aliases, extra, onSave, onClose, title }) {
  const [f, setF] = useState(() => fromRow(row));
  const [picker, setPicker] = useState(null); // { field, allow }
  const set = (patch) => setF({ ...f, ...patch });
  const def = RUNG_TYPES.find((t) => t.id === f.type);
  const pick = (field, allow) => setPicker({ field, allow });
  const valid = f.type === "emergency" ? Boolean(f.when) : f.type === "count" ? Boolean(f.target && (f.up || f.down)) : f.type === "move" || f.type === "calc" ? Boolean(f.target && f.value) : Boolean(f.target && f.when);
  return (
    <>
      <Modal tut="plc-rung-form" title={title || (row ? "Edit rung" : "Add a rung")} width={780} onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={!valid} onClick={() => onSave(toRow(f))}>{row ? "Apply" : "Add rung"}</button></>}>
        <div className="field"><label>Rung type</label><select className="select" value={f.type} onChange={(e) => set({ type: e.target.value, timer: "" })}>{RUNG_TYPES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}</select></div>
        {def.target === "bit" && <AddrField label={`${f.type}: the Q or M bit this rung writes (one owner per bit)`} value={f.target} placeholder="gpio1.do1 / M10 / a name" onChange={(v) => set({ target: v })} onPick={() => pick("target", ["Q", "M"])} />}
        {def.target === "reg" && <AddrField label={`${f.type}: the register (R0..R31)`} value={f.target} placeholder="R0 / a name" onChange={(v) => set({ target: v })} onPick={() => pick("target", ["R"])} />}
        {f.type !== "count" && <ExprField label={f.type === "emergency" ? "emergency: the condition (fires once, on its rising edge)" : f.type === "move" || f.type === "calc" ? "when: condition (optional — empty = every scan)" : "when: condition"} value={f.when} onChange={(v) => set({ when: v })} aliases={aliases} extra={extra} />}
        {f.type === "out" && (
          <div className="row">
            <div className="field grow"><label>Timer</label><select className="select" value={f.timer} onChange={(e) => set({ timer: e.target.value })}>{TIMERS.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}</select></div>
            {f.timer && <div className="field" style={{ width: 200 }}><label>Time (500ms, 2s, or a register in ms)</label><input className="input mono" value={f.time} placeholder="500ms" onChange={(e) => set({ time: e.target.value })} /></div>}
          </div>
        )}
        {f.type === "count" && (
          <>
            <ExprField label="up: +1 on every rising edge of" value={f.up} onChange={(v) => set({ up: v })} aliases={aliases} extra={extra} />
            <ExprField label="down: −1 on every rising edge of (optional)" value={f.down} onChange={(v) => set({ down: v })} aliases={aliases} extra={extra} />
            <ExprField label="reset: count = 0 while (optional, a level)" value={f.reset} onChange={(v) => set({ reset: v })} aliases={aliases} extra={extra} />
            <div className="row">
              <div className="field grow"><label>preset: number or register (optional)</label><input className="input mono" value={f.preset} placeholder="10 / R2 / a setting" onChange={(e) => set({ preset: e.target.value })} /></div>
              <AddrField label="done: bit = 1 while count ≥ preset (optional)" value={f.done} placeholder="M24" onChange={(v) => set({ done: v })} onPick={() => pick("done", ["Q", "M"])} />
            </div>
          </>
        )}
        {(f.type === "move" || f.type === "calc") && (
          <div className="field"><label>{f.type === "move" ? "value: a number or a register" : "formula: + - * / % and brackets, e.g. R0 * 2 + R1"}</label><input className="input mono" value={f.value} placeholder={f.type === "move" ? "3 / R1" : "R0 * 2 + R1"} onChange={(e) => set({ value: e.target.value })} /></div>
        )}
        {f.type === "emergency" && <div className="field"><label>text: shown with the emergency (toast, alarm, log)</label><input className="input" value={f.text} placeholder="Door opened while running" onChange={(e) => set({ text: e.target.value })} /></div>}
        <div className="wiz-preview">- {JSON.stringify(toRow(f)).replace(/"(\w+)":/g, "$1: ").replace(/,/g, ", ").replace(/undefined/g, "")}</div>
        <div className={cx("xs muted")}>{HINTS[f.type]}</div>
      </Modal>
      {picker && (
        <Modal title="Pick" width={640} onClose={() => setPicker(null)}>
          <AddressPicker aliases={aliases} extra={extra} allow={picker.allow} onPick={(n) => { set({ [picker.field]: n }); setPicker(null); }} />
        </Modal>
      )}
    </>
  );
}
/** Address text field with a picker button (a top-level component, so typing keeps the focus). */
export function AddrField({ label, value, placeholder, onChange, onPick }) {
  return (
    <div className="field">{label && <label>{label}</label>}<div className="row"><input className="input mono grow" value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} /><button className="btn" onClick={onPick}>pick</button></div></div>
  );
}
const HINTS = {
  out: "A coil writes 1 AND 0, every scan. A bit has ONE out: rung; use set/reset when it must be written from several places.",
  set: "Several set: and reset: rungs may share a bit. If both are true in the same scan, the lower rung wins.",
  reset: "Several set: and reset: rungs may share a bit. If both are true in the same scan, the lower rung wins.",
  toggle: "Each 0→1 of the condition flips the bit. Holding the condition does not flip again.",
  count: "The register IS the counter: the web UI or the BT may write it (e.g. back to 0). move/calc may not write a counter register.",
  move: "With a RISE(...) condition the value is written once at the edge; without when: it is written every scan.",
  calc: "Whole numbers (int32); division by zero gives 0. The left side must be a register.",
  emergency: "Rising edge → S.PLC_EMERGENCY, controlled outputs to their safe value, sequences idle, the supervisor's trigger_emergency is called. Reset with the supervisor's reset_fault.",
};
