// IO watch (drive state broadcaster: set_io_watch / get_io_watch / get_io_log).
// Left: every input and output of the drives and the GPIO module; tick the
// ones to watch, untick to stop, then Apply calls the service once per change.
// Right: the IO log (io_logs.yaml, all fields) with the live edges merged in,
// a level timeline per signal and the full record of the selected line.
import { Fragment, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Activity, ChevronDown, ChevronRight, Eye, Radio, RefreshCw, RotateCcw, Save } from "lucide-react";
import FloatingWindow from "../../components/ui/FloatingWindow";
import { Split } from "../../components/ui/Split";
import { Alert, Badge, Button, Checkbox, EmptyState, IconButton, Input, Loading, SearchInput, Segmented, Select, StatusDot, Switch, cx } from "../../components/ui";
import { robotApi } from "../../lib/robotApi";
import { useRobot } from "../../store/robot";
import { toast } from "../../store/toast";
import { splitName, useSequences } from "../io/ioApi";
import { FieldList, ExtraChips } from "./RecordFields";
import { Highlight } from "./Highlight";

const DRIVE_INPUTS = ["di1", "di2", "di3", "di4", "di5", "di6", "di7", "di8"];
const DRIVE_OUTPUTS = ["do1", "do2", "do3", "pi_p"];
const GPIO_INPUTS = DRIVE_INPUTS;
const GPIO_OUTPUTS = ["do1", "do2", "do3", "do4", "do5", "do6", "do7", "do8"];
const DEVICES = [
  ...[1, 2, 3, 4, 5, 6].map((n) => ({ id: `joint${n}`, label: `Drive ${n}`, inputs: DRIVE_INPUTS, outputs: DRIVE_OUTPUTS })),
  { id: "gpio1", label: "GPIO module", inputs: GPIO_INPUTS, outputs: GPIO_OUTPUTS },
];
const NAME_RE = /^[A-Za-z0-9_.-]{1,48}$/;
const key = (device, input) => `${device}:${String(input).toLowerCase()}`;
const cleanName = (s) => String(s || "").replace(/[^A-Za-z0-9_.-]/g, "_").slice(0, 48);
const isHigh = (e) => e.value === true || /^(high|rising|on)$/i.test(e.event || "");
const fmtHeld = (s) => (s === null || s === undefined || s === "" ? "–" : s >= 3600 ? `${(s / 3600).toFixed(1)} h` : s >= 60 ? `${(s / 60).toFixed(1)} min` : `${Number(s).toFixed(3)} s`);
const clock = (e) => (e.time ? e.time.slice(11) || e.time : e.stamp ? new Date(e.stamp).toLocaleTimeString("en-GB") : "");

/** Names the project's IO sequences give to driver / GPIO pins: { "joint1:do1": "gripper1" }. */
function useIoNames() {
  const { data = [] } = useSequences();
  return useMemo(() => {
    const m = {};
    for (const s of data) {
      const base = splitName(s.name).base || s.name;
      const dev = s.gpioId ? `gpio${s.gpioId}` : s.driverId ? `joint${s.driverId}` : "";
      if (!dev) continue;
      if (s.diId) m[key(dev, `di${s.diId}`)] = base;
      if (s.doId) m[key(dev, Number(s.doId) === 4 && !s.gpioId ? "pi_p" : `do${s.doId}`)] = base;
    }
    return m;
  }, [data]);
}

const draftOf = (signals) => Object.fromEntries((signals || []).map((s) => [key(s.device, s.input), { name: s.name, device: s.device, input: s.input, logRising: s.logRising, logFalling: s.logFalling, debounceMs: s.debounceMs || 0 }]));
const same = (a, b) => a.name === b.name && a.logRising === b.logRising && a.logFalling === b.logFalling && Number(a.debounceMs) === Number(b.debounceMs);

/* ───────────── left: the IO list ───────────── */

