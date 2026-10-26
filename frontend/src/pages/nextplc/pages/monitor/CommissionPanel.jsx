// CommissionPanel -- the commissioning tools, on the Monitor page next to the live image: write
// M bits / registers from outside, pulse a bit, force a physical input or output (refused in
// AUTO), release forces, load / reload the program, reset the fault; on the simulator also play
// the supervisor. A click on a bit in the image fills the matching field (`pick`).
import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, RotateCcw, Upload, Zap } from "lucide-react";
import { usePlc } from "../../store/plc";
import { plcApi, programsApi } from "../../lib/api";
import { toast } from "../../store/toast";
import { plainText } from "../../../../lib/plainText";
import { Modal, confirm, cx } from "../../components/ui";
import AddressPicker from "../../components/AddressPicker";
import { aliasMap } from "../../lib/addresses";

function useAction() {
  const [busy, setBusy] = useState(false);
  const run = async (fn, okText) => {
    setBusy(true);
    try { const r = await fn(); if (r?.ok === false) toast.error(plainText(r.message)); else toast.success(okText || plainText(r?.message) || "done"); return r; }
    catch (e) { toast.error(plainText(e.message)); }
    finally { setBusy(false); }
  };
  return [busy, run];
}

function Section({ title, extra, children, tut }) {
  return (
    <section className="comm-section" data-tut={tut}>
      <div className="comm-head"><h4>{title}</h4>{extra}</div>
      {children}
    </section>
  );
}

