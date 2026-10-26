// MonitorPage -- the image table live (inputs, outputs logic vs physical, M bits, registers,
// system bits) next to the commissioning tools and the program's rungs, sequences, alarms and
// events. Both panes resize; hiding one gives the other the whole width.
import { memo, useMemo, useState } from "react";
import { Eye, EyeOff, PanelRightClose, PanelRightOpen } from "lucide-react";
import { usePlc } from "../../store/plc";
import { I_GROUPS, Q_GROUPS, M_NAMES, S_NAMES, R_NAMES, S_HELP, I_HELP, aliasMap } from "../../lib/addresses";
import { Tabs, cx } from "../../components/ui";
import { Split } from "../../../../components/ui/Split";
import { plcApi } from "../../lib/api";
import { toast } from "../../store/toast";
import { plainText } from "../../../../lib/plainText";
import { usePref } from "../../lib/prefs";
import CommissionPanel from "./CommissionPanel";

// redrawn only when what it shows changes (the click handler is rebuilt on every frame)
const Bit = memo(function Bit({ name, v, alias, forced, controlled, logic, hint, onClick }) {
  const mismatch = controlled && logic !== undefined && logic !== v;
  return (
    <div className={cx("bit", v === 1 && "on", forced && "forced", controlled === false && "free", onClick && "clickable")} title={`${name}${alias ? ` (${alias})` : ""}${hint ? ` - ${hint}` : ""}${controlled === false ? " - free (not in the program)" : ""}${mismatch ? ` - logic wants ${logic}, physical is ${v} (safe state / force)` : ""}`} onClick={onClick}>
      <span className={cx("led", v === 1 && (forced ? "warn" : "on"))} />
      <span className="col" style={{ gap: 0, minWidth: 0 }}><span className="name">{name.replace(/^(joint\d|gpio1)\./, "")}</span>{alias && <span className="alias">{alias}</span>}</span>
      {forced ? <span className="tag">F</span> : mismatch ? <span className="tag mismatch">≠{logic}</span> : null}
    </div>
  );
}, (a, b) => a.name === b.name && a.v === b.v && a.alias === b.alias && a.forced === b.forced && a.controlled === b.controlled
  && a.logic === b.logic && a.hint === b.hint && Boolean(a.onClick) === Boolean(b.onClick));

