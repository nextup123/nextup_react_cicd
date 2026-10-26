// Diagnostics › Summary: one button gathers every source and shows what matters
// on one page: an overall verdict with findings, the robot now, the joints, the
// last 24 hours, the PLC and the robot PC. Nothing is fetched until asked.
import { useState } from "react";
import {
  Activity, AlertOctagon, AlertTriangle, BarChart3, CheckCircle2, CircuitBoard, ClipboardCopy, ClipboardList, Cpu, Info, RefreshCw, Search, Server, ShieldAlert, Sparkles,
} from "lucide-react";
import { Badge, Button, Card, EmptyState, cx } from "../../components/ui";
import { toast } from "../../store/toast";
import { compileSummary, fmtSecs, summaryText } from "./summaryData";
import BlackboxViewer from "./BlackboxViewer";

const VERDICT = {
  ok: { icon: CheckCircle2, title: "All good", text: "Nothing needs attention right now." },
  warn: { icon: AlertTriangle, title: "Needs attention", text: "The robot can work, but check the points below." },
  crit: { icon: AlertOctagon, title: "Action needed", text: "Fix the first point below before production." },
};
const LEVEL_ICON = { crit: AlertOctagon, warn: AlertTriangle, info: Info };

function Row({ label, children, tone }) {
  return (
    <div className="dg-sum-row">
      <span className="dg-sum-k">{label}</span>
      <span className={cx("dg-sum-v", tone && `text-${tone}`)}>{children ?? "–"}</span>
    </div>
  );
}

function Section({ icon: Icon, title, children, className }) {
  return (
    <section className={cx("dg-sum-sec", className)}>
      <h3 className="dg-sum-h"><Icon size={15} /> {title}</h3>
      {children}
    </section>
  );
}

