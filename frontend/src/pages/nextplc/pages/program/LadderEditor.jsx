// LadderEditor -- build the program as a ladder diagram, two-way with the YAML.
//
// Every rung of `rungs:` is drawn as a ladder rung (rowToRung). Click an element to select it;
// the palette inserts contacts in series / in a parallel branch, wraps the selection in a timer,
// NOT or edge box, sets the coil type; the inspector edits the selected element. A complete rung
// is written back into its own line of the YAML (rungToRow + YamlProgram.setRow, comments kept);
// an incomplete one stays a draft (marked) until every element has its address / value.
//
// Sequences are drawn below as SFC charts (SfcChart). Their transitions (start, abort, each
// step's next) are ladder networks too: selected, they are edited with the same palette and
// written back into their own key of the YAML (setSeqField / setStep). Steps are edited in the
// step inspector (name, outputs, timeout).
//
// Function block instances (blocks:) and alarms (alarms:) are ladder rungs too (FbRungSvg): a block
// is a box with its bit inputs as contacts on the left, parameters as value tags and its bit outputs
// as coils on the right; an alarm is a contact on its bit driving an ALARM coil. Selected, they are
// edited in their inspector and written back into their own row of the YAML.
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Copy, Plus, Trash2, Pencil, MessageSquare, Bell, Boxes } from "lucide-react";
import {
  YamlProgram, rowToRung, rungToRow, netToText, textToNet, getAt, replaceAt, insertSeries, insertParallel, deleteAt, unwrapAt,
} from "nextplc-engine";
import SfcChart from "./SfcChart";
import SequenceForm from "./SequenceForm";
import LadderSvg from "../../components/ladder/LadderSvg";
import { BlockRungSvg, AlarmRungSvg, ALARM_LEVELS, blockPorts } from "../../components/ladder/FbRungSvg";
import { blocksApi } from "../../lib/api";
import { Modal, confirm, cx } from "../../components/ui";
import AddressPicker from "../../components/AddressPicker";
import BlockWizard from "./BlockWizard";

const contact = (nc = false, edge = null) => ({ t: "contact", name: "", nc, edge });
/** Path of a node object inside a network (by identity), or null. */
function findPath(net, node, path = []) {
  if (!net) return null;
  if (net === node) return path;
  const kids = net.t === "series" ? net.items : net.t === "parallel" ? net.branches : net.t === "timer" || net.t === "group" ? [net.inner] : [];
  for (let i = 0; i < kids.length; i++) { const p = findPath(kids[i], node, [...path, i]); if (p) return p; }
  return null;
}
const COILS = [
  { id: "out", label: "( )", title: "Coil: target = rung, every scan" },
  { id: "set", label: "(S)", title: "Set coil: latch 1" },
  { id: "reset", label: "(R)", title: "Reset coil: latch 0" },
  { id: "toggle", label: "(T)", title: "Toggle: flip on each rising edge" },
  { id: "ton", label: "TON", title: "On-delay timer coil" },
  { id: "tof", label: "TOF", title: "Off-delay timer coil" },
  { id: "tp", label: "TP", title: "Pulse timer coil" },
  { id: "count", label: "CTU", title: "Counter (CU = rung, CD / R / PV / Q)" },
  { id: "move", label: "MOVE", title: "Register = value while the rung is true" },
  { id: "calc", label: "CALC", title: "Register = formula" },
  { id: "emergency", label: "EMERG", title: "Robot emergency stop on the rising edge" },
];

const netBad = (net) => {
  const bad = (n) => {
    if (!n) return false;
    switch (n.t) {
      case "contact": return !n.name.trim();
      case "cmp": return !String(n.a).trim() || !String(n.b).trim();
      case "timer": return !String(n.time).trim() || bad(n.inner);
      case "group": return bad(n.inner);
      case "series": return n.items.some(bad);
      case "parallel": return n.branches.some(bad);
      default: return false;
    }
  };
  return bad(net) ? "an element has no address / value" : "";
};
function incomplete(net, coil) {
  if (netBad(net)) return netBad(net);
  if (coil.type !== "emergency" && !String(coil.target || "").trim()) return "the coil has no target";
  if ((coil.type === "move" || coil.type === "calc") && !String(coil.value || "").trim()) return "the value is missing";
  if (coil.timer && !String(coil.time || "").trim()) return "the timer has no time";
  return "";
}
const coilFromId = (id, old) => {
  const base = { target: old?.target || "" };
  if (["ton", "tof", "tp"].includes(id)) return { type: "out", ...base, timer: id, time: old?.time || "500ms" };
  if (id === "count") return { type: "count", target: /^r\d+$/i.test(base.target) ? base.target : "", down: "", reset: "", preset: "", done: "" };
  if (id === "move" || id === "calc") return { type: id, target: /^r\d+$/i.test(base.target) ? base.target : "", value: "" };
  if (id === "emergency") return { type: "emergency", text: "" };
  return { type: id, ...base, timer: "", time: "" };
};

const TRANS_KEY = /^q(\d+)\.(start|abort|t(\d+))$/;
const uniqueName = (base, used) => { let n = 1; while (used.has(`${base}${n}`.toLowerCase())) n++; return `${base}${n}`; };

