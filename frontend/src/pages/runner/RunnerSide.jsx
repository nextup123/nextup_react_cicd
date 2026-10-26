// Side panel of the NexRoot runner: run summary, failure report, the selected
// node, the event list and the blackboard. Reads the stores; renders only when
// the visible tab's data changes.
import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronUp, Crosshair, Database, History, ListTree, OctagonAlert, Pencil, Radar } from "lucide-react";
import { Badge, Button, EmptyState, Tabs } from "../../components/ui";
import { useRobot } from "../../store/robot";
import { useBtRunner } from "../../store/btRunner";
import { STATUS_LABEL, fmtMs, fmtS, pathTo } from "./runnerModel";
import { plainName, plainText } from "../../lib/plainText";

const EV_LABEL = ["Idle", "Running", "Success", "Failure"];
const EV_TONE = ["", "warning", "success", "danger"];

export default function RunnerSide({ tab, setTab, index, selectedUid, onFocus, onBreak, onEdit }) {
  const runner = useBtRunner((s) => s.runner);
  const live = useBtRunner((s) => s.live);
  const failCount = runner?.lastFailure ? 1 : undefined;
  return (
    <div className="nr-side-inner">
      <Tabs
        className="nr-tabs"
        value={tab}
        onChange={setTab}
        tabs={[
          { value: "run", label: "Run", icon: Radar },
          { value: "failure", label: "Failure", icon: OctagonAlert, count: failCount },
          { value: "node", label: "Node", icon: ListTree },
          { value: "events", label: "Events", icon: History },
          { value: "data", label: "Data", icon: Database },
        ]}
      />
      <div className="nr-side-body">
        {tab === "run" && <RunTab runner={runner} live={live} index={index} onFocus={onFocus} />}
        {tab === "failure" && <FailureTab runner={runner} live={live} index={index} onFocus={onFocus} />}
        {tab === "node" && <NodeTab index={index} uid={selectedUid} live={live} onFocus={onFocus} onBreak={onBreak} onEdit={onEdit} />}
        {tab === "events" && <EventsTab index={index} onFocus={onFocus} live={live} />}
        {tab === "data" && <DataTab />}
      </div>
    </div>
  );
}

function Crumbs({ index, uids, onFocus }) {
  if (!index || !uids?.length) return null;
  return (
    <div className="nr-crumbs">
      {uids.map((u, i) => {
        const n = index.byUid.get(u);
        if (!n) return null;
        return (
          <span key={`${u}-${i}`}>
            {i > 0 && <span className="muted"> › </span>}
            <button type="button" className="nr-link-btn" onClick={() => onFocus(u)}>
              {n.name}
            </button>
          </span>
        );
      })}
    </div>
  );
}

function RunTab({ runner, live, index, onFocus }) {
  if (!runner) return <EmptyState compact title="No runner status" text="Waiting for the program runner." />;
  const run = live?.run || [];
  return (
    <div className="col" style={{ gap: 14 }}>
      <section>
        <h4 className="nr-h">Running now</h4>
        {run.length === 0 ? (
          <span className="small muted">{runner.state === "PAUSED" ? "Nothing: paused." : "No action is running."}</span>
        ) : (
          run.map(([uid, ms, name]) => (
            <div key={uid} className="nr-running">
              <button type="button" className="nr-link-btn strong" onClick={() => onFocus(uid)}>
                {name}
              </button>
              <span className="xs muted">{index?.byUid.get(uid)?.type}</span>
              <span className="grow" />
              <span className="small mono">{fmtMs(ms)}</span>
              {index && <Crumbs index={index} uids={pathTo(index, uid).slice(0, -1)} onFocus={onFocus} />}
            </div>
          ))
        )}
        {live?.lastEvent && <div className="xs muted" style={{ marginTop: 6 }}>Last: {live.lastEvent}</div>}
      </section>
      <section>
        <h4 className="nr-h">Cycle times</h4>
        <div className="nr-stats" data-tut="rn-stats">
          <Stat label="This cycle" value={fmtS(runner.cycleElapsed)} />
          <Stat label="Last" value={fmtS(runner.lastCycle)} />
          <Stat label="Average" value={fmtS(runner.avgCycle)} />
          <Stat label="Min / max" value={`${fmtS(runner.minCycle)} / ${fmtS(runner.maxCycle)}`} />
        </div>
      </section>
      {runner.profile?.length > 0 && (
        <section>
          <h4 className="nr-h">Slowest steps of the last cycle</h4>
          <ol className="nr-list">
            {runner.profile.map((p, i) => (
              <li key={i} className="small">
                {p}
              </li>
            ))}
          </ol>
        </section>
      )}
      <section>
        <h4 className="nr-h">Runner</h4>
        <div className="small">{plainText(runner.message) || "—"}</div>
        <div className="xs muted" style={{ marginTop: 4 }}>
          {plainName(runner.tree)} · {runner.hasStartNode ? "Start node in the tree" : "no Start node: the runner gates the whole tree"}
          {runner.simMode ? " · runner in sim mode" : ""}
        </div>
      </section>
    </div>
  );
}

