// Live robot logs (/logs_topic): saved history from GET /error-logs/live merged
// with the lines streamed since then (shared robot store), newest first.
import { useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Pause, Play, RefreshCw, ScrollText, Trash2 } from "lucide-react";
import { Alert, Badge, Button, Card, EmptyState, Loading, SearchInput, Select, Switch, cx } from "../../components/ui";
import { api, errorMessage } from "../../lib/api";
import { clearLiveLogs, useRobot } from "../../store/robot";
import { confirm } from "../../store/confirm";
import { toast } from "../../store/toast";
import { LEVELS, fmtClock, fmtDay, parseLog } from "./logUtils";
import { Highlight } from "./Highlight";

const LIMITS = [100, 200, 500, 1000, 2000].map((n) => ({ value: String(n), label: `Last ${n}` }));
const SOURCES = [
  { value: "all", label: "All sources" },
  { value: "bt", label: "Behaviour tree" },
  { value: "backend", label: "Backend / nodes" },
];
const LEVEL_OPTIONS = [
  { value: "all", label: "All levels" },
  { value: "failure", label: "Failures" },
  { value: "warn", label: "Warnings" },
  { value: "success", label: "Success" },
  { value: "info", label: "Info" },
];
const DUP_WINDOW_MS = 5000;

export function LiveLogs() {
  const [limit, setLimit] = useState("500");
  const [source, setSource] = useState("all");
  const [level, setLevel] = useState("all");
  const [search, setSearch] = useState("");
  const [live, setLive] = useState(true);
  const [pausedAt, setPausedAt] = useState(0);
  const [clearedAt, setClearedAt] = useState(0);
  const loadedAt = useRef(Date.now());

  const histQ = useQuery({
    queryKey: ["diagnostics", "live-history", limit],
    queryFn: async () => {
      const at = Date.now();
      const data = await api.get(`/error-logs/live?limit=${limit}`);
      loadedAt.current = at;
      return Array.isArray(data?.logs) ? data.logs : [];
    },
    staleTime: 0,
    refetchOnWindowFocus: false,
  });
  const stream = useRobot((s) => s.liveLogs);

  // Merge: history (saved by the backend) + streamed lines not already in it.
  const all = useMemo(() => {
    const out = [];
    const seen = new Map(); // message -> [timestamps]
    (histQ.data || []).forEach((h, i) => {
      const at = new Date(h.timestamp).getTime() || 0;
      const p = parseLog(h.message, h.level);
      out.push({ key: `h${i}`, at, ...p });
      const k = p.message;
      if (!seen.has(k)) seen.set(k, []);
      seen.get(k).push(at);
    });
    stream.forEach((s) => {
      const p = parseLog(s.text);
      // The backend saves every streamed line, so a line received before the
      // history was fetched is normally already in it.
      if (s.at <= loadedAt.current + DUP_WINDOW_MS && seen.get(p.message)?.some((t) => Math.abs(t - s.at) < DUP_WINDOW_MS)) return;
      out.push({ key: `s${s.id}`, at: s.at, ...p });
    });
    out.sort((a, b) => b.at - a.at);
    return out;
  }, [histQ.data, stream]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    const max = Number(limit);
    return all
      .filter((l) => l.at > clearedAt)
      .filter((l) => live || l.at <= pausedAt)
      .slice(0, max)
      .filter((l) => source === "all" || (source === "bt") === l.bt)
      .filter((l) => level === "all" || l.level === level)
      .filter((l) => !q || `${fmtClock(l.at)} ${l.level} ${l.bt ? "bt " : ""}${l.message}`.toLowerCase().includes(q));
  }, [all, search, limit, clearedAt, live, pausedAt, source, level]);

  const total = Math.min(all.filter((l) => l.at > clearedAt).length, Number(limit));
  const newWhilePaused = live ? 0 : all.filter((l) => l.at > pausedAt && l.at > clearedAt).length;

  const toggleLive = (on) => {
    setLive(on);
    if (!on) setPausedAt(Date.now());
  };

  const clear = async () => {
    const ok = await confirm({
      title: "Clear live logs?",
      message: "This permanently deletes every saved log line (live_logs.json on the robot) and empties this view. It cannot be undone.",
      tone: "danger",
      confirmLabel: "Clear logs",
    });
    if (!ok) return;
    try {
      await api.del("/error-logs/live");
      clearLiveLogs();
      setClearedAt(Date.now());
      toast.success("Live logs cleared");
      histQ.refetch();
    } catch (err) {
      toast.error(errorMessage(err), { title: "Could not clear live logs" });
    }
  };

  const today = new Date().toDateString();

  return (
    <Card
      className="dg-panel"
      tut="dg-live"
      bodyClassName="dg-panel-body"
      icon={ScrollText}
      title="Live logs"
      subtitle={`Showing ${visible.length} of ${total}${newWhilePaused ? ` · ${newWhilePaused} new while paused` : ""}`}
      actions={
        <>
          <Switch size="sm" tone="success" checked={live} onChange={toggleLive} label={live ? "Live" : "Paused"} title="Pause to freeze the list while reading; resume to catch up" />
          <Button size="sm" variant="ghost" icon={RefreshCw} loading={histQ.isFetching} onClick={() => histQ.refetch()} title="Reload saved logs" data-tut="dg-live-refresh">
            Refresh
          </Button>
          <Button size="sm" variant="ghost-danger" icon={Trash2} onClick={clear} title="Delete all saved live logs" data-tut="dg-live-clear">
            Clear
          </Button>
        </>
      }
    >
      <div className="dg-filters" data-tut="dg-live-filters">
        <SearchInput size="sm" value={search} onChange={setSearch} placeholder="Search logs…" className="dg-search" />
        <Select size="sm" options={LEVEL_OPTIONS} value={level} onChange={(e) => setLevel(e.target.value)} aria-label="Level" />
        <Select size="sm" options={SOURCES} value={source} onChange={(e) => setSource(e.target.value)} aria-label="Source" />
        <Select size="sm" options={LIMITS} value={limit} onChange={(e) => setLimit(e.target.value)} aria-label="How many lines" />
      </div>

      {histQ.error && (
        <Alert tone="warning" title="Saved logs could not be loaded" action={<Button size="sm" onClick={() => histQ.refetch()}>Retry</Button>}>
          {errorMessage(histQ.error)}. New lines still appear below.
        </Alert>
      )}

      <div className="dg-log" data-tut="dg-log" role="log" aria-live="off">
        {histQ.isLoading ? (
          <Loading label="Loading logs…" />
        ) : !visible.length ? (
          <EmptyState icon={live ? Play : Pause} title={all.length ? "No matching log lines" : "No logs yet"} text={all.length ? "Change the filters or search." : "Lines published by the robot appear here as they arrive."} compact />
        ) : (
          visible.map((l) => {
            const d = new Date(l.at);
            return (
              <div key={l.key} className={cx("dg-log-row", `is-${l.level}`)}>
                <span className="dg-log-time" title={d.toLocaleString()}>
                  {d.toDateString() !== today && <span className="dg-log-day">{fmtDay(l.at)} </span>}
                  {fmtClock(l.at)}
                </span>
                <span className="dg-log-badges">
                  {l.bt && <Badge tone="info">BT</Badge>}
                  <Badge tone={LEVELS[l.level].tone}>{LEVELS[l.level].label}</Badge>
                </span>
                <span className="dg-log-msg"><Highlight text={l.message} term={search.trim()} /></span>
              </div>
            );
          })
        )}
      </div>
    </Card>
  );
}
