import { RotateCcw } from "lucide-react";
import { IconButton } from "../../components/ui";
import { errorMessage } from "../../lib/api";
import { useSettings } from "../../lib/queries";
import { confirm } from "../../store/confirm";
import { toast } from "../../store/toast";
import { useRobot } from "../../store/robot";
import { resetTotal, useClientState } from "./clientState";

const avg = (list) => (list.length ? list.reduce((a, b) => a + b, 0) / list.length : null);
const fmt = (v) => (v == null ? "—" : v.toFixed(2));

function Tile({ label, value, unit, hint, action, accent }) {
  return (
    <div className={`cc-kpi ${accent ? "is-accent" : ""}`} title={hint}>
      <span className="cc-kpi-label">
        {label}
        {action}
      </span>
      <span className="cc-kpi-value tabular">
        {value}
        {unit && value !== "—" && <small>{unit}</small>}
      </span>
    </div>
  );
}

/** Cycle times of the last cycles as a small line chart. */
function Sparkline({ values }) {
  if (values.length < 2) return <div className="cc-spark is-empty" data-tut="cc-spark">Cycle times appear here after two cycles</div>;
  const w = 220;
  const h = 40;
  const max = Math.max(...values);
  const min = Math.min(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => [(i / (values.length - 1)) * w, h - 4 - ((v - min) / span) * (h - 8)]);
  const line = pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  return (
    <div className="cc-spark" data-tut="cc-spark" title={`Last ${values.length} cycle times: ${min.toFixed(2)} – ${max.toFixed(2)} s`}>
      <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
        <polygon points={`0,${h} ${line} ${w},${h}`} className="cc-spark-fill" />
        <polyline points={line} className="cc-spark-line" />
        <circle cx={pts[pts.length - 1][0]} cy={pts[pts.length - 1][1]} r="3" className="cc-spark-dot" />
      </svg>
      <span className="cc-spark-range">
        {min.toFixed(1)}–{max.toFixed(1)} s
      </span>
    </div>
  );
}

/** Cycle counters and cycle-time analytics: one strip at the bottom of the control deck. */
export default function ProductionStrip() {
  const { data: settings } = useSettings();
  const currentOps = useClientState((s) => s.currentOps);
  const cycleTimes = useRobot((s) => s.cycleTimes);
  const valid = cycleTimes.filter((t) => t > 0 && t < 300);
  const last = valid.length ? valid[valid.length - 1] : null;

  const reset = async () => {
    if (
      !(await confirm({
        title: "Reset total operations?",
        message: `The total counter (${settings?.total_operations ?? 0}) goes back to 0. This cannot be undone.`,
        tone: "danger",
        confirmLabel: "Reset",
      }))
    )
      return;
    try {
      await resetTotal();
      toast.success("Total operations reset to 0");
    } catch (err) {
      toast.error(errorMessage(err, "Could not reset the counter"));
    }
  };

  return (
    <div className="cc-prod" data-tut="cc-production">
      <div className="cc-kpis" data-tut="cc-kpis">
        <Tile accent label="This session" value={currentOps} hint="Cycles finished since this app was opened" />
        <Tile label="Last session" value={settings?.last_session_operations ?? 0} hint="Stored cycle count of the previous session" />
        <Tile
          label="Total"
          value={settings?.total_operations ?? 0}
          hint="All cycles counted on this robot"
          action={<IconButton icon={RotateCcw} label="Reset total to 0" size="sm" onClick={reset} className="cc-tile-action" data-tut="cc-reset-total" />}
        />
        <Tile label="Last cycle" value={fmt(last)} unit="s" />
        <Tile label="Avg 5" value={fmt(avg(valid.slice(-5)))} unit="s" hint="Average of the last 5 cycles" />
        <Tile label="Avg 15" value={fmt(avg(valid.slice(-15)))} unit="s" hint="Average of the last 15 cycles" />
      </div>
      <Sparkline values={valid.slice(-30)} />
    </div>
  );
}
