// Time, uptime and load in the sidebar footer, plus the rest alerts.
//
// The robot PC is asked once a minute (one tiny /uptime request; react-query
// pauses it while the tab is hidden). The levels below decide the colours and
// the alerts:
//   uptime ≥ 12 h  → a popup asks for a 20–30 min rest (skip or close; once per boot)
//   uptime ≥ 24 h  → critical card "needs a 30 min rest": can be minimised, never closed
//   load   ≥ 8     → warning popup (closed until the load is normal again)
//   load   > 16    → critical card, minimisable, gone when the load drops
// Load is the 5-minute average, so a short spike does not raise an alert.
import { useEffect, useMemo, useState } from "react";
import { Activity, AlarmClock, ChevronUp, Coffee, Gauge, Minimize2 } from "lucide-react";
import { Button, IconButton, Modal, cx } from "../components/ui";
import { useUptime } from "../lib/queries";
import "./systemInfo.css";

export const REST_LIMITS = {
  uptimeWarnH: 12,
  uptimeCritH: 24,
  loadWarn: 8,
  loadCrit: 16,
};

// Per browser on purpose (not a "nextup." key, so not mirrored to the robot).
const STORE_KEY = "nextupLocal.restAlerts";
const readStore = () => {
  try {
    return JSON.parse(localStorage.getItem(STORE_KEY) || "{}") || {};
  } catch {
    return {};
  }
};
const writeStore = (v) => {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(v));
  } catch {
    /* storage full or blocked: alerts still work for this page view */
  }
};

function Clock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  return now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

const fmtHours = (secs) => {
  const h = Math.floor(secs / 3600);
  return h >= 48 ? `${Math.floor(h / 24)} days` : `${h} hours`;
};

/** Levels from one /uptime answer. Old servers send only text: parse that. */
function useLevels() {
  const q = useUptime();
  const lv = useMemo(() => {
    const d = q.data;
    if (!d) return { secs: null, load: null, loads: null, uptime: "ok", loadLevel: "ok", boot: null };
    const loads = Array.isArray(d.load) ? d.load : String(d.loadAverage || "").split(/[\s,]+/).filter(Boolean).map(Number);
    const load = Number.isFinite(loads[1]) ? loads[1] : Number.isFinite(loads[0]) ? loads[0] : null;
    let secs = Number.isFinite(d.uptimeSeconds) ? d.uptimeSeconds : null;
    if (secs == null && typeof d.uptime === "string") {
      const m = d.uptime.match(/(?:(\d+) days?, )?(\d+):(\d+)/);
      if (m) secs = (+(m[1] || 0) * 24 + +m[2]) * 3600 + +m[3] * 60;
    }
    const L = REST_LIMITS;
    const uptime = secs == null ? "ok" : secs >= L.uptimeCritH * 3600 ? "crit" : secs >= L.uptimeWarnH * 3600 ? "warn" : "ok";
    const loadLevel = load == null ? "ok" : load > L.loadCrit ? "crit" : load >= L.loadWarn ? "warn" : "ok";
    // Boot time to the 10 minutes, so a skip lasts until the PC restarts.
    const boot = secs == null ? null : Math.round((Date.now() / 1000 - secs) / 600);
    return { secs, load, loads, uptime, loadLevel, boot };
  }, [q.data]);
  return { ...lv, q };
}

export function SystemInfo() {
  const lv = useLevels();
  const { q } = lv;
  const loadsText = q.isError ? "N/A" : lv.loads?.length ? lv.loads.map((v) => v.toFixed(v >= 10 ? 1 : 2)).join(" ") : "…";
  return (
    <>
      <dl className={cx("sys-info", (lv.uptime !== "ok" || lv.loadLevel !== "ok") && "has-alert")}>
        <div className="sys-row">
          <dt>Time</dt>
          <dd><Clock /></dd>
        </div>
        <div className={cx("sys-row", `is-${lv.uptime}`)} title={lv.uptime === "ok" ? "Time since the robot PC started" : lv.uptime === "crit" ? "Running for more than 24 hours: the robot needs a rest" : "Running for more than 12 hours: plan a rest"}>
          <dt>Uptime</dt>
          <dd>{q.isError ? "N/A" : q.data?.uptime || "…"}</dd>
        </div>
        <div className={cx("sys-row", `is-${lv.loadLevel}`)} title="System load: 1, 5 and 15 minute averages">
          <dt>Load</dt>
          <dd>{loadsText}</dd>
        </div>
      </dl>
      <RestAlerts lv={lv} />
    </>
  );
}

