// SfcChart -- one sequence drawn as an SFC (Sequential Function Chart, IEC 61131-3 / GRAFCET):
//
//   ╔════════╗  initial step 0 = IDLE (double box)
//   ╚═══╤════╝
//     ──┼──  T0  start condition (a ladder network ending on the transition bar)
//   ┌───┴────┐  ┌───────────────┐
//   │ 1 name │──│ N gpio1.do3   │  step + its action block (bits = 1 while the step is active)
//   └───┬────┘  └───────────────┘
//     ──┼──  T1  next condition            timeout 2s → on_timeout = 1, back to IDLE
//       ↺ 0 IDLE                           after the last step
//
// Every transition is edited like a rung (same palette); a step box selects the step for the
// step inspector. Live: the active step is green, the transition the PLC checks now is "armed"
// and shows power flow, the time in the step runs against its timeout.
import { cx } from "../../components/ui";
import LadderSvg from "../../components/ladder/LadderSvg";
import { ArrowDown, ArrowUp, Copy, Pencil, Plus, Table2, Trash2 } from "lucide-react";

function Cond({ k, item, sel, setSel, read, live, armed, tail, readOnly }) {
  if (!item) return null;
  if (item.error) return <div className="err-line"><b>{tail.label}</b><span>Cannot be drawn: {item.error}. Fix "{item.raw}" in the code.</span></div>;
  const selected = sel?.key === k;
  return (
    <div className={cx("sfc-cond", selected && "is-selected", item.draft && "is-draft", armed && "is-armed")} onClick={(e) => { e.stopPropagation(); if (!readOnly) setSel({ key: k, path: [] }); }}>
      <LadderSvg net={item.net} coil={null} tail={{ ...tail, armed }} sel={selected ? sel.path : null} onSelect={(path) => !readOnly && setSel({ key: k, path })} read={read} live={live && armed && !item.draft} />
      {item.draft && <span className="pill warn xs">not written yet: {item.why}</span>}
    </div>
  );
}

const fmt = (s) => (s < 10 ? s.toFixed(1) : Math.round(s).toString());
const durS = (t) => { const m = /^\s*(\d+(?:\.\d+)?)\s*(ms|s|min)?\s*$/i.exec(String(t || "")); if (!m) return 0; const v = Number(m[1]); return (m[2] || "s").toLowerCase() === "ms" ? v / 1000 : (m[2] || "").toLowerCase() === "min" ? v * 60 : v; };

/**
 * props: seq {name, start, abort, steps:[{name, do, next, timeout, on_timeout}], block?}
 *        prefix (key prefix "q<i>" editable, "b<i>" read-only), trans(key) -> {net, error, raw, draft, why}
 *        sel, setSel, read, live, liveStep (0 = idle, n = step n, undefined = not live), since (ms)
 *        onSeq(op), onStep(op, j)
 */
