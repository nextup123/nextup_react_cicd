// FormEditor -- the program (or block) as forms: names, blocks, rungs, sequences, alarms, safe
// state, retain. Every change is written back into the YAML text in place (YamlProgram keeps
// comments and order), so the text editor and this form always show the same file.
import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Pencil, Plus, Trash2 } from "lucide-react";
import { YamlProgram } from "nextplc-engine";
import { Modal, cx } from "../../components/ui";
import AddressPicker from "../../components/AddressPicker";
import RungForm, { describeRow } from "./RungForm";
import SequenceForm from "./SequenceForm";
import BlockWizard from "./BlockWizard";

const LEVELS = ["error", "warning", "info"];
const PORT_KINDS = ["in", "out", "register", "time", "number"];

export default function FormEditor({ text, onChange, aliases, extra, mode = "program", liveRungs, onGoLine }) {
  const y = useMemo(() => new YamlProgram(text), [text]);
  const [modal, setModal] = useState(null); // { kind, index, ... }
  const [picker, setPicker] = useState(null); // { allow, cb }
  const commit = () => onChange(y.toString());
  const isBlock = mode === "block";
  const names = y.names();
  const rungs = y.rungs();
  const blocks = y.blocks();
  const seqs = y.sequences();
  const alarms = y.alarms();
  const safe = y.safeState();
  const retain = y.strings("retain");
  const ports = isBlock ? y.entries("ports").map(({ key, value }) => ({ name: key, ...(typeof value === "object" ? value : { kind: String(value) }) })) : [];
  const locals = isBlock ? y.entries("locals").map(({ key, value }) => ({ name: key, area: String(value) })) : [];
  const allExtra = useMemo(() => [...(extra || []), ...ports.map((p) => ({ name: p.name, alias: "", hint: `port (${p.kind})` })), ...locals.map((l) => ({ name: l.name, alias: "", hint: `local (${l.area})` }))], [extra, ports, locals]);

  if (y.errors.length) return <div className="err-line"><b>code</b><span>The code is not valid (line {y.errors[0].line}: {y.errors[0].message}). Fix it in the editor, then the form can edit it.</span></div>;

  return (
    <div className="form-editor">
      {/* ---- header ---- */}
      <Section title={isBlock ? "Block" : "Program"}>
        <div className="row" style={{ gap: 12 }}>
          <Field label={isBlock ? "block (name)" : "program (name)"} value={y.scalar(isBlock ? "block" : "program")} mono onCommit={(v) => { y.setScalar(isBlock ? "block" : "program", v); commit(); }} />
          {isBlock ? <Field label="description" value={y.scalar("description")} grow onCommit={(v) => { y.setScalar("description", v); commit(); }} /> : <Field label="scan_ms (1..1000, empty = node default 10)" value={y.scalar("scan_ms")} mono onCommit={(v) => { y.setScalar("scan_ms", v); commit(); }} />}
        </div>
      </Section>

      {/* ---- ports / locals (block) ---- */}
      {isBlock && (
        <Section title="Ports" count={ports.length} onAdd={() => setModal({ kind: "port" })} hint="What the block reads (in), writes (out), its registers, times and numbers. The program connects addresses to them.">
          {ports.length > 0 && (
            <table className="grid"><thead><tr><th>port</th><th>kind</th><th>optional</th><th>default</th><th /></tr></thead><tbody>
              {ports.map((p) => <tr key={p.name}><td className="mono">{p.name}</td><td><span className={cx("pkind", p.kind)}>{p.kind}</span></td><td>{String(p.optional) === "true" ? "yes" : ""}</td><td className="mono">{p.default ?? ""}</td><td><RowBtns onEdit={() => setModal({ kind: "port", port: p })} onDelete={() => { y.removeEntry("ports", p.name); commit(); }} /></td></tr>)}
            </tbody></table>
          )}
        </Section>
      )}
      {isBlock && (
        <Section title="Locals" count={locals.length} onAdd={() => setPrompt(setModal, "local")} hint="Internal bits (M) and registers (R), allocated per instance; readable as <as>.<local>.">
          <div className="row" style={{ flexWrap: "wrap", gap: 4 }}>{locals.map((l) => <span key={l.name} className="pill mono">{l.name} ({l.area})<button className="btn icon ghost sm" style={{ width: 18, height: 18 }} onClick={() => { y.removeEntry("locals", l.name); commit(); }}>×</button></span>)}</div>
        </Section>
      )}

      {/* ---- names ---- */}
      {!isBlock && (
        <Section title="Names" count={names.length} onAdd={() => setModal({ kind: "name" })} hint="A name is another way to write an address. Letters, digits, _; not a raw address or a keyword.">
          {names.length > 0 && (
            <table className="grid"><thead><tr><th>name</th><th>address</th><th>section</th><th /></tr></thead><tbody>
              {names.map((n) => <tr key={n.section + n.key}><td className="mono">{n.key}</td><td className="mono">{n.value}</td><td className="muted xs">{n.section}</td><td><RowBtns onEdit={() => setModal({ kind: "name", name: n })} onDelete={() => { y.removeName(n.key); commit(); }} /></td></tr>)}
            </tbody></table>
          )}
        </Section>
      )}

      {/* ---- blocks ---- */}
      {!isBlock && (
        <Section title="Blocks" count={blocks.length} onAdd={() => setModal({ kind: "block" })} hint="A library block with your addresses on its ports. Its rungs run after the program's own rungs.">
          {blocks.map((b, i) => (
            <div key={i} className="form-row">
              <span className="pill mono">{b.use}</span><b className="mono small">{b.as || b.use}</b>
              <span className="mono xs muted truncate grow">{Object.entries(b.with || {}).map(([k, v]) => `${k}=${v}`).join("  ")}</span>
              <RowBtns onEdit={() => setModal({ kind: "block", index: i, row: b })} onUp={() => { y.moveRow("blocks", i, i - 1); commit(); }} onDown={() => { y.moveRow("blocks", i, i + 1); commit(); }} onDelete={() => { y.removeRow("blocks", i); commit(); }} />
            </div>
          ))}
        </Section>
      )}

      {/* ---- rungs ---- */}
      <Section title="Rungs" count={rungs.length} onAdd={() => setModal({ kind: "rung" })} hint="Run top to bottom every scan. One owner per bit: out / toggle / done / sequence outputs own their bit; set / reset may share.">
        {rungs.map((r, i) => {
          const [head, detail] = describeRow(r);
          const live = liveRungs ? liveRungs[i] : undefined;
          return (
            <div key={i} className={cx("form-row rung", live && "live")} onDoubleClick={() => setModal({ kind: "rung", index: i, row: r })}>
              <span className="num">{i + 1}</span>
              <span className={cx("type", r.type)}>{r.type}</span>
              <div className="grow col" style={{ gap: 0, minWidth: 0 }}><b className="mono small truncate">{head}</b><span className="mono xs muted truncate">{detail}</span></div>
              {live !== undefined && <span className={cx("pill", live && "on")}>{live ? "TRUE" : "false"}</span>}
              <RowBtns onEdit={() => setModal({ kind: "rung", index: i, row: r })} onUp={() => { y.moveRow("rungs", i, i - 1); commit(); }} onDown={() => { y.moveRow("rungs", i, i + 1); commit(); }} onDelete={() => { y.removeRow("rungs", i); commit(); }} onGo={onGoLine && y.lineOfRow("rungs", i) ? () => onGoLine(y.lineOfRow("rungs", i)) : undefined} />
            </div>
          );
        })}
        {!rungs.length && <div className="empty">No rungs yet. <b>Add a rung</b>: pick the type, the bit it writes and the condition.</div>}
      </Section>

      {/* ---- sequences ---- */}
      <Section title="Sequences" count={seqs.length} onAdd={() => setModal({ kind: "seq" })} hint="Step logic (SFC): one step at a time; the step's bits are 1, the others 0.">
        {seqs.map((s, i) => (
          <div key={i} className="form-row" style={{ alignItems: "flex-start" }}>
            <div className="grow col" style={{ gap: 2, minWidth: 0 }}>
              <div className="row"><b className="mono small">{s.name}</b><span className="mono xs muted">start: {s.start}</span>{s.abort && <span className="mono xs muted">abort: {s.abort}</span>}</div>
              <div className="row" style={{ flexWrap: "wrap", gap: 4 }}>{s.steps.map((st, k) => <span key={k} className="seqstep" title={`do ${JSON.stringify(st.do)} · next ${st.next}${st.timeout ? ` · timeout ${st.timeout} → ${st.on_timeout}` : ""}`}>{k + 1} {st.name}</span>)}</div>
            </div>
            <RowBtns onEdit={() => setModal({ kind: "seq", index: i, row: s })} onDelete={() => { y.removeRow("sequences", i); commit(); }} onGo={onGoLine && y.lineOfRow("sequences", i) ? () => onGoLine(y.lineOfRow("sequences", i)) : undefined} />
          </div>
        ))}
      </Section>

      {/* ---- alarms ---- */}
      <Section title="Alarms" count={alarms.length} onAdd={() => setModal({ kind: "alarm" })} hint="When the bit goes 0→1 the text is sent as a PLC alarm and shown as a message (unless toast: false).">
        {alarms.length > 0 && (
          <table className="grid"><thead><tr><th>bit</th><th>text</th><th>level</th><th>toast</th><th /></tr></thead><tbody>
            {alarms.map((a, i) => <tr key={i}><td className="mono">{a.bit}</td><td>{a.text}</td><td>{a.level || "error"}</td><td>{String(a.toast ?? "true")}</td><td><RowBtns onEdit={() => setModal({ kind: "alarm", index: i, row: a })} onDelete={() => { y.removeRow("alarms", i); commit(); }} /></td></tr>)}
          </tbody></table>
        )}
      </Section>

      {/* ---- safe state + retain ---- */}
      <Section title="Safe state" hint={isBlock ? "Ports that keep following the rungs in an emergency (lamps, horn)." : "Where the controlled outputs go in an emergency, with stale inputs, without a program. Exempt outputs keep following the rungs."}>
        <div className="col" style={{ gap: 8 }}>
          {!isBlock && (
            <div className="row"><span className="small">default value of every controlled output</span><select className="select" value={safe.default} onChange={(e) => { y.setSafeState({ ...safe, default: e.target.value }); commit(); }}><option value="0">0</option><option value="1">1</option></select></div>
          )}
          <div className="row" style={{ flexWrap: "wrap", gap: 4 }}>
            <span className="small">exempt (keep running):</span>
            {safe.exempt.map((e) => <span key={e} className="pill mono warn">{e}<button className="btn icon ghost sm" style={{ width: 18, height: 18 }} onClick={() => { y.setSafeState({ ...safe, exempt: safe.exempt.filter((x) => x !== e) }); commit(); }}>×</button></span>)}
            <button className="btn sm" onClick={() => setPicker({ allow: ["Q"], extraOnly: isBlock, cb: (n) => { y.setSafeState({ ...safe, exempt: [...safe.exempt, n] }); commit(); } })}><Plus size={12} />output</button>
          </div>
          {!isBlock && (
            <div className="row" style={{ flexWrap: "wrap", gap: 4 }}>
              <span className="small">per output:</span>
              {safe.values.map((v) => <span key={v.name} className="pill mono">{v.name} → {v.value}<button className="btn icon ghost sm" style={{ width: 18, height: 18 }} onClick={() => { y.setSafeState({ ...safe, values: safe.values.filter((x) => x.name !== v.name) }); commit(); }}>×</button></span>)}
              <button className="btn sm" onClick={() => setPicker({ allow: ["Q"], cb: (n) => { y.setSafeState({ ...safe, values: [...safe.values.filter((x) => x.name !== n), { name: n, value: safe.default === "1" ? "0" : "1" }] }); commit(); } })}><Plus size={12} />output = {safe.default === "1" ? "0" : "1"}</button>
            </div>
          )}
        </div>
      </Section>
      <Section title="Retained registers" hint="Saved on the robot when they change and restored at the next start.">
        <div className="row" style={{ flexWrap: "wrap", gap: 4 }}>
          {retain.map((r) => <span key={r} className="pill mono">{r}<button className="btn icon ghost sm" style={{ width: 18, height: 18 }} onClick={() => { y.setStrings("retain", retain.filter((x) => x !== r)); commit(); }}>×</button></span>)}
          <button className="btn sm" onClick={() => setPicker({ allow: ["R"], extraOnly: isBlock, cb: (n) => { y.setStrings("retain", [...retain, n]); commit(); } })}><Plus size={12} />register</button>
        </div>
      </Section>

      {/* ---- modals ---- */}
      {modal?.kind === "rung" && <RungForm row={modal.row} aliases={aliases} extra={allExtra} onClose={() => setModal(null)} onSave={(obj) => { if (modal.index === undefined) y.addRow("rungs", obj); else y.setRow("rungs", modal.index, obj); commit(); setModal(null); }} />}
      {modal?.kind === "seq" && <SequenceForm seq={modal.row} aliases={aliases} extra={allExtra} onClose={() => setModal(null)} onSave={(head, steps) => { y.setSequence(modal.index === undefined ? -1 : modal.index, head, steps); commit(); setModal(null); }} />}
      {modal?.kind === "block" && <BlockWizard aliases={aliases} initial={modal.row} onClose={() => setModal(null)} onSave={(obj) => { if (modal.index === undefined) y.addRow("blocks", obj); else y.setRow("blocks", modal.index, obj); commit(); setModal(null); }} />}
      {modal?.kind === "alarm" && <AlarmForm row={modal.row} aliases={aliases} extra={allExtra} onClose={() => setModal(null)} onSave={(obj) => { if (modal.index === undefined) y.addRow("alarms", obj); else y.setRow("alarms", modal.index, obj); commit(); setModal(null); }} />}
      {modal?.kind === "name" && <NameForm name={modal.name} onClose={() => setModal(null)} onSave={(key, value) => { y.setName(key, value, modal.name?.key); commit(); setModal(null); }} />}
      {modal?.kind === "port" && <PortForm port={modal.port} onClose={() => setModal(null)} onSave={(p) => { if (modal.port && modal.port.name !== p.name) y.removeEntry("ports", modal.port.name); const def = { kind: p.kind }; if (p.optional) def.optional = "true"; if (p.default) def.default = p.default; y.setEntry("ports", p.name, def); commit(); setModal(null); }} />}
      {modal?.kind === "local" && <LocalForm onClose={() => setModal(null)} onSave={(name, area) => { y.setEntry("locals", name, area); commit(); setModal(null); }} />}
      {picker && <Modal title="Pick" width={640} onClose={() => setPicker(null)}><AddressPicker aliases={aliases} extra={allExtra} allow={picker.extraOnly ? [] : picker.allow} preferAlias={false} onPick={(n) => { picker.cb(n); setPicker(null); }} /></Modal>}
    </div>
  );
}
const setPrompt = (setModal, kind) => setModal({ kind });