export default function LadderEditor({ text, onChange, aliases, extra, read, live, liveRungs, onGoLine, seqLive, described }) {
  const y = useMemo(() => new YamlProgram(text), [text]);
  const names = useMemo(() => (y.errors.length ? new Map() : y.nameKinds()), [y]);
  const rows = useMemo(() => (y.errors.length ? [] : y.rungs()), [y]);
  const blocks = useMemo(() => (y.errors.length ? [] : y.blocks()), [y]);
  const seqs = useMemo(() => (y.errors.length ? [] : y.sequences()), [y]);
  const alarms = useMemo(() => (y.errors.length ? [] : y.alarms()), [y]);
  const [blockDefs, setBlockDefs] = useState({}); // library block name -> {ports, description}
  const [alarmDraft, setAlarmDraft] = useState(null); // new alarm not written yet (no bit)
  const [blockNew, setBlockNew] = useState(false);
  useEffect(() => {
    let off = false;
    blocksApi.list().then((r) => { if (!off) setBlockDefs(Object.fromEntries((r.blocks || []).map((b) => [b.name, b]))); }).catch(() => {});
    return () => { off = true; };
  }, []);
  const [seqEdit, setSeqEdit] = useState(null); // { index, seq } for the table form
  const [drafts, setDrafts] = useState({}); // key -> { net, coil, at?, isNew? }
  const [sel, setSel] = useState(null); // { key, path | "coil" }
  const [picker, setPicker] = useState(null); // { cb, allow }
  const [blockEdit, setBlockEdit] = useState(null);
  const [commentEdit, setCommentEdit] = useState(null);

  // rungs as drawn: YAML rows (or their draft) + new drafts at their position
  const rungs = useMemo(() => {
    const list = rows.map((row, i) => {
      const key = `r${i}`;
      if (drafts[key]) return { key, index: i, ...drafts[key], draft: true };
      const { index, type, ...clean } = row;
      const r = rowToRung(clean, names);
      return r.ok ? { key, index: i, net: r.net, coil: r.coil, comment: y.rowComment("rungs", i) } : { key, index: i, error: r.err, raw: r.condText, coil: r.coil, comment: y.rowComment("rungs", i) };
    });
    for (const [key, d] of Object.entries(drafts)) if (d.isNew) list.splice(Math.min(d.at, list.length), 0, { key, index: -1, ...d, draft: true });
    return list;
  }, [rows, drafts, names, y]);
  // sequence transitions as drawn: YAML text -> network (or their draft)
  const transList = useMemo(() => {
    const out = [];
    const mk = (key, i, field, txt) => {
      if (drafts[key]) return out.push({ key, kind: "trans", seq: i, field, ...drafts[key], coil: null, draft: true });
      const r = textToNet(txt, names);
      out.push(r.ok ? { key, kind: "trans", seq: i, field, net: r.net, coil: null } : { key, kind: "trans", seq: i, field, error: r.err, raw: txt, coil: null });
    };
    seqs.forEach((sq, i) => {
      mk(`q${i}.start`, i, "start", sq.start);
      if (sq.abort || drafts[`q${i}.abort`]) mk(`q${i}.abort`, i, "abort", sq.abort);
      sq.steps.forEach((st, j) => mk(`q${i}.t${j}`, i, j, st.next));
    });
    return out;
  }, [seqs, drafts, names]);
  const transOf = (key) => transList.find((t) => t.key === key);
  const seqShape = seqs.map((s) => s.steps.length).join(",");
  useEffect(() => { // a YAML change from outside invalidates drafts of rows that changed shape
    setDrafts((d) => Object.fromEntries(Object.entries(d).filter(([k, v]) => v.isNew || (k.startsWith("r") && Number(k.slice(1)) < rows.length))));
  }, [rows.length]);
  useEffect(() => { // ... and sequence transition drafts when steps / sequences were added or removed
    setDrafts((d) => Object.fromEntries(Object.entries(d).filter(([k, v]) => !k.startsWith("q") || v.keep === seqShape)));
  }, [seqShape]);
  // live: when each sequence entered its current step (the state has the step, not the time)
  const sinceRef = useRef(new Map());
  const liveSteps = useMemo(() => {
    const m = new Map();
    if (!live || !seqLive) return m;
    for (const s of seqLive) {
      const key = s.name.toLowerCase();
      const old = sinceRef.current.get(key);
      if (!old || old.step !== s.step) sinceRef.current.set(key, { step: s.step, since: Date.now() });
      m.set(key, { step: s.step, since: sinceRef.current.get(key).since });
    }
    return m;
  }, [live, seqLive]);

  if (y.errors.length) return <div className="err-line"><b>code</b><span>The code is not valid (line {y.errors[0].line}): fix it in the editor, then the ladder can be edited.</span></div>;

  const current = sel ? rungs.find((r) => r.key === sel.key) || transList.find((t) => t.key === sel.key) || null : null;
  const isTrans = current?.kind === "trans";
  const selNode = current && sel.path !== "coil" && current.net !== undefined ? (sel.path.length ? getAt(current.net, sel.path) : current.net) : null;

  /** Apply a change to rung `key`: write it into the YAML when complete, else keep a draft. */
  const update = (key, net, coil) => {
    if (TRANS_KEY.test(key)) return updateTrans(key, net);
    const r = rungs.find((x) => x.key === key);
    const why = incomplete(net, coil);
    if (why) { setDrafts({ ...drafts, [key]: { ...(drafts[key] || {}), net, coil, why, at: r?.isNew ? r.at : undefined, isNew: r?.isNew } }); return; }
    const yy = new YamlProgram(text);
    const row = rungToRow(net, coil);
    if (r?.isNew) yy.addRow("rungs", row, r.at);
    else yy.setRow("rungs", r.index, row);
    const { [key]: _, ...rest } = drafts;
    setDrafts(rest);
    onChange(yy.toString());
    if (r?.isNew) setSel(sel ? { key: `r${r.at}`, path: sel.path } : null);
  };
  /** A sequence transition: complete -> its key in the YAML; else a draft. An empty abort = no abort. */
  const updateTrans = (key, net) => {
    const t = transOf(key);
    if (!t) return;
    const why = netBad(net) || (!net && t.field !== "abort" ? "the transition needs a condition (a contact)" : "");
    if (why) { setDrafts({ ...drafts, [key]: { net, why, keep: seqShape } }); return; }
    const yy = new YamlProgram(text);
    const txt = net ? netToText(net) : "";
    if (t.field === "start" || t.field === "abort") yy.setSeqField(t.seq, t.field, txt);
    else yy.setStep(t.seq, t.field, { ...seqs[t.seq].steps[t.field], next: txt });
    const { [key]: _, ...rest } = drafts;
    setDrafts(rest);
    onChange(yy.toString());
  };
  /** Apply fn(net, path) -> { net?, coil?, select? } to the selected rung; `select` = the node to select next. */
  const withSel = (fn) => {
    if (!current || current.error) return;
    const out = fn(current.net, sel.path);
    if (!out) return;
    const net = out.net !== undefined ? out.net : current.net;
    update(current.key, net, out.coil || current.coil);
    if (isTrans && !out.select && !net) setSel({ key: current.key, path: [] });
    if (out.select) { const p = findPath(net, out.select); if (p) setSel((s) => ({ key: s.key, path: p })); }
  };

  // ---- palette actions ----
  const pathOf = () => (sel && sel.path !== "coil" ? sel.path : null);
  const addSeries = (node, after = true) => withSel((net) => {
    const p = pathOf();
    if (!net) return { net: node, select: node };
    if (!p) return { net: insertSeries(net, [], node, true), select: node }; // coil selected: append at the end of the rung
    return { net: insertSeries(net, p, node, after), select: node };
  });
  const addParallel = (node) => withSel((net) => ({ net: net ? insertParallel(net, pathOf() || [], node) : node, select: node }));
  const wrap = (w) => withSel((net) => {
    if (!net) return null;
    const p = pathOf() || [];
    const box = { ...w, inner: getAt(net, p) };
    return { net: replaceAt(net, p, box), select: box };
  });
  const remove = () => {
    if (!current) return;
    if (sel.path === "coil") return;
    withSel((net) => ({ net: deleteAt(net, sel.path) }));
    setSel({ key: current.key, path: [] });
  };
  const setCoil = (id) => withSel((net, _p) => ({ net, coil: coilFromId(id, current.coil) }));
  const editNode = (patch) => withSel((net) => ({ net: replaceAt(net, sel.path, { ...selNode, ...patch }) }));
  const editCoil = (patch) => withSel((net) => ({ net, coil: { ...current.coil, ...patch } }));

  // ---- rung actions ----
  const newRung = (at) => {
    const key = `n${Date.now()}`;
    setDrafts({ ...drafts, [key]: { net: contact(), coil: { type: "out", target: "", timer: "", time: "" }, isNew: true, at, why: "new rung: give the contact and the coil an address" } });
    setSel({ key, path: [] });
  };
  const rowOp = (fn) => { const yy = new YamlProgram(text); fn(yy); setDrafts({}); onChange(yy.toString()); };

  // ---- sequence actions ----
  /** write fn(yy) and leave blank-contact drafts on the transitions `blank` (keys after the change) */
  const seqOp = (fn, blank = [], select = null) => {
    const yy = new YamlProgram(text);
    fn(yy);
    const shape = yy.sequences().map((s) => s.steps.length).join(",");
    const keepR = Object.fromEntries(Object.entries(drafts).filter(([k]) => !k.startsWith("q")));
    for (const k of blank) keepR[k] = { net: contact(), why: "give the contact an address", keep: shape };
    setDrafts(keepR);
    onChange(yy.toString());
    setSel(select);
  };
  const usedSeqNames = () => new Set(seqs.map((s) => String(s.name).toLowerCase()));
  const addSequence = () => {
    const i = seqs.length;
    const name = uniqueName("seq", usedSeqNames());
    seqOp((yy) => { yy.setSequence(-1, { name, start: "FALSE" }, [{ name: "step1", do: [], next: "FALSE" }]); yy.section("sequences").flow = false; }, [`q${i}.start`, `q${i}.t0`], { key: `q${i}.start`, path: [] });
  };
  const onSeq = (i) => async (op) => {
    const sq = seqs[i];
    if (op === "table") setSeqEdit({ index: i, seq: sq });
    else if (op === "line") onGoLine?.(y.lineOfSeq(i));
    else if (op === "addAbort") { setDrafts({ ...drafts, [`q${i}.abort`]: { net: contact(), why: "give the contact an address", keep: seqShape } }); setSel({ key: `q${i}.abort`, path: [] }); }
    else if (op === "duplicate") {
      const name = uniqueName(`${sq.name}_`, usedSeqNames());
      seqOp((yy) => { const { steps, ...head } = sq; yy.setSequence(-1, { ...head, name }, steps.map((st) => ({ ...st }))); });
    } else if (op === "delete") {
      if (await confirm({ title: `Delete sequence ${sq.name}`, message: `Remove the sequence and its ${sq.steps.length} steps from the program?`, okLabel: "Delete", danger: true })) seqOp((yy) => yy.removeRow("sequences", i));
    }
  };
  const onStep = (i) => (op, j) => {
    const steps = seqs[i].steps;
    if (op === "up" && j > 0) seqOp((yy) => yy.moveStep(i, j, j - 1), [], { key: `q${i}.s${j - 1}`, path: "step" });
    else if (op === "down" && j < steps.length - 1) seqOp((yy) => yy.moveStep(i, j, j + 1), [], { key: `q${i}.s${j + 1}`, path: "step" });
    else if (op === "delete") seqOp((yy) => yy.removeStep(i, j), [], null);
    else if (op === "add") {
      const name = uniqueName("step", new Set(steps.map((s) => String(s.name).toLowerCase())));
      seqOp((yy) => yy.addStep(i, { name, do: [], next: "FALSE" }, j + 1), [`q${i}.t${j + 1}`], { key: `q${i}.s${j + 1}`, path: "step" });
    }
  };
  const stepSel = sel?.path === "step" ? /^q(\d+)\.s(\d+)$/.exec(sel.key) : null;
  const headSel = sel?.path === "head" ? /^q(\d+)\.head$/.exec(sel.key) : null;
  const editStep = (i, j, patch) => {
    const yy = new YamlProgram(text);
    const st = { ...seqs[i].steps[j], ...patch };
    if (!st.timeout) delete st.on_timeout;
    yy.setStep(i, j, st);
    onChange(yy.toString());
  };
  const blockSeqs = (described?.sequences || []).filter((s) => s.block);

  return (
    <div className="ladder-editor" onClick={() => setSel(null)}>
      <div className="lad-toolbar" onClick={(e) => e.stopPropagation()}>
        <div className="lad-group">
          <span className="lad-glabel">Contacts</span>
          <button className="lad-btn" title="Normally open contact, in series after the selection" onClick={() => addSeries(contact())}><span className="sym">-| |-</span></button>
          <button className="lad-btn" title="Normally closed contact (NOT)" onClick={() => addSeries(contact(true))}><span className="sym">-|/|-</span></button>
          <button className="lad-btn" title="Rising edge contact (RISE)" onClick={() => addSeries(contact(false, "rise"))}><span className="sym">-|P|-</span></button>
          <button className="lad-btn" title="Falling edge contact (FALL)" onClick={() => addSeries(contact(false, "fall"))}><span className="sym">-|N|-</span></button>
          <button className="lad-btn" title="Parallel branch (OR) around the selection" onClick={() => addParallel(contact())}><span className="sym">⊐ OR</span></button>
          <button className="lad-btn" title="Insert before the selection" onClick={() => addSeries(contact(), false)}><span className="sym">←| |</span></button>
        </div>
        <div className="lad-group">
          <span className="lad-glabel">Boxes</span>
          <button className="lad-btn" title="Compare (number = ≠ < ≤ > ≥ number)" onClick={() => addSeries({ t: "cmp", a: "", op: ">=", b: "", nc: false })}><span className="sym">CMP</span></button>
          <button className="lad-btn" title="ON_FOR: selection has been true for a time" onClick={() => wrap({ t: "timer", kind: "on_for", time: "500ms", nc: false })}><span className="sym">ON_FOR</span></button>
          <button className="lad-btn" title="OFF_FOR: selection has been false for a time" onClick={() => wrap({ t: "timer", kind: "off_for", time: "500ms", nc: false })}><span className="sym">OFF_FOR</span></button>
          <button className="lad-btn" title="NOT: invert the selection" onClick={() => wrap({ t: "group", fn: "not" })}><span className="sym">NOT</span></button>
          <button className="lad-btn" title="P: rising edge of the selection" onClick={() => wrap({ t: "group", fn: "rise" })}><span className="sym">P(…)</span></button>
          <button className="lad-btn" title="Remove the box, keep what is inside" onClick={() => withSel((net) => ({ net: unwrapAt(net, sel.path) }))} disabled={!selNode || !(selNode.t === "timer" || selNode.t === "group")}><span className="sym">unbox</span></button>
        </div>
        <div className="lad-group">
          <span className="lad-glabel">Coil / function</span>
          {COILS.map((c) => <button key={c.id} className={cx("lad-btn", current && !current.error && !isTrans && coilId(current.coil) === c.id && "active")} title={c.title} onClick={() => setCoil(c.id)} disabled={!current || Boolean(current.error) || isTrans}><span className="sym">{c.label}</span></button>)}
        </div>
        <div className="lad-group">
          <button className="lad-btn danger" title="Delete the selected element (Del)" onClick={remove} disabled={!current || sel?.path === "coil" || !selNode}><Trash2 size={14} /></button>
          <button className="lad-btn" title="New rung below the selection" onClick={() => newRung(current && !isTrans && current.index >= 0 ? current.index + 1 : rows.length)}><Plus size={14} /><span>Rung</span></button>
          <button className="lad-btn" title="New sequence (SFC): steps one after the other" onClick={addSequence}><Plus size={14} /><span>Sequence</span></button>
          <button className="lad-btn" title="New function block rung: a library block (blinker, debounce, cylinder…) wired to your addresses" onClick={() => setBlockNew(true)}><Boxes size={14} /><span>Block</span></button>
          <button className="lad-btn" title="New alarm rung: a bit that raises an alarm while it is 1" onClick={() => { setAlarmDraft({ bit: "", text: "", level: "error", toast: true }); setSel({ key: "anew", path: "alarm" }); }}><Bell size={14} /><span>Alarm</span></button>
        </div>
      </div>

      <div className="lad-body">
        {rungs.map((r, i) => (
          <div key={r.key} className={cx("lad-rung", sel?.key === r.key && "is-selected", r.draft && "is-draft")} onClick={(e) => { e.stopPropagation(); setSel({ key: r.key, path: [] }); }}>
            <div className="lad-rung-head">
              <span className="num">{r.index >= 0 ? r.index + 1 : "new"}</span>
              {r.comment && <span className="lad-comment truncate" title={r.comment}>{r.comment}</span>}
              {!r.error && !r.draft && <span className="mono xs muted truncate grow" title="the condition in the code">{r.net ? netToText(r.net) : "TRUE"}</span>}
              {r.draft && <span className="pill warn grow" style={{ justifyContent: "flex-start" }}>not written yet: {r.why}</span>}
              {liveRungs && r.index >= 0 && !r.draft && <span className={cx("pill", liveRungs[r.index] && "on")}>{liveRungs[r.index] ? "TRUE" : "false"}</span>}
              {r.index >= 0 && <div className="row" style={{ gap: 1 }} onClick={(e) => e.stopPropagation()}>
                <button className="btn icon ghost sm" title="Rung comment" onClick={() => setCommentEdit({ index: r.index, text: r.comment || "" })}><MessageSquare size={13} /></button>
                {onGoLine && <button className="btn sm ghost" title="Show in the code" onClick={() => onGoLine(y.lineOfRow("rungs", r.index))}>line</button>}
                <button className="btn icon ghost sm" title="Duplicate" onClick={() => rowOp((yy) => { const { index, type, ...clean } = rows[r.index]; yy.addRow("rungs", clean, r.index + 1); })}><Copy size={13} /></button>
                <button className="btn icon ghost sm" title="Move up" onClick={() => rowOp((yy) => yy.moveRow("rungs", r.index, r.index - 1))}><ArrowUp size={13} /></button>
                <button className="btn icon ghost sm" title="Move down" onClick={() => rowOp((yy) => yy.moveRow("rungs", r.index, r.index + 1))}><ArrowDown size={13} /></button>
                <button className="btn icon ghost sm" title="Delete rung" onClick={() => { rowOp((yy) => yy.removeRow("rungs", r.index)); setSel(null); }}><Trash2 size={13} /></button>
              </div>}
              {r.draft && <button className="btn icon ghost sm" title="Discard the draft" onClick={(e) => { e.stopPropagation(); const { [r.key]: _, ...rest } = drafts; setDrafts(rest); setSel(null); }}><Trash2 size={13} /></button>}
            </div>
            <div className="lad-canvas">
              {r.error ? <div className="err-line"><b>rung {i + 1}</b><span>Cannot be drawn: {r.error}. Fix the condition "{r.raw}" in the code.</span></div>
                : <LadderSvg net={r.net} coil={r.coil} sel={sel?.key === r.key ? sel.path : null} onSelect={(path) => setSel({ key: r.key, path })} read={read} live={live && !r.draft} rungLive={liveRungs && r.index >= 0 ? liveRungs[r.index] : undefined} />}
            </div>
          </div>
        ))}
        {!rungs.length && <div className="empty">No rungs yet. Press <b>+ Rung</b>, then pick contacts and a coil from the palette.</div>}

        <div className="lad-section-title">Function blocks (library blocks as ladder: inputs left, outputs right; their own rungs run after the program's)</div>
        {blocks.map((b, i) => (
          <div key={`b${i}`} className={cx("lad-rung lad-fb", sel?.key === `b${i}` && "is-selected")} onClick={(e) => { e.stopPropagation(); setSel({ key: `b${i}`, path: "block" }); }}>
            <div className="lad-rung-head">
              <span className="num">FB</span>
              <b className="mono small">{b.as || b.use}</b>
              <span className="pill mono">{b.use}</span>
              <span className="xs muted truncate grow">{blockDefs[b.use]?.description || ""}</span>
              <div className="row" style={{ gap: 1 }} onClick={(e) => e.stopPropagation()}>
                <button className="btn icon ghost sm" title="Change block / all ports" onClick={() => setBlockEdit({ index: i, row: b })}><Pencil size={13} /></button>
                {onGoLine && <button className="btn sm ghost" title="Show in the code" onClick={() => onGoLine(y.lineOfRow("blocks", i))}>line</button>}
                <button className="btn icon ghost sm" title="Duplicate" onClick={() => rowOp((yy) => yy.addRow("blocks", { ...b, as: uniqueName(`${b.as || b.use}_`, new Set(blocks.map((x) => String(x.as || x.use).toLowerCase()))) }, i + 1))}><Copy size={13} /></button>
                <button className="btn icon ghost sm" title="Move up" onClick={() => rowOp((yy) => yy.moveRow("blocks", i, i - 1))}><ArrowUp size={13} /></button>
                <button className="btn icon ghost sm" title="Move down" onClick={() => rowOp((yy) => yy.moveRow("blocks", i, i + 1))}><ArrowDown size={13} /></button>
                <button className="btn icon ghost sm" title="Delete block" onClick={() => { rowOp((yy) => yy.removeRow("blocks", i)); setSel(null); }}><Trash2 size={13} /></button>
              </div>
            </div>
            <div className="lad-canvas">
              <BlockRungSvg row={b} def={blockDefs[b.use]} read={read} live={live} selected={sel?.key === `b${i}`} onSelect={() => setSel({ key: `b${i}`, path: "block" })} />
            </div>
          </div>
        ))}
        {!blocks.length && <div className="empty small">No function blocks. <b>Block</b> adds a library block (blinker, debounce…) as a rung.</div>}

        <div className="lad-section-title">Alarms (a contact on the alarm bit drives the alarm: raised while the bit is 1)</div>
        {[...alarms.map((a, i) => ({ key: `a${i}`, index: i, a })), ...(alarmDraft ? [{ key: "anew", index: -1, a: alarmDraft, draft: true }] : [])].map(({ key, index, a, draft }) => (
          <div key={key} className={cx("lad-rung lad-alarm", sel?.key === key && "is-selected", draft && "is-draft")} onClick={(e) => { e.stopPropagation(); setSel({ key, path: "alarm" }); }}>
            <div className="lad-rung-head">
              <span className="num">{draft ? "new" : `A${index + 1}`}</span>
              {draft ? <span className="pill warn grow" style={{ justifyContent: "flex-start" }}>not written yet: give the alarm a bit</span>
                : <span className="xs muted truncate grow">{a.text || ""}</span>}
              {live && read && !draft && a.bit && <span className={cx("pill", read(String(a.bit)) && (String(a.level || "error") === "info" ? "on" : "warn"))}>{read(String(a.bit)) ? "ACTIVE" : "ok"}</span>}
              {!draft && <div className="row" style={{ gap: 1 }} onClick={(e) => e.stopPropagation()}>
                {onGoLine && <button className="btn sm ghost" title="Show in the code" onClick={() => onGoLine(y.lineOfRow("alarms", index))}>line</button>}
                <button className="btn icon ghost sm" title="Duplicate" onClick={() => rowOp((yy) => yy.addRow("alarms", { ...a }, index + 1))}><Copy size={13} /></button>
                <button className="btn icon ghost sm" title="Move up" onClick={() => rowOp((yy) => yy.moveRow("alarms", index, index - 1))}><ArrowUp size={13} /></button>
                <button className="btn icon ghost sm" title="Move down" onClick={() => rowOp((yy) => yy.moveRow("alarms", index, index + 1))}><ArrowDown size={13} /></button>
                <button className="btn icon ghost sm" title="Delete alarm" onClick={() => { rowOp((yy) => yy.removeRow("alarms", index)); setSel(null); }}><Trash2 size={13} /></button>
              </div>}
              {draft && <button className="btn icon ghost sm" title="Discard the draft" onClick={(e) => { e.stopPropagation(); setAlarmDraft(null); setSel(null); }}><Trash2 size={13} /></button>}
            </div>
            <div className="lad-canvas">
              <AlarmRungSvg alarm={a} read={read} live={live && !draft} selected={sel?.key === key} onSelect={() => setSel({ key, path: "alarm" })} />
            </div>
          </div>
        ))}
        {!alarms.length && !alarmDraft && <div className="empty small">No alarms. <b>Alarm</b> adds one: a bit (usually an M bit set by a rung) that shows an alarm while it is 1.</div>}
        <div className="lad-section-title">Sequences (SFC: one step active at a time; they run after the rungs, every scan)</div>
        {seqs.map((sq, i) => (
          <SfcChart key={`q${i}`} seq={sq} prefix={`q${i}`} trans={transOf} sel={sel} setSel={setSel} read={read} live={live}
            liveStep={liveSteps.get(String(sq.name).toLowerCase())?.step} since={liveSteps.get(String(sq.name).toLowerCase())?.since}
            onSeq={onSeq(i)} onStep={onStep(i)} line={y.lineOfSeq(i)} />
        ))}
        {!seqs.length && <div className="empty small">No sequences. <b>+ Sequence</b> adds one: steps that follow each other (step 1 → when T1 is true → step 2 …), each step switching its own outputs.</div>}
        {blockSeqs.map((sq, i) => {
          const tr = (key) => {
            const [, f] = key.split(".");
            const txt = f === "start" ? sq.start : f === "abort" ? sq.abort : sq.steps[Number(f.slice(1))]?.next;
            const r = textToNet(txt, names);
            return r.ok ? { net: r.net } : { error: r.err, raw: txt };
          };
          const ls = liveSteps.get(String(sq.name).toLowerCase());
          return <SfcChart key={`b${i}`} readOnly seq={{ ...sq, steps: sq.steps.map((st) => ({ ...st })) }} prefix={`b${i}`} trans={tr} sel={sel} setSel={setSel} read={read} live={live} liveStep={ls?.step} since={ls?.since} />;
        })}
        <div className="xs muted" style={{ padding: "6px 2px" }}>One coil per rung (a bit has one owner: use (S)/(R) when it must be written from several rungs). Click a block or alarm rung to edit it.</div>
      </div>

      {current && !current.error && (
        <div className="lad-inspector" onClick={(e) => e.stopPropagation()}>
          {isTrans && !selNode ? <TransInspector t={current} seq={seqs[current.seq]} />
            : sel.path === "coil" || !selNode ? <CoilInspector coil={current.coil} onChange={editCoil} pick={(cb, allow) => setPicker({ cb, allow })} />
            : <NodeInspector node={selNode} onChange={editNode} pick={(cb, allow) => setPicker({ cb, allow })} />}
        </div>
      )}
      {stepSel && seqs[Number(stepSel[1])]?.steps[Number(stepSel[2])] && (
        <div className="lad-inspector" onClick={(e) => e.stopPropagation()}>
          <StepInspector n={Number(stepSel[2]) + 1} seq={seqs[Number(stepSel[1])]} step={seqs[Number(stepSel[1])].steps[Number(stepSel[2])]} onChange={(patch) => editStep(Number(stepSel[1]), Number(stepSel[2]), patch)} pick={(cb, allow) => setPicker({ cb, allow })} />
        </div>
      )}
      {headSel && seqs[Number(headSel[1])] && (
        <div className="lad-inspector" onClick={(e) => e.stopPropagation()}>
          <div className="lad-insp-row">
            <b className="small">Sequence</b>
            <div className="field"><label>name (letters, digits, _)</label><input className="input mono" value={seqs[Number(headSel[1])].name} onChange={(e) => { const yy = new YamlProgram(text); yy.setSeqField(Number(headSel[1]), "name", e.target.value.replace(/[^A-Za-z0-9_]/g, "")); onChange(yy.toString()); }} /></div>
            <span className="xs muted grow">Rungs that read <span className="mono">seq.&lt;name&gt;…</span> must use the new name too.</span>
          </div>
        </div>
      )}
      {sel?.path === "block" && /^b\d+$/.test(sel.key) && blocks[Number(sel.key.slice(1))] && (
        <div className="lad-inspector" onClick={(e) => e.stopPropagation()}>
          <BlockInspector row={blocks[Number(sel.key.slice(1))]} def={blockDefs[blocks[Number(sel.key.slice(1))].use]} pick={(cb, allow) => setPicker({ cb, allow })}
            onChange={(row) => { const yy = new YamlProgram(text); yy.setRow("blocks", Number(sel.key.slice(1)), row); onChange(yy.toString()); }}
            onWizard={() => setBlockEdit({ index: Number(sel.key.slice(1)), row: blocks[Number(sel.key.slice(1))] })} />
        </div>
      )}
      {sel?.path === "alarm" && (sel.key === "anew" ? alarmDraft : alarms[Number(sel.key.slice(1))]) && (
        <div className="lad-inspector" onClick={(e) => e.stopPropagation()}>
          <AlarmInspector alarm={sel.key === "anew" ? alarmDraft : alarms[Number(sel.key.slice(1))]} pick={(cb, allow) => setPicker({ cb, allow })}
            onChange={(patch) => {
              const isNew = sel.key === "anew";
              const next = { ...(isNew ? alarmDraft : alarms[Number(sel.key.slice(1))]), ...patch };
              if (!String(next.bit || "").trim()) { if (isNew) setAlarmDraft(next); return; }
              const row = { bit: String(next.bit).trim() };
              if (String(next.text || "")) row.text = String(next.text);
              row.level = ALARM_LEVELS.includes(String(next.level)) ? String(next.level) : "error";
              row.toast = String(next.toast ?? "true") !== "false";
              const yy = new YamlProgram(text);
              if (isNew) { const at = yy.addRow("alarms", row); setAlarmDraft(null); setSel({ key: `a${at}`, path: "alarm" }); }
              else yy.setRow("alarms", Number(sel.key.slice(1)), row);
              onChange(yy.toString());
            }} />
        </div>
      )}
      {blockNew && <BlockWizard aliases={aliases} onClose={() => setBlockNew(false)} onSave={(obj) => { const yy = new YamlProgram(text); const at = yy.addRow("blocks", obj); onChange(yy.toString()); setBlockNew(false); setSel({ key: `b${at}`, path: "block" }); }} />}
      {seqEdit && <SequenceForm seq={seqEdit.seq} aliases={aliases} extra={extra} onClose={() => setSeqEdit(null)} onSave={(head, steps) => { seqOp((yy) => yy.setSequence(seqEdit.index, head, steps)); setSeqEdit(null); }} />}

      {picker && <Modal title="Pick an address" width={640} onClose={() => setPicker(null)}><AddressPicker aliases={aliases} extra={extra} allow={picker.allow} onPick={(n) => { picker.cb(n); setPicker(null); }} /></Modal>}
      {blockEdit && <BlockWizard aliases={aliases} initial={blockEdit.row} onClose={() => setBlockEdit(null)} onSave={(obj) => { rowOp((yy) => yy.setRow("blocks", blockEdit.index, obj)); setBlockEdit(null); }} />}
      {commentEdit && (
        <Modal title={`Comment of rung ${commentEdit.index + 1}`} onClose={() => setCommentEdit(null)} footer={<><button className="btn" onClick={() => setCommentEdit(null)}>Cancel</button><button className="btn primary" onClick={() => { rowOp((yy) => yy.setRowComment("rungs", commentEdit.index, commentEdit.text)); setCommentEdit(null); }}>Apply</button></>}>
          <div className="field"><label>Written as a # comment above the rung in the code</label><textarea className="textarea" rows={3} autoFocus value={commentEdit.text} onChange={(e) => setCommentEdit({ ...commentEdit, text: e.target.value })} /></div>
        </Modal>
      )}
    </div>
  );
}
const coilId = (c) => (c.type === "out" && c.timer ? c.timer : c.type === "count" ? "count" : c.type);

// ---- inspectors (top-level components: typing keeps the focus) ----
function AddrInput({ label, value, onChange, pick, allow, placeholder }) {
  return (
    <div className="field"><label>{label}</label><div className="row">
      <input className="input mono grow" value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
      <button className="btn sm" onClick={() => pick(onChange, allow)}>pick</button>
    </div></div>
  );
}
function NodeInspector({ node, onChange, pick }) {
  switch (node.t) {
    case "contact":
      return (
        <div className="lad-insp-row">
          <b className="small">Contact</b>
          <AddrInput label="address or name" value={node.name} onChange={(v) => onChange({ name: v.trim() })} pick={pick} placeholder="gpio1.di1 / M10 / S.AUTO" />
          <div className="field"><label>type</label><div className="ptabs">{[["NO", false], ["NC", true]].map(([l, v]) => <button key={l} className={cx(node.nc === v && "active")} onClick={() => onChange({ nc: v })}>{l}</button>)}</div></div>
          <div className="field"><label>edge</label><div className="tabs">{[["level", null], ["P (rise)", "rise"], ["N (fall)", "fall"]].map(([l, v]) => <button key={l} className={cx(node.edge === v && "active")} onClick={() => onChange({ edge: v })}>{l}</button>)}</div></div>
          <span className="xs muted grow">{node.edge ? "1 for exactly one scan at the change; needs to have seen the other value first." : node.nc ? "Closed while the bit is 0." : "Closed while the bit is 1."}</span>
        </div>
      );
    case "cmp":
      return (
        <div className="lad-insp-row">
          <b className="small">Compare</b>
          <AddrInput label="left (number, register, formula)" value={node.a} onChange={(v) => onChange({ a: v })} pick={pick} allow={["R"]} placeholder="R0" />
          <div className="field"><label>op</label><select className="select" value={node.op} onChange={(e) => onChange({ op: e.target.value })}>{["==", "!=", "<", "<=", ">", ">="].map((o) => <option key={o}>{o}</option>)}</select></div>
          <AddrInput label="right" value={node.b} onChange={(v) => onChange({ b: v })} pick={pick} allow={["R"]} placeholder="10 / R2" />
          <div className="field"><label>invert</label><div className="tabs">{[["no", false], ["NOT", true]].map(([l, v]) => <button key={l} className={cx(node.nc === v && "active")} onClick={() => onChange({ nc: v })}>{l}</button>)}</div></div>
        </div>
      );
    case "timer":
      return (
        <div className="lad-insp-row">
          <b className="small">Time condition</b>
          <div className="field"><label>kind</label><div className="tabs">{[["ON_FOR", "on_for"], ["OFF_FOR", "off_for"]].map(([l, v]) => <button key={l} className={cx(node.kind === v && "active")} onClick={() => onChange({ kind: v })}>{l}</button>)}</div></div>
          <div className="field"><label>time (500ms, 2s, or a register in ms)</label><input className="input mono" value={node.time} onChange={(e) => onChange({ time: e.target.value })} /></div>
          <div className="field"><label>invert</label><div className="tabs">{[["no", false], ["NOT", true]].map(([l, v]) => <button key={l} className={cx(node.nc === v && "active")} onClick={() => onChange({ nc: v })}>{l}</button>)}</div></div>
          <span className="xs muted grow">{node.kind === "on_for" ? "True when the part on its left has been true for this long without a break." : "True when the part on its left has been false for this long."}</span>
        </div>
      );
    case "group":
      return (
        <div className="lad-insp-row">
          <b className="small">Box</b>
          <div className="field"><label>function</label><div className="tabs">{[["NOT", "not"], ["P (rise)", "rise"], ["N (fall)", "fall"]].map(([l, v]) => <button key={l} className={cx(node.fn === v && "active")} onClick={() => onChange({ fn: v })}>{l}</button>)}</div></div>
          <span className="xs muted grow">Applies to the whole part on its left (e.g. NOT (a OR b), RISE(a AND b)).</span>
        </div>
      );
    case "const":
      return <div className="lad-insp-row"><b className="small">Constant {node.value ? "TRUE" : "FALSE"}</b><button className="btn sm" onClick={() => onChange({ t: "contact", name: "", nc: false, edge: null })}>Replace with a contact</button><span className="xs muted grow">{node.value ? "Always closed." : "Never closed: the transition / rung never passes."}</span></div>;
    case "series":
    case "parallel":
      return <div className="lad-insp-row"><b className="small">{node.t === "series" ? "Series (AND)" : "Parallel branch (OR)"}</b><span className="xs muted">Select a single element to edit it, or use the palette to add around this group.</span></div>;
    default:
      return <div className="lad-insp-row"><b className="small">{node.t}</b></div>;
  }
}
function CoilInspector({ coil, onChange, pick }) {
  const bitTarget = ["out", "set", "reset", "toggle"].includes(coil.type);
  return (
    <div className="lad-insp-row">
      <b className="small">{coil.type === "out" && coil.timer ? `${coil.timer.toUpperCase()} coil` : coil.type === "count" ? "Counter" : coil.type === "emergency" ? "Emergency" : coil.type === "move" || coil.type === "calc" ? coil.type.toUpperCase() : `Coil (${coil.type})`}</b>
      {bitTarget && <AddrInput label="output bit (Q or M)" value={coil.target} onChange={(v) => onChange({ target: v.trim() })} pick={pick} allow={["Q", "M"]} placeholder="gpio1.do1 / M10" />}
      {coil.type === "out" && coil.timer && <div className="field"><label>time PT (500ms, 2s, register ms)</label><input className="input mono" value={coil.time} onChange={(e) => onChange({ time: e.target.value })} /></div>}
      {(coil.type === "count" || coil.type === "move" || coil.type === "calc") && <AddrInput label="register" value={coil.target} onChange={(v) => onChange({ target: v.trim() })} pick={pick} allow={["R"]} placeholder="R0" />}
      {coil.type === "count" && <>
        <div className="field"><label>CD: count down on (optional)</label><input className="input mono" value={coil.down} onChange={(e) => onChange({ down: e.target.value })} /></div>
        <div className="field"><label>R: reset while (optional)</label><input className="input mono" value={coil.reset} onChange={(e) => onChange({ reset: e.target.value })} /></div>
        <div className="field"><label>PV: preset</label><input className="input mono" style={{ width: 90 }} value={coil.preset} onChange={(e) => onChange({ preset: e.target.value })} /></div>
        <AddrInput label="Q: done bit (optional)" value={coil.done} onChange={(v) => onChange({ done: v.trim() })} pick={pick} allow={["Q", "M"]} placeholder="M24" />
      </>}
      {(coil.type === "move" || coil.type === "calc") && <div className="field"><label>{coil.type === "move" ? "value (number or register)" : "formula (+ - * / %)"}</label><input className="input mono" value={coil.value} onChange={(e) => onChange({ value: e.target.value })} /></div>}
      {coil.type === "emergency" && <div className="field grow"><label>text shown with the emergency</label><input className="input" value={coil.text} onChange={(e) => onChange({ text: e.target.value })} /></div>}
      <span className="xs muted grow">{{ out: coil.timer ? { ton: "Target = 1 after the rung has been true for PT.", tof: "Target stays 1 for PT after the rung goes false.", tp: "Target = 1 for exactly PT when the rung becomes true." }[coil.timer] : "Target follows the rung every scan (1 and 0).", set: "While the rung is true: target = 1, and it stays 1.", reset: "While the rung is true: target = 0.", toggle: "Each 0→1 of the rung flips the target.", count: "CU = the rung (counts its rising edges). The register IS the counter.", move: "While the rung is true (TRUE rung = every scan).", calc: "While the rung is true (TRUE rung = every scan).", emergency: "Rising edge of the rung → robot emergency stop + safe state." }[coil.type]}</span>
    </div>
  );
}

function TransInspector({ t, seq }) {
  const what = t.field === "start" ? "T0 — start: 0 IDLE → step 1" : t.field === "abort" ? "ABORT: any step → 0 IDLE" : `T${t.field + 1} — step ${t.field + 1} → ${t.field + 1 < seq.steps.length ? `step ${t.field + 2}` : "0 IDLE"}`;
  return <div className="lad-insp-row"><b className="small">Transition</b><span className="mono small">{what}</span><span className="xs muted grow">Pick a contact from the palette (NO, NC, P, N, OR, CMP, ON_FOR…). {t.field === "abort" ? "Delete every contact to remove the abort." : "The step changes in the scan where this is true."}</span></div>;
}
function StepInspector({ n, seq, step, onChange, pick }) {
  const list = Array.isArray(step.do) ? step.do : [];
  return (
    <div className="lad-insp-row">
      <b className="small">Step {n} of {seq.name}</b>
      <div className="field"><label>name</label><input className="input mono" style={{ width: 130 }} value={step.name} onChange={(e) => onChange({ name: e.target.value.replace(/[^A-Za-z0-9_]/g, "") })} /></div>
      <div className="field"><label>outputs = 1 while active (N)</label>
        <div className="row" style={{ flexWrap: "wrap", gap: 4, minHeight: 30 }}>
          {list.map((d, k) => <span key={k} className="pill mono">{d}<button className="btn icon ghost sm" style={{ width: 18, height: 18 }} title="Remove" onClick={() => onChange({ do: list.filter((_, m) => m !== k) })}>×</button></span>)}
          <button className="btn sm" onClick={() => pick((v) => onChange({ do: [...list, v.trim()] }), ["Q", "M"])}>+ bit</button>
        </div>
      </div>
      <div className="field"><label>timeout (optional)</label><input className="input mono" style={{ width: 80 }} value={step.timeout || ""} placeholder="2s" onChange={(e) => onChange({ timeout: e.target.value.trim(), on_timeout: step.on_timeout || "" })} /></div>
      {step.timeout && <AddrInput label="on_timeout: bit set to 1" value={step.on_timeout || ""} onChange={(v) => onChange({ on_timeout: v.trim() })} pick={pick} allow={["Q", "M"]} placeholder="M30" />}
      <span className="xs muted grow">The transition below the step (T{n}) is edited by clicking it.{step.timeout && !step.on_timeout ? " A timeout needs an on_timeout bit." : ""}</span>
    </div>
  );
}

function BlockInspector({ row, def, onChange, pick, onWizard }) {
  const { left, right } = blockPorts(row, def);
  const ports = [...left, ...right];
  const setPort = (name, v) => {
    const w = { ...(row.with || {}) };
    if (String(v).trim()) w[name] = String(v).trim(); else delete w[name];
    onChange({ use: row.use, as: row.as || row.use, with: w });
  };
  const allowOf = (k) => (k === "out" ? ["Q", "M"] : k === "in" ? ["I", "Q", "M", "S"] : ["R"]);
  return (
    <div className="lad-insp-row" style={{ alignItems: "flex-start" }}>
      <b className="small">Block {row.as || row.use}</b>
      <div className="field"><label>instance name</label><input className="input mono" style={{ width: 130 }} value={row.as || ""} onChange={(e) => onChange({ ...row, as: e.target.value.replace(/[^A-Za-z0-9_]/g, "") })} /></div>
      {ports.map((p) => p.kind === "in" || p.kind === "out" || p.kind === "register"
        ? <AddrInput key={p.name} label={`${p.name} (${p.kind === "in" ? "input bit" : p.kind === "out" ? "output bit" : "register"})`} value={p.value} onChange={(v) => setPort(p.name, v)} pick={pick} allow={allowOf(p.kind)} placeholder={p.def ? `default ${p.def}` : p.optional ? "optional" : ""} />
        : <div key={p.name} className="field"><label>{p.name} ({p.kind === "time" ? "time" : p.kind === "number" ? "number" : "value"})</label><input className="input mono" style={{ width: 110 }} value={p.value} placeholder={p.def ? `default ${p.def}` : p.kind === "time" ? "500ms" : ""} onChange={(e) => setPort(p.name, e.target.value)} /></div>)}
      <button className="btn sm" onClick={onWizard} title="Pick another library block or see every port">Change block…</button>
      <span className="xs muted grow">{def?.description || "Library block"}. Inputs are read as contacts, outputs are written like coils.</span>
    </div>
  );
}
function AlarmInspector({ alarm, onChange, pick }) {
  const level = ALARM_LEVELS.includes(String(alarm.level)) ? String(alarm.level) : "error";
  const toast = String(alarm.toast ?? "true") !== "false";
  return (
    <div className="lad-insp-row">
      <b className="small">Alarm</b>
      <AddrInput label="bit (contact): alarm while it is 1" value={String(alarm.bit || "")} onChange={(v) => onChange({ bit: v.trim() })} pick={pick} allow={["I", "Q", "M", "S"]} placeholder="M30" />
      <div className="field grow" style={{ minWidth: 200 }}><label>text shown to the operator</label><input className="input" value={String(alarm.text || "")} placeholder="the bit's name" onChange={(e) => onChange({ text: e.target.value })} /></div>
      <div className="field"><label>level</label><div className="ptabs">{ALARM_LEVELS.map((l) => <button key={l} className={cx(level === l && "active")} onClick={() => onChange({ level: l })}>{l}</button>)}</div></div>
      <div className="field"><label>popup</label><div className="ptabs">{[["toast", true], ["silent", false]].map(([l, v]) => <button key={l} className={cx(toast === v && "active")} onClick={() => onChange({ toast: v })}>{l}</button>)}</div></div>
    </div>
  );
}