function RestAlerts({ lv }) {
  const [store, setStore] = useState(readStore);
  const save = (patch) =>
    setStore((s) => {
      const next = { ...s, ...patch };
      writeStore(next);
      return next;
    });

  // A new boot starts fresh; a normal load re-arms the load warning.
  useEffect(() => {
    if (lv.boot != null && store.boot !== lv.boot) save({ boot: lv.boot, uptimeSkipped: false, uptimeMin: false });
  }, [lv.boot]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (lv.loadLevel === "ok" && (store.loadSkipped || store.loadMin)) save({ loadSkipped: false, loadMin: false });
  }, [lv.loadLevel]); // eslint-disable-line react-hooks/exhaustive-deps

  const sameBoot = store.boot === lv.boot;
  const uptimePopup = lv.uptime === "warn" && !(sameBoot && store.uptimeSkipped);
  const loadPopup = !uptimePopup && lv.loadLevel === "warn" && !store.loadSkipped;
  const crit = [];
  if (lv.uptime === "crit") crit.push({ key: "uptime", min: sameBoot && store.uptimeMin, setMin: (v) => save({ uptimeMin: v }) });
  if (lv.loadLevel === "crit") crit.push({ key: "load", min: store.loadMin, setMin: (v) => save({ loadMin: v }) });

  return (
    <>
      <Modal
        open={uptimePopup}
        onClose={() => save({ uptimeSkipped: true })}
        size="sm"
        icon={<span className="rest-ico is-warn"><Coffee size={18} /></span>}
        title="Time for a rest"
        description={`The robot has been running for ${lv.secs != null ? fmtHours(lv.secs) : "12 hours"}.`}
        footer={
          <>
            <Button onClick={() => save({ uptimeSkipped: true })}>Skip</Button>
            <Button variant="primary" onClick={() => save({ uptimeSkipped: true })}>OK, I will plan it</Button>
          </>
        }
      >
        <p className="rest-text">
          Give the robot a <b>20 to 30 minute</b> rest when the current job allows it: finish the cycle, stop the program and power the robot down or let it stand still.
          After {REST_LIMITS.uptimeCritH} hours this becomes a critical reminder that stays on screen.
        </p>
      </Modal>
      <Modal
        open={loadPopup}
        onClose={() => save({ loadSkipped: true })}
        size="sm"
        icon={<span className="rest-ico is-warn"><Gauge size={18} /></span>}
        title="The robot PC is busy"
        description={`System load ${lv.load?.toFixed(1)} (5-minute average), warning from ${REST_LIMITS.loadWarn}.`}
        footer={<Button variant="primary" onClick={() => save({ loadSkipped: true })}>OK</Button>}
      >
        <p className="rest-text">
          Close pages and tools that are not needed (extra browser tabs, 3D views, recordings). If it keeps rising, plan a rest for the robot PC.
          Above {REST_LIMITS.loadCrit} it becomes a critical reminder.
        </p>
      </Modal>
      {crit.length > 0 && (
        <div className="rest-crit-stack">
          {crit.map((c) => (c.key === "uptime" ? <UptimeCritical key="u" lv={lv} {...c} /> : <LoadCritical key="l" lv={lv} {...c} />))}
        </div>
      )}
    </>
  );
}

function CriticalCard({ icon: Icon, title, short, children, min, setMin }) {
  if (min)
    return (
      <button type="button" className="rest-pill" onClick={() => setMin(false)} title={`${title}. Click to show.`}>
        <Icon size={15} />
        <span>{short}</span>
        <ChevronUp size={14} />
      </button>
    );
  return (
    <div className="rest-card" role="alert">
      <div className="rest-card-head">
        <span className="rest-ico is-crit"><Icon size={18} /></span>
        <span className="rest-card-title grow">{title}</span>
        <IconButton icon={Minimize2} label="Minimise" size="sm" onClick={() => setMin(true)} />
      </div>
      <div className="rest-text">{children}</div>
    </div>
  );
}

function UptimeCritical({ lv, min, setMin }) {
  return (
    <CriticalCard icon={AlarmClock} title="Robot needs a rest" short={`Rest needed · up ${lv.secs != null ? fmtHours(lv.secs) : "24 h+"}`} min={min} setMin={setMin}>
      Running for <b>{lv.secs != null ? fmtHours(lv.secs) : "more than 24 hours"}</b> without a break. Stop the program and give the robot a <b>30 minute</b> rest. This
      reminder stays until the robot PC is restarted.
    </CriticalCard>
  );
}

function LoadCritical({ lv, min, setMin }) {
  return (
    <CriticalCard icon={Activity} title="Robot PC overloaded" short={`Load ${lv.load?.toFixed(1)}`} min={min} setMin={setMin}>
      System load is <b>{lv.load?.toFixed(1)}</b> (5-minute average, critical above {REST_LIMITS.loadCrit}). Motion and the program can lag. Close extra pages and tools, and
      give the robot PC a <b>30 minute</b> rest if it stays this high.
    </CriticalCard>
  );
}
