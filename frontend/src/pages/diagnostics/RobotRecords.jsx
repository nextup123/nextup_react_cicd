// Records kept by the new controllers: supervisor events (mode changes,
// emergencies, resets), the drive error log, per-joint fault counters, the
// motion log of the motion server and black-box recordings of emergencies.
// Events, errors and motions come from the record files when they are on the
// robot, so every field shows: known ones in columns, the rest as chips in
// Details, and a click on a row lists the whole record.
import { Fragment, Suspense, lazy, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Activity, AlertOctagon, BarChart3, ChevronDown, ChevronRight, Download, FileClock, Gauge, HardDriveDownload, RefreshCw, Search, ShieldAlert, Trash2 } from "lucide-react";
import { Alert, Badge, Button, Card, EmptyState, Loading, SearchInput, Segmented, Select, cx } from "../../components/ui";
import { api, errorMessage } from "../../lib/api";
import { robotApi, robotCall } from "../../lib/robotApi";
import { confirm } from "../../store/confirm";
import { toast } from "../../store/toast";
import { useRobot } from "../../store/robot";
import { Highlight } from "./Highlight";
import { ExtraChips, FieldList } from "./RecordFields";
import BlackboxViewer from "./BlackboxViewer";
import { importRetry } from "../../lib/retry";

// the drive tools' Faults page: read from the drives themselves (backend/ethercat)
const DriveFaults = lazy(importRetry(() => import("../ethercat/DriveFaults.jsx")));

const VIEWS = [
  { value: "events", label: "Supervisor events", icon: ShieldAlert },
  { value: "errors", label: "Drive errors", icon: Activity },
  { value: "counters", label: "Fault counters", icon: Gauge },
  { value: "motions", label: "Motion log", icon: FileClock },
  { value: "blackbox", label: "Black box", icon: HardDriveDownload },
  { value: "drivefaults", label: "Drive faults", icon: AlertOctagon },
];
const VIEW_KEY = "nextup.diagnostics.records";
const MAX_OPTIONS = [100, 300, 1000].map((n) => ({ value: String(n), label: `Last ${n}` }));

const EVENT_TONE = {
  emergency: "danger", emergency_requested: "danger", request_rejected: "danger", fault: "danger", error: "danger",
  blackbox_saved: "warning", rearm_waiting: "warning", joint_isolated: "warning",
  estop_released: "success", armed: "success", reset: "success",
  profile_changed: "primary", mode_change: "primary", request_accepted: "info", speed_override: "info",
  error_raised: "danger", fault_raised: "danger", error_changed: "warning", present_at_startup: "warning",
  error_cleared: "success", fault_cleared: "success", state_changed: "primary",
};
const resultTone = (r) => (/^(success|ok|done)/i.test(r || "") ? "success" : r ? "danger" : undefined);
const STATE_TONE = { succeeded: "success", success: "success", failed: "danger", aborted: "danger", rejected: "danger", canceled: undefined, started: "info", executing: "info" };
const clock = (e) => e.time || (e.stamp ? new Date(e.stamp).toLocaleString() : "");
const evText = (s) => String(s || "").replace(/_/g, " ");

function useRecords(view, max) {
  const fetchers = {
    events: () => robotApi.events({ max }),
    errors: () => robotApi.errors({ max }),
    counters: () => robotApi.faultCounters(),
    motions: () => robotApi.motionLog(max),
    blackbox: () => robotApi.blackbox(),
  };
  return useQuery({ queryKey: ["robot-records", view, max], queryFn: fetchers[view], staleTime: 0, retry: 0, enabled: Boolean(fetchers[view]) });
}

/** A table row that opens to the whole record. */
function RecRow({ cols, fields, open, onToggle, children }) {
  return (
    <Fragment>
      <tr className={cx("dg-rec-row", open && "is-open")} onClick={(e) => !e.target.closest("button, a") && onToggle()}>
        <td className="dg-rec-caret">{open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}</td>
        {children}
      </tr>
      {open && (
        <tr className="dg-rec-detail">
          <td />
          <td colSpan={cols}>
            <FieldList fields={fields} />
          </td>
        </tr>
      )}
    </Fragment>
  );
}

function useOpenRow() {
  const [open, setOpen] = useState(null);
  return [open, (k) => setOpen((o) => (o === k ? null : k))];
}

