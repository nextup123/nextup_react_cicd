// ProgramPage -- write the logic as code, guided. Left: the text with syntax colouring, the
// error line and live rung marks. Right: the Form (the same program as tables, two-way), the
// Teacher (every rung read back), the Ladder (live power flow when this program runs in the
// PLC), the Guide (cursor-aware reference), the Outline and the Check output. The two panes
// resize (Split "plc.program"); "Hide code" removes the left one and the right takes the width.
// Each project has one program, "This project's program" (saved and versioned with the project;
// the PLC runs it for this project and loads it when it starts). Every other program is in the
// library, shared by all projects; "Use in this project" copies a library program over it and
// "Save as" keeps a copy of any program in the library.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, Code2, Download, FilePlus2, Save, Trash2, Boxes, ListPlus, Upload, Lightbulb, PlusSquare, Workflow, Star } from "lucide-react";
import { YamlProgram, newProgramYaml } from "nextplc-engine";
import CodeEditor from "../../components/CodeEditor";
import { Modal, PromptModal, Tabs, confirm, cx } from "../../components/ui";
import AddressPicker from "../../components/AddressPicker";
import RungForm from "./RungForm";
import SequenceForm from "./SequenceForm";
import BlockWizard from "./BlockWizard";
import FormEditor from "./FormEditor";
import GuidePanel from "./GuidePanel";
import { PATTERNS, applyPattern } from "./yamlPatterns";
import { TeacherPanel, OutlinePanel, useNameRead } from "./panels";
import LadderEditor from "./LadderEditor";
import { programsApi } from "../../lib/api";
import { usePlc } from "../../store/plc";
import { toast } from "../../store/toast";
import { aliasMap } from "../../lib/addresses";
import { usePref } from "../../lib/prefs";
import { Split } from "../../../../components/ui/Split";
import { plainName, plainText } from "../../../../lib/plainText";
import { useBridge } from "../../../../tutorial/bridge";
import { guardIdle } from "../../../../lib/interlock";

const DRAFT_KEY = "nextup.plc.draft";
const PROJECT = "@project";
const isProject = (n) => n === PROJECT;
const progLabel = (n) => (isProject(n) ? "this project's program" : plainName(n));
const YAML_RE = /^[A-Za-z0-9_][A-Za-z0-9_.-]*\.ya?ml$/i;
const isYamlName = (n) => YAML_RE.test(n || "");
// names are typed and shown without the extension
const NAME_RE = /^[A-Za-z0-9_][A-Za-z0-9_.-]*$/;
const toFile = (v) => `${v.replace(/\.ya?ml$/i, "")}.yaml`;
const nameError = (v) => (NAME_RE.test(v.replace(/\.ya?ml$/i, "")) ? "" : "letters, digits, - and _");
const err = (e) => toast.error(plainText(e.message));