const Stat = ({ label, value }) => (
  <div className="nr-stat">
    <span className="xs muted">{label}</span>
    <span className="strong">{value}</span>
  </div>
);

function FailureTab({ runner, live, index, onFocus }) {
  const lf = runner?.lastFailure;
  const leaf = live?.fail;
  const runFail = live?.runFail;
  if (!lf && !leaf) return <EmptyState compact title="No failure" text="Nothing has failed since the runner started." />;
  return (
    <div className="col" style={{ gap: 16 }}>
      {lf && (
        <section className="nr-fail">
          <div className="row" style={{ gap: 8, alignItems: "center" }}>
            <Badge tone="danger">Cycle {lf.cycle} failed</Badge>
            <span className="xs muted">{lf.time}</span>
            <span className="grow" />
            {runFail?.uid > 0 && (
              <Button size="sm" icon={Crosshair} onClick={() => onFocus(runFail.uid)}>
                Show
              </Button>
            )}
          </div>
          <div className="nr-fail-node">
            {lf.node} <span className="muted small">({lf.nodeId})</span>
          </div>
          {lf.error && <div className="nr-fail-error">{lf.error}</div>}
          {runFail?.pathUids?.length ? <Crumbs index={index} uids={runFail.pathUids} onFocus={onFocus} /> : <div className="xs muted">{lf.path}</div>}
          <dl className="nr-kv">
            {lf.ports && (
              <>
                <dt>Ports</dt>
                <dd className="mono">{lf.ports}</dd>
              </>
            )}
            <dt>Step time</dt>
            <dd>{fmtS(lf.stepTime)}</dd>
            {lf.joints?.length > 0 && (
              <>
                <dt>Joints (deg)</dt>
                <dd className="mono">{lf.joints.map((r) => ((r * 180) / Math.PI).toFixed(1)).join("  ")}</dd>
              </>
            )}
            {lf.blackboard?.length > 0 && (
              <>
                <dt>Blackboard</dt>
                <dd className="mono">{lf.blackboard.join("  ")}</dd>
              </>
            )}
          </dl>
        </section>
      )}
      {leaf && (!lf || leaf.node !== lf.node || leaf.cycle !== lf.cycle) && (
        <section>
          <h4 className="nr-h">Last node that failed</h4>
          <div className="small">
            <button type="button" className="nr-link-btn strong" onClick={() => leaf.uid && onFocus(leaf.uid)}>
              {leaf.node}
            </button>{" "}
            <span className="muted">({leaf.type}) · cycle {leaf.cycle}</span>
          </div>
          {leaf.reason && <div className="nr-fail-error">{leaf.reason}</div>}
          <div className="xs muted">A Fallback or Recovery may have handled this one; the run only stops when the failure reaches the root.</div>
        </section>
      )}
      {leaf?.recent?.length > 0 && (
        <section>
          <h4 className="nr-h">What happened before</h4>
          <ol className="nr-recent mono xs">
            {leaf.recent.map((l, i) => (
              <li key={i}>{l}</li>
            ))}
          </ol>
        </section>
      )}
    </div>
  );
}