export default function SfcChart({ seq, prefix, trans, sel, setSel, read, live, liveStep, since, readOnly, onSeq, onStep, line }) {
  const isLive = live && liveStep !== undefined;
  const inStep = isLive && since ? (Date.now() - since) / 1000 : 0;
  const steps = seq.steps || [];
  const active = isLive ? liveStep : -1;
  const selStep = sel?.path === "step" && sel.key.startsWith(`${prefix}.s`) ? Number(sel.key.slice(prefix.length + 2)) : -1;
  const headSel = sel?.key === `${prefix}.head`;
  const stepName = (n) => (n === 0 ? "IDLE" : steps[n - 1]?.name || "");
  const bit = (b) => { const v = isLive && read ? read(b) : undefined; return <span key={b} className={cx("sfc-bit mono", v && "on")}>{isLive && <span className={cx("led", v && "on")} />}{b}</span>; };

  return (
    <div className={cx("sfc", readOnly && "is-readonly")} onClick={(e) => e.stopPropagation()}>
      <div className={cx("lad-rung-head", headSel && "is-selected")}>
        <span className="num">SFC</span>
        <b className="mono small sfc-name" onClick={() => !readOnly && setSel({ key: `${prefix}.head`, path: "head" })} title={readOnly ? "" : "Rename"}>{seq.name}</b>
        {seq.block && <span className="pill mono" title="from a library block (edit the block in the Block library)">block {seq.block}</span>}
        {isLive && (active === 0
          ? <span className="pill">IDLE</span>
          : <span className="pill on">● step {active} {stepName(active)} · {fmt(inStep)} s</span>)}
        <span className="mono xs muted truncate grow">other rungs read seq.{seq.name}.step / .active / .{steps[0]?.name || "step"}</span>
        {!readOnly && <div className="row" style={{ gap: 1 }}>
          <button className="btn icon ghost sm" title="Rename" onClick={() => setSel({ key: `${prefix}.head`, path: "head" })}><Pencil size={13} /></button>
          <button className="btn icon ghost sm" title="Edit as a table" onClick={() => onSeq("table")}><Table2 size={13} /></button>
          {line > 0 && <button className="btn sm ghost" title="Show in the code" onClick={() => onSeq("line")}>line</button>}
          <button className="btn icon ghost sm" title="Duplicate the sequence" onClick={() => onSeq("duplicate")}><Copy size={13} /></button>
          <button className="btn icon ghost sm" title="Delete the sequence" onClick={() => onSeq("delete")}><Trash2 size={13} /></button>
        </div>}
      </div>

      <div className="sfc-abort">
        <span className="sfc-abort-lbl"><b>ABORT</b><span className="xs muted">any step → 0 IDLE, its outputs 0</span></span>
        {seq.abort || trans(`${prefix}.abort`)?.draft
          ? <Cond k={`${prefix}.abort`} item={trans(`${prefix}.abort`)} sel={sel} setSel={setSel} read={read} live={live} armed={isLive && active > 0} tail={{ label: "→ 0 IDLE" }} readOnly={readOnly} />
          : !readOnly ? <button className="btn sm ghost" onClick={() => onSeq("addAbort")}><Plus size={13} />abort condition</button> : <span className="xs muted">none</span>}
      </div>

      <div className="sfc-grid">
        {/* initial step */}
        <div className="sfc-l"><div className={cx("sfc-step initial", active === 0 && "active")}><span className="n">0</span><span>IDLE</span></div></div>
        <div className="sfc-r sfc-note xs muted">initial step: the sequence waits here (all its outputs 0)</div>

        <div className="sfc-l"><div className={cx("sfc-tbar", isLive && active === 0 && "armed")} /><span className="sfc-tn">T0</span></div>
        <div className="sfc-r"><Cond k={`${prefix}.start`} item={trans(`${prefix}.start`)} sel={sel} setSel={setSel} read={read} live={live} armed={isLive && active === 0} tail={{ label: `→ 1 ${stepName(1)}` }} readOnly={readOnly} /></div>

        {steps.map((st, j) => {
          const n = j + 1, isActive = active === n, to = durS(st.timeout);
          const last = j === steps.length - 1;
          return [
            <div key={`sl${j}`} className="sfc-l">
              <div className={cx("sfc-step", isActive && "active", selStep === j && "is-selected")} onClick={() => !readOnly && setSel({ key: `${prefix}.s${j}`, path: "step" })} title={readOnly ? "" : "Select the step"}>
                <span className="n">{n}</span><span className="truncate">{st.name}</span>
              </div>
            </div>,
            <div key={`sr${j}`} className="sfc-r sfc-actrow">
              <span className="sfc-link" />
              <div className={cx("sfc-action", isActive && "active")} onClick={() => !readOnly && setSel({ key: `${prefix}.s${j}`, path: "step" })}>
                <span className="q" title="N = non-stored: 1 while the step is active, 0 when it is left">N</span>
                <div className="bits">{(st.do || []).length ? st.do.map(bit) : <span className="xs muted">no outputs</span>}</div>
              </div>
              {!readOnly && selStep === j && <div className="row" style={{ gap: 1 }}>
                <button className="btn icon ghost sm" title="Step up" onClick={() => onStep("up", j)}><ArrowUp size={13} /></button>
                <button className="btn icon ghost sm" title="Step down" onClick={() => onStep("down", j)}><ArrowDown size={13} /></button>
                <button className="btn sm ghost" title="New step after this one" onClick={() => onStep("add", j)}><Plus size={13} />step</button>
                <button className="btn icon ghost sm" title="Delete the step" disabled={steps.length < 2} onClick={() => onStep("delete", j)}><Trash2 size={13} /></button>
              </div>}
            </div>,
            <div key={`tl${j}`} className="sfc-l"><div className={cx("sfc-tbar", isActive && "armed")} /><span className="sfc-tn">T{n}</span></div>,
            <div key={`tr${j}`} className="sfc-r sfc-trow">
              <Cond k={`${prefix}.t${j}`} item={trans(`${prefix}.t${j}`)} sel={sel} setSel={setSel} read={read} live={live} armed={isActive} tail={{ label: last ? "→ 0 IDLE" : `→ ${n + 1} ${stepName(n + 1)}` }} readOnly={readOnly} />
              {st.timeout && (
                <div className={cx("sfc-timeout", isActive && "active")} title="If the transition is not true within this time: the on_timeout bit is set (and stays 1) and the sequence goes back to IDLE">
                  <span>⏱ <b className="mono">{st.timeout}</b> → <b className="mono">{st.on_timeout || "?"}</b> = 1, back to 0 IDLE</span>
                  {isActive && to > 0 && <span className="sfc-tbar-prog"><i style={{ width: `${Math.min(100, (inStep / to) * 100)}%` }} /></span>}
                </div>
              )}
            </div>,
          ];
        })}

        <div className="sfc-l"><div className="sfc-jump">↺</div></div>
        <div className="sfc-r sfc-note xs muted">after the last step: back to <b>0 IDLE</b> (jump), and T0 is checked again</div>
      </div>
    </div>
  );
}