function EventTable({ rows, term, onOpenBlackbox }) {
  const [open, toggle] = useOpenRow();
  return (
    <table className="table compact dg-rec-table">
      <thead>
        <tr>
          <th />
          <th>Time</th>
          <th>Event</th>
          <th>Joint</th>
          <th>Mode</th>
          <th>Details</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((e, i) => {
          const k = `${e.stamp}-${i}`;
          const x = e.extra || {};
          const bb = e.blackbox || "";
          return (
            <RecRow key={k} cols={5} fields={e.fields} open={open === k} onToggle={() => toggle(k)}>
              <td className="mono small nowrap"><Highlight text={clock(e)} term={term} /></td>
              <td className="nowrap">
                <Badge tone={EVENT_TONE[e.event] || (e.event === "request_result" ? resultTone(x.result) : undefined)}>{evText(e.event || e.source)}</Badge>
              </td>
              <td className="small"><Highlight text={e.joint || "–"} term={term} /></td>
              <td className="small nowrap">{e.profile || "–"}{e.phase ? <span className="xs muted"> · {e.phase}</span> : null}</td>
              <td className="small">
                <Highlight text={e.description && e.description !== e.detail ? `${e.description} · ${e.detail}` : e.detail} term={term} />
                {e.count > 1 && <span className="muted"> ×{e.count}</span>}
                {e.state && <span className="xs muted"> · {e.state}</span>}
                <ExtraChips extra={x} detail={e.detail} />
                {bb && (
                  <Button size="sm" variant="soft" icon={BarChart3} className="dg-inline-btn" data-tut="dg-ev-recording" onClick={() => onOpenBlackbox(bb)}>
                    View recording
                  </Button>
                )}
              </td>
            </RecRow>
          );
        })}
      </tbody>
    </table>
  );
}

function CodeCell({ hex, num, description, onLookup }) {
  if (!num && (!hex || hex === "0x0000")) return <span className="muted">0x0000</span>;
  return (
    <div className="dg-code-cell">
      {onLookup ? (
        <Button size="sm" variant="soft-danger" icon={Search} data-tut="dg-rec-code" onClick={() => onLookup(`E${String(hex).replace(/^0x/i, "")}`)} title="Look up this code">
          {hex}
        </Button>
      ) : (
        <span className="mono small">{hex}</span>
      )}
      <span className="xs muted mono"> {num}</span>
      {description && <div className="xs dg-code-desc" title={description}>{description}</div>}
    </div>
  );
}

function ErrorTable({ rows, term, onLookup }) {
  const [open, toggle] = useOpenRow();
  return (
    <table className="table compact dg-rec-table">
      <thead>
        <tr>
          <th />
          <th>Time</th>
          <th>Joint</th>
          <th>Event</th>
          <th>Last error</th>
          <th>Previous error</th>
          <th>Drive</th>
          <th>Details</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((e, i) => {
          const k = `${e.stamp}-${i}`;
          return (
            <RecRow key={k} cols={7} fields={e.fields} open={open === k} onToggle={() => toggle(k)}>
              <td className="mono small nowrap"><Highlight text={clock(e)} term={term} /></td>
              <td className="small"><strong><Highlight text={e.joint || "–"} term={term} /></strong>{e.source && e.source !== "drive" ? <span className="xs muted"> {e.source}</span> : null}</td>
              <td className="nowrap"><Badge tone={EVENT_TONE[e.event]}>{evText(e.event)}</Badge></td>
              <td><CodeCell hex={e.codeHex} num={e.lastError} description={e.description} onLookup={e.lastError ? onLookup : null} /></td>
              <td><CodeCell hex={e.previousHex || "0x0000"} num={e.previousError} description={e.previousDescription} onLookup={e.previousError ? onLookup : null} /></td>
              <td className="small nowrap">
                {e.state || "–"}
                <div className="xs muted mono">
                  {e.statusword ? `SW ${e.statusword}` : ""}
                  {e.mode !== null && e.mode !== undefined ? ` · mode ${e.mode}` : ""}
                </div>
              </td>
              <td className="small">
                <Highlight text={e.detail} term={term} />
                {e.count > 1 && <span className="muted"> ×{e.count}</span>}
                <ExtraChips extra={e.extra} detail={e.detail} />
              </td>
            </RecRow>
          );
        })}
      </tbody>
    </table>
  );
}