function NodeTab({ index, uid, live, onFocus, onBreak, onEdit }) {
  const events = useBtRunner((s) => s.events);
  const n = index?.byUid.get(uid);
  const mine = useMemo(() => (uid ? events.filter((e) => e.uid === uid).slice(-12).reverse() : []), [events, uid]);
  if (!n) return <EmptyState compact title="No node selected" text="Click a node in the tree. Right-click for breakpoints and the editor." />;
  const ch = live?.st?.[index.posOf.get(uid)] || ".";
  const isBp = live?.bp?.name === n.name;
  return (
    <div className="col" style={{ gap: 12 }}>
      <div>
        <div className="nr-fail-node">{n.name}</div>
        <div className="small muted">
          {n.type} · uid {n.uid} · depth {n.depth}
          {n.subtree ? ` · subtree ${n.subtree}` : " · main tree"}
        </div>
        <Badge tone={ch === "R" ? "warning" : ch === "S" || ch === "s" ? "success" : ch === "F" || ch === "f" ? "danger" : undefined} style={{ marginTop: 6 }}>
          {STATUS_LABEL[ch]}
        </Badge>
      </div>
      <Crumbs index={index} uids={pathTo(index, uid)} onFocus={onFocus} />
      <div className="row wrap" style={{ gap: 6 }}>
        <Button size="sm" icon={Crosshair} data-tut="rn-node-show" onClick={() => onFocus(uid)}>
          Show
        </Button>
        {isBp ? (
          <Button size="sm" data-tut="rn-break-clear" onClick={() => onBreak("")}>Clear breakpoint</Button>
        ) : (
          <>
            <Button size="sm" data-tut="rn-break-start" onClick={() => onBreak(n.name)} title="Hold the tree (tick level) when this node starts">
              Break when it starts
            </Button>
            <Button size="sm" data-tut="rn-break-fail" onClick={() => onBreak(n.name, true)} title="Hold the tree when this node fails">
              Break on failure
            </Button>
          </>
        )}
        <Button size="sm" icon={Pencil} data-tut="rn-node-edit" onClick={() => onEdit(uid)} title="Open this node in the Robot Program editor">
          Edit
        </Button>
      </div>
      <section>
        <h4 className="nr-h">Recent results</h4>
        {mine.length === 0 ? (
          <span className="small muted">{live?.events ? "No change seen while this page was open." : "Events are not available; colours come from the running steps."}</span>
        ) : (
          <ul className="nr-events">
            {mine.map((e, i) => (
              <li key={i}>
                <span className="xs muted mono">{new Date(e.t).toLocaleTimeString()}</span>
                <Badge tone={EV_TONE[e.s]}>{EV_LABEL[e.s]}</Badge>
                {e.p === 1 && <span className="xs muted">after {fmtMs(e.ms)}</span>}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function EventsTab({ index, onFocus, live }) {
  const events = useBtRunner((s) => s.events);
  const list = useMemo(() => events.slice(-150).reverse(), [events]);
  const [sel, setSel] = useState(null); // the selected event (same object while it stays in the list)
  const listRef = useRef(null);
  const pos = sel ? list.indexOf(sel) : -1;
  const pick = (e) => {
    setSel(e);
    onFocus(e.uid);
  };
  // Previous = the row above (newer), Next = the row below (older), like reading the list
  const go = (d) => {
    if (!list.length) return;
    const i = pos < 0 ? 0 : Math.min(list.length - 1, Math.max(0, pos + d));
    pick(list[i]);
  };
  useEffect(() => {
    listRef.current?.querySelector(".is-sel")?.scrollIntoView({ block: "nearest" });
  }, [sel]);
  if (!live?.events && !list.length) return <EmptyState compact title="No events" text="The runner has not sent step events yet. Colours then come from the running steps only." />;
  return (
    <div className="col" style={{ gap: 8 }}>
      <div className="nr-ev-nav" data-tut="rn-ev-nav">
        <Button size="sm" icon={ChevronUp} disabled={!list.length || pos === 0} onClick={() => go(-1)} title="Select the event above (newer)">
          Previous
        </Button>
        <Button size="sm" icon={ChevronDown} disabled={!list.length || (pos >= 0 && pos === list.length - 1)} onClick={() => go(1)} title="Select the event below (older)">
          Next
        </Button>
        <span className="xs muted">{pos >= 0 ? `${pos + 1} of ${list.length}` : `${list.length} event${list.length === 1 ? "" : "s"} · newest first`}</span>
      </div>
      <ul className="nr-events" ref={listRef} data-tut="rn-events">
        {list.map((e, i) => {
          const n = index?.byUid.get(e.uid);
          return (
            <li key={`${e.t}-${e.uid}-${i}`} className={[e.s === 3 ? "is-fail" : "", e === sel ? "is-sel" : ""].join(" ").trim() || undefined} onClick={() => pick(e)}>
              <span className="xs muted mono">{new Date(e.t).toLocaleTimeString()}</span>
              <button type="button" className="nr-link-btn" onClick={(ev) => { ev.stopPropagation(); pick(e); }}>
                {n?.name || `#${e.uid}`}
              </button>
              <Badge tone={EV_TONE[e.s]}>{EV_LABEL[e.s]}</Badge>
              {e.p === 1 && <span className="xs muted">{fmtMs(e.ms)}</span>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function DataTab() {
  const bb = useRobot((s) => s.btBlackboard);
  const info = useBtRunner((s) => s.structure);
  const boards = Object.entries(bb || {});
  return (
    <div className="col" style={{ gap: 14 }}>
      <section>
        <h4 className="nr-h">Blackboard</h4>
        {boards.length === 0 ? (
          <span className="small muted">No blackboard values yet.</span>
        ) : (
          boards.map(([name, entries]) => (
            <div key={name} style={{ marginBottom: 8 }}>
              <div className="xs muted">{name}</div>
              <dl className="nr-kv">
                {(entries || []).map((e) => (
                  <FragmentKV key={e.key} k={e.key} v={e.value} />
                ))}
              </dl>
            </div>
          ))
        )}
      </section>
      {info && (
        <section>
          <h4 className="nr-h">Loaded tree</h4>
          <div className="small">
            {info.treeId} · {info.nodes?.length || 0} nodes
          </div>
          <div className="xs muted">{plainName(info.xmlFile)}</div>
          {(info.warnings || []).slice(0, 20).map((w, i) => (
            <div key={i} className="xs muted">
              ⚠ {w}
            </div>
          ))}
        </section>
      )}
    </div>
  );
}

const FragmentKV = ({ k, v }) => (
  <>
    <dt>{k}</dt>
    <dd className="mono">{v}</dd>
  </>
);
