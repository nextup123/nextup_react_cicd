// Drive error history (error_logs.yaml): time, joint and error code. Clicking a
// code opens it in the fault lookup.
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { History, RefreshCw, Search } from "lucide-react";
import { Alert, Button, Card, EmptyState, Loading, SearchInput, Select } from "../../components/ui";
import { api, errorMessage } from "../../lib/api";
import { toHex } from "./logUtils";
import { Highlight } from "./Highlight";

const LIMITS = [100, 200, 500, 1000, 2000].map((n) => ({ value: String(n), label: `Last ${n}` }));

export function ErrorHistory({ onLookup }) {
  const [limit, setLimit] = useState("100");
  const [search, setSearch] = useState("");
  const q = useQuery({
    queryKey: ["diagnostics", "error-history", limit],
    queryFn: async () => {
      const data = await api.get(`/error-logs?limit=${limit}`);
      return Array.isArray(data?.logs) ? data.logs : [];
    },
    staleTime: 0,
  });

  const term = search.trim().toLowerCase();
  const rows = useMemo(() => {
    const list = (q.data || []).slice().reverse(); // newest first
    if (!term) return list;
    return list.filter((l) => `${l.time} ${l.joint} ${l.last_error} E${toHex(l.last_error)} ${toHex(l.last_error)}`.toLowerCase().includes(term));
  }, [q.data, term]);

  return (
    <Card
      className="dg-panel"
      tut="dg-errors"
      bodyClassName="dg-panel-body"
      icon={History}
      title="Error history"
      subtitle={q.data ? `Showing ${rows.length} of ${q.data.length} drive errors` : "Drive errors recorded by the robot"}
      actions={
        <Button size="sm" variant="ghost" icon={RefreshCw} loading={q.isFetching} onClick={() => q.refetch()}>
          Refresh
        </Button>
      }
    >
      <div className="dg-filters">
        <SearchInput size="sm" value={search} onChange={setSearch} placeholder="Search time, joint or code…" className="dg-search" />
        <Select size="sm" options={LIMITS} value={limit} onChange={(e) => setLimit(e.target.value)} aria-label="How many entries" />
      </div>
      <div className="dg-scroll">
        {q.isLoading ? (
          <Loading label="Loading error history…" />
        ) : q.error ? (
          <Alert tone="danger" title="Could not load error history" action={<Button size="sm" onClick={() => q.refetch()}>Retry</Button>}>
            {errorMessage(q.error)}
          </Alert>
        ) : !rows.length ? (
          <EmptyState icon={History} title={q.data?.length ? "No matching errors" : "No errors recorded"} text={q.data?.length ? "Change the search." : "Drive errors appear here when a joint reports a fault."} compact />
        ) : (
          <table className="table compact dg-err-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>Joint</th>
                <th title="Drive error code in hexadecimal; click to look it up">Code</th>
                <th title="Same code in decimal">Dec</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((l, i) => {
                const hex = `E${toHex(l.last_error)}`;
                return (
                  <tr key={`${l.time}-${i}`}>
                    <td className="mono small"><Highlight text={l.time} term={term} /></td>
                    <td><Highlight text={l.joint} term={term} /></td>
                    <td>
                      <Button size="sm" variant="soft-danger" icon={Search} data-tut="dg-err-code" onClick={() => onLookup(hex)} title={`Look up ${hex} in the fault database`}>
                        {hex}
                      </Button>
                    </td>
                    <td className="mono small muted">{l.last_error}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </Card>
  );
}