function MotionTable({ rows, term }) {
  const [open, toggle] = useOpenRow();
  return (
    <table className="table compact dg-rec-table">
      <thead>
        <tr>
          <th />
          <th>Time</th>
          <th>Motion</th>
          <th>Result</th>
          <th>Speed</th>
          <th>Duration</th>
          <th>Message</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((m, i) => {
          const k = `${m.id}-${i}`;
          return (
            <RecRow key={k} cols={6} fields={m.fields} open={open === k} onToggle={() => toggle(k)}>
              <td className="mono small nowrap">{clock(m)}</td>
              <td className="small">
                <Highlight text={`${m.kind || ""} ${m.target || ""}`} term={term} />
                <div className="xs muted">
                  {[m.motionType, m.planner, m.id].filter(Boolean).join(" · ")}
                  {m.dryRun ? " · test run" : ""}
                </div>
              </td>
              <td className="nowrap">
                <Badge tone={STATE_TONE[m.state]}>{m.state || "–"}</Badge>
                {m.error && m.error !== "E_OK" && <div className="xs text-danger mono">{m.error}{m.code ? ` (${m.code})` : ""}</div>}
              </td>
              <td className="mono small nowrap">
                {m.speed !== null && m.speed !== undefined ? `${+m.speed.toFixed(3)} m/s` : "–"}
                <div className="xs muted">
                  {m.acceleration !== null && m.acceleration !== undefined ? `${+m.acceleration.toFixed(3)} m/s²` : ""}
                  {m.speedScale !== null && m.speedScale !== undefined ? ` · ${m.speedScale} %` : ""}
                </div>
              </td>
              <td className="mono small nowrap">{m.durationS !== null && m.durationS !== undefined ? `${m.durationS} s` : "–"}</td>
              <td className="small">
                <Highlight text={m.message || ""} term={term} />
                <ExtraChips extra={m.extra} detail={m.message} />
              </td>
            </RecRow>
          );
        })}
      </tbody>
    </table>
  );
}

function Counters({ data }) {
  const rows = data?.counters || [];
  if (!rows.length) return <EmptyState compact icon={Gauge} title="No counters" text="The drive state broadcaster counts faults and errors per joint." />;
  return (
    <div className="dg-counter-grid" data-tut="dg-counters">
      {rows.map((c) => (
        <div key={c.joint} className={`dg-counter ${c.faults ? "is-bad" : ""}`}>
          <span className="section-label">{c.joint}</span>
          <span className="dg-counter-num tabular">{c.faults}</span>
          <span className="xs muted">faults · {c.errors} errors</span>
          {c.lastFault && <span className="xs muted">last {c.lastFault}</span>}
          {c.details && typeof c.details === "object" && Object.keys(c.details).length > 0 && (
            <span className="xs mono muted">{Object.entries(c.details).map(([k, v]) => `${k}×${typeof v === "object" ? JSON.stringify(v) : v}`).join("  ")}</span>
          )}
        </div>
      ))}
    </div>
  );
}

