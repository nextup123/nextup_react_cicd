// BlockEditor -- build your own block: the block file as text and as a form (ports, locals,
// rungs with port names as addresses), the cursor-aware guide, Check (the loader expands the
// block into a wrapper program exactly like a real program would) and Test (a scenario against
// that wrapper, nextplc_sim or the JS engine). Saved to <plc dir>/blocks/<name>.yaml.
import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Play, Save, X } from "lucide-react";
import { YamlProgram } from "nextplc-engine";
import CodeEditor from "../../components/CodeEditor";
import { Tabs, confirm, cx } from "../../components/ui";
import FormEditor from "../program/FormEditor";
import GuidePanel from "../program/GuidePanel";
import { api, blocksApi } from "../../lib/api";
import { toast } from "../../store/toast";
import { Split } from "../../../../components/ui/Split";
import { plainText } from "../../../../lib/plainText";

const DEFAULT_SCENARIO = (as) => `# scenario for the block instance "${as}": SET its inputs, EXPECT its outputs
SUPERVISOR AUTO
WAIT 50ms
# SET gpio1.di1 1
# EXPECT gpio1.do1 1 WITHIN 50ms
`;

/** Suggest a wiring for the test: inputs on gpio1.di*, outputs on gpio1.do*, registers R*, defaults kept. */
function suggestBindings(ports) {
  let di = 1, dout = 1, r = 0;
  const out = {};
  for (const p of ports) {
    if (p.default) continue;
    if (p.kind === "in") out[p.name] = `gpio1.di${Math.min(di++, 8)}`;
    else if (p.kind === "out") out[p.name] = `gpio1.do${Math.min(dout++, 8)}`;
    else if (p.kind === "register") out[p.name] = `R${r++}`;
    else if (p.kind === "time") out[p.name] = "1s";
    else if (p.kind === "number") out[p.name] = "10";
  }
  return out;
}

