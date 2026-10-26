// ConditionBuilder -- rows of "address · state · value" joined with AND / OR, producing the
// expression text of a rung condition: gpio1.di1 AND NOT M10, RISE(x), ON_FOR(x, 500ms), R0 >= 10 ...
import { useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Modal } from "./ui";
import AddressPicker from "./AddressPicker";

export const STATES = [
  { id: "on", label: "is 1 (on)", fmt: (x) => x },
  { id: "off", label: "is 0 (off)", fmt: (x) => `NOT ${x}` },
  { id: "rise", label: "goes 0→1 (RISE)", fmt: (x) => `RISE(${x})` },
  { id: "fall", label: "goes 1→0 (FALL)", fmt: (x) => `FALL(${x})` },
  { id: "on_for", label: "has been 1 for…", time: true, fmt: (x, t) => `ON_FOR(${x}, ${t})` },
  { id: "off_for", label: "has been 0 for…", time: true, fmt: (x, t) => `OFF_FOR(${x}, ${t})` },
  { id: "==", label: "= (equals)", num: true, fmt: (x, v) => `${x} == ${v}` },
  { id: "!=", label: "≠", num: true, fmt: (x, v) => `${x} != ${v}` },
  { id: ">", label: ">", num: true, fmt: (x, v) => `${x} > ${v}` },
  { id: ">=", label: ">=", num: true, fmt: (x, v) => `${x} >= ${v}` },
  { id: "<", label: "<", num: true, fmt: (x, v) => `${x} < ${v}` },
  { id: "<=", label: "<=", num: true, fmt: (x, v) => `${x} <= ${v}` },
  { id: "running", label: "sequence is running", seq: true, fmt: (x) => `seq.${x}.active` },
  { id: "idle", label: "sequence is idle", seq: true, fmt: (x) => `NOT seq.${x}.active` },
  { id: "step", label: "sequence is in step n", seq: true, num: true, fmt: (x, v) => `seq.${x}.step == ${v}` },
  { id: "true", label: "always (TRUE)", none: true, fmt: () => "TRUE" },
];
export const emptyRow = () => ({ join: "AND", addr: "", state: "on", value: "" });

export function buildExpr(rows) {
  return rows.map((c, i) => {
    const st = STATES.find((s) => s.id === c.state) || STATES[0];
    const x = c.addr || "?";
    const v = c.value || (st.time ? "500ms" : st.num ? "0" : "");
    return (i ? ` ${c.join} ` : "") + st.fmt(x, v);
  }).join("");
}

export function ConditionRows({ rows, onChange, aliases, extra, allow }) {
  const [picker, setPicker] = useState(null);
  const set = (i, patch) => onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  return (
    <div className="col" style={{ gap: 6 }}>
      {rows.map((c, i) => {
        const st = STATES.find((s) => s.id === c.state) || STATES[0];
        return (
          <div key={i} className="wiz-row">
            {i === 0 ? <span className="small muted">when</span> : <select className="select" value={c.join} onChange={(e) => set(i, { join: e.target.value })}><option>AND</option><option>OR</option></select>}
            {st.none ? <span className="small muted">—</span> : <button className="btn mono" style={{ justifyContent: "flex-start" }} onClick={() => setPicker(i)}>{c.addr || (st.seq ? "pick sequence…" : "pick address…")}</button>}
            <select className="select" value={c.state} onChange={(e) => set(i, { state: e.target.value })}>{STATES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</select>
            {st.time ? <input className="input mono" placeholder="500ms / 2s / R10" value={c.value} onChange={(e) => set(i, { value: e.target.value })} /> : st.num ? <input className="input mono" placeholder="number or Rn" value={c.value} onChange={(e) => set(i, { value: e.target.value })} /> : <span />}
            <button className="btn icon ghost sm" onClick={() => rows.length > 1 && onChange(rows.filter((_, j) => j !== i))} aria-label="Remove"><Trash2 size={14} /></button>
          </div>
        );
      })}
      <button className="btn sm ghost" style={{ alignSelf: "flex-start" }} onClick={() => onChange([...rows, emptyRow()])}><Plus size={14} />condition</button>
      {picker !== null && (
        <Modal title="Pick an address" width={640} onClose={() => setPicker(null)}>
          <AddressPicker aliases={aliases} extra={extra} allow={allow} onPick={(name) => { set(picker, { addr: name }); setPicker(null); }} />
        </Modal>
      )}
    </div>
  );
}

/** A text field for an expression with a "Build…" helper that fills it. */
export function ExprField({ label, value, onChange, aliases, extra, placeholder, hint }) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState([emptyRow()]);
  const preview = useMemo(() => buildExpr(rows), [rows]);
  return (
    <div className="field">
      {label && <label>{label}</label>}
      <div className="row">
        <input className="input mono grow" value={value} placeholder={placeholder || "gpio1.di1 AND S.AUTO"} onChange={(e) => onChange(e.target.value)} />
        <button className="btn" onClick={() => setOpen(true)}>Build…</button>
      </div>
      {hint && <span className="xs muted">{hint}</span>}
      {open && (
        <Modal title="Build the condition" width={760} onClose={() => setOpen(false)} footer={<><button className="btn" onClick={() => setOpen(false)}>Cancel</button><button className="btn" onClick={() => { onChange(value ? `${value} AND ${preview}` : preview); setOpen(false); }}>Append with AND</button><button className="btn primary" onClick={() => { onChange(preview); setOpen(false); }}>Use</button></>}>
          <ConditionRows rows={rows} onChange={setRows} aliases={aliases} extra={extra} />
          <div className="wiz-preview">{preview}</div>
          <div className="xs muted">AND binds before OR; use brackets in the text for anything else. RISE / FALL last one scan; ON_FOR / OFF_FOR take a time (500ms, 2s) or a register holding milliseconds.</div>
        </Modal>
      )}
    </div>
  );
}