function PinRow({ dev, pin, names, draft, current, live, onToggle, onEdit }) {
  const k = key(dev.id, pin);
  const d = draft[k];
  const c = current[k];
  const changed = d && c ? !same(d, c) : Boolean(d) !== Boolean(c);
  const ev = d ? live[d.name] || (c ? live[c.name] : null) : null;
  const label = names[k];
  const level = ev ? isHigh(ev) : c?.level === 1 ? true : c?.level === 0 ? false : null;
  return (
    <div className={cx("iow-pin", d && "is-on", changed && "is-changed")}>
      <div className="iow-pin-main">
        <Checkbox checked={!!d} onChange={(v) => onToggle(dev, pin, v)} label={<span className="iow-pin-id mono">{pin.toUpperCase()}</span>} />
        <span className="iow-pin-label small">{label || (d ? "" : <span className="muted">–</span>)}</span>
        {d && <StatusDot tone={level === null ? "off" : level ? "success" : "off"} title={level === null ? "Level not known yet" : level ? "HIGH" : "LOW"} />}
        {changed && <Badge tone="warning" size="sm">{!c ? "add" : !d ? "remove" : "edit"}</Badge>}
      </div>
      {d && (
        <div className="iow-pin-edit">
          <Input size="sm" value={d.name} onChange={(e) => onEdit(k, { name: cleanName(e.target.value) })} invalid={!NAME_RE.test(d.name)} aria-label="Watch name" title="Name used in the log" />
          <label className="iow-mini" title="Log LOW → HIGH">
            <input type="checkbox" checked={d.logRising} onChange={(e) => onEdit(k, { logRising: e.target.checked })} /> ↑
          </label>
          <label className="iow-mini" title="Log HIGH → LOW">
            <input type="checkbox" checked={d.logFalling} onChange={(e) => onEdit(k, { logFalling: e.target.checked })} /> ↓
          </label>
          <Input size="sm" type="number" min={0} className="iow-deb" value={d.debounceMs} onChange={(e) => onEdit(k, { debounceMs: Math.max(0, Number(e.target.value) || 0) })} title="Debounce in ms (0 = default 20 ms)" aria-label="Debounce ms" />
        </div>
      )}
    </div>
  );
}

