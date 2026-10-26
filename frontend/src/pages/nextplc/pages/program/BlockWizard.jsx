// BlockWizard -- USE <block> AS <name> WITH port = address ... from the library's port list.
import { useEffect, useMemo, useState } from "react";
import { Modal, cx } from "../../components/ui";
import AddressPicker from "../../components/AddressPicker";
import { blocksApi } from "../../lib/api";

/**
 * onSave(obj)     -> {use, as, with} for the YAML blocks: section; `initial` = the row being edited
 */
export default function BlockWizard({ aliases, onInsert, onSave, onClose, initial }) {
  const [blocks, setBlocks] = useState(null);
  const [sel, setSel] = useState(null);
  const [as, setAs] = useState("");
  const [vals, setVals] = useState(initial?.with || {});
  const [picker, setPicker] = useState(null);
  useEffect(() => {
    blocksApi.list().then((r) => {
      setBlocks(r.blocks);
      const first = (initial && r.blocks.find((b) => b.name === initial.use)) || r.blocks[0];
      if (first) { setSel(first); setAs(initial?.as || first.name); }
    });
  }, []); // eslint-disable-line
  const line = useMemo(() => {
    if (!sel) return "";
    const parts = sel.ports.filter((p) => vals[p.name]).map((p) => `${p.name} = ${vals[p.name]}`);
    return `USE ${sel.name} AS ${as || sel.name}${parts.length ? ` WITH ${parts.join(", ")}` : ""}`;
  }, [sel, as, vals]);
  const missing = sel ? sel.ports.filter((p) => !p.optional && !p.default && !vals[p.name]) : [];
  return (
    <>
      <Modal tut="plc-block-form" title={initial ? "Edit block instance" : "Use a library block"} width={760} onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={!sel || missing.length > 0} onClick={() => (onSave ? onSave({ use: sel.name, as: as || sel.name, with: Object.fromEntries(sel.ports.filter((p) => vals[p.name]).map((p) => [p.name, vals[p.name]])) }) : onInsert(line))}>{initial ? "Apply" : onSave ? "Add block" : "Insert line"}</button></>}>
        {!blocks ? <div className="empty">Loading the library…</div> : (
          <div className="col" style={{ gap: 12 }}>
            <div className="row">
              <div className="field grow"><label>Block</label><select className="select mono" value={sel?.name || ""} onChange={(e) => { const b = blocks.find((x) => x.name === e.target.value); setSel(b); setAs(b.name); setVals({}); }}>{blocks.map((b) => <option key={b.name} value={b.name}>{b.name} - {b.description}</option>)}</select></div>
              <div className="field" style={{ width: 180 }}><label>Instance name (AS)</label><input className="input mono" value={as} onChange={(e) => setAs(e.target.value.replace(/[^A-Za-z0-9_]/g, ""))} /></div>
            </div>
            {sel && (
              <div className="ports" style={{ gridTemplateColumns: "auto auto 1fr auto" }}>
                {sel.ports.map((p) => (
                  <PortRow key={p.name} p={p} value={vals[p.name] || ""} onChange={(v) => setVals({ ...vals, [p.name]: v })} onPick={() => setPicker({ port: p })} />
                ))}
              </div>
            )}
            {sel?.locals?.length > 0 && <div className="small muted">Readable after this line: {sel.locals.map((l) => `${as || sel.name}.${l.name}`).join(", ")} (and every port as {as || sel.name}.&lt;port&gt;)</div>}
            <div className="wiz-preview">{onSave ? `- {use: ${sel?.name}, as: ${as || sel?.name}, with: {${sel ? sel.ports.filter((p) => vals[p.name]).map((p) => `${p.name}: ${vals[p.name]}`).join(", ") : ""}}}` : line}</div>
            {missing.length > 0 && <div className="small" style={{ color: "var(--danger-text)" }}>Connect: {missing.map((p) => p.name).join(", ")}</div>}
          </div>
        )}
      </Modal>
      {picker && (
        <Modal title={`Port ${picker.port.name} (${picker.port.kind})`} width={640} onClose={() => setPicker(null)}>
          <AddressPicker aliases={aliases} allow={picker.port.kind === "out" ? ["Q", "M"] : picker.port.kind === "register" || picker.port.kind === "time" || picker.port.kind === "number" ? ["R"] : ["I", "Q", "M", "S"]} onPick={(name) => { setVals((v) => ({ ...v, [picker.port.name]: name })); setPicker(null); }} />
        </Modal>
      )}
    </>
  );
}
function PortRow({ p, value, onChange, onPick }) {
  const needs = p.kind === "time" ? "500ms, 2s or a setting" : p.kind === "number" ? "a number or a register" : p.kind === "register" ? "R0..R31" : p.kind === "out" ? "Q or M bit the block writes" : "a bit the block reads";
  return (
    <>
      <span className="pname">{p.name}</span>
      <span className={cx("pkind", p.kind)}>{p.kind}</span>
      <input className="input mono" placeholder={`${needs}${p.default ? ` (default ${p.default})` : p.optional ? " (optional)" : ""}`} value={value} onChange={(e) => onChange(e.target.value)} />
      <button className="btn sm" onClick={onPick}>pick</button>
    </>
  );
}