export default function ProgramPage() {
  const plcProgram = usePlc((s) => s.program);
  const bridge = usePlc((s) => s.bridge);
  // only what the live marks need, as strings, so the page redraws when a rung or step changes
  const programOk = usePlc((s) => Boolean(s.state?.program_ok));
  const rungKey = usePlc((s) => (s.state ? s.state.rungs.map((r) => (r.result ? 1 : 0)).join("") : ""));
  const seqKey = usePlc((s) => (s.state ? JSON.stringify(s.state.seqs) : ""));
  const [files, setFiles] = useState([]);
  const [hasProject, setHasProject] = useState(true);
  const [name, setName] = useState("");
  const [text, setText] = useState("");
  const [savedText, setSavedText] = useState("");
  const [described, setDescribed] = useState(null);
  const [error, setError] = useState(null);
  const [checkOut, setCheckOut] = useState(null);
  const [cursorLine, setCursorLine] = useState(1);
  const [goLine, setGoLine] = useState(null);
  const [tab, setTab] = usePref("programTab", "ladder");
  const [hideCode, setHideCode] = usePref("hideCode", false);
  const [modal, setModal] = useState(null);
  const [busy, setBusy] = useState("");
  const describeTimer = useRef(null);
  const dirty = text !== savedText;
  const lines = useMemo(() => text.split("\n"), [text]);


  // ---- files ----
  const refresh = useCallback(async () => {
    const r = await programsApi.list();
    const all = [...(r.project ? [r.project] : []), ...r.programs.filter((f) => isYamlName(f.name))];
    setFiles(all);
    setHasProject(Boolean(r.project));
    return all;
  }, []);
  const open = useCallback(async (n) => {
    const r = await programsApi.read(n);
    setName(r.name); setText(r.text); setSavedText(r.text); setCheckOut(null); setCursorLine(1);
    try { localStorage.setItem(DRAFT_KEY, n); } catch { /* ignore */ }
  }, []);
  useEffect(() => {
    refresh().then((list) => {
      const last = localStorage.getItem(DRAFT_KEY);
      const pick = list.find((f) => f.name === last) || list.find((f) => f.project) || list.find((f) => f.active) || list[0];
      if (pick) open(pick.name);
    }).catch(err);
  }, [refresh, open]);

  // ---- describe (debounced) ----
  useEffect(() => {
    clearTimeout(describeTimer.current);
    if (!text.trim()) { setDescribed(null); setError(null); return; }
    describeTimer.current = setTimeout(async () => {
      try {
        const r = await programsApi.describe(text, name || "program.yaml");
        if (r.ok) { setDescribed(r.program); setError(null); }
        else { setDescribed(null); const m = /^line (\d+|\?): ?(.*)$/s.exec(r.error); setError({ message: m ? m[2] : r.error, line: m && m[1] !== "?" ? Number(m[1]) : null }); }
      } catch (e) { setError({ message: e.message, line: null }); }
    }, 250);
    return () => clearTimeout(describeTimer.current);
  }, [text, name]);

  // ---- live ----
  const isLive = Boolean(plcProgram?.ok && plcProgram.text === text && programOk);
  const readName = useNameRead(isLive, described);
  useBridge("nextplc", { name, dirty, files: files.map((f) => f.name), hasProject, tab, hideCode, error: Boolean(error), isLive, rungs: described?.rung_count ?? null, seqs: described?.sequence_count ?? null, blocks: described?.blocks?.length ?? null, checked: checkOut ? Boolean(checkOut.ok) : null });
  const liveRungs = useMemo(() => (isLive ? [...rungKey].map((c) => c === "1") : null), [isLive, rungKey]);
  const seqLive = useMemo(() => (isLive && seqKey ? JSON.parse(seqKey) : null), [isLive, seqKey]);
  const liveLines = useMemo(() => {
    if (!liveRungs || !described) return null;
    const s = new Set();
    described.rungs.forEach((r) => { if (liveRungs[r.index] && r.type !== "emergency") s.add(r.line); });
    return s;
  }, [liveRungs, described]);
  const aliases = useMemo(() => aliasMap(described?.aliases), [described]);
  const extra = useMemo(() => {
    const y = new YamlProgram(text);
    const seqs = y.errors.length ? [] : y.sequences().map((s) => ({ name: s.name, alias: "", hint: "sequence (seq.<name>.step / .active)" }));
    const blocks = y.errors.length ? [] : y.blocks().map((b) => ({ name: b.as || b.use, alias: "", hint: `block ${b.use} (<as>.<port>, <as>.<local>)` }));
    return [...seqs, ...blocks];
  }, [text]);

  // ---- document edits from the helpers ----
  const withDoc = (fn) => {
    const y = new YamlProgram(text);
    if (y.errors.length) { toast.error(`The code is not valid (line ${y.errors[0].line}); fix it first.`); return; }
    fn(y);
    setText(y.toString());
    setModal(null);
  };
  const insertAtCursor = (snippet) => {
    const ls = text.split("\n");
    const i = Math.min(cursorLine, ls.length);
    if ((ls[i - 1] ?? "").trim() === "") ls.splice(i - 1, 1, ...snippet.split("\n")); else ls.splice(i, 0, ...snippet.split("\n"));
    setText(ls.join("\n"));
    setModal(null);
  };
  const insertWord = (w) => {
    const ls = text.split("\n");
    const i = Math.min(cursorLine, ls.length) - 1;
    ls[i] = (ls[i] || "").replace(/\s*$/, "") + (ls[i]?.trim() ? " " : "") + w;
    setText(ls.join("\n"));
    setModal(null);
  };

  // ---- actions ----
  const save = async (as) => {
    const n = as || name;
    if (!n) return setModal("saveas");
    setBusy("save");
    try { await programsApi.save(n, text); setName(n); setSavedText(text); await refresh(); toast.success(isProject(n) ? "This project's program saved" : `${plainName(n)} saved in the library`); }
    catch (e) { err(e); }
    finally { setBusy(""); }
  };
  const check = async () => {
    setBusy("check");
    try { const r = await programsApi.check(text, name || "program.yaml"); setCheckOut(r); setTab("check"); }
    catch (e) { err(e); }
    finally { setBusy(""); }
  };
  const loadToPlc = async () => {
    if (bridge.mode === "real" && !guardIdle("change the PLC program")) return;
    if (error) return toast.error("Fix the error first; the PLC refuses a program with an error.");
    if (dirty) { if (!(await confirm({ title: "Save and load", message: `${progLabel(name)} has unsaved changes. Save it and load it into the PLC?`, okLabel: "Save and load" }))) return; await save(); }
    else if (!(await confirm({ title: bridge.mode === "real" ? "Load into the ROBOT" : "Load into the simulator", message: `Load ${progLabel(name)} into the ${bridge.mode === "real" ? "PLC running on the robot (real outputs)" : "simulated PLC"}? Outputs that leave the program are written 0 once; timers and sequences start fresh, M and R keep their values.`, okLabel: "Load", danger: bridge.mode === "real" }))) return;
    setBusy("load");
    try { const r = await programsApi.load(name); if (r.ok) toast.success(plainText(r.message)); else toast.error(plainText(r.message)); }
    catch (e) { err(e); }
    finally { setBusy(""); }
  };
  const useInProject = async () => {
    if (dirty) return toast.error("Save the program first: the saved version is what the project gets.");
    if (!(await confirm({ title: "Use in this project", message: `Make ${plainName(name)} this project's program? The PLC runs it for this project and loads it when it starts. The current project program is kept as a backup; the library copy stays as it is.`, okLabel: "Use in this project" }))) return;
    try { const r = await programsApi.useInProject(name); toast.success(plainText(r.message)); await refresh(); open(PROJECT); } catch (e) { err(e); }
  };
  const startProjectProgram = async () => {
    if (dirty && !(await confirm({ title: "Discard changes", message: `${progLabel(name)} has unsaved changes. Start this project's program anyway?`, okLabel: "Discard", danger: true }))) return;
    const t = newProgramYaml("my_cell");
    try { await programsApi.save(PROJECT, t); await refresh(); open(PROJECT); toast.success("This project's program started"); } catch (e) { err(e); }
  };
  const remove = async () => {
    if (!name || isProject(name)) return;
    if (!(await confirm({ title: "Delete program", message: `Delete ${plainName(name)} from the library? No project can use it after that. This cannot be undone.`, okLabel: "Delete", danger: true }))) return;
    try { await programsApi.remove(name); const list = await refresh(); setName(""); setText(""); setSavedText(""); if (list[0]) open(list[0].name); }
    catch (e) { err(e); }
  };
  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "s") { e.preventDefault(); save(); }
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); check(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
  useEffect(() => { if (tab === "teacher") document.getElementById(`lesson-${cursorLine}`)?.scrollIntoView({ block: "nearest" }); }, [cursorLine, tab]);

  return (
    <div className="page">
      <div className="page-bar">
        <div className="prog-files">
          <select data-tut="plc-program-select" className="select" value={name} onChange={async (e) => { if (dirty && !(await confirm({ title: "Discard changes", message: `${progLabel(name)} has unsaved changes. Open ${progLabel(e.target.value)} anyway?`, okLabel: "Discard", danger: true }))) return; open(e.target.value); }}>
            {!name && <option value="">— pick a program —</option>}
            {files.filter((f) => f.project).map((f) => <option key={f.name} value={f.name}>{"★ This project's program"}{f.active ? "  ● in PLC" : ""}</option>)}
            <optgroup label="Library (every project)">
              {files.filter((f) => !f.project).map((f) => <option key={f.name} value={f.name}>{f.label || plainName(f.name)}{f.active ? "  ● in PLC" : ""}{f.in_project ? "  ★ in this project" : ""}</option>)}
            </optgroup>
          </select>
          {dirty && <span className="dirty-dot" title="unsaved changes" />}
          {isLive && <span className="pill on">live: running in the PLC</span>}
          {plcProgram?.ok && name && files.find((f) => f.name === name)?.active && !isLive && <span className="pill warn">in the PLC, but changed here</span>}
          {!hasProject && <button data-tut="plc-start-project" className="btn sm" onClick={startProjectProgram} title="This project has no PLC program yet: start one, or open a library program and press Use in this project"><FilePlus2 size={14} />Start this project's program</button>}
        </div>
        <span className="sep" />
        <button data-tut="plc-new" className="btn sm" onClick={async () => { if (dirty && !(await confirm({ title: "Discard changes", message: "The current program has unsaved changes. Start a new program anyway?", okLabel: "Discard", danger: true }))) return; setModal("new"); }} title="New program in the library"><FilePlus2 size={14} />New</button>
        <button data-tut="plc-save" className="btn sm" onClick={() => save()} disabled={!dirty || busy === "save"} title="Ctrl+S"><Save size={14} />Save</button>
        <button data-tut="plc-saveas" className="btn sm" onClick={() => setModal("saveas")} title="Save a copy in the library: every project can open and use it"><Download size={14} />Save as</button>
        <button data-tut="plc-delete" className="btn sm ghost" onClick={remove} disabled={!name || isProject(name)} title={isProject(name) ? "This project's program cannot be deleted; replace it with Use in this project" : "Delete this program from the library"}><Trash2 size={14} /></button>
        <span className="sep" />
        <button data-tut="plc-check" className="btn sm" onClick={check} disabled={busy === "check" || !text.trim()} title="Ctrl+Enter"><Check size={14} />Check</button>
        <button data-tut="plc-load" className="btn sm primary" onClick={loadToPlc} disabled={!name || Boolean(error) || busy === "load"} title={bridge.mode === "real" ? "Load into the PLC on the robot" : "Load into the simulated PLC"}><Upload size={14} />{bridge.mode === "real" ? "Load into ROBOT" : "Load into SIM"}</button>
        <button data-tut="plc-use" className="btn sm" onClick={useInProject} disabled={!name || isProject(name) || Boolean(error) || files.find((f) => f.name === name)?.in_project} title="Copy this library program over this project's program: the PLC runs it for this project (the previous one is kept as a backup)"><Star size={14} />Use in this project</button>
        <span className="grow" />
        <button data-tut="plc-hidecode" className={cx("btn sm", hideCode && "active")} onClick={() => setHideCode((v) => !v)} title={hideCode ? "Show the code next to the panel" : "Hide the code: the panel takes the whole width"}><Code2 size={14} />{hideCode ? "Show code" : "Hide code"}</button>
        <span data-tut="plc-shortcuts" className="muted xs">Ctrl+S save · Ctrl+Enter check</span>
      </div>

      <Split id="plc.program" defaults={[11, 9]} min={[340, 380]} className="plc-split">
        {!hideCode && <div key="code" className="col" style={{ minHeight: 0 }}>
          <div className="helper-bar" data-tut="plc-helpers">
            <button data-tut="plc-add-rung" className="btn sm" onClick={() => setModal("rung")}><PlusSquare size={14} />Add a rung</button>
            <button data-tut="plc-add-block" className="btn sm" onClick={() => setModal("block")}><Boxes size={14} />Add a block</button>
            <button data-tut="plc-add-seq" className="btn sm" onClick={() => setModal("seq")}><Workflow size={14} />Add a sequence</button>
            <button data-tut="plc-patterns" className="btn sm" onClick={() => setModal("patterns")}><ListPlus size={14} />Patterns</button>
            <button data-tut="plc-address" className="btn sm" onClick={() => setModal("picker")}><Lightbulb size={14} />Insert address</button>
            <span className="grow" />
            <span className="muted xs">{lines.length} lines{described ? ` · ${described.rung_count} rungs · ${described.sequence_count} seq · ${described.alarm_count} alarms` : ""}</span>
          </div>
          <CodeEditor tut="plc-editor" value={text} onChange={setText} errorLine={error?.line} liveLines={liveLines} onCursorLine={setCursorLine} cursorLine={goLine} placeholder={"program: my_cell\nrungs:\n  - {out: gpio1.do1, when: \"gpio1.di1 AND S.AUTO\"}"} />
          {error ? (
            <div className="err-line" data-tut="plc-status-line"><b>{error.line ? `line ${error.line}` : "error"}</b><span>{error.message}</span>{error.line && <button className="btn sm ghost" style={{ marginLeft: "auto" }} onClick={() => setGoLine(error.line)}>go</button>}</div>
          ) : described ? (
            <div className="ok-line" data-tut="plc-status-line"><Check size={14} /><span>Loads. {described.rung_count} rungs, {described.sequence_count} sequences, {described.alarm_count} alarms{described.blocks.length ? `, ${described.blocks.length} blocks` : ""}; controls {described.controls.length} of 32 outputs.</span></div>
          ) : null}
        </div>}

        <div key="panel" className="panel">
          <div className="panel-head" data-tut="plc-panel-tabs">
            <Tabs value={tab} onChange={setTab} items={[{ id: "ladder", label: "Ladder" }, { id: "form", label: "Form" }, { id: "teacher", label: "Teacher" }, { id: "guide", label: "Guide" }, { id: "outline", label: "Outline" }, { id: "check", label: "Check", badge: checkOut ? (checkOut.ok ? "ok" : "!") : undefined }]} />
            <span className="grow" />
            {isLive && tab !== "check" && tab !== "guide" && <span className="pill on">live</span>}
          </div>
          <div className="panel-body" data-tut="plc-panel-body">
            {tab === "form" && <FormEditor text={text} onChange={setText} aliases={aliases} extra={extra} liveRungs={liveRungs} onGoLine={setGoLine} />}
            {tab === "teacher" && <TeacherPanel described={described} lines={lines} cursorLine={cursorLine} onGoLine={setGoLine} liveRungs={liveRungs} />}
            {tab === "ladder" && <LadderEditor text={text} onChange={setText} aliases={aliases} extra={extra} read={readName} live={isLive} liveRungs={liveRungs} seqLive={seqLive} described={described} onGoLine={(l) => { setHideCode(false); setGoLine(l); }} />}
            {tab === "guide" && <GuidePanel lines={lines} cursorLine={cursorLine} onInsert={insertAtCursor} />}
            {tab === "outline" && <OutlinePanel described={described} onGoLine={setGoLine} />}
            {tab === "check" && <CheckPanel out={checkOut} />}
          </div>
        </div>
      </Split>

      {modal === "rung" && <RungForm aliases={aliases} extra={extra} onClose={() => setModal(null)} onSave={(obj) => withDoc((y) => y.addRow("rungs", obj))} />}
      {modal === "seq" && <SequenceForm aliases={aliases} extra={extra} onClose={() => setModal(null)} onSave={(head, steps) => withDoc((y) => y.setSequence(-1, head, steps))} />}
      {modal === "block" && <BlockWizard aliases={aliases} onClose={() => setModal(null)} onSave={(obj) => withDoc((y) => y.addRow("blocks", obj))} />}
      {modal === "picker" && <Modal tut="plc-address-list" title="Insert an address at the cursor line" width={640} onClose={() => setModal(null)}><AddressPicker aliases={aliases} extra={extra} onPick={insertWord} /></Modal>}
      {modal === "patterns" && (
        <Modal tut="plc-patterns-list" title="Patterns: added to the right sections of the program" width={720} onClose={() => setModal(null)}>
          <div className="col" style={{ gap: 6 }}>{PATTERNS.map((p) => <button key={p.id} className="snip" onClick={() => withDoc((y) => applyPattern(y, p))}><b>{p.title}</b><span>{p.hint}</span><pre>{previewPattern(p)}</pre></button>)}</div>
        </Modal>
      )}
      {modal === "saveas" && <PromptModal tut="plc-saveas-form" title="Save a copy in the library" label="Program name" initial={name && !isProject(name) ? plainName(name) : "my_cell"} okLabel="Save" validate={nameError} onClose={() => setModal(null)} onSubmit={(v) => { setModal(null); save(toFile(v)); }} />}
      {modal === "new" && <PromptModal tut="plc-new-form" title="New program" label="Program name" initial="my_cell" okLabel="Create" validate={(v) => nameError(v) || (files.some((f) => f.name === toFile(v)) ? "a program with this name exists" : "")} onClose={() => setModal(null)} onSubmit={async (v) => { setModal(null); const f = toFile(v); const t = newProgramYaml(plainName(f)); setName(f); setText(t); try { await programsApi.save(f, t); setSavedText(t); refresh(); } catch (e) { err(e); } }} />}
    </div>
  );
}

function previewPattern(p) {
  const out = [];
  for (const [k, v] of Object.entries(p.names || {})) out.push(`names: ${k}: ${v}`);
  for (const b of p.blocks || []) out.push(`- {use: ${b.use}, as: ${b.as}, with: {...}}`);
  for (const r of p.rungs || []) out.push(`- ${JSON.stringify(r).replace(/"(\w+)":/g, "$1: ").replace(/,/g, ", ")}`);
  for (const s of p.sequences || []) out.push(`sequence ${s.head.name}: ${s.steps.length} steps`);
  for (const a of p.alarms || []) out.push(`alarm ${a.bit}: "${a.text}"`);
  return out.join("\n");
}

function CheckPanel({ out }) {
  if (!out) return <div className="empty">Press <b>Check</b> (Ctrl+Enter) to run the loader (the same one the PLC uses) and, when it is installed on the robot, the PLC's own checker.</div>;
  return (
    <div className="col">
      <div className={out.ok ? "ok-line" : "err-line"}>{out.ok ? <Check size={14} /> : <span>!</span>}<span>{out.ok ? "OK: the program loads" : plainText(out.error)}</span></div>
      {out.output && <pre className="small" style={{ whiteSpace: "pre-wrap", padding: 10, background: "var(--surface-2)", borderRadius: 8 }}>{plainText(out.output)}</pre>}
      {out.ok && out.program && (
        <table className="grid"><thead><tr><th>#</th><th>line</th><th>rung</th></tr></thead><tbody>
          {out.program.rungs.map((r) => <tr key={r.index}><td className="mono">{r.index + 1}</td><td className="mono">{r.line}</td><td className="mono">{r.text}</td></tr>)}
        </tbody></table>
      )}
    </div>
  );
}
export { cx };