const ago = (t) => {
  const ms = Date.now() - (typeof t === "number" ? t : Date.parse(String(t || "").replace(" ", "T")));
  if (!Number.isFinite(ms) || ms < 0) return "";
  const m = Math.round(ms / 60000);
  return m < 1 ? "just now" : m < 60 ? `${m} min ago` : m < 48 * 60 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`;
};

export function SummaryPanel({ onLookup, onGoto }) {
  const [s, setS] = useState(null);
  const [busy, setBusy] = useState(false);
  const [viewing, setViewing] = useState(null);

  const run = async () => {
    setBusy(true);
    try {
      setS(await compileSummary());
    } catch (err) {
      toast.error(String(err?.message || err), { title: "Summary failed" });
    } finally {
      setBusy(false);
    }
  };
  const copy = () =>
    navigator.clipboard?.writeText(summaryText(s)).then(
      () => toast.success("Summary copied"),
      () => toast.error("The browser did not allow copying")
    );

  const v = s ? VERDICT[s.verdict] : null;
  const r = s?.robot;
  const a = s?.activity;

  return (
    <Card
      className="dg-panel"
      tut="dg-summary"
      bodyClassName="dg-panel-body"
      icon={ClipboardList}
      title="Summary"
      subtitle={s ? `Compiled ${new Date(s.at).toLocaleTimeString()} from every record and live status` : "Everything from the other tabs in one page"}
      actions={
        <>
          {s && <Button size="sm" variant="ghost" icon={ClipboardCopy} onClick={copy} title="Copy as text, e.g. for a message to service">Copy</Button>}
          <Button size="sm" variant="primary" icon={s ? RefreshCw : Sparkles} loading={busy} onClick={run} data-tut="dg-sum-run">
            Get latest summary
          </Button>
        </>
      }
    >
      <div className="dg-scroll">
        {!s ? (
          <EmptyState
            icon={ClipboardList}
            title="No summary yet"
            text="Get the latest summary: robot state, emergencies and faults, the last records of every kind, the PLC and the robot PC, in one page."
            action={<Button variant="primary" icon={Sparkles} loading={busy} onClick={run}>Get latest summary</Button>}
          />
        ) : (
          <div className="dg-sum">
            <div className={cx("dg-sum-verdict", `is-${s.verdict}`)}>
              <v.icon size={26} />
              <div className="grow">
                <div className="dg-sum-vt">{v.title}</div>
                <div className="small">{v.text}</div>
              </div>
            </div>
            {s.findings.length > 0 && (
              <ul className="dg-sum-findings">
                {s.findings.map((f, i) => {
                  const I = LEVEL_ICON[f.level];
                  return (
                    <li key={i} className={`is-${f.level}`}>
                      <I size={15} />
                      <span>
                        <span className="strong">{f.text}</span>
                        {f.hint && <span className="muted"> · {f.hint}</span>}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}

            <div className="dg-sum-grid">
              <Section icon={ShieldAlert} title="Robot now">
                <Row label="Mode">{r.profile ? r.profile.toUpperCase() : "–"}{r.phase ? <span className="muted"> · {r.phase}</span> : null}</Row>
                <Row label="Emergency" tone={r.latched || r.estop ? "danger" : "success"}>{r.latched || r.estop ? `Active${r.cause ? `: ${r.cause}` : ""}` : "None"}</Row>
                <Row label="Drives" tone={r.armed === false ? "warning" : undefined}>{r.armed ? "Armed" : r.armed === false ? "Not armed" : "–"}{r.allEnabled === false ? " · not all enabled" : ""}</Row>
                <Row label="Standing still">{r.standstill === undefined ? "–" : r.standstill ? "Yes" : "No, moving"}</Row>
                <Row label="Speed">{r.speed != null ? `${r.speed} %` : "–"}</Row>
                <Row label="At home">{r.atHome ? (r.atHome.atHome ? r.atHome.homeName || "Yes" : `No${r.atHome.activeHome ? ` (home: ${r.atHome.activeHome})` : ""}`) : "–"}</Row>
                <Row label="Motion">{r.motion ? `${r.motion.active ? "Moving" : r.motion.state || "idle"}${r.motion.target ? ` · ${r.motion.target}` : ""}` : "–"}</Row>
                <Row label="Robot program">
                  {r.runner ? `${String(r.runner.state || "–").toLowerCase()}${r.runner.cyclesDone ? ` · ${r.runner.cyclesDone} cycles` : ""}${r.runner.avgCycle ? ` · avg ${(+r.runner.avgCycle).toFixed(1)} s` : ""}` : "–"}
                </Row>
              </Section>

              <Section icon={Activity} title="Last 24 hours">
                <div className="dg-sum-kpis">
                  <span className={cx(a.day.emergencies && "is-bad")}><b>{a.day.emergencies}</b> emergencies</span>
                  <span className={cx(a.day.faults && "is-bad")}><b>{a.day.faults}</b> faults</span>
                  <span className={cx(a.day.rejected && "is-warn")}><b>{a.day.rejected}</b> refused requests</span>
                  <span><b>{a.day.motionsOk}</b> motions done</span>
                  <span className={cx(a.day.motionsFailed && "is-warn")}><b>{a.day.motionsFailed}</b> motions failed</span>
                  <span><b>{a.day.recordings}</b> recordings</span>
                </div>
                <Row label="Last emergency">{a.lastEmergency ? <>{a.lastEmergency.detail || a.lastEmergency.event} <span className="muted">· {a.lastEmergency.time} {ago(a.lastEmergency.stamp) && `(${ago(a.lastEmergency.stamp)})`}</span></> : "None recorded"}</Row>
                <Row label="Last fault">
                  {a.lastFault ? (
                    <>
                      {a.lastFault.joint ? `${a.lastFault.joint} · ` : ""}
                      {a.lastFault.codeHex && a.lastFault.codeHex !== "0x0000" ? (
                        <button type="button" className="dg-sum-link" onClick={() => onLookup(`E${String(a.lastFault.codeHex).replace(/^0x/i, "")}`)} title="Look up this code"><Search size={11} /> {a.lastFault.codeHex}</button>
                      ) : null}{" "}
                      {a.lastFault.description || a.lastFault.detail} <span className="muted">· {a.lastFault.time}</span>
                    </>
                  ) : "None recorded"}
                </Row>
                <Row label="Last refused request">{a.lastRejected ? <>{a.lastRejected.extra?.request || a.lastRejected.detail} <span className="muted">· {a.lastRejected.extra?.failure || a.lastRejected.extra?.result || ""} {a.lastRejected.time}</span></> : "None"}</Row>
                <Row label="Last failed motion">{a.lastFailedMotion ? <>{a.lastFailedMotion.kind} {a.lastFailedMotion.target} <span className="muted">· {a.lastFailedMotion.error || a.lastFailedMotion.state} · {a.lastFailedMotion.time}</span></> : "None"}</Row>
                <Row label="Last recording">
                  {a.lastRecording ? (
                    <>
                      <span className="dg-sum-clip" title={a.lastRecording.cause}>{a.lastRecording.cause}</span> <span className="muted">· {a.lastRecording.trigger}</span>{" "}
                      <button type="button" className="dg-sum-link" onClick={() => setViewing(a.lastRecording.file)}><BarChart3 size={11} /> View</button>
                    </>
                  ) : "None"}
                </Row>
                {a.causes.length > 0 && (
                  <Row label="Recordings by cause">
                    <span className="dg-sum-chips">{a.causes.map(([c, n]) => <Badge key={c} className="dg-sum-chip" title={c}>{c} · {n}</Badge>)}</span>
                  </Row>
                )}
              </Section>

              <Section icon={CircuitBoard} title="PLC">
                {s.plc ? (
                  <>
                    <Row label="Runs on">{s.plc.mode === "sim" ? "Simulator" : "Robot"}</Row>
                    <Row label="Program" tone={s.plc.ok ? undefined : "danger"}>{s.plc.program || "None loaded"}{s.plc.ok ? "" : " · refused"}</Row>
                    {!s.plc.ok && s.plc.error && <Row label="Why">{s.plc.error}</Row>}
                    <Row label="Logic">{s.plc.rungs} rungs · {s.plc.sequences} sequences</Row>
                    <Row label="Scan">{s.plc.scanMs != null ? `${(+s.plc.scanMs).toFixed(2)} ms every ${(+s.plc.periodMs || 0).toFixed(1)} ms` : "–"}</Row>
                    <Row label="Forced bits" tone={s.plc.forced ? "warning" : undefined}>{s.plc.forced}</Row>
                    <Row label="Safe state" tone={s.plc.safe ? "warning" : undefined}>{s.plc.safe ? "On" : "Off"}</Row>
                    {s.plc.sequenceSteps.length > 0 && <Row label="Sequences">{s.plc.sequenceSteps.map((q) => `${q.name}: ${q.step ? q.stepName || `step ${q.step}` : "idle"}`).join(" · ")}</Row>}
                    <Row label="Recent alarms">{s.plc.alarms.length ? s.plc.alarms.map((x, i) => <div key={i} className="small">{x.text} <span className="muted xs">{x.level}</span></div>) : "None"}</Row>
                  </>
                ) : <div className="muted small">The PLC did not answer.</div>}
              </Section>

              <Section icon={Cpu} title="Joints" className="dg-sum-wide">
                <table className="table compact dg-sum-joints">
                  <thead>
                    <tr><th>Joint</th><th>Drive</th><th>Faults</th><th>Errors</th><th>Last error</th></tr>
                  </thead>
                  <tbody>
                    {s.joints.map((j) => (
                      <tr key={j.name} className={cx(j.fault && "is-bad")}>
                        <td className="strong">{j.name}{j.isolated && <Badge tone="warning" className="dg-inline-badge">isolated</Badge>}</td>
                        <td className="small">{j.fault ? <Badge tone="danger">Fault</Badge> : j.state || <span className="muted">–</span>}</td>
                        <td className={cx("tabular", j.faults && "text-danger strong")}>{j.faults}</td>
                        <td className="tabular">{j.errors}</td>
                        <td className="small">
                          {j.lastError ? (
                            <>
                              <button type="button" className="dg-sum-link mono" onClick={() => onLookup(`E${String(j.lastError.hex).replace(/^0x/i, "")}`)}>{j.lastError.hex}</button>{" "}
                              <span className="dg-sum-clip" title={j.lastError.description || j.lastError.detail}>{j.lastError.description || j.lastError.detail}</span> <span className="muted xs">· {j.lastError.time}</span>
                            </>
                          ) : <span className="muted">none</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Section>

              <Section icon={Server} title="Robot PC and connection">
                <Row label="Server" tone={s.system.connected ? "success" : "danger"}>{s.system.connected ? "Connected" : "Disconnected"}</Row>
                <Row label="Robot">{s.system.simulated ? "Simulated robot" : s.system.rosReady === false ? "Robot software not ready" : "Real robot"}</Row>
                <Row label="Running for" tone={s.system.uptimeSeconds >= 12 * 3600 ? "warning" : undefined}>{fmtSecs(s.system.uptimeSeconds)}</Row>
                <Row label="Load (5 min)">{s.system.load5 != null ? s.system.load5.toFixed(2) : "–"}</Row>
                <Row label="Project">{s.system.project || "None loaded"}</Row>
                <Row label="Records kept">{a.totals.events} events · {a.totals.errors} drive records · {a.totals.recordings} recordings</Row>
              </Section>
            </div>
            <div className="dg-sum-foot xs muted">
              Details: <button type="button" className="dg-sum-link" onClick={() => onGoto("records")}>Robot records</button> ·{" "}
              <button type="button" className="dg-sum-link" onClick={() => onGoto("logs")}>Logs</button> ·{" "}
              <button type="button" className="dg-sum-link" onClick={() => onGoto("faults")}>Fault lookup</button>
            </div>
          </div>
        )}
      </div>
      {viewing && <BlackboxViewer file={viewing} onClose={() => setViewing(null)} />}
    </Card>
  );
}
