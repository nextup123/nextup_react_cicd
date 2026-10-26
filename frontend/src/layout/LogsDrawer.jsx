// Behaviour-tree popup history (/ros/logs), previously the left "System Logs" drawer.
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { RefreshCw, ScrollText } from "lucide-react";
import { Badge, Button, Drawer, EmptyState, Loading, Segmented, Select } from "../components/ui";
import { api } from "../lib/api";
import { plainText } from "../lib/plainText";

const TYPE_TONE = { failure: "danger", warn: "warning", success: "success" };

export function LogsDrawer({ open, onClose }) {
  const [filter, setFilter] = useState("all");
  const [sort, setSort] = useState("newest");
  const [clearedAt, setClearedAt] = useState(0);
  const { data, isLoading, isFetching, refetch, error } = useQuery({
    queryKey: ["bt-logs"],
    queryFn: () => api.get("/ros/logs"),
    enabled: open,
    staleTime: 0,
  });

  const logs = useMemo(() => {
    const out = [];
    Object.entries(data?.data || {}).forEach(([type, items]) =>
      (items || []).forEach((item) => out.push({ ...item, type }))
    );
    return out
      .filter((l) => filter === "all" || l.type === filter)
      .filter((l) => new Date(l.timestamp).getTime() > clearedAt)
      .sort((a, b) => (sort === "newest" ? -1 : 1) * (new Date(a.timestamp) - new Date(b.timestamp)));
  }, [data, filter, sort, clearedAt]);

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Robot messages"
      actions={<Button size="sm" icon={RefreshCw} loading={isFetching} onClick={() => refetch()}>Refresh</Button>}
    >
      <div className="col" style={{ gap: 12 }}>
        <div className="row-wrap">
          <Segmented
            value={filter}
            onChange={setFilter}
            options={[
              { value: "all", label: "All" },
              { value: "failure", label: "Failures" },
              { value: "warn", label: "Warnings" },
              { value: "success", label: "Success" },
            ]}
          />
          <Select size="sm" value={sort} onChange={(e) => setSort(e.target.value)} style={{ width: 110 }} options={[{ value: "newest", label: "Newest" }, { value: "oldest", label: "Oldest" }]} />
          <Button size="sm" variant="ghost" onClick={() => setClearedAt(Date.now())}>Clear view</Button>
        </div>
        {isLoading ? (
          <Loading />
        ) : error ? (
          <EmptyState icon={ScrollText} title="Could not load messages" text={error.message} />
        ) : logs.length === 0 ? (
          <EmptyState icon={ScrollText} title="No messages" text="Behaviour tree popups (success, warnings and failures) appear here." />
        ) : (
          logs.map((l, i) => (
            <div key={i} className={`log-entry is-${l.type}`}>
              <div style={{ wordBreak: "break-word" }}>{plainText(l.message)}</div>
              <div className="row small muted">
                <Badge tone={TYPE_TONE[l.type]}>{l.type}</Badge>
                <span className="tabular">{new Date(l.timestamp).toLocaleString()}</span>
              </div>
            </div>
          ))
        )}
      </div>
    </Drawer>
  );
}