function Section({ title, count, hint, onAdd, children }) {
  return (
    <section className="form-section">
      <div className="form-section-head"><h3>{title}{count !== undefined && <span className="cnt">{count}</span>}</h3>{hint && <span className="xs muted grow">{hint}</span>}{onAdd && <button className="btn sm" onClick={onAdd}><Plus size={13} />add</button>}</div>
      <div className="form-section-body">{children}</div>
    </section>
  );
}
function RowBtns({ onEdit, onUp, onDown, onDelete, onGo }) {
  return (
    <div className="row" style={{ gap: 2, flexShrink: 0 }}>
      {onGo && <button className="btn sm ghost" onClick={onGo} title="Show in the text">line</button>}
      {onEdit && <button className="btn icon ghost sm" onClick={onEdit} aria-label="Edit"><Pencil size={13} /></button>}
      {onUp && <button className="btn icon ghost sm" onClick={onUp} aria-label="Move up"><ArrowUp size={13} /></button>}
      {onDown && <button className="btn icon ghost sm" onClick={onDown} aria-label="Move down"><ArrowDown size={13} /></button>}
      {onDelete && <button className="btn icon ghost sm" onClick={onDelete} aria-label="Delete"><Trash2 size={13} /></button>}
    </div>
  );
}
/** A text field that writes on blur / Enter (so typing does not rewrite the YAML on every key). */
function Field({ label, value, onCommit, mono, grow }) {
  const [v, setV] = useState(value);
  const [last, setLast] = useState(value);
  if (value !== last) { setLast(value); setV(value); }
  return <div className={cx("field", grow && "grow")}><label>{label}</label><input className={cx("input", mono && "mono")} value={v} onChange={(e) => setV(e.target.value)} onBlur={() => { if (v !== value) onCommit(v); }} onKeyDown={(e) => { if (e.key === "Enter") e.target.blur(); }} /></div>;
}

