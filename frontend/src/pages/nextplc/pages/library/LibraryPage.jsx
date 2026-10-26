// LibraryPage -- the block library: ports, locals, what each block does, the file itself.
// A block is used with USE <block> AS <name> WITH port = address ... (Program page: "Use a block").
import { useEffect, useState } from "react";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { Copy, FilePlus2, Pencil, Trash2 } from "lucide-react";
import { newBlockYaml } from "nextplc-engine";
import { blocksApi } from "../../lib/api";
import { toast } from "../../store/toast";
import CodeEditor from "../../components/CodeEditor";
import { PromptModal, Tabs, confirm, cx } from "../../components/ui";
import BlockEditor from "./BlockEditor";
import { Split } from "../../../../components/ui/Split";
import { usePref } from "../../lib/prefs";
import { plainText } from "../../../../lib/plainText";

export default function LibraryPage() {
  const [data, setData] = useState(null);
  const [sel, setSel] = useState(null);
  const [tab, setTab] = usePref("libraryTab", "ports");
  const [showList, setShowList] = usePref("libraryList", true);
  const [editing, setEditing] = useState(null); // { name, text, isNew }
  const [naming, setNaming] = useState(null); // "new" | "copy"
  const load = () => blocksApi.list().then((r) => { setData(r); setSel((s) => r.blocks.find((b) => b.name === s?.name) || r.blocks[0] || null); }).catch((e) => toast.error(plainText(e.message)));
  useEffect(() => { load(); }, []);
  if (editing) return <BlockEditor name={editing.name} initialText={editing.text} isNew={editing.isNew} onClose={() => { setEditing(null); load(); }} onSaved={load} />;
  if (!data) return <div className="page"><div className="empty">Loading the library…</div></div>;
  const useLine = (b) => `- {use: ${b.name}, as: ${b.name}, with: {${b.ports.filter((p) => !p.optional && !p.default).map((p) => `${p.name}: ?`).join(", ")}}}`;
  const validName = (v) => (/^[A-Za-z_][A-Za-z0-9_]*$/.test(v) ? (data.blocks.some((b) => b.name === v && b.source === "library") ? "that name is a library block; choose another" : "") : "letters, digits and _");
  return (
    <div className="page">
      <Split id="plc.library" defaults={[1, 3]} min={[240, 380]} className="plc-split">
        {showList && <div key="list" className="panel">
          <div className="panel-head" data-tut="plc-lib-head"><h3>Blocks</h3><span className="muted xs">{data.blocks.length}</span><span className="grow" /><button data-tut="plc-lib-new" className="btn sm" onClick={() => setNaming("new")}><FilePlus2 size={13} />New block</button><button className="btn sm icon ghost" onClick={() => setShowList(false)} title="Hide the list"><PanelLeftClose size={14} /></button></div>
          <div className="panel-body"><div className="liblist" data-tut="plc-lib-list">
            {data.blocks.map((b) => <button key={b.name} className={cx("libitem", sel?.name === b.name && "active")} onClick={() => setSel(b)}><b>{b.name}</b><span>{b.description}</span>{b.source === "user" && <span className="pill">your block</span>}</button>)}
            {!data.blocks.length && <div className="empty">No blocks found: the PLC package is not installed on this computer.</div>}
          </div></div>
        </div>}
        {sel ? (
          <div key="block" className="panel" data-tut="plc-lib-block">
            <div className="panel-head">{!showList && <button className="btn sm icon ghost" onClick={() => setShowList(true)} title="Show the list of blocks"><PanelLeftOpen size={14} /></button>}<h3 className="mono">{sel.name}</h3><span className="muted small">{sel.description}</span><span className="grow" /><Tabs value={tab} onChange={setTab} items={[{ id: "ports", label: "Ports" }, { id: "doc", label: "How it works" }, { id: "file", label: "Code" }]} /></div>
            <div className={cx("panel-body", tab === "file" && "tight")} style={tab === "file" ? { display: "flex" } : undefined}>
              {tab === "ports" && (
                <div className="col" style={{ gap: 14 }}>
                  <div className="ports">
                    {sel.ports.map((p) => <PortRow key={p.name} p={p} />)}
                  </div>
                  {sel.locals.length > 0 && <div className="small"><b>Locals</b> (readable as <span className="mono">&lt;as&gt;.&lt;local&gt;</span>): {sel.locals.map((l) => <span key={l.name} className="pill mono" style={{ marginRight: 4 }}>{l.name} ({l.area})</span>)}</div>}
                  <div className="small muted">{sel.rungs} rungs{sel.sequences ? `, ${sel.sequences} sequences` : ""}{sel.alarms ? `, ${sel.alarms} alarms` : ""}{sel.exempt?.length ? ` · exempt from the safe state: ${sel.exempt.join(", ")}` : ""}{sel.retain?.length ? ` · retained: ${sel.retain.join(", ")}` : ""}</div>
                  <div className="wiz-preview" data-tut="plc-lib-useline">{useLine(sel)}</div>
                  <div className="row">
                    <button data-tut="plc-lib-copyline" className="btn sm" onClick={() => { navigator.clipboard?.writeText(useLine(sel)); toast.success("blocks: line copied"); }}><Copy size={14} />Copy blocks: line</button>
                    {sel.source === "user" ? <>
                      <button data-tut="plc-lib-edit" className="btn sm" onClick={() => setEditing({ name: sel.name, text: sel.text, isNew: false })}><Pencil size={14} />Edit block</button>
                      <button className="btn sm ghost" onClick={async () => { if (await confirm({ title: "Delete block", message: `Delete your block ${sel.name}? Programs that use it will not load any more.`, okLabel: "Delete", danger: true })) { try { await blocksApi.remove(sel.name); } catch (e) { toast.error(plainText(e.message)); } load(); } }}><Trash2 size={14} /></button>
                    </> : <button data-tut="plc-lib-copy" className="btn sm" onClick={() => setNaming("copy")}><Pencil size={14} />Copy to my blocks and edit</button>}
                  </div>
                </div>
              )}
              {tab === "doc" && <div className="blockdoc">{sel.doc || "(this block has no description)"}</div>}
              {tab === "file" && <CodeEditor value={sel.text} readOnly onChange={() => {}} />}
            </div>
          </div>
        ) : <div key="block" className="panel"><div className="empty">Pick a block.</div></div>}
      </Split>
      {naming && <PromptModal tut="plc-lib-name" title={naming === "new" ? "New block" : `Copy ${sel?.name} to my blocks`} label="Block name (letters, digits and _)" initial={naming === "new" ? "my_block" : `my_${sel?.name}`} okLabel={naming === "new" ? "Create" : "Copy"} validate={validName} onClose={() => setNaming(null)} onSubmit={(v) => { const text = naming === "new" ? newBlockYaml(v) : sel.text.replace(/^block:\s*\S+/m, `block: ${v}`); setNaming(null); setEditing({ name: v, text, isNew: true }); }} />}
    </div>
  );
}
function PortRow({ p }) {
  const what = { in: "a bit the block reads", out: "a Q or M bit the block writes (it owns it)", register: "an R register", time: "a time (500ms, 2s) or a register in ms", number: "a whole number or a register" }[p.kind];
  return (
    <>
      <span className="pname">{p.name}</span>
      <span className={cx("pkind", p.kind)}>{p.kind}</span>
      <span className="small">{what}{p.default ? <span className="muted"> · default {p.default}</span> : p.optional ? <span className="muted"> · optional</span> : null}</span>
    </>
  );
}
