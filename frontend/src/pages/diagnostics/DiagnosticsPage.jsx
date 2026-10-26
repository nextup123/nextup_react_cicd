// Diagnostics (old "Error Handling"): live logs + drive error history, a
// one-page summary of everything, robot records, fault code lookup, the commands
// notebook and the error description. The IO watch opens as a floating window.
import { useCallback, useState } from "react";
import { Split } from "../../components/ui/Split";
import { BookOpen, ClipboardList, Eye, FileText, ScrollText, ShieldAlert, SquareTerminal } from "lucide-react";
import { Button, Tabs } from "../../components/ui";
import IoWatchWindow from "./IoWatchWindow";
import { LiveLogs } from "./LiveLogs";
import { ErrorHistory } from "./ErrorHistory";
import { FaultLookup } from "./FaultLookup";
import { RobotRecords } from "./RobotRecords";
import { SummaryPanel } from "./SummaryPanel";
import { CommandsEditor } from "./CommandsEditor";
import { DescriptionEditor } from "./DescriptionEditor";
import "./diagnostics.css";

const TAB_KEY = "nextup.diagnostics.tab";
const TAB_IDS = ["logs", "summary", "records", "faults", "commands", "description"];

function readTab() {
  try {
    const t = localStorage.getItem(TAB_KEY);
    return TAB_IDS.includes(t) ? t : "logs";
  } catch {
    return "logs";
  }
}

export default function DiagnosticsPage() {
  const [tab, setTabState] = useState(readTab);
  const [visited, setVisited] = useState(() => new Set([readTab()]));
  const [faultQuery, setFaultQuery] = useState("");
  const [cmdDirty, setCmdDirty] = useState(false);
  const [descDirty, setDescDirty] = useState(false);
  const [ioWatch, setIoWatch] = useState(false);

  const setTab = useCallback((t) => {
    setTabState(t);
    setVisited((v) => (v.has(t) ? v : new Set(v).add(t)));
    try {
      localStorage.setItem(TAB_KEY, t);
    } catch {
      /* ignore */
    }
  }, []);

  const lookup = useCallback(
    (code) => {
      setFaultQuery(code);
      setTab("faults");
    },
    [setTab]
  );

  const tabs = [
    { value: "logs", label: "Logs", icon: ScrollText },
    { value: "summary", label: "Summary", icon: ClipboardList },
    { value: "records", label: "Robot records", icon: ShieldAlert },
    { value: "faults", label: "Fault lookup", icon: BookOpen },
    { value: "commands", label: cmdDirty ? "Commands *" : "Commands", icon: SquareTerminal },
    { value: "description", label: descDirty ? "Description *" : "Description", icon: FileText },
  ];

  const panel = (id, node) => (visited.has(id) ? <div className="dg-tab" hidden={tab !== id} data-tut={`dg-tab-${id}`}>{node}</div> : null);

  return (
    <div className="page page-fill dg-page">
      <div className="dg-toolbar">
        <Tabs tabs={tabs} value={tab} onChange={setTab} className="dg-tabs" />
        <div className="dg-tools">
          <Button size="sm" icon={Eye} data-tut="dg-iowatch" active={ioWatch} onClick={() => setIoWatch((v) => !v)} title="Choose the IOs to watch and see their log">
            IO watch
          </Button>
        </div>
      </div>

      {panel(
        "logs",
        <Split id="diag.logs" className="dg-logs-grid" defaults={[1.65, 1]} min={[360, 300]} gap={14}>
          <LiveLogs />
          <ErrorHistory onLookup={lookup} />
        </Split>
      )}
      {panel("summary", <SummaryPanel onLookup={lookup} onGoto={setTab} />)}
      {panel("records", <RobotRecords onLookup={lookup} />)}
      {panel("faults", <FaultLookup query={faultQuery} onQuery={setFaultQuery} />)}
      {panel("commands", <CommandsEditor onDirtyChange={setCmdDirty} />)}
      {panel("description", <DescriptionEditor onDirtyChange={setDescDirty} />)}
      {ioWatch && <IoWatchWindow onClose={() => setIoWatch(false)} />}
    </div>
  );
}
