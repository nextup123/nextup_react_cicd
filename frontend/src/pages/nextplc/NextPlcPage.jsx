// NextPLC -- the soft PLC of the robot, inside NextUp: Program | Block Library | Monitor | Help
// (/nextplc/<tab>). The strip on the right shows only what the top bar does not: whether the PLC
// runs a program, its safe state / IO fault / forces when they are on, and which PLC the pages
// talk to (the simulated one, or the robot's). Robot mode, emergency and the connection stay in
// the top bar. While this page is open the live PLC image is streamed; it stops when you leave.
import { Suspense, lazy, useState } from "react";
import { Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { AlertTriangle, BookOpen, Boxes, Cpu, FileCode2, FlaskConical, Gauge } from "lucide-react";
import { Loading, Tabs } from "../../components/ui";
import { useConnection } from "../../lib/ws";
import { plainText } from "../../lib/plainText";
import { Led, confirm, cx } from "./components/ui";
import { usePlc, usePlcWatch } from "./store/plc";
import { systemApi } from "./lib/api";
import { guardIdle } from "../../lib/interlock";
import { importRetry } from "../../lib/retry";
import { toast } from "./store/toast";
import { readPref, writePref } from "./lib/prefs";
import "@fontsource-variable/jetbrains-mono";
import "./nextplc.css";
import "./nextplc-extra.css";

const ProgramPage = lazy(importRetry(() => import("./pages/program/ProgramPage.jsx")));
const LibraryPage = lazy(importRetry(() => import("./pages/library/LibraryPage.jsx")));
const MonitorPage = lazy(importRetry(() => import("./pages/monitor/MonitorPage.jsx")));
const HelpPage = lazy(importRetry(() => import("./pages/help/HelpPage.jsx")));

const TABS = [
  { value: "program", label: "Program", icon: FileCode2, el: ProgramPage },
  { value: "library", label: "Block Library", icon: Boxes, el: LibraryPage },
  { value: "monitor", label: "Monitor", icon: Gauge, el: MonitorPage },
  { value: "help", label: "Help", icon: BookOpen, el: HelpPage },
];

export default function NextPlcPage() {
  usePlcWatch();
  const location = useLocation();
  const navigate = useNavigate();
  const seg = location.pathname.replace(/^\/nextplc\/?/, "").split("/")[0];
  const tab = TABS.some((t) => t.value === seg) ? seg : "";
  const last = readPref("tab", "program");
  const go = (t) => { writePref("tab", t); navigate(`/nextplc/${t}`); };

  return (
    <div className="nxplc nxplc-shell">
      <div className="nxplc-toolbar" data-tut="plc-toolbar">
        <Tabs tabs={TABS} value={tab} onChange={go} className="nxplc-tabs" />
        <PlcStrip />
      </div>
      <NoDataBanner />
      <Suspense fallback={<Loading label="Loading…" />}>
        <Routes>
          {TABS.map((t) => <Route key={t.value} path={`${t.value}/*`} element={<t.el />} />)}
          <Route path="*" element={<Navigate to={`/nextplc/${TABS.some((t) => t.value === last) ? last : "program"}`} replace />} />
        </Routes>
      </Suspense>
    </div>
  );
}

/** RUN / STOP, the program, SAFE / IO / FORCE only when on, and SIM | ROBOT. */
function PlcStrip() {
  const state = usePlc((s) => s.state);
  const program = usePlc((s) => s.program);
  const bridge = usePlc((s) => s.bridge);
  const conn = useConnection((s) => s.status);
  const b = state?.bits || {};
  const run = Boolean(state?.program_ok) && conn === "open";
  const ioFault = Boolean(b["S.IO_FAULT"]);
  return (
    <div className="plc-strip" data-tut="plc-strip">
      <span data-tut="plc-run" className={cx("plc-chip", run ? "is-run" : state ? "is-stop" : "")} title={run ? "The PLC runs the program every scan" : state ? "No program running: the outputs are held safe" : "Waiting for the PLC"}>
        <Led on={run || Boolean(state && !state.program_ok)} kind={run ? "on" : "warn"} />{run ? "RUN" : state ? "STOP" : "…"}
        <b className="truncate">{program?.ok ? program.name : program ? "no program" : ""}</b>
      </span>
      {state?.safe_state && <span className="plc-chip is-warn" title="The controlled outputs are held at their safe values"><Led on kind="warn" blink />SAFE</span>}
      {ioFault && <span className="plc-chip is-danger" title="Inputs stale or an IO fault"><Led on kind="danger" />IO fault</span>}
      {state?.forced_count > 0 && <span className="plc-chip is-warn" title="Inputs or outputs are forced (Monitor, Commission)"><Led on kind="warn" />FORCE {state.forced_count}</span>}
      <ModeSwitch bridge={bridge} />
    </div>
  );
}

/** Which PLC the pages talk to. Going to the robot asks first. */
function ModeSwitch({ bridge }) {
  const [busy, setBusy] = useState(false);
  const go = async (mode) => {
    if (mode === bridge.mode || busy) return;
    if (mode === "real" && !guardIdle("switch to the robot's PLC")) return;
    if (mode === "real" && !(await confirm({ title: "Work with the robot's PLC", message: "From now on Load, Write, Force and Reset go to the PLC running on the robot and switch real outputs. The simulated PLC stops. Continue?", okLabel: "Use the robot's PLC", danger: true }))) return;
    setBusy(true);
    try { const r = await systemApi.setMode(mode); toast[mode === "real" ? "warning" : "success"](mode === "real" ? "Load, Write, Force and Reset now go to the robot." : "Nothing reaches the robot.", { title: r.message }); }
    catch (e) { toast.error(plainText(e.message), { title: "Not changed" }); }
    finally { setBusy(false); }
  };
  return (
    <div data-tut="plc-mode" className={cx("mode-switch", bridge.mode)} role="radiogroup" aria-label="Which PLC">
      <button role="radio" aria-checked={bridge.mode === "sim"} className={cx(bridge.mode === "sim" && "on")} disabled={busy} onClick={() => go("sim")} title="Simulated PLC: the program runs here; nothing reaches the robot"><FlaskConical size={14} />SIM</button>
      <button role="radio" aria-checked={bridge.mode === "real"} className={cx(bridge.mode === "real" && "on real")} disabled={busy || (!bridge.real_available && bridge.mode !== "real")} onClick={() => go("real")} title={bridge.real_available ? "The PLC running on the robot" : `Not available: ${plainText(bridge.real_reason)}`}><Cpu size={14} />ROBOT</button>
    </div>
  );
}

function NoDataBanner() {
  const bridge = usePlc((s) => s.bridge);
  if (bridge.mode !== "real" || bridge.node_alive !== false) return null;
  return <div className="banner danger nxplc-banner"><AlertTriangle size={16} /><span><b>Robot PLC:</b> {plainText(bridge.message)} Start the PLC on the robot, or switch to SIM.</span></div>;
}
