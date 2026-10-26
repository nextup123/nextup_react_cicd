// SequenceForm -- a sequence (name, start, abort) and its steps as a table.
import { useState } from "react";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { Modal } from "../../components/ui";
import AddressPicker from "../../components/AddressPicker";
import { ExprField } from "../../components/ConditionBuilder";

const newStep = (n) => ({ name: `step${n}`, do: [], next: "", timeout: "", on_timeout: "" });

export default function SequenceForm({ seq, aliases, extra, onSave, onClose }) {
  const [head, setHead] = useState({ name: seq?.name || "", start: seq?.start || "", abort: seq?.abort || "" });
  const [steps, setSteps] = useState(() => (seq?.steps?.length ? seq.steps.map((s) => ({ name: s.name || "", do: Array.isArray(s.do) ? s.do : [], next: s.next || "", timeout: s.timeout || "", on_timeout: s.on_timeout || "" })) : [newStep(1)]));
  const [picker, setPicker] = useState(null); // { i, field }
  const setStep = (i, patch) => setSteps(steps.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const move = (i, d) => { const j = i + d; if (j < 0 || j >= steps.length) return; const c = [...steps]; [c[i], c[j]] = [c[j], c[i]]; setSteps(c); };
  const valid = /^[A-Za-z0-9_]+$/.test(head.name) && head.start && steps.length && steps.every((s) => /^[A-Za-z0-9_]+$/.test(s.name) && s.next && (!s.timeout || s.on_timeout));
  return (
    <>
      <Modal tut="plc-seq-form" title={seq ? `Edit sequence ${seq.name}` : "Add a sequence"} width={900} onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={!valid} onClick={() => onSave(head, steps.map((s) => ({ name: s.name, do: s.do, next: s.next, timeout: s.timeout || undefined, on_timeout: s.timeout ? s.on_timeout : undefined })))}>{seq ? "Apply" : "Add sequence"}</button></>}>
        <div className="row">
          <div className="field" style={{ width: 200 }}><label>name (letters, digits, _)</label><input className="input mono" value={head.name} onChange={(e) => setHead({ ...head, name: e.target.value })} /></div>
          <div className="grow"><ExprField label="start: idle → step 1 when" value={head.start} onChange={(v) => setHead({ ...head, start: v })} aliases={aliases} extra={extra} placeholder="S.AUTO AND RISE(gpio1.di7)" /></div>
        </div>
        <ExprField label="abort: any step → idle, outputs off (optional)" value={head.abort} onChange={(v) => setHead({ ...head, abort: v })} aliases={aliases} extra={extra} placeholder="S.EMERGENCY OR NOT S.AUTO" />
        <div className="small muted">While a step is active, the bits in its <span className="mono">do</span> are 1 and every other bit the sequence owns is 0. A step is entered in one scan; its <span className="mono">next</span> is checked from the next scan on. <span className="mono">timeout</span> sets <span className="mono">on_timeout</span> (latched) and goes idle.</div>
        <table className="grid">
          <thead><tr><th>#</th><th>name</th><th>do (bits = 1)</th><th>next (go on when)</th><th>timeout</th><th>on_timeout</th><th /></tr></thead>
          <tbody>
            {steps.map((s, i) => (
              <tr key={i}>
                <td className="mono">{i + 1}</td>
                <td><input className="input mono" style={{ width: 110 }} value={s.name} onChange={(e) => setStep(i, { name: e.target.value })} /></td>
                <td>
                  <div className="row" style={{ flexWrap: "wrap", gap: 4 }}>
                    {s.do.map((d, k) => <span key={k} className="pill mono">{d}<button className="btn icon ghost sm" style={{ width: 18, height: 18 }} onClick={() => setStep(i, { do: s.do.filter((_, m) => m !== k) })}>×</button></span>)}
                    <button className="btn sm" onClick={() => setPicker({ i, field: "do" })}><Plus size={12} /></button>
                  </div>
                </td>
                <td><div className="row"><input className="input mono" style={{ width: 170 }} value={s.next} placeholder="gpio1.di2 / ON_FOR(TRUE, 2s)" onChange={(e) => setStep(i, { next: e.target.value })} /><button className="btn sm" onClick={() => setPicker({ i, field: "next" })}>pick</button></div></td>
                <td><input className="input mono" style={{ width: 70 }} value={s.timeout} placeholder="2s" onChange={(e) => setStep(i, { timeout: e.target.value })} /></td>
                <td><div className="row"><input className="input mono" style={{ width: 70 }} value={s.on_timeout} placeholder="M30" onChange={(e) => setStep(i, { on_timeout: e.target.value })} /><button className="btn sm" onClick={() => setPicker({ i, field: "on_timeout" })}>pick</button></div></td>
                <td><div className="row" style={{ gap: 2 }}><button className="btn icon ghost sm" onClick={() => move(i, -1)}><ArrowUp size={13} /></button><button className="btn icon ghost sm" onClick={() => move(i, 1)}><ArrowDown size={13} /></button><button className="btn icon ghost sm" onClick={() => steps.length > 1 && setSteps(steps.filter((_, j) => j !== i))}><Trash2 size={13} /></button></div></td>
              </tr>
            ))}
          </tbody>
        </table>
        <button className="btn sm ghost" style={{ alignSelf: "flex-start" }} onClick={() => setSteps([...steps, newStep(steps.length + 1)])}><Plus size={14} />step</button>
        <div className="xs muted">Shortcuts for <span className="mono">next</span>: a time — <span className="mono">ON_FOR(TRUE, 2s)</span>; an edge — <span className="mono">RISE(M13)</span>; the last step's next: TRUE goes idle at once. Other rungs read <span className="mono">seq.{head.name || "name"}.step</span>, <span className="mono">.active</span>, <span className="mono">.{steps[0]?.name || "step1"}</span>.</div>
      </Modal>
      {picker && (
        <Modal title="Pick" width={640} onClose={() => setPicker(null)}>
          <AddressPicker aliases={aliases} extra={extra} allow={picker.field === "next" ? undefined : ["Q", "M"]} onPick={(n) => { const s = steps[picker.i]; if (picker.field === "do") setStep(picker.i, { do: [...s.do, n] }); else setStep(picker.i, { [picker.field]: n }); setPicker(null); }} />
        </Modal>
      )}
    </>
  );
}