export default function MonitorPage() {
  const state = usePlc((s) => s.state);
  const alarms = usePlc((s) => s.alarms);
  const events = usePlc((s) => s.events);
  const sim = usePlc((s) => s.sim);
  const [side, setSide] = usePref("monitorSide", "commission");
  const [showImage, setShowImage] = usePref("monitorImage", true);
  const [showSide, setShowSide] = usePref("monitorPanel", true);
  const [showAllM, setShowAllM] = useState(false);
  const [pick, setPick] = useState(null);
  const aliases = useMemo(() => aliasMap(state?.aliases), [state?.aliases]);
  if (!state) return <div className="page"><div className="empty">Waiting for the PLC…</div></div>;
  const b = state.bits, forced = new Set(state.forced);
  const usedM = M_NAMES.filter((n) => aliases.has(n) || b[n] === 1);
  const mList = showAllM ? M_NAMES : usedM.length ? M_NAMES.slice(0, Math.max(32, Math.max(...usedM.map((n) => Number(n.slice(1)))) + 1)) : M_NAMES.slice(0, 32);
  const toggleInput = sim ? (n) => plcApi.simInput(n, b[n] !== 1).catch((e) => toast.error(plainText(e.message))) : undefined;
  const pickFor = (kind) => (n) => { setPick({ name: n, kind, at: Date.now() }); setSide("commission"); setShowSide(true); };

  const image = showImage && (
    <div key="image" className="panel"><div className="panel-body col" style={{ gap: 16 }}>
      <div className="iogroup" data-tut="plc-inputs">
        <div className="iogroup-title">Inputs <span className="cnt">I · 56</span>{sim && <span className="pill info">simulated: click to toggle</span>}</div>
        {I_GROUPS.map((g) => (
          <div key={g.device} className="row" style={{ alignItems: "flex-start" }}>
            <span className="mono xs muted" style={{ width: 46, paddingTop: 8 }}>{g.device}</span>
            <div className="bitgrid io grow">{g.names.map((n) => <Bit key={n} name={n} v={b[n]} alias={aliases.get(n)} forced={forced.has(n)} hint={I_HELP(n)} onClick={toggleInput && !forced.has(n) ? () => toggleInput(n) : () => pickFor("I")(n)} />)}</div>
          </div>
        ))}
      </div>
      <div className="iogroup" data-tut="plc-outputs">
        <div className="iogroup-title">Outputs <span className="cnt">Q · 32</span><span className="muted">physical value; ≠ shows what the logic wants when they differ</span></div>
        {Q_GROUPS.map((g) => (
          <div key={g.device} className="row" style={{ alignItems: "flex-start" }}>
            <span className="mono xs muted" style={{ width: 46, paddingTop: 8 }}>{g.device}</span>
            <div className="bitgrid io grow">{g.names.map((n) => <Bit key={n} name={n} v={b[n]} alias={aliases.get(n)} forced={forced.has(n)} controlled={state.q_controlled[n]} logic={state.logic_q[n]} onClick={() => pickFor("Q")(n)} />)}</div>
          </div>
        ))}
      </div>
      <div className="iogroup" data-tut="plc-mbits">
        <div className="iogroup-title">M bits <span className="cnt">M0 … M127</span><button className="btn sm ghost" onClick={() => setShowAllM((v) => !v)}>{showAllM ? "show used" : "show all 128"}</button></div>
        <div className="bitgrid dense">{mList.map((n) => <Bit key={n} name={n} v={b[n]} alias={aliases.get(n)} onClick={() => pickFor("M")(n)} />)}</div>
      </div>
      <div className="iogroup" data-tut="plc-regs">
        <div className="iogroup-title">Registers <span className="cnt">R0 … R31</span></div>
        <div className="reggrid">{R_NAMES.map((n) => <button key={n} className="reg" onClick={() => pickFor("R")(n)} title="Pick this register to write it"><span className="name">{n}</span>{aliases.get(n) && <span className="alias">{aliases.get(n)}</span>}<span className="v">{state.regs[n]}</span></button>)}</div>
      </div>
      <div className="iogroup" data-tut="plc-sysbits">
        <div className="iogroup-title">System bits <span className="cnt">S</span></div>
        <div className="bitgrid">{S_NAMES.map((n) => <Bit key={n} name={n} v={b[n]} hint={S_HELP[n]} />)}</div>
      </div>
    </div></div>
  );

  const panel = showSide && (
    <div key="side" className="panel">
      <div className="panel-head" data-tut="plc-side-tabs"><Tabs value={side} onChange={setSide} items={[{ id: "commission", label: "Commission" }, { id: "rungs", label: `Rungs ${state.rungs.length}` }, { id: "seq", label: `Sequences ${state.seqs.length}` }, { id: "alarms", label: `Alarms ${alarms.length}` }, { id: "events", label: "Events" }]} /></div>
      <div className="panel-body" data-tut="plc-side-body">
        {side === "commission" && <CommissionPanel pick={pick} />}
        {side === "rungs" && (state.rungs.length ? <div className="rungs-live">{state.rungs.map((r, i) => <div key={i} className={cx("r", r.result && "on")}><span className="n">{i + 1}</span><span>{r.text}</span></div>)}</div> : <div className="empty">No program loaded.</div>)}
        {side === "seq" && (state.seqs.length ? <div className="seqstrip">{state.seqs.map((s) => <SeqRow key={s.name} s={s} />)}</div> : <div className="empty">The program has no sequences.</div>)}
        {side === "alarms" && (alarms.length ? <div className="alarmlist">{[...alarms].reverse().map((a, i) => <div key={i} className={cx("alarm", a.level, !a.active && "cleared")}><span className="pill bit mono">{a.bit}</span><span>{a.active ? a.text : `cleared: ${a.text}`}</span><time>{new Date(a.time).toLocaleTimeString()}</time></div>)}</div> : <div className="empty">No alarms since the page opened.</div>)}
        {side === "events" && <div className="eventlog">{[...events].reverse().map((e, i) => <div key={i} className={cx("e", e.level)}><time>{new Date(e.time).toLocaleTimeString()}</time><span>{e.text}</span></div>)}</div>}
      </div>
    </div>
  );

  return (
    <div className="page">
      <div className="page-bar">
        <div data-tut="plc-scan" className="scanbox" title="Scan period / time the last scan took / scans since the program was loaded">
          <ScanBox fallback={state} />
        </div>
        <span className="grow" />
        <button data-tut="plc-hide-image" className={cx("btn sm", !showImage && "active")} disabled={showImage && !showSide} onClick={() => setShowImage(!showImage)} title={showImage ? "Hide the I/O image" : "Show the I/O image"}>{showImage ? <EyeOff size={14} /> : <Eye size={14} />}{showImage ? "Hide image" : "Show image"}</button>
        <button data-tut="plc-hide-panel" className={cx("btn sm", !showSide && "active")} disabled={showSide && !showImage} onClick={() => setShowSide(!showSide)} title={showSide ? "Hide the side panel" : "Show the side panel"}>{showSide ? <PanelRightClose size={14} /> : <PanelRightOpen size={14} />}{showSide ? "Hide panel" : "Show panel"}</button>
      </div>
      {state.safe_state && <div className={cx("banner", b["S.EMERGENCY"] || b["S.PLC_EMERGENCY"] ? "danger" : "warn")}><b>Safe state</b>: the controlled outputs are held at their safe values{b["S.PLC_EMERGENCY"] ? " (an EMERGENCY rung fired; waiting for the robot)" : b["S.EMERGENCY"] ? " (emergency latched by the robot)" : !state.program_ok ? " (no program loaded)" : b["S.IO_FAULT"] ? " (inputs stale / IO fault)" : ""}.</div>}
      <Split id="plc.monitor" defaults={[7, 4]} min={[360, 320]} className="plc-split">
        {image}
        {panel}
      </Split>
    </div>
  );
}

/** Scan counters: their own subscription, so a scan-only frame redraws just this. */
function ScanBox({ fallback }) {
  const s = usePlc((x) => x.scan) || fallback;
  return (
    <>
      <span className="xs muted">Scan</span><b className="mono tabular">{Number(s.scan_period_ms || 0).toFixed(1)} ms</b>
      <span className="xs muted">took</span><b className="mono tabular">{Number(s.scan_time_ms || 0).toFixed(2)} ms</b>
      <span className="xs muted">count</span><b className="mono tabular">{s.scan_count}</b>
    </>
  );
}

function SeqRow({ s }) {
  return (
    <div className="seqrow">
      <span className="seqname">{s.name}</span>
      <span className={cx("seqstep idle", s.step === 0 && "active")}>idle</span>
      {s.step > 0 && <span className="seqstep active">step {s.step}{s.step_name ? ` · ${s.step_name}` : ""}</span>}
    </div>
  );
}