function IoList({ watchQ, live, onApplied }) {
  const names = useIoNames();
  const signals = watchQ.data?.signals || [];
  const current = useMemo(() => {
    const m = draftOf(signals);
    for (const s of signals) m[key(s.device, s.input)].level = s.level;
    return m;
  }, [signals]);
  const [draft, setDraft] = useState(current);
  const [open, setOpen] = useState(() => new Set(["joint1", "gpio1"]));
  const [showOutputs, setShowOutputs] = useState(false);
  const [filter, setFilter] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => setDraft(draftOf(signals)), [signals]);

  const readOnly = Boolean(watchQ.data?.readOnly);
  const toggle = (dev, pin, on) =>
    setDraft((d) => {
      const k = key(dev.id, pin);
      const n = { ...d };
      if (!on) delete n[k];
      else n[k] = current[k] ? { ...current[k] } : { name: cleanName(names[k] || `${dev.id}_${pin}`), device: dev.id, input: pin, logRising: true, logFalling: true, debounceMs: 0 };
      return n;
    });
  const edit = (k, patch) => setDraft((d) => ({ ...d, [k]: { ...d[k], ...patch } }));
  const toggleDevice = (dev, on) => {
    const pins = [...dev.inputs, ...(showOutputs ? dev.outputs : [])];
    pins.forEach((p) => toggle(dev, p, on));
  };

  const removes = Object.keys(current).filter((k) => !draft[k] || draft[k].name !== current[k].name);
  const adds = Object.keys(draft).filter((k) => !current[k] || !same(draft[k], current[k]));
  const changes = new Set([...removes, ...adds]).size;
  const bad = Object.values(draft).filter((d) => !NAME_RE.test(d.name));
  const dupNames = Object.values(draft).map((d) => d.name).filter((n, i, a) => a.indexOf(n) !== i);

  const apply = async () => {
    setBusy(true);
    const fails = [];
    try {
      for (const k of removes) {
        const r = await robotApi.removeIoWatch(current[k].name).catch((e) => ({ ok: false, message: e.message }));
        if (!r?.ok) fails.push(`${current[k].name}: ${r?.message || "not removed"}`);
      }
      for (const k of adds) {
        const r = await robotApi.addIoWatch(draft[k]).catch((e) => ({ ok: false, message: e.message }));
        if (!r?.ok) fails.push(`${draft[k].name}: ${r?.message || "not added"}`);
      }
    } finally {
      setBusy(false);
    }
    if (fails.length) toast.error(fails.join("\n"), { title: "IO watch" });
    else toast.success(`IO watch updated (${changes} change${changes === 1 ? "" : "s"})`);
    onApplied();
  };

  const extraKeys = Object.keys(draft).filter((k) => !DEVICES.some((d) => k.startsWith(`${d.id}:`) && [...d.inputs, ...d.outputs].some((p) => k === key(d.id, p))));
  const q = filter.trim().toLowerCase();
  const matches = (dev, pin) => !q || `${dev.id} ${dev.label} ${pin} ${names[key(dev.id, pin)] || ""} ${draft[key(dev.id, pin)]?.name || ""}`.toLowerCase().includes(q);

  return (
    <div className="iow-list">
      <div className="iow-list-tools" data-tut="dg-iow-find">
        <SearchInput size="sm" value={filter} onChange={setFilter} placeholder="Find an IO…" className="grow" />
        <Switch size="sm" checked={showOutputs} onChange={setShowOutputs} label="Outputs" title="Also list the outputs (their changes can be watched too)" />
      </div>
      {readOnly && (
        <Alert tone="warning" title="Watch service not running">
          The list comes from {watchQ.data?.file ? <span className="mono">{watchQ.data.file}</span> : "the watch file"}; changes can be applied once the drive state broadcaster answers.
        </Alert>
      )}
      <div className="iow-devices" data-tut="dg-iow-devices">
        {DEVICES.map((dev) => {
          const pins = [...dev.inputs, ...(showOutputs ? dev.outputs : [])].filter((p) => matches(dev, p));
          if (q && !pins.length) return null;
          const on = pins.filter((p) => draft[key(dev.id, p)]).length;
          const isOpen = open.has(dev.id) || !!q;
          return (
            <div key={dev.id} className="iow-dev">
              <div className="iow-dev-head">
                <button type="button" className="iow-dev-toggle" onClick={() => setOpen((s) => { const n = new Set(s); n.has(dev.id) ? n.delete(dev.id) : n.add(dev.id); return n; })}>
                  {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  <strong>{dev.label}</strong>
                  <span className="xs muted mono">{dev.id}</span>
                </button>
                {on > 0 && <Badge tone="primary" size="sm">{on} watched</Badge>}
                <Checkbox checked={on > 0 && on === pins.length} onChange={(v) => toggleDevice(dev, v)} label={<span className="xs muted">all</span>} disabled={readOnly} />
              </div>
              {isOpen && (
                <div className="iow-pins">
                  {pins.map((p) => (
                    <PinRow key={p} dev={dev} pin={p} names={names} draft={draft} current={current} live={live} onToggle={toggle} onEdit={edit} />
                  ))}
                </div>
              )}
            </div>
          );
        })}
        {extraKeys.length > 0 && (
          <div className="iow-dev">
            <div className="iow-dev-head"><strong>Other watches</strong></div>
            <div className="iow-pins">
              {extraKeys.map((k) => (
                <div key={k} className="iow-pin is-on">
                  <div className="iow-pin-main">
                    <Checkbox checked onChange={() => setDraft((d) => { const n = { ...d }; delete n[k]; return n; })} label={<span className="mono small">{draft[k].name}</span>} />
                    <span className="xs muted mono">{draft[k].device} · {draft[k].input}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
      <div className="iow-apply" data-tut="dg-iow-apply">
        <span className="small muted grow">
          {bad.length ? <span className="text-danger">Names: letters, digits, _ . - (max 48)</span> : dupNames.length ? <span className="text-danger">Each watch needs its own name ({dupNames[0]})</span> : changes ? `${changes} change${changes === 1 ? "" : "s"} not applied yet` : `${Object.keys(current).length} watched`}
        </span>
        <Button size="sm" variant="ghost" icon={RotateCcw} data-tut="dg-iow-undo" disabled={!changes || busy} onClick={() => setDraft(draftOf(signals))}>Undo</Button>
        <Button size="sm" variant="primary" icon={Save} loading={busy} disabled={!changes || readOnly || bad.length > 0 || dupNames.length > 0} onClick={apply} title={readOnly ? "The watch service is not running" : "Call the watch service for every change"}>
          Apply
        </Button>
      </div>
    </div>
  );
}

/* ───────────── right: the IO log ───────────── */

/** One lane per signal: HIGH / LOW over the time span of the shown lines. */
const SPANS = [
  { value: "60", label: "Last 1 min" },
  { value: "300", label: "Last 5 min" },
  { value: "3600", label: "Last hour" },
  { value: "0", label: "All shown lines" },
];

function Timeline({ rows, signals, span }) {
  const lanes = useMemo(() => {
    const newest = rows.reduce((m, r) => Math.max(m, r.stamp || 0), 0);
    const from = Number(span) > 0 ? newest - Number(span) * 1000 : 0;
    const withT = rows.filter((r) => r.stamp && r.stamp >= from).sort((a, b) => a.stamp - b.stamp);
    if (withT.length < 1) return null;
    const t0 = withT[0].stamp - (withT[0].wasFor ? Math.min(withT[0].wasFor, 5) * 1000 : 500);
    const t1 = Math.max(withT[withT.length - 1].stamp + 500, t0 + 1000);
    const names = [...new Set([...signals, ...withT.map((r) => r.signal)])].filter(Boolean);
    return {
      t0,
      t1,
      list: names.map((n) => {
        const ev = withT.filter((r) => r.signal === n);
        const segs = [];
        ev.forEach((e, i) => {
          const from = i === 0 ? t0 : ev[i - 1].stamp;
          if (i === 0) segs.push({ from, to: e.stamp, high: !isHigh(e) });
          segs.push({ from: e.stamp, to: i + 1 < ev.length ? ev[i + 1].stamp : t1, high: isHigh(e) });
        });
        return { name: n, segs, edges: ev.length };
      }),
    };
  }, [rows, signals, span]);
  if (!lanes || !lanes.list.length) return null;
  const dur = lanes.t1 - lanes.t0;
  const x = (t) => ((t - lanes.t0) / dur) * 1000;
  return (
    <div className="iow-timeline" data-tut="dg-iow-timeline" title="Signal level over the shown lines (green = HIGH)">
      {lanes.list.map((l) => (
        <div key={l.name} className="iow-lane">
          <span className="iow-lane-name small" title={l.name}>{l.name}</span>
          <svg viewBox="0 0 1000 20" preserveAspectRatio="none" className="iow-lane-svg">
            {l.segs.map((s, i) => (
              <rect key={i} x={x(s.from)} width={Math.max(0.6, x(s.to) - x(s.from))} y={s.high ? 2 : 13} height={s.high ? 16 : 5} className={s.high ? "is-high" : "is-low"} />
            ))}
          </svg>
          <span className="xs muted tabular">{l.edges}</span>
        </div>
      ))}
      <div className="iow-lane iow-axis xs muted">
        <span />
        <span className="iow-axis-row">
          <span>{new Date(lanes.t0).toLocaleTimeString("en-GB")}</span>
          <span>{new Date(lanes.t1).toLocaleTimeString("en-GB")}</span>
        </span>
        <span />
      </div>
    </div>
  );
}

function IoLog({ signals }) {
  const [live, setLive] = useState(true);
  const [signal, setSignal] = useState("");
  const [edge, setEdge] = useState("all");
  const [search, setSearch] = useState("");
  const [sel, setSel] = useState(null);
  const [tracing, setTracing] = useState(false);
  const [span, setSpan] = useState("60");
  const q = useQuery({ queryKey: ["io-log", 500], queryFn: () => robotApi.ioLog({ max: 500 }), retry: 0, staleTime: 0 });
  const stream = useRobot((s) => s.ioEvents);
  const [frozen, setFrozen] = useState(stream);
  useEffect(() => {
    if (live) setFrozen(stream);
  }, [live, stream]);

  // file / service lines + live edges received since (deduplicated by signal + stamp)
  const all = useMemo(() => {
    const seen = new Set();
    const out = [];
    for (const e of [...frozen, ...(q.data?.entries || [])]) {
      const k = `${e.signal}|${e.stamp}|${e.event}`;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(e);
    }
    return out.sort((a, b) => (b.stamp || 0) - (a.stamp || 0));
  }, [frozen, q.data]);

  const term = search.trim().toLowerCase();
  const rows = useMemo(
    () =>
      all.filter(
        (e) =>
          (!signal || e.signal === signal) &&
          (edge === "all" || (edge === "high") === isHigh(e)) &&
          (!term || JSON.stringify(e).toLowerCase().includes(term))
      ),
    [all, signal, edge, term]
  );
  const signalNames = useMemo(() => [...new Set([...signals.map((s) => s.name), ...all.map((e) => e.signal)])].filter(Boolean), [signals, all]);

  const trace = async () => {
    setTracing(true);
    const r = await robotApi.ioTrace(60).catch((e) => ({ ok: false, message: e.message }));
    if (!r?.ok) {
      toast.error(r?.message || "Trace not started", { title: "IO trace" });
      setTracing(false);
    } else {
      toast.success("Every IO change is logged for 60 s");
      setTimeout(() => setTracing(false), 60000);
    }
  };

  const unavailable = q.error?.status === 503;
  return (
    <div className="iow-log">
      <div className="iow-log-tools" data-tut="dg-iow-logtools">
        <Switch size="sm" tone="success" checked={live} onChange={setLive} label={live ? "Live" : "Paused"} />
        <Select size="sm" value={signal} onChange={(e) => setSignal(e.target.value)} aria-label="Signal">
          <option value="">All signals</option>
          {signalNames.map((n) => <option key={n} value={n}>{n}</option>)}
        </Select>
        <Segmented size="sm" value={edge} onChange={setEdge} options={[{ value: "all", label: "All" }, { value: "high", label: "HIGH" }, { value: "low", label: "LOW" }]} />
        <SearchInput size="sm" value={search} onChange={setSearch} placeholder="Search…" className="grow" />
        <Button size="sm" variant="ghost" icon={Radio} data-tut="dg-iow-trace" loading={tracing} onClick={trace} title="Log every IO change of every device for 60 s">Trace 60 s</Button>
        <IconButton size="sm" icon={RefreshCw} loading={q.isFetching} onClick={() => q.refetch()} label="Reload the IO log" />
      </div>
      {q.error && <Alert tone={unavailable ? "warning" : "danger"} title={unavailable ? "IO log not available" : "Could not load the IO log"}>{q.error.message}. Live changes still appear.</Alert>}
      <Timeline rows={rows.slice(0, 400)} signals={signal ? [signal] : signals.map((s) => s.name)} span={span} />
      <div className="iow-log-meta xs muted">
        <Select size="sm" value={span} onChange={(e) => setSpan(e.target.value)} options={SPANS} aria-label="Timeline span" title="Time span of the level timeline" />
        {rows.length} line{rows.length === 1 ? "" : "s"}{q.data?.total !== undefined ? ` · ${q.data.total} in the log` : ""}{q.data?.from === "file" ? " · read from io_logs.yaml" : ""}
      </div>
      <div className="iow-log-table" data-tut="dg-iow-log">
        {q.isLoading ? (
          <Loading />
        ) : !rows.length ? (
          <EmptyState compact icon={Activity} title={all.length ? "Nothing matches" : "No IO changes logged"} text={all.length ? "Change the filters." : "Watch an input on the left; its changes appear here."} />
        ) : (
          <table className="table compact">
            <thead>
              <tr>
                <th>Time</th>
                <th>Signal</th>
                <th>Change</th>
                <th title="How long the previous level lasted">Held before</th>
                <th>#</th>
                <th>Pin</th>
                <th>Mode</th>
                <th>Details</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 500).map((e, i) => {
                const k = `${e.signal}|${e.stamp}|${e.event}|${i}`;
                const open = sel === k;
                return (
                  <Fragment key={k}>
                    <tr className={cx("dg-rec-row", open && "is-open")} onClick={() => setSel(open ? null : k)}>
                      <td className="mono small nowrap" title={e.time}>{clock(e)}</td>
                      <td><strong><Highlight text={e.signal} term={term} /></strong></td>
                      <td><Badge tone={isHigh(e) ? "success" : undefined}>{String(e.event || (e.value ? "HIGH" : "LOW")).toUpperCase()}</Badge></td>
                      <td className="mono small nowrap">{fmtHeld(e.wasFor)}</td>
                      <td className="mono small">{e.count || "–"}</td>
                      <td className="small nowrap">{e.device} · {String(e.input || "").toUpperCase()}{e.bit !== null && e.bit !== undefined ? <span className="xs muted"> bit {e.bit}</span> : null}</td>
                      <td className="small nowrap">{e.profile || "–"}{e.phase ? <span className="xs muted"> · {e.phase}</span> : null}</td>
                      <td className="small">
                        <Highlight text={e.detail} term={term} />
                        <ExtraChips extra={e.extra} detail={e.detail} />
                      </td>
                    </tr>
                    {open && (
                      <tr className="dg-rec-detail">
                        <td colSpan={8}>
                          {e.positionsDeg?.length > 0 && (
                            <div className="iow-pose">
                              <span className="section-label">Robot position at the change</span>
                              {e.positionsDeg.map((v, j) => (
                                <span key={j} className="iow-pose-j"><span className="xs muted">J{j + 1}</span> <span className="mono">{Number(v).toFixed(2)}°</span></span>
                              ))}
                            </div>
                          )}
                          <FieldList fields={e.fields || e} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

export default function IoWatchWindow({ onClose }) {
  const watchQ = useQuery({ queryKey: ["io-watch"], queryFn: () => robotApi.ioWatch(), retry: 0 });
  const stream = useRobot((s) => s.ioEvents);
  const live = useMemo(() => {
    const m = {};
    for (const e of [...stream].reverse()) m[e.signal] = e;
    return m;
  }, [stream]);
  const signals = watchQ.data?.signals || [];
  return (
    <FloatingWindow
      id="diag.iowatch"
      title="IO watch"
      subtitle={watchQ.data ? `${signals.length} signal${signals.length === 1 ? "" : "s"} watched${watchQ.data.readOnly ? " · read only" : ""}` : ""}
      icon={Eye}
      size={{ w: 1180, h: 680 }}
      minSize={{ w: 560, h: 340 }}
      onClose={onClose}
      bodyClassName="iow-body"
    >
      {watchQ.isLoading ? (
        <Loading />
      ) : watchQ.isError ? (
        <div style={{ padding: 12 }}>
          <Alert tone="warning" title="IO watch not available" action={<Button size="sm" icon={RefreshCw} onClick={() => watchQ.refetch()}>Retry</Button>}>{watchQ.error?.message}</Alert>
        </div>
      ) : (
        <Split id="diag.iowatch" className="iow-split" defaults={[1, 2.1]} min={[280, 380]} gap={0}>
          <IoList watchQ={watchQ} live={live} onApplied={() => watchQ.refetch()} />
          <IoLog signals={signals} />
        </Split>
      )}
    </FloatingWindow>
  );
}
