// Fault code lookup over user_config/faults.json (faults + warnings):
// code → name, causes, how to confirm, and the remedy.
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { BookOpen, ChevronDown, ChevronRight } from "lucide-react";
import { Alert, Badge, Button, Card, EmptyState, Loading, SearchInput, Segmented, Select, cx } from "../../components/ui";
import { api, errorMessage } from "../../lib/api";
import { Highlight } from "./Highlight";

const RESET = [
  { value: "all", label: "All" },
  { value: "Yes", label: "Resettable" },
  { value: "No", label: "Not resettable" },
];

function rangeTone(range = "") {
  if (range.includes("Warning")) return "warning";
  if (range.includes("Axis")) return "info";
  return "danger";
}

function subFaultText(fault, sf) {
  return [
    fault.faultCode, fault.faultName, sf.subFaultCode, sf.name, sf.errorCode603Fh, sf.auxiliaryCode203Fh,
    ...(sf.causesAndSolutions || []).flatMap((cs) => [cs.cause, cs.solution, cs.confirmingMethod]),
  ].filter(Boolean).join(" ").toLowerCase();
}

function SubFault({ sf, term, defaultOpen }) {
  const [open, setOpen] = useState(defaultOpen);
  const causes = sf.causesAndSolutions || [];
  return (
    <div className={cx("dg-sub", open && "is-open")}>
      <button className="dg-sub-head" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        {open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
        <span className="mono strong"><Highlight text={sf.subFaultCode} term={term} /></span>
        <span className="grow dg-sub-name"><Highlight text={sf.name} term={term} /></span>
        {sf.faultRange && <Badge tone={rangeTone(sf.faultRange)}>{sf.faultRange}</Badge>}
        {sf.resettable === "Yes" ? <Badge tone="success">Resettable</Badge> : <Badge>Not resettable</Badge>}
      </button>
      {open && (
        <div className="dg-sub-body">
          <div className="dg-chips">
            <span className="chip" title="Error code (object 603Fh)"><span className="muted">603Fh</span> <Highlight text={sf.errorCode603Fh || "—"} term={term} /></span>
            <span className="chip" title="Auxiliary code (object 203Fh)"><span className="muted">203Fh</span> <Highlight text={sf.auxiliaryCode203Fh || "—"} term={term} /></span>
            <span className="chip"><span className="muted">Type</span> {sf.type || "—"}</span>
          </div>
          <div className="section-label">Causes and remedies ({causes.length})</div>
          {!causes.length && <div className="small muted">No causes listed.</div>}
          <ol className="dg-causes">
            {causes.map((cs, i) => (
              <li key={i} className="dg-cause">
                <div className="dg-cause-title"><Highlight text={cs.cause} term={term} /></div>
                {cs.confirmingMethod && (
                  <div className="dg-cause-row">
                    <span className="dg-cause-label">How to check</span>
                    <span><Highlight text={cs.confirmingMethod} term={term} /></span>
                  </div>
                )}
                {cs.solution && (
                  <div className="dg-cause-row is-solution">
                    <span className="dg-cause-label">Remedy</span>
                    <span><Highlight text={cs.solution} term={term} /></span>
                  </div>
                )}
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}

function FaultGroup({ fault, subFaults, term, defaultOpen }) {
  const [open, setOpen] = useState(defaultOpen);
  const warning = fault._kind === "warning";
  return (
    <div className={cx("dg-group", open && "is-open")}>
      <button className="dg-group-head" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        <span className="dg-code mono"><Highlight text={fault.faultCode} term={term} /></span>
        <span className="grow strong dg-group-name"><Highlight text={fault.faultName} term={term} /></span>
        <Badge tone={warning ? "warning" : "danger"}>{warning ? "Warning" : "Fault"}</Badge>
        <span className="xs muted nowrap">{subFaults.length} sub-code{subFaults.length === 1 ? "" : "s"}</span>
      </button>
      {open && (
        <div className="dg-group-body">
          {subFaults.map((sf) => (
            <SubFault key={sf.subFaultCode || sf.name} sf={sf} term={term} defaultOpen={defaultOpen && subFaults.length <= 3} />
          ))}
        </div>
      )}
    </div>
  );
}

export function FaultLookup({ query, onQuery }) {
  const [reset, setReset] = useState("all");
  const [range, setRange] = useState("all");
  const q = useQuery({
    queryKey: ["diagnostics", "faults"],
    queryFn: async () => {
      const data = await api.get("/error-logs/api/fault");
      return [
        ...(data?.faults || []).map((f) => ({ ...f, _kind: "fault" })),
        ...(data?.warnings || []).map((f) => ({ ...f, _kind: "warning" })),
      ].filter((f) => f && Array.isArray(f.subFaults));
    },
    staleTime: Infinity,
  });

  const ranges = useMemo(() => {
    const set = new Set();
    (q.data || []).forEach((f) => f.subFaults.forEach((sf) => sf?.faultRange && set.add(sf.faultRange)));
    return [{ value: "all", label: "All categories" }, ...[...set].sort().map((r) => ({ value: r, label: r }))];
  }, [q.data]);

  const term = query.trim().toLowerCase();
  const results = useMemo(() => {
    const out = [];
    for (const fault of q.data || []) {
      const subs = fault.subFaults.filter((sf) => {
        if (!sf) return false;
        if (reset !== "all" && sf.resettable !== reset) return false;
        if (range !== "all" && sf.faultRange !== range) return false;
        return !term || subFaultText(fault, sf).includes(term);
      });
      if (subs.length) out.push({ fault, subs });
    }
    // Exact code matches first (e.g. "E101" before codes that only mention 101).
    if (term) out.sort((a, b) => (b.fault.faultCode?.toLowerCase() === term) - (a.fault.faultCode?.toLowerCase() === term));
    return out;
  }, [q.data, reset, range, term]);

  const count = results.reduce((n, r) => n + r.subs.length, 0);
  const autoOpen = !!term && results.length <= 3;

  return (
    <Card
      className="dg-panel dg-faults"
      tut="dg-faults"
      bodyClassName="dg-panel-body"
      icon={BookOpen}
      title="Fault lookup"
      subtitle={q.data ? `${count} matching code${count === 1 ? "" : "s"} · servo drive fault and warning database` : "Servo drive fault and warning database"}
    >
      <div className="dg-filters" data-tut="dg-fault-filters">
        <SearchInput value={query} onChange={onQuery} placeholder="Fault code (E101, E101.0), 603Fh code or keyword…" className="dg-search dg-fault-search" />
        <Segmented options={RESET} value={reset} onChange={setReset} ariaLabel="Resettable" />
        <Select options={ranges} value={range} onChange={(e) => setRange(e.target.value)} aria-label="Category" />
        {(query || reset !== "all" || range !== "all") && (
          <Button variant="ghost" size="sm" onClick={() => { onQuery(""); setReset("all"); setRange("all"); }}>
            Reset
          </Button>
        )}
      </div>
      <div className="dg-scroll">
        {q.isLoading ? (
          <Loading label="Loading fault database…" />
        ) : q.error ? (
          <Alert tone="danger" title="Could not load the fault database" action={<Button size="sm" onClick={() => q.refetch()}>Retry</Button>}>
            {errorMessage(q.error)}. The backend may be offline or faults.json is missing.
          </Alert>
        ) : !results.length ? (
          <EmptyState
            icon={BookOpen}
            title="No faults found"
            text={term ? `Nothing matches "${query.trim()}". Codes look like E101 or E101.0; you can also search a 603Fh code (0x6320) or a word such as "overcurrent".` : "Try another category or reset the filters."}
            compact
          />
        ) : (
          <div className="dg-groups" data-tut="dg-fault-results" key={`${term}|${reset}|${range}`}>
            {results.map(({ fault, subs }) => (
              <FaultGroup key={`${fault._kind}-${fault.faultCode}`} fault={fault} subFaults={subs} term={term} defaultOpen={autoOpen} />
            ))}
          </div>
        )}
      </div>
    </Card>
  );
}