export default function CommissionPanel({ pick }) {
  const state = usePlc((s) => s.state);
  const program = usePlc((s) => s.program);
  const sim = usePlc((s) => s.sim);
  const bridge = usePlc((s) => s.bridge);
  const aliases = useMemo(() => aliasMap(state?.aliases), [state?.aliases]);
  const [busy, run] = useAction();
  const [picker, setPicker] = useState(null); // { cb, allow }
  const [setName, setSetName] = useState("M10");
  const [setValue, setSetValue] = useState("1");
  const [pulseMs, setPulseMs] = useState("100");
  const [regName, setRegName] = useState("R0");
  const [regValue, setRegValue] = useState("0");
  const [forceName, setForceName] = useState("gpio1.di1");
  const inAuto = Boolean(state?.bits["S.AUTO"]);
  const live = (n) => (state ? (n.startsWith("R") && !n.includes(".") ? state.regs[n] : state.bits[n]) : undefined);

  // a bit clicked in the image
  useEffect(() => {
    if (!pick) return;
    if (pick.kind === "M") setSetName(pick.name);
    else if (pick.kind === "R") setRegName(pick.name);
    else setForceName(pick.name);
  }, [pick]);

  return (
    <div className="comm-col">
      {!bridge.simulated && <div className="banner warn"><AlertTriangle size={16} /><span>These commands write into the running PLC on the robot. A forced input blinds the logic to the real sensor: release every force before production.</span></div>}

      <Section tut="plc-cm-write" title="Write a bit or a register">
        <p className="small muted">Only <span className="mono">M</span> bits and <span className="mono">R</span> registers can be written from outside. A bit driven by a rung or a sequence is refused: the program owns it. Click an M bit or a register in the image to pick it.</p>
        <div className="row wrap">
          <div className="field grow"><label>M bit (address or name)</label><div className="row"><input className="input mono grow" value={setName} onChange={(e) => setSetName(e.target.value)} /><button className="btn" onClick={() => setPicker({ cb: setSetName, allow: ["M"] })}>pick</button></div></div>
          <div className="field" style={{ width: 80 }}><label>Value</label><select className="select" value={setValue} onChange={(e) => setSetValue(e.target.value)}><option value="1">1</option><option value="0">0</option></select></div>
        </div>
        <div className="row wrap">
          <button data-tut="plc-cm-writebit" className="btn primary" disabled={busy || !setName} onClick={() => run(() => plcApi.setBits([setName], [Number(setValue)]), `${setName} = ${setValue}`)}>Write {setName} = {setValue}{live(setName) !== undefined ? ` (now ${live(setName)})` : ""}</button>
          <div className="row"><input className="input mono" style={{ width: 72 }} value={pulseMs} onChange={(e) => setPulseMs(e.target.value)} /><span className="small muted">ms</span><button data-tut="plc-cm-pulse" className="btn" disabled={busy || !setName} onClick={() => run(() => plcApi.setBits([setName], [1], [Number(pulseMs)]), `${setName} pulsed ${pulseMs} ms`)}><Zap size={14} />Pulse</button></div>
        </div>
        <div className="row wrap">
          <div className="field grow"><label>Register</label><div className="row"><input className="input mono grow" value={regName} onChange={(e) => setRegName(e.target.value)} /><button className="btn" onClick={() => setPicker({ cb: setRegName, allow: ["R"] })}>pick</button></div></div>
          <div className="field" style={{ width: 110 }}><label>Value (int32)</label><input className="input mono" value={regValue} onChange={(e) => setRegValue(e.target.value)} /></div>
          <button data-tut="plc-cm-writereg" className="btn primary" style={{ alignSelf: "flex-end" }} disabled={busy || !regName} onClick={() => run(() => plcApi.setBits([regName], [Number(regValue) | 0]), `${regName} = ${regValue}`)}>Write{live(regName) !== undefined ? ` (now ${live(regName)})` : ""}</button>
        </div>
        {state?.aliases?.length > 0 && <div className="row wrap" style={{ gap: 4 }}><span className="xs muted">Names of the loaded program:</span>{state.aliases.filter((a) => /^(M|R)\d/.test(a.target)).map((a) => <button key={a.alias} className="pill mono" onClick={() => (a.target.startsWith("R") ? (setRegName(a.alias), setRegValue(String(live(a.target) ?? 0))) : setSetName(a.alias))}>{a.alias} = {live(a.target)}</button>)}</div>}
      </Section>

      <Section tut="plc-cm-force" title="Force a physical input or output" extra={state?.forced_count > 0 && <span className="pill warn">{state.forced_count} forced</span>}>
        <p className="small muted">A forced input replaces the real sensor in the image; a forced output wins over the program and the safe state. {inAuto ? <b style={{ color: "var(--danger-text)" }}>Refused in AUTO: {sim ? "set the simulated supervisor below" : "switch the robot"} to JOG or SAFEAUTO first.</b> : bridge.simulated ? "" : "Click an input or an output in the image to pick it."}</p>
        <div className="field"><label>Input or output</label><div className="row"><input className="input mono grow" value={forceName} onChange={(e) => setForceName(e.target.value)} /><button className="btn" onClick={() => setPicker({ cb: setForceName, allow: ["I", "Q"] })}>pick</button></div></div>
        <div className="row wrap">
          <button data-tut="plc-cm-force1" className="btn warn" disabled={busy || inAuto} onClick={() => run(() => plcApi.force(forceName, true), `${forceName} forced to 1`)}>Force {forceName} = 1</button>
          <button className="btn warn" disabled={busy || inAuto} onClick={() => run(() => plcApi.force(forceName, false), `${forceName} forced to 0`)}>Force = 0</button>
          <button data-tut="plc-cm-release" className="btn" disabled={busy} onClick={() => run(() => plcApi.force(forceName, false, true), `${forceName} released`)}>Release</button>
        </div>
        {state?.forced?.length > 0 && (
          <div className="forcelist" data-tut="plc-cm-forcelist">
            {state.forced.map((n) => <div key={n} className="forcerow"><span className="led warn" /><span>{n}</span>{aliases.get(n) && <span className="muted">({aliases.get(n)})</span>}<span className="grow" /><span>= {state.bits[n]}</span><button className="btn sm" onClick={() => run(() => plcApi.force(n, false, true), `${n} released`)}>release</button></div>)}
            <button className="btn danger sm" style={{ alignSelf: "flex-start" }} onClick={async () => { if (await confirm({ title: "Release all forces", message: "Every forced input and output goes back to its real value.", okLabel: "Release all" })) run(() => plcApi.releaseAll(), "all forces released"); }}>Release all</button>
          </div>
        )}
      </Section>

      <Section tut="plc-cm-program" title="Program and faults">
        <div className="small">Loaded: <b className="mono">{program?.ok ? program.name : "none"}</b>{program && !program.ok && <div className="err-line" style={{ marginTop: 6 }}><b>refused</b><span>{plainText(program.error)}</span></div>}</div>
        <div className="row wrap">
          <button data-tut="plc-cm-reload" className="btn" disabled={busy} onClick={async () => { if (await confirm({ title: "Reload the program", message: "Reload the current program. M and R keep their values; timers, edges and sequences start fresh; every controlled output is sent once.", okLabel: "Reload" })) run(() => programsApi.load(), "program reloaded"); }}><RotateCcw size={14} />Reload</button>
          <LoadOther busy={busy} run={run} />
          <button data-tut="plc-cm-reset" className="btn" disabled={busy} onClick={() => run(() => plcApi.resetFault(), "reset sent")}><Upload size={14} style={{ transform: "rotate(180deg)" }} />Reset fault</button>
        </div>
        <p className="small muted">An EMERGENCY rung latches the PLC safe state until the robot reports the emergency; the operator then resets the fault. A program reload also clears the PLC latch.</p>
      </Section>

      {sim && (
        <Section tut="plc-cm-sim" title="Simulated supervisor" extra={<span className="pill info">simulator only</span>}>
          <p className="small muted">On the robot these come from the motion supervisor. Here you play it: profile, armed, emergency, e-stop, and stale inputs.</p>
          <div className="supbar" data-tut="plc-cm-profile">
            <span className="xs muted">Profile</span>
            {["AUTO", "SAFEAUTO", "JOG"].map((p) => <button key={p} className={cx("btn sm", sim.supervisor.ok && sim.supervisor.profile === p && "active")} onClick={() => run(() => plcApi.simSupervisor(p), `profile ${p}`)}>{p}</button>)}
            <button className={cx("btn sm", !sim.supervisor.ok && "active")} onClick={() => run(() => plcApi.simSupervisor(sim.supervisor.ok ? "OFF" : "ON"), "supervisor")}>{sim.supervisor.ok ? "Supervisor off" : "Supervisor on"}</button>
          </div>
          <div className="supbar">
            <button className={cx("btn sm", sim.supervisor.armed && "active")} onClick={() => run(() => plcApi.simSupervisor("ARMED", !sim.supervisor.armed), "armed")}>Armed {sim.supervisor.armed ? "1" : "0"}</button>
            <button className={cx("btn sm", sim.supervisor.emergency && "danger")} onClick={() => run(() => plcApi.simSupervisor("EMERGENCY", !sim.supervisor.emergency), "emergency")}>Emergency {sim.supervisor.emergency ? "1" : "0"}</button>
            <button className={cx("btn sm", sim.supervisor.estop && "danger")} onClick={() => run(() => plcApi.simSupervisor("ESTOP", !sim.supervisor.estop), "e-stop")}>E-stop {sim.supervisor.estop ? "1" : "0"}</button>
            <button className={cx("btn sm", sim.supervisor.fault && "warn")} onClick={() => run(() => plcApi.simSupervisor("FAULT", !sim.supervisor.fault), "fault")}>Drive fault {sim.supervisor.fault ? "1" : "0"}</button>
            <button className={cx("btn sm", sim.inputs_stale && "warn")} onClick={() => run(() => plcApi.simInputsStale(!sim.inputs_stale), "inputs")}>Inputs {sim.inputs_stale ? "STALE" : "fresh"}</button>
            <button className="btn sm primary" onClick={() => run(() => plcApi.simSupervisor("RESET"), "reset")}>Reset fault</button>
          </div>
        </Section>
      )}
      {picker && <Modal title="Pick" width={640} onClose={() => setPicker(null)}><AddressPicker aliases={aliases} allow={picker.allow} preferAlias={false} onPick={(n) => { picker.cb(n); setPicker(null); }} /></Modal>}
    </div>
  );
}

function LoadOther({ busy, run }) {
  const [files, setFiles] = useState(null);
  const [sel, setSel] = useState("");
  const openList = async () => { try { const r = await programsApi.list(); const all = [...(r.project ? [r.project] : []), ...r.programs]; setFiles(all); setSel(all[0]?.name || ""); } catch (e) { toast.error(plainText(e.message)); } };
  if (!files) return <button data-tut="plc-cm-loadother" className="btn" disabled={busy} onClick={openList}><Upload size={14} />Load another…</button>;
  const label = (n) => files.find((f) => f.name === n)?.label || n;
  return (
    <div className="row" data-tut="plc-cm-loadother">
      <select className="select" value={sel} onChange={(e) => setSel(e.target.value)}>{files.map((f) => <option key={f.name} value={f.name}>{f.label}{f.active ? " ●" : ""}</option>)}</select>
      <button className="btn primary" disabled={busy || !sel} onClick={async () => { if (await confirm({ title: "Load program", message: `Load ${label(sel)} into the PLC?`, okLabel: "Load" })) run(() => programsApi.load(sel)); }}>Load</button>
      <button className="btn ghost" onClick={() => setFiles(null)}>cancel</button>
    </div>
  );
}