function AlarmForm({ row, aliases, extra, onClose, onSave }) {
  const [a, setA] = useState({ bit: row?.bit || "", text: row?.text || "", level: row?.level || "error", toast: String(row?.toast ?? "true") });
  const [pick, setPick] = useState(false);
  return (
    <>
      <Modal title={row ? "Edit alarm" : "Add an alarm"} onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={!a.bit} onClick={() => onSave({ bit: a.bit, text: a.text || undefined, level: a.level, toast: a.toast })}>{row ? "Apply" : "Add"}</button></>}>
        <div className="field"><label>bit (any bit: M30, gpio1.di1, S.IO_FAULT, a name)</label><div className="row"><input className="input mono grow" value={a.bit} onChange={(e) => setA({ ...a, bit: e.target.value })} /><button className="btn" onClick={() => setPick(true)}>pick</button></div></div>
        <div className="field"><label>text</label><input className="input" value={a.text} placeholder="gpio1.di2 did not come within 2 s" onChange={(e) => setA({ ...a, text: e.target.value })} /></div>
        <div className="row">
          <div className="field grow"><label>level</label><select className="select" value={a.level} onChange={(e) => setA({ ...a, level: e.target.value })}>{LEVELS.map((l) => <option key={l}>{l}</option>)}</select></div>
          <div className="field grow"><label>toast in the web UI</label><select className="select" value={a.toast} onChange={(e) => setA({ ...a, toast: e.target.value })}><option value="true">true</option><option value="false">false (silent)</option></select></div>
        </div>
      </Modal>
      {pick && <Modal title="Pick" width={640} onClose={() => setPick(false)}><AddressPicker aliases={aliases} extra={extra} onPick={(n) => { setA({ ...a, bit: n }); setPick(false); }} /></Modal>}
    </>
  );
}
function NameForm({ name, onClose, onSave }) {
  const [key, setKey] = useState(name?.key || "");
  const [value, setValue] = useState(name?.value || "");
  const [pick, setPick] = useState(false);
  const bad = !/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) ? "letters, digits and _, not starting with a digit" : /^(m|r)\d+$/i.test(key) || /^(joint\d|gpio1)\./i.test(key) || /^s\./i.test(key) ? "that is a raw address" : "";
  return (
    <>
      <Modal title={name ? "Edit name" : "Add a name"} onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={Boolean(bad) || !value} onClick={() => onSave(key, value)}>{name ? "Apply" : "Add"}</button></>}>
        <div className="row">
          <div className="field grow"><label>name</label><input className="input mono" value={key} onChange={(e) => setKey(e.target.value)} /></div>
          <div className="field grow"><label>address</label><div className="row"><input className="input mono grow" value={value} onChange={(e) => setValue(e.target.value)} /><button className="btn" onClick={() => setPick(true)}>pick</button></div></div>
        </div>
        {bad && key && <div className="small" style={{ color: "var(--danger-text)" }}>{bad}</div>}
      </Modal>
      {pick && <Modal title="Pick" width={640} onClose={() => setPick(false)}><AddressPicker aliases={new Map()} preferAlias={false} onPick={(n) => { setValue(n); setPick(false); }} /></Modal>}
    </>
  );
}
function PortForm({ port, onClose, onSave }) {
  const [p, setP] = useState({ name: port?.name || "", kind: port?.kind || "in", optional: String(port?.optional) === "true", default: port?.default || "" });
  const ok = /^[A-Za-z_][A-Za-z0-9_]*$/.test(p.name) && !["and", "or", "not", "true", "false", "rise", "fall", "on_for", "off_for"].includes(p.name.toLowerCase());
  return (
    <Modal title={port ? "Edit port" : "Add a port"} onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={!ok} onClick={() => onSave(p)}>{port ? "Apply" : "Add"}</button></>}>
      <div className="row">
        <div className="field grow"><label>port name</label><input className="input mono" value={p.name} onChange={(e) => setP({ ...p, name: e.target.value })} /></div>
        <div className="field" style={{ width: 160 }}><label>kind</label><select className="select" value={p.kind} onChange={(e) => setP({ ...p, kind: e.target.value })}>{PORT_KINDS.map((k) => <option key={k}>{k}</option>)}</select></div>
      </div>
      <div className="row">
        <label className="row small"><input type="checkbox" checked={p.optional} onChange={(e) => setP({ ...p, optional: e.target.checked })} />optional (an open in reads 0, an open out gets a private M bit)</label>
      </div>
      <div className="field"><label>default (a value like 2s / 10 / S.ARMED / TRUE, or the name of another port)</label><input className="input mono" value={p.default} onChange={(e) => setP({ ...p, default: e.target.value })} /></div>
      <div className="xs muted">{{ in: "any bit the block reads (I, Q, M, S) or TRUE / FALSE", out: "a Q or M bit the block writes — it belongs to the block (one owner per bit)", register: "an R register", time: "500ms, 2s, or a register / SETTING holding milliseconds", number: "a whole number or a register / SETTING" }[p.kind]}</div>
    </Modal>
  );
}
function LocalForm({ onClose, onSave }) {
  const [name, setName] = useState("");
  const [area, setArea] = useState("M");
  return (
    <Modal title="Add a local" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)} onClick={() => onSave(name, area)}>Add</button></>}>
      <div className="row">
        <div className="field grow"><label>local name</label><input className="input mono" value={name} onChange={(e) => setName(e.target.value)} /></div>
        <div className="field" style={{ width: 120 }}><label>area</label><select className="select" value={area} onChange={(e) => setArea(e.target.value)}><option>M</option><option>R</option></select></div>
      </div>
    </Modal>
  );
}