const causeTone = (c = "") => (/emergency|fault|failed|rejected/i.test(c) ? "danger" : /left|jump|disabled/i.test(c) ? "warning" : "info");
// Filter chip text: the cause without the joint and without the long " - details" part.
const causeGroup = (c = "") => c.replace(/\s*\(joint\d+\)\s*$/i, "").split(/\s+[-–]\s+/)[0].trim();
const kb = (n) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(2)} MB` : `${(n / 1024).toFixed(1)} kB`);

function Blackbox({ data, term, onView, onChanged }) {
  const [cause, setCause] = useState("");
  const all = data?.files || [];
  const causes = useMemo(() => [...new Set(all.map((f) => causeGroup(f.cause)))].sort(), [all]);
  const files = all.filter((f) => (!cause || f.cause.startsWith(cause)) && (!term || `${f.trigger} ${f.cause} ${f.joint} ${f.file}`.toLowerCase().includes(term)));
  if (!all.length) return <EmptyState compact icon={HardDriveDownload} title="No recordings" text="The supervisor records the last seconds of joint data at every emergency." />;
  const del = async (f) => {
    if (!(await confirm({ title: "Delete this edited copy?", message: f.file, tone: "danger", confirmLabel: "Delete" }))) return;
    try {
      await api.del(`/robot/blackbox/${encodeURIComponent(f.file)}`);
      toast.success("Edited copy deleted");
      onChanged();
    } catch (err) {
      toast.error(errorMessage(err), { title: "Not deleted" });
    }
  };
  return (
    <>
      <div className="dg-bb-causes" data-tut="dg-bb-causes">
        <button type="button" className={cx("dg-bb-cause", !cause && "is-active")} onClick={() => setCause("")}>All <span className="muted">{all.length}</span></button>
        {causes.map((c) => (
          <button key={c} type="button" className={cx("dg-bb-cause", cause === c && "is-active")} onClick={() => setCause(cause === c ? "" : c)} title={c}>
            <span className="dg-bb-cause-text">{c}</span> <span className="muted">{all.filter((f) => f.cause.startsWith(c)).length}</span>
          </button>
        ))}
      </div>
      <table className="table compact dg-rec-table dg-bb-table">
        <colgroup>
          <col className="dg-bb-c-time" />
          <col />
          <col className="dg-bb-c-joint" />
          <col className="dg-bb-c-window" />
          <col className="dg-bb-c-size" />
          <col className="dg-bb-c-act" />
        </colgroup>
        <thead>
          <tr>
            <th>Triggered</th>
            <th>Cause</th>
            <th>Joint</th>
            <th>Window</th>
            <th>Size</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {files.map((f) => (
            <tr key={f.file} className="dg-rec-row" onDoubleClick={() => onView(f.file)}>
              <td className="mono small nowrap" title={f.file}>{f.trigger || new Date(f.mtime).toLocaleString()}</td>
              <td className="dg-bb-cause-cell">
                <Badge tone={causeTone(f.cause)} className="dg-bb-cause-badge" title={f.cause || "emergency"}>{f.cause || "emergency"}</Badge>
                {f.edited && <Badge tone="primary" className="dg-inline-badge">edited copy</Badge>}
              </td>
              <td className="small">{f.joint || "–"}</td>
              <td className="xs muted dg-bb-window">{f.window || "–"}</td>
              <td className="mono small nowrap">{kb(f.size)}</td>
              <td className="nowrap" style={{ textAlign: "right" }}>
                <Button size="sm" variant="soft" icon={BarChart3} data-tut="dg-bb-view" onClick={() => onView(f.file)}>View</Button>{" "}
                <Button size="sm" icon={Download} data-tut="dg-bb-csv" onClick={() => window.open(`/robot/blackbox/${encodeURIComponent(f.file)}?download=1`, "_blank")}>CSV</Button>
                {f.edited && <Button size="sm" variant="ghost-danger" icon={Trash2} onClick={() => del(f)} title="Delete this edited copy" />}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

export function RobotRecords({ onLookup }) {
  const [view, setViewState] = useState(() => {
    try {
      return VIEWS.some((v) => v.value === localStorage.getItem(VIEW_KEY)) ? localStorage.getItem(VIEW_KEY) : "events";
    } catch {
      return "events";
    }
  });
  const [max, setMax] = useState("300");
  const [search, setSearch] = useState("");
  const [eventFilter, setEventFilter] = useState("");
  const [jointFilter, setJointFilter] = useState("");
  const [viewing, setViewing] = useState(null); // black-box file open in the viewer
  const q = useRecords(view, Number(max));
  const latestEvent = useRobot((s) => s.robotEvents[0]?.stamp);

  // New supervisor / drive events arrive live: refresh the open list.
  useEffect(() => {
    if (latestEvent && (view === "events" || view === "errors" || view === "counters")) q.refetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [latestEvent]);

  const setView = (v) => {
    setViewState(v);
    setSearch("");
    setEventFilter("");
    setJointFilter("");
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      /* ignore */
    }
  };

  const term = search.trim().toLowerCase();
  const list = q.data?.entries || [];
  const eventNames = useMemo(() => [...new Set(list.map((e) => e.event || e.state).filter(Boolean))].sort(), [list]);
  const joints = useMemo(() => [...new Set(list.map((e) => e.joint).filter(Boolean))].sort(), [list]);
  const rows = useMemo(
    () =>
      list.filter(
        (e) =>
          (!eventFilter || (e.event || e.state) === eventFilter) &&
          (!jointFilter || e.joint === jointFilter) &&
          (!term || JSON.stringify(e.fields || e).toLowerCase().includes(term) || String(e.description || "").toLowerCase().includes(term))
      ),
    [list, term, eventFilter, jointFilter]
  );

  const clear = async () => {
    const what = { events: "the supervisor event log", errors: "the drive error log", counters: "the fault counters" }[view];
    if (!(await confirm({ title: `Clear ${what}?`, message: "This cannot be undone.", tone: "danger", confirmLabel: "Clear" }))) return;
    const fn = { events: robotApi.clearEvents, errors: robotApi.clearErrors, counters: robotApi.resetFaultCounters }[view];
    await robotCall(fn);
    q.refetch();
  };
  const canClear = ["events", "errors", "counters"].includes(view);
  const driveFaults = view === "drivefaults";
  const unavailable = q.error?.status === 503;
  const listView = view === "events" || view === "errors" || view === "motions";
  const shown = view === "blackbox" ? (q.data?.files || []).length : rows.length;
  const subtitle =
    q.data?.total !== undefined
      ? `${shown} shown of ${q.data.total} recorded${q.data.from === "file" ? ` · ${q.data.file ? q.data.file.split("/").pop() : "file"}` : q.data.from === "service" ? " · from the service" : ""}`
      : view === "blackbox" && q.data
        ? `${shown} recordings`
        : driveFaults
          ? "Read from the servo drives"
          : "Kept by the supervisor, drive broadcaster and motion server";

  return (
    <Card
      className="dg-panel"
      tut="dg-records"
      bodyClassName="dg-panel-body"
      icon={ShieldAlert}
      title="Robot records"
      subtitle={subtitle}
      actions={
        <>
          {canClear && <Button size="sm" variant="ghost" icon={Trash2} data-tut="dg-rec-clear" onClick={clear} disabled={unavailable}>Clear</Button>}
          {!driveFaults && <Button size="sm" variant="ghost" icon={RefreshCw} loading={q.isFetching} onClick={() => q.refetch()}>Refresh</Button>}
        </>
      }
    >
      <div className="dg-filters" data-tut="dg-rec-filters">
        <Segmented value={view} onChange={setView} options={VIEWS} size="sm" />
        {view !== "counters" && !driveFaults && <SearchInput size="sm" value={search} onChange={setSearch} placeholder="Search every field…" className="dg-search" />}
        {listView && eventNames.length > 1 && (
          <Select size="sm" value={eventFilter} onChange={(e) => setEventFilter(e.target.value)} aria-label="Event">
            <option value="">{view === "motions" ? "All results" : "All events"}</option>
            {eventNames.map((n) => <option key={n} value={n}>{evText(n)}</option>)}
          </Select>
        )}
        {listView && joints.length > 0 && (
          <Select size="sm" value={jointFilter} onChange={(e) => setJointFilter(e.target.value)} aria-label="Joint">
            <option value="">All joints</option>
            {joints.map((n) => <option key={n} value={n}>{n}</option>)}
          </Select>
        )}
        {listView && <Select size="sm" options={MAX_OPTIONS} value={max} onChange={(e) => setMax(e.target.value)} aria-label="How many" />}
      </div>
      <div className={cx("dg-scroll", driveFaults && "dg-scroll-faults")} data-tut="dg-rec-list">
        {driveFaults ? (
          <Suspense fallback={<Loading />}>
            <DriveFaults />
          </Suspense>
        ) : q.isLoading ? (
          <Loading />
        ) : q.error ? (
          <Alert tone={unavailable ? "warning" : "danger"} title={unavailable ? "Service not running" : "Could not load"}>{errorMessage(q.error)}</Alert>
        ) : view === "counters" ? (
          <Counters data={q.data} />
        ) : view === "blackbox" ? (
          <Blackbox data={q.data} term={term} onView={setViewing} onChanged={() => q.refetch()} />
        ) : !rows.length ? (
          <EmptyState compact icon={FileClock} title={term || eventFilter || jointFilter ? "Nothing matches" : "Nothing recorded yet"} />
        ) : view === "motions" ? (
          <MotionTable rows={rows} term={term} />
        ) : view === "errors" ? (
          <ErrorTable rows={rows} term={term} onLookup={onLookup} />
        ) : (
          <EventTable rows={rows} term={term} onOpenBlackbox={setViewing} />
        )}
      </div>
      {viewing && <BlackboxViewer file={viewing} onClose={() => setViewing(null)} onSaved={() => view === "blackbox" && q.refetch()} />}
    </Card>
  );
}