export default function BlockEditor({ name, initialText, isNew, onClose, onSaved }) {
  const [text, setText] = useState(initialText);
  const [savedText, setSavedText] = useState(isNew ? "" : initialText);
  const [tab, setTab] = useState("form");
  const [cursorLine, setCursorLine] = useState(1);
  const [goLine, setGoLine] = useState(null);
  const [check, setCheck] = useState(null);
  const [bindings, setBindings] = useState({});
  const [scenario, setScenario] = useState(DEFAULT_SCENARIO(name));
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState("");
  const timer = useRef(null);
  const dirty = text !== savedText;
  const lines = useMemo(() => text.split("\n"), [text]);
  const ports = useMemo(() => { const y = new YamlProgram(text); return y.errors.length ? [] : y.entries("ports").map(({ key, value }) => ({ name: key, ...(typeof value === "object" ? value : { kind: String(value) }) })); }, [text]);
  useEffect(() => { setBindings((b) => ({ ...suggestBindings(ports), ...Object.fromEntries(Object.entries(b).filter(([k]) => ports.some((p) => p.name === k))) })); }, [ports]);

  // live check while typing (the loader, through the wrapper program)
  useEffect(() => {
    clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      try { setCheck(await api.post(`/plc-api/blocks/${encodeURIComponent(name)}/check`, { text, as: name, with: bindings })); }
      catch (e) { setCheck({ ok: false, error: e.message }); }
    }, 300);
    return () => clearTimeout(timer.current);
  }, [text, bindings, name]);
  const errorLine = useMemo(() => {
    if (!check || check.ok) return undefined;
    const m = /line \d+: block '[^']*' \(as [^)]*\), \S+ line (\d+):/.exec(check.error || "");
    return m ? Number(m[1]) : undefined;
  }, [check]);
  const errorText = check && !check.ok ? String(check.error || "").replace(/^line \d+: block '[^']*' \(as [^)]*\), \S+ /, "") : "";

  const save = async () => {
    setBusy("save");
    try { await blocksApi.save(name, text); setSavedText(text); toast.success(`block ${name} saved to your blocks`); onSaved?.(); }
    catch (e) { toast.error(plainText(e.message)); }
    finally { setBusy(""); }
  };
  const runTest = async () => {
    setBusy("test");
    try { setResult(await api.post(`/plc-api/blocks/${encodeURIComponent(name)}/test`, { text, as: name, with: bindings, scenario })); setTab("test"); }
    catch (e) { toast.error(plainText(e.message)); }
    finally { setBusy(""); }
  };
  const close = async () => { if (dirty && !(await confirm({ title: "Discard changes", message: `The block ${name} has unsaved changes. Close anyway?`, okLabel: "Discard", danger: true }))) return; onClose(); };

  return (
    <div className="page">
      <div className="page-bar" data-tut="plc-be-bar">
        <b className="mono">{name}</b>
        <span className="pill">{isNew ? "new block" : "your block"}</span>
        {dirty && <span className="dirty-dot" />}
        <span className="sep" />
        <button data-tut="plc-be-save" className="btn sm primary" onClick={save} disabled={!dirty || busy === "save"}><Save size={14} />Save to my blocks</button>
        <button data-tut="plc-be-test" className="btn sm" onClick={runTest} disabled={busy === "test" || !check?.ok}><Play size={14} />Run test</button>
        <span className="grow" />
        <button data-tut="plc-be-close" className="btn sm ghost" onClick={close}><X size={14} />Close</button>
      </div>
      <Split id="plc.block" defaults={[11, 9]} min={[340, 360]} className="plc-split">
        <div key="code" className="col" style={{ minHeight: 0 }}>
          <CodeEditor tut="plc-be-code" value={text} onChange={setText} errorLine={errorLine} onCursorLine={setCursorLine} cursorLine={goLine} />
          {check && !check.ok ? <div className="err-line" data-tut="plc-be-check"><b>{errorLine ? `line ${errorLine}` : "error"}</b><span>{errorText}</span></div>
            : check?.ok ? <div className="ok-line" data-tut="plc-be-check"><Check size={14} /><span>Expands into {check.description.rung_count} rungs{check.description.sequence_count ? `, ${check.description.sequence_count} sequences` : ""}{check.description.alarm_count ? `, ${check.description.alarm_count} alarms` : ""} with the test wiring below.</span></div> : null}
        </div>
        <div key="panel" className="panel">
          <div className="panel-head" data-tut="plc-be-tabs"><Tabs value={tab} onChange={setTab} items={[{ id: "form", label: "Form" }, { id: "guide", label: "Guide" }, { id: "expanded", label: "Expanded" }, { id: "test", label: "Test", badge: result ? (result.passed ? "pass" : "fail") : undefined }]} /></div>
          <div className="panel-body">
            {tab === "form" && <FormEditor text={text} onChange={setText} aliases={new Map()} extra={[]} mode="block" onGoLine={setGoLine} />}
            {tab === "guide" && <GuidePanel lines={lines} cursorLine={cursorLine} mode="block" onInsert={(s) => { const ls = text.split("\n"); ls.splice(Math.min(cursorLine, ls.length), 0, ...s.split("\n")); setText(ls.join("\n")); }} />}
            {tab === "expanded" && (check?.ok ? (
              <div className="col">
                <div className="small muted">What the loader makes of the block with the test wiring: its rungs with the ports replaced by addresses, the locals it allocated, and who owns which bit.</div>
                <table className="grid"><thead><tr><th>#</th><th>rung</th></tr></thead><tbody>{check.description.rungs.map((r) => <tr key={r.index}><td className="mono">{r.index + 1}</td><td className="mono">{r.text}</td></tr>)}</tbody></table>
                {check.description.blocks[0] && <div className="row" style={{ flexWrap: "wrap", gap: 4 }}>{check.description.blocks[0].locals.map((l) => <span key={l.local} className="pill mono">{name}.{l.local} = {l.address}</span>)}</div>}
              </div>
            ) : <div className="empty">Fix the error first.</div>)}
            {tab === "test" && (
              <div className="col" style={{ gap: 12 }}>
                <div>
                  <div className="small" style={{ marginBottom: 6 }}><b>Test wiring</b> — the addresses the scenario talks to (a real program would connect its own):</div>
                  <div className="ports" style={{ gridTemplateColumns: "auto auto 1fr" }}>
                    {ports.map((p) => <PortBind key={p.name} p={p} value={bindings[p.name] ?? ""} onChange={(v) => setBindings({ ...bindings, [p.name]: v })} />)}
                    {!ports.length && <span className="muted small">no ports yet</span>}
                  </div>
                </div>
                <div className="field" data-tut="plc-be-scenario"><label>Scenario (SET inputs, EXPECT outputs; the instance is called {name}, locals as {name}.&lt;local&gt;)</label><textarea className="textarea" rows={10} value={scenario} onChange={(e) => setScenario(e.target.value)} /></div>
                <button className="btn primary" style={{ alignSelf: "flex-start" }} onClick={runTest} disabled={busy === "test" || !check?.ok}><Play size={14} />Run test</button>
                {result && (
                  <>
                    <div className={cx("verdict", !result.ok ? "err" : result.passed ? "pass" : "fail")}>{!result.ok ? `Scenario error: ${plainText(result.error)}` : result.summary}</div>
                    <div className="simlog">{(result.log || []).map((l, i) => { const m = /^\s*(\d+) ms\s{2}(.*)$/.exec(l); const t = m ? m[2] : l; return <div key={i} className={cx("l", /^OK\s/.test(t) && "ok", /^FAIL\s/.test(t) && "fail", /^EMERGENCY/.test(t) && "em", /^ALARM/.test(t) && "alarm")}><time>{m ? `${m[1]} ms` : ""}</time><span>{t}</span></div>; })}</div>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </Split>
    </div>
  );
}
function PortBind({ p, value, onChange }) {
  return (
    <>
      <span className="pname">{p.name}</span>
      <span className={cx("pkind", p.kind)}>{p.kind}</span>
      <input className="input mono" value={value} placeholder={p.default ? `default ${p.default}` : p.optional ? "(open)" : "required"} onChange={(e) => onChange(e.target.value)} />
    </>
  );
}
