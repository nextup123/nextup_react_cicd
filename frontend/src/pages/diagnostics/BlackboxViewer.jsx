// Black-box viewer: one supervisor recording (the joint data around an
// emergency) in a floating window. Chart: a panel per signal group (position,
// velocity, commands, jog) with lanes for the supervisor flags, drive status
// words and modes; drag across to zoom, click to put the cursor, the readout
// lists every value at the cursor and the moments something changed. Table:
// every column, filter by group / joint / rows that change; double-click a
// cell to edit it, tick rows to remove them. Edits stay in the view until
// downloaded or saved as a copy next to the original (never overwritten).
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { scaleLinear } from "d3";
import { BarChart3, Crosshair, Download, Eraser, HardDriveDownload, ListFilter, RotateCcw, Save, Table2, Trash2, Undo2, ZoomIn, ZoomOut } from "lucide-react";
import FloatingWindow from "../../components/ui/FloatingWindow";
import { Alert, Badge, Button, Checkbox, EmptyState, Input, Loading, Segmented, Switch, cx } from "../../components/ui";
import { confirm } from "../../store/confirm";
import { toast } from "../../store/toast";
import {
  GROUPS, LINE_GROUPS, STATE_COLS, activeColumns, cia402, columnInfo, findChanges, laneText, laneTone, lowerIndex, nearest, parseBlackbox, stats, timesOf, toCsv, toNum,
} from "./blackboxData";
import "./blackbox.css";

const JOINT_COLORS = ["#2563eb", "#dc2626", "#16a34a", "#d97706", "#9333ea", "#0891b2", "#db2777", "#65a30d"];
const OTHER_COLORS = ["#475467", "#7c3aed", "#0d9488", "#b45309", "#be123c"];
const LEFT = 92;
const RIGHT = 14;
const PANEL_H = 150;
const LANE_H = 18;
const DEG = 180 / Math.PI;
const VIEW_KEY = "nextup.blackbox.view";

const fmtT = (t) => (Number.isFinite(t) ? `${t >= 0 ? "+" : "−"}${Math.abs(t).toFixed(4)} s` : "–");
const colorOf = (col, k) => {
  const info = columnInfo(col);
  return info.joint ? JOINT_COLORS[(info.joint - 1) % JOINT_COLORS.length] : OTHER_COLORS[k % OTHER_COLORS.length];
};
function readView() {
  try {
    return localStorage.getItem(VIEW_KEY) === "table" ? "table" : "chart";
  } catch {
    return "chart";
  }
}

function useWidth() {
  const ref = useRef(null);
  const [w, setW] = useState(800);
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(([e]) => setW(Math.max(200, Math.floor(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

/** Line path with min/max per pixel when there are more points than pixels. */
function seriesPath(times, vals, i0, i1, x, y, width) {
  const n = i1 - i0 + 1;
  let d = "";
  let pen = false;
  const move = (px, py) => {
    d += `${pen ? "L" : "M"}${px.toFixed(1)},${py.toFixed(1)}`;
    pen = true;
  };
  if (n <= width * 2) {
    for (let i = i0; i <= i1; i++) {
      const v = vals[i];
      if (!Number.isFinite(v)) {
        pen = false;
        continue;
      }
      move(x(times[i]), y(v));
    }
    return d;
  }
  const per = n / width;
  for (let b = 0; b < width; b++) {
    const a = i0 + Math.floor(b * per);
    const e = Math.min(i1, i0 + Math.floor((b + 1) * per) - 1);
    let lo = Infinity;
    let hi = -Infinity;
    let iLo = a;
    let iHi = a;
    for (let i = a; i <= e; i++) {
      const v = vals[i];
      if (!Number.isFinite(v)) continue;
      if (v < lo) {
        lo = v;
        iLo = i;
      }
      if (v > hi) {
        hi = v;
        iHi = i;
      }
    }
    if (lo === Infinity) {
      pen = false;
      continue;
    }
    const [f, s] = iLo <= iHi ? [lo, hi] : [hi, lo];
    move(x(times[Math.min(iLo, iHi)]), y(f));
    move(x(times[Math.max(iLo, iHi)]), y(s));
  }
  return d;
}

/* ───────────── chart ───────────── */

const LinePanel = memo(function LinePanel({ title, unit, cols, colIdx, numeric, times, i0, i1, x, width, hover, cursor, focusJoint, deg }) {
  const series = cols.map((c) => {
    const k = colIdx[c];
    const conv = deg && GROUPS[columnInfo(c).group]?.angle ? DEG : 1;
    return { c, vals: conv === 1 ? numeric[k] : numeric[k].map((v) => v * conv), color: colorOf(c, k), joint: columnInfo(c).joint };
  });
  let lo = Infinity;
  let hi = -Infinity;
  for (const s of series)
    for (let i = i0; i <= i1; i++) {
      const v = s.vals[i];
      if (Number.isFinite(v)) {
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
    }
  if (lo === Infinity) {
    lo = -1;
    hi = 1;
  }
  if (hi - lo < 1e-9) {
    const p = Math.abs(hi) * 0.05 || 0.001;
    lo -= p;
    hi += p;
  }
  const pad = (hi - lo) * 0.08;
  const y = scaleLinear().domain([lo - pad, hi + pad]).range([PANEL_H - 18, 8]);
  const ticks = y.ticks(4);
  const xt = x.ticks(Math.max(2, Math.floor(width / 110)));
  const shownUnit = deg && unit.startsWith("rad") ? unit.replace("rad", "°") : unit;
  return (
    <div className="bb-panel">
      <div className="bb-panel-head">
        <span className="bb-panel-title">{title}</span>
        <span className="xs muted">{shownUnit}</span>
        <span className="bb-legend">
          {series.map((s) => (
            <span key={s.c} className={cx("bb-legend-item", focusJoint && s.joint === focusJoint && "is-focus")}>
              <i style={{ background: s.color }} />
              {s.joint ? `J${s.joint}` : s.c}
            </span>
          ))}
        </span>
      </div>
      <svg width={width} height={PANEL_H} className="bb-svg">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={LEFT} x2={width - RIGHT} y1={y(t)} y2={y(t)} className="bb-grid" />
            <text x={LEFT - 6} y={y(t) + 3.5} className="bb-tick" textAnchor="end">{+t.toPrecision(4)}</text>
          </g>
        ))}
        {xt.map((t) => (
          <g key={`x${t}`}>
            <line x1={x(t)} x2={x(t)} y1={8} y2={PANEL_H - 18} className="bb-grid" />
            <text x={x(t)} y={PANEL_H - 5} className="bb-tick" textAnchor="middle">{+t.toFixed(3)}</text>
          </g>
        ))}
        <clipPath id={`clip-${title}`}>
          <rect x={LEFT} y={0} width={Math.max(0, width - LEFT - RIGHT)} height={PANEL_H} />
        </clipPath>
        <g clipPath={`url(#clip-${title})`}>
          {series.map((s) => (
            <path key={s.c} d={seriesPath(times, s.vals, i0, i1, x, y, width - LEFT - RIGHT)} stroke={s.color} className={cx("bb-line", focusJoint && s.joint === focusJoint && "is-focus")} />
          ))}
        </g>
        <Markers x={x} times={times} hover={hover} cursor={cursor} h={PANEL_H - 18} />
        {hover >= 0 &&
          series.map((s) =>
            Number.isFinite(s.vals[hover]) ? <circle key={s.c} cx={x(times[hover])} cy={y(s.vals[hover])} r={3} fill={s.color} className="bb-dot" /> : null
          )}
      </svg>
    </div>
  );
});

function Markers({ x, times, hover, cursor, h }) {
  const [a, b] = x.domain();
  const r = x.range();
  return (
    <>
      {a <= 0 && b >= 0 && <line x1={x(0)} x2={x(0)} y1={0} y2={h} className="bb-trigger" />}
      {cursor >= 0 && times[cursor] >= a && times[cursor] <= b && <line x1={x(times[cursor])} x2={x(times[cursor])} y1={0} y2={h} className="bb-cursor" />}
      {hover >= 0 && x(times[hover]) >= r[0] && <line x1={x(times[hover])} x2={x(times[hover])} y1={0} y2={h} className="bb-hover" />}
    </>
  );
}

const Lanes = memo(function Lanes({ title, cols, colIdx, rows, times, i0, i1, x, width, hover, cursor }) {
  const h = cols.length * LANE_H + 4;
  return (
    <div className="bb-panel">
      <div className="bb-panel-head">
        <span className="bb-panel-title">{title}</span>
      </div>
      <svg width={width} height={h} className="bb-svg">
        {cols.map((c, li) => {
          const k = colIdx[c];
          const segs = [];
          let s = i0;
          for (let i = i0 + 1; i <= i1 + 1; i++) {
            if (i > i1 || rows[i].v[k] !== rows[s].v[k]) {
              segs.push({ a: s, b: i <= i1 ? i : i1, v: rows[s].v[k] });
              s = i;
            }
          }
          const y0 = li * LANE_H + 2;
          return (
            <g key={c}>
              <text x={LEFT - 6} y={y0 + 12} className="bb-lane-name" textAnchor="end">{c.replace(/_joint(\d+)$/, " J$1")}</text>
              {segs.map((g, i) => {
                const xa = Math.max(LEFT, x(times[g.a]));
                const xb = Math.min(width - RIGHT, x(times[g.b]));
                if (xb <= xa - 0.5) return null;
                const label = laneText(c, g.v);
                return (
                  <g key={i}>
                    <rect x={xa} y={y0} width={Math.max(0.8, xb - xa)} height={LANE_H - 3} rx={2} className={`bb-lane bb-tone-${laneTone(c, g.v)}`}>
                      <title>{`${c}: ${label}\n${fmtT(times[g.a])} … ${fmtT(times[g.b])}`}</title>
                    </rect>
                    {xb - xa > label.length * 5.6 + 8 && (
                      <text x={xa + 4} y={y0 + 11.5} className="bb-lane-text">{label}</text>
                    )}
                  </g>
                );
              })}
            </g>
          );
        })}
        <Markers x={x} times={times} hover={hover} cursor={cursor} h={h} />
      </svg>
    </div>
  );
});

function Picker({ columns, timeCol, selected, setSelected, active }) {
  const joints = [...new Set(columns.map((c) => columnInfo(c).joint).filter(Boolean))].sort((a, b) => a - b);
  const has = (g, j) => columns.includes(`${g}_joint${j}`) || (g === "q" && columns.includes(`joint${j}`));
  const colName = (g, j) => (columns.includes(`${g}_joint${j}`) ? `${g}_joint${j}` : `joint${j}`);
  const toggle = (c, on) =>
    setSelected((s) => {
      const n = new Set(s);
      if (on) n.add(c);
      else n.delete(c);
      return n;
    });
  const groups = [...LINE_GROUPS, "statusword", "mode"].filter((g) => joints.some((j) => has(g, j)));
  const state = columns.filter((c) => STATE_COLS.includes(c));
  const other = columns.filter((c, i) => i !== timeCol && columnInfo(c).group === "other");
  const groupAll = (g, on) => joints.forEach((j) => has(g, j) && toggle(colName(g, j), on));
  return (
    <div className="bb-picker" data-tut="dg-bb-picker">
      <div className="section-label">Signals</div>
      <table className="bb-matrix">
        <thead>
          <tr>
            <th />
            {joints.map((j) => (
              <th key={j} style={{ color: JOINT_COLORS[(j - 1) % JOINT_COLORS.length] }}>J{j}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {groups.map((g) => {
            const all = joints.filter((j) => has(g, j)).every((j) => selected.has(colName(g, j)));
            return (
              <tr key={g}>
                <th>
                  <button type="button" className="bb-group-btn" title={`${GROUPS[g].long}: all joints on / off`} onClick={() => groupAll(g, !all)}>{GROUPS[g].label}</button>
                </th>
                {joints.map((j) => {
                  const c = colName(g, j);
                  return (
                    <td key={j}>
                      {has(g, j) && (
                        <input type="checkbox" checked={selected.has(c)} onChange={(e) => toggle(c, e.target.checked)} title={`${c}${active.has(c) ? "" : " (no change in this recording)"}`} className={cx(!active.has(c) && "is-flat")} />
                      )}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
      {state.length > 0 && (
        <>
          <div className="section-label">Supervisor</div>
          <div className="bb-pick-list">
            {state.map((c) => (
              <Checkbox key={c} checked={selected.has(c)} onChange={(v) => toggle(c, v)} label={<span className={cx("small", !active.has(c) && "muted")}>{c}</span>} />
            ))}
          </div>
        </>
      )}
      {other.length > 0 && (
        <>
          <div className="section-label">Other columns</div>
          <div className="bb-pick-list">
            {other.map((c) => (
              <Checkbox key={c} checked={selected.has(c)} onChange={(v) => toggle(c, v)} label={<span className={cx("small mono", !active.has(c) && "muted")}>{c}</span>} />
            ))}
          </div>
        </>
      )}
      <div className="bb-pick-actions">
        <Button size="sm" variant="ghost" onClick={() => setSelected(new Set([...active].filter((c) => c !== columns[timeCol])))} title="Every column that changes in this recording">Changing only</Button>
        <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>None</Button>
      </div>
    </div>
  );
}

function Readout({ doc, rows, times, idx, selected, deg, changes, onJump, range }) {
  const r = idx >= 0 ? rows[idx] : null;
  const i0 = lowerIndex(times, range[0]);
  const i1 = Math.max(i0, lowerIndex(times, range[1]) - 1);
  const shown = doc.columns.filter((c, k) => k !== doc.timeCol && selected.has(c));
  return (
    <div className="bb-readout" data-tut="dg-bb-readout">
      <div className="section-label">{idx >= 0 ? `Row ${idx + 1} · ${fmtT(times[idx])}` : "Move over the chart"}</div>
      {r && (
        <div className="bb-values">
          {shown.map((c) => {
            const k = doc.columns.indexOf(c);
            const info = columnInfo(c);
            const raw = r.v[k];
            const n = toNum(raw);
            const val = info.group === "statusword" ? `${raw} · ${cia402(raw).text}` : GROUPS[info.group]?.lane || STATE_COLS.includes(c) ? laneText(c, raw) : Number.isFinite(n) ? (deg && GROUPS[info.group]?.angle ? `${(n * DEG).toFixed(3)}°` : raw) : raw === "" ? "–" : raw;
            return (
              <div key={c} className="bb-value">
                <span className="bb-value-k" style={info.joint ? { color: JOINT_COLORS[(info.joint - 1) % JOINT_COLORS.length] } : undefined}>{c}</span>
                <span className="mono">{val}</span>
              </div>
            );
          })}
        </div>
      )}
      {shown.some((c) => !GROUPS[columnInfo(c).group]?.lane && !STATE_COLS.includes(c)) && (
        <>
          <div className="section-label">In view (min · max)</div>
          <div className="bb-values">
            {shown
              .filter((c) => !GROUPS[columnInfo(c).group]?.lane && !STATE_COLS.includes(c))
              .map((c) => {
                const st = stats(rows, doc.columns.indexOf(c), i0, i1);
                const f = deg && GROUPS[columnInfo(c).group]?.angle ? DEG : 1;
                return (
                  <div key={c} className="bb-value">
                    <span className="bb-value-k">{c}</span>
                    <span className="mono xs">{st ? `${+(st.min * f).toFixed(4)} · ${+(st.max * f).toFixed(4)}` : "–"}</span>
                  </div>
                );
              })}
          </div>
        </>
      )}
      <div className="section-label">Changes ({changes.length})</div>
      <div className="bb-changes">
        {!changes.length && <span className="xs muted">No supervisor flag, status word or mode changes.</span>}
        {changes.slice(0, 400).map((ch, i) => (
          <button key={i} type="button" className={cx("bb-change", idx === ch.i && "is-on", ch.t >= 0 && changes[i - 1]?.t < 0 && "is-first-after")} onClick={() => onJump(ch.i)} title={`${laneText(ch.col, ch.from)} → ${laneText(ch.col, ch.to)}`}>
            <span className="mono xs">{fmtT(ch.t)}</span>
            <span className="small">{ch.col.replace(/_joint(\d+)$/, " J$1")}</span>
            <span className="xs muted mono">{ch.from || "–"} → {ch.to || "–"}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function ChartView({ doc, rows, times, numeric, colIdx, selected, setSelected, active, cursor, setCursor, focusJoint, changes }) {
  const [wrapRef, width] = useWidth();
  const full = useMemo(() => [times[0] ?? 0, times[times.length - 1] ?? 1], [times]);
  const [range, setRange] = useState(full);
  const [deg, setDeg] = useState(true);
  const [hover, setHover] = useState(-1);
  const [sel, setSel] = useState(null); // drag-zoom box in px
  const drag = useRef(null);
  useEffect(() => setRange(full), [full]);

  const x = useMemo(() => scaleLinear().domain(range).range([LEFT, width - RIGHT]), [range, width]);
  const i0 = Math.max(0, lowerIndex(times, range[0]) - 1);
  const i1 = Math.min(times.length - 1, lowerIndex(times, range[1]));

  const toT = (clientX) => {
    const box = wrapRef.current.getBoundingClientRect();
    return x.invert(Math.min(width - RIGHT, Math.max(LEFT, clientX - box.left)));
  };
  const onDown = (e) => {
    if (e.button !== 0) return;
    const box = wrapRef.current.getBoundingClientRect();
    drag.current = { x0: e.clientX - box.left };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onMove = (e) => {
    const t = toT(e.clientX);
    setHover(nearest(times, t));
    if (drag.current) {
      const box = wrapRef.current.getBoundingClientRect();
      const x1 = e.clientX - box.left;
      if (Math.abs(x1 - drag.current.x0) > 4) setSel([Math.min(drag.current.x0, x1), Math.max(drag.current.x0, x1)]);
    }
  };
  const onUp = (e) => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (sel && sel[1] - sel[0] > 6) {
      const a = x.invert(Math.max(LEFT, sel[0]));
      const b = x.invert(Math.min(width - RIGHT, sel[1]));
      if (b - a > 1e-6) setRange([a, b]);
    } else setCursor(nearest(times, toT(e.clientX)));
    setSel(null);
  };
  const zoom = (f, at) => {
    const [a, b] = range;
    const c = at ?? (a + b) / 2;
    const na = Math.max(full[0], c - (c - a) * f);
    const nb = Math.min(full[1], c + (b - c) * f);
    setRange(nb - na < 1e-5 ? range : [na, nb]);
  };
  const onWheel = (e) => {
    if (!e.ctrlKey && !e.shiftKey) return;
    e.preventDefault();
    zoom(e.deltaY > 0 ? 1.25 : 0.8, toT(e.clientX));
  };
  const around = (t, half) => setRange([Math.max(full[0], t - half), Math.min(full[1], t + half)]);

  const panels = [];
  for (const g of LINE_GROUPS) {
    const cols = doc.columns.filter((c) => selected.has(c) && columnInfo(c).group === g);
    if (cols.length) panels.push({ type: "line", g, cols });
  }
  const other = doc.columns.filter((c, k) => k !== doc.timeCol && selected.has(c) && columnInfo(c).group === "other");
  const otherNum = other.filter((c) => numeric[colIdx[c]].some(Number.isFinite));
  if (otherNum.length) panels.push({ type: "line", g: "other", cols: otherNum });
  const laneCols = {
    state: doc.columns.filter((c) => selected.has(c) && STATE_COLS.includes(c)),
    statusword: doc.columns.filter((c) => selected.has(c) && columnInfo(c).group === "statusword"),
    mode: doc.columns.filter((c) => selected.has(c) && columnInfo(c).group === "mode"),
    other: other.filter((c) => !otherNum.includes(c)),
  };

  return (
    <div className="bb-chart-view">
      <Picker columns={doc.columns} timeCol={doc.timeCol} selected={selected} setSelected={setSelected} active={active} />
      <div className="bb-charts">
        <div className="bb-chart-tools" data-tut="dg-bb-tools">
          <Button size="sm" variant="ghost" icon={ZoomIn} onClick={() => zoom(0.5, cursor >= 0 ? times[cursor] : undefined)}>Zoom in</Button>
          <Button size="sm" variant="ghost" icon={ZoomOut} onClick={() => zoom(2)}>Zoom out</Button>
          <Button size="sm" variant="ghost" icon={RotateCcw} onClick={() => setRange(full)} disabled={range[0] === full[0] && range[1] === full[1]}>Full</Button>
          <Button size="sm" variant="ghost" icon={Crosshair} onClick={() => around(0, 0.25)} disabled={full[0] > 0 || full[1] < 0} title="Show ±250 ms around the trigger">Trigger ±0.25 s</Button>
          <span className="grow xs muted">{fmtT(range[0])} … {fmtT(range[1])} · drag across to zoom, click for the cursor, Ctrl + wheel zooms</span>
          <Switch size="sm" checked={deg} onChange={setDeg} label="Degrees" title="Show joint angles and speeds in degrees (the file holds radians)" />
        </div>
        <div className="bb-chart-scroll">
          <div ref={wrapRef} className="bb-chart-area" data-tut="dg-bb-chart" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerLeave={() => !drag.current && setHover(-1)} onWheel={onWheel}>
            {!panels.length && !Object.values(laneCols).some((l) => l.length) && <EmptyState compact icon={BarChart3} title="Pick signals on the left" />}
            {panels.map((p) => (
              <LinePanel key={p.g} title={p.g === "other" ? "Other" : GROUPS[p.g].long} unit={GROUPS[p.g].unit || ""} cols={p.cols} colIdx={colIdx} numeric={numeric} times={times} i0={i0} i1={i1} x={x} width={width} hover={hover} cursor={cursor} focusJoint={focusJoint} deg={deg} />
            ))}
            {laneCols.state.length > 0 && <Lanes title="Supervisor" cols={laneCols.state} colIdx={colIdx} rows={rows} times={times} i0={i0} i1={i1} x={x} width={width} hover={hover} cursor={cursor} />}
            {laneCols.statusword.length > 0 && <Lanes title="Drive state (statusword)" cols={laneCols.statusword} colIdx={colIdx} rows={rows} times={times} i0={i0} i1={i1} x={x} width={width} hover={hover} cursor={cursor} />}
            {laneCols.mode.length > 0 && <Lanes title="Drive mode of operation" cols={laneCols.mode} colIdx={colIdx} rows={rows} times={times} i0={i0} i1={i1} x={x} width={width} hover={hover} cursor={cursor} />}
            {laneCols.other.length > 0 && <Lanes title="Other" cols={laneCols.other} colIdx={colIdx} rows={rows} times={times} i0={i0} i1={i1} x={x} width={width} hover={hover} cursor={cursor} />}
            {sel && <div className="bb-zoombox" style={{ left: sel[0], width: sel[1] - sel[0] }} />}
          </div>
        </div>
      </div>
      <Readout
        doc={doc}
        rows={rows}
        times={times}
        idx={hover >= 0 ? hover : cursor}
        selected={selected}
        deg={deg}
        changes={changes}
        range={range}
        onJump={(i) => {
          setCursor(i);
          if (times[i] < range[0] || times[i] > range[1]) around(times[i], (range[1] - range[0]) / 2);
        }}
      />
    </div>
  );
}

/* ───────────── table ───────────── */

const ROW_H = 26;
const TABLE_GROUPS = ["state", ...LINE_GROUPS, "statusword", "mode", "other"];

function TableView({ doc, rows, times, edited, selectedRows, setSelectedRows, onEdit, cursor, setCursor, focusJoint }) {
  const [groups, setGroups] = useState(() => new Set(["state", "q", "qd", "statusword"]));
  const allJoints = useMemo(() => [...new Set(doc.columns.map((c) => columnInfo(c).joint).filter(Boolean))].sort((a, b) => a - b), [doc.columns]);
  const [joints, setJoints] = useState(() => new Set(allJoints));
  const [changedOnly, setChangedOnly] = useState(false);
  const [jump, setJump] = useState("");
  const [editing, setEditing] = useState(null); // { id, k, value }
  const [scroll, setScroll] = useState(0);
  const [height, setHeight] = useState(400);
  const box = useRef(null);
  const lastClick = useRef(null);

  useEffect(() => {
    const el = box.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(([e]) => setHeight(e.contentRect.height));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const cols = useMemo(
    () =>
      doc.columns
        .map((c, k) => ({ c, k, info: columnInfo(c) }))
        .filter((x) => x.k !== doc.timeCol && groups.has(x.info.group) && (!x.info.joint || joints.has(x.info.joint))),
    [doc.columns, doc.timeCol, groups, joints]
  );
  const view = useMemo(() => {
    if (!changedOnly) return rows.map((_, i) => i);
    const out = [0];
    for (let i = 1; i < rows.length; i++) if (cols.some((x) => rows[i].v[x.k] !== rows[i - 1].v[x.k])) out.push(i);
    return out;
  }, [rows, cols, changedOnly]);
  const trigger = useMemo(() => (times.length ? nearest(times, 0) : -1), [times]);

  const scrollToRow = useCallback(
    (i) => {
      const pos = view.indexOf(i) >= 0 ? view.indexOf(i) : view.findIndex((r) => r >= i);
      if (pos >= 0 && box.current) box.current.scrollTop = Math.max(0, pos * ROW_H - height / 2);
    },
    [view, height]
  );
  useEffect(() => {
    if (cursor >= 0) scrollToRow(cursor);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cursor]);

  const first = Math.max(0, Math.floor(scroll / ROW_H) - 15);
  const last = Math.min(view.length, Math.ceil((scroll + height) / ROW_H) + 15);
  const slice = view.slice(first, last);
  const allSel = view.length > 0 && view.every((i) => selectedRows.has(rows[i].id));

  const clickRow = (e, i) => {
    const id = rows[i].id;
    const from = lastClick.current;
    const shift = e.shiftKey;
    setSelectedRows((s) => {
      const n = new Set(s);
      if (shift && from !== null && view.indexOf(from) >= 0) {
        const a = view.indexOf(from);
        const b = view.indexOf(i);
        const on = !s.has(id);
        for (let p = Math.min(a, b); p <= Math.max(a, b); p++) on ? n.add(rows[view[p]].id) : n.delete(rows[view[p]].id);
      } else if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
    lastClick.current = i;
  };
  const commit = () => {
    if (!editing) return;
    onEdit(editing.id, editing.k, editing.value.trim());
    setEditing(null);
  };
  const toggleGroup = (g) =>
    setGroups((s) => {
      const n = new Set(s);
      n.has(g) ? n.delete(g) : n.add(g);
      return n;
    });
  const groupsPresent = TABLE_GROUPS.filter((g) => doc.columns.some((c, k) => k !== doc.timeCol && columnInfo(c).group === g));

  return (
    <div className="bb-table-view">
      <div className="bb-table-tools" data-tut="dg-bb-table-tools">
        <ListFilter size={14} className="muted" />
        {groupsPresent.map((g) => (
          <button key={g} type="button" className={cx("bb-chip", groups.has(g) && "is-on")} onClick={() => toggleGroup(g)} title={GROUPS[g].long}>{GROUPS[g].label}</button>
        ))}
        <span className="bb-sep" />
        {allJoints.map((j) => (
          <button key={j} type="button" className={cx("bb-chip", joints.has(j) && "is-on", focusJoint === j && "is-focus")} style={{ "--chip": JOINT_COLORS[(j - 1) % JOINT_COLORS.length] }} onClick={() => setJoints((s) => { const n = new Set(s); n.has(j) ? n.delete(j) : n.add(j); return n; })}>J{j}</button>
        ))}
        <span className="bb-sep" />
        <Switch size="sm" checked={changedOnly} onChange={setChangedOnly} label="Only rows that change" title="Hide rows where no shown column differs from the row before" />
        <span className="grow" />
        <form
          className="bb-jump"
          onSubmit={(e) => {
            e.preventDefault();
            const t = Number(jump);
            if (Number.isFinite(t)) setCursor(nearest(times, t));
          }}
        >
          <Input size="sm" value={jump} onChange={(e) => setJump(e.target.value)} placeholder="Go to time (s)" />
        </form>
        <Button size="sm" variant="ghost" icon={Crosshair} onClick={() => setCursor(trigger)} disabled={trigger < 0}>Trigger</Button>
      </div>
      <div className="bb-table-box" data-tut="dg-bb-table" ref={box} onScroll={(e) => setScroll(e.currentTarget.scrollTop)}>
        <table className="bb-table">
          <thead>
            <tr>
              <th className="bb-sticky bb-col-sel">
                <input type="checkbox" checked={allSel} onChange={(e) => setSelectedRows((s) => { const n = new Set(s); view.forEach((i) => (e.target.checked ? n.add(rows[i].id) : n.delete(rows[i].id))); return n; })} title="Select every shown row" />
              </th>
              <th className="bb-sticky bb-col-n">#</th>
              <th className="bb-sticky bb-col-t">{doc.columns[doc.timeCol] || "t"}</th>
              {cols.map((x) => (
                <th key={x.k} title={GROUPS[x.info.group]?.long} style={x.info.joint ? { color: JOINT_COLORS[(x.info.joint - 1) % JOINT_COLORS.length] } : undefined}>
                  {x.c.replace(/_joint(\d+)$/, " J$1")}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {first > 0 && <tr style={{ height: first * ROW_H }} aria-hidden />}
            {slice.map((i) => {
              const r = rows[i];
              const sel = selectedRows.has(r.id);
              return (
                <tr key={r.id} className={cx(sel && "is-sel", i === cursor && "is-cursor", i === trigger && "is-trigger", times[i] > 0 && "is-after")} onClick={(e) => !e.target.closest("input") && setCursor(i)}>
                  <td className="bb-sticky bb-col-sel">
                    <input type="checkbox" checked={sel} onClick={(e) => { e.stopPropagation(); clickRow(e, i); }} onChange={() => {}} />
                  </td>
                  <td className="bb-sticky bb-col-n mono">{i + 1}</td>
                  <td className="bb-sticky bb-col-t mono">{r.v[doc.timeCol]}</td>
                  {cols.map((x) => {
                    const ek = `${r.id}:${x.k}`;
                    const isEd = editing && editing.id === r.id && editing.k === x.k;
                    const changed = i > 0 && rows[i - 1].v[x.k] !== r.v[x.k];
                    const val = r.v[x.k];
                    return (
                      <td
                        key={x.k}
                        className={cx("mono", edited.has(ek) && "is-edited", changed && "is-changed", x.info.group === "statusword" && `bb-sw bb-tone-${cia402(val).key}`)}
                        onDoubleClick={() => setEditing({ id: r.id, k: x.k, value: val })}
                        title={edited.has(ek) ? `was ${edited.get(ek) || "(empty)"}` : x.info.group === "statusword" ? cia402(val).text : undefined}
                      >
                        {isEd ? (
                          <input
                            autoFocus
                            className="bb-cell-input"
                            value={editing.value}
                            onChange={(e) => setEditing({ ...editing, value: e.target.value })}
                            onBlur={commit}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") commit();
                              if (e.key === "Escape") setEditing(null);
                            }}
                          />
                        ) : val === "" ? (
                          <span className="bb-empty">·</span>
                        ) : (
                          val
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
            {last < view.length && <tr style={{ height: (view.length - last) * ROW_H }} aria-hidden />}
          </tbody>
        </table>
      </div>
      <div className="bb-table-foot xs muted">
        {view.length} of {rows.length} rows · {cols.length} of {doc.columns.length - 1} columns · double-click a cell to edit · tick rows (Shift for a range) to remove them
      </div>
    </div>
  );
}

/* ───────────── window ───────────── */

export default function BlackboxViewer({ file, onClose, onSaved }) {
  const [doc, setDoc] = useState(null);
  const [error, setError] = useState(null);
  const [rows, setRows] = useState([]);
  const [edited, setEdited] = useState(() => new Map()); // "id:k" → original value
  const [removed, setRemoved] = useState(0);
  const [history, setHistory] = useState([]);
  const [selectedRows, setSelectedRows] = useState(() => new Set());
  const [selected, setSelected] = useState(() => new Set());
  const [cursor, setCursor] = useState(-1);
  const [mode, setModeState] = useState(readView);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let dead = false;
    setDoc(null);
    setError(null);
    fetch(`/robot/blackbox/${encodeURIComponent(file)}`)
      .then(async (r) => {
        if (!r.ok) throw new Error((await r.json().catch(() => null))?.message || `HTTP ${r.status}`);
        return r.text();
      })
      .then((text) => {
        if (dead) return;
        const d = parseBlackbox(text);
        if (!d.columns.length) throw new Error("The file has no columns");
        setDoc(d);
        setRows(d.rows);
        setEdited(new Map());
        setRemoved(0);
        setHistory([]);
        setSelectedRows(new Set());
        // default signals: the changing positions, the supervisor flags and the status words
        const act = activeColumns(d.columns, d.rows);
        const def = d.columns.filter((c, k) => k !== d.timeCol && (columnInfo(c).group === "q" || STATE_COLS.includes(c) || (columnInfo(c).group === "statusword" && act.has(c)) || (columnInfo(c).group === "qd" && act.has(c))));
        setSelected(new Set(def.length ? def : d.columns.filter((_, k) => k !== d.timeCol).slice(0, 6)));
        setCursor(-1);
      })
      .catch((err) => !dead && setError(err.message));
    return () => {
      dead = true;
    };
  }, [file]);

  const setMode = (m) => {
    setModeState(m);
    try {
      localStorage.setItem(VIEW_KEY, m);
    } catch {
      /* ignore */
    }
  };

  const times = useMemo(() => (doc ? timesOf(rows, doc.timeCol) : []), [doc, rows]);
  const numeric = useMemo(() => (doc ? doc.columns.map((_, k) => rows.map((r) => toNum(r.v[k]))) : []), [doc, rows]);
  const colIdx = useMemo(() => Object.fromEntries((doc?.columns || []).map((c, k) => [c, k])), [doc]);
  const active = useMemo(() => (doc ? activeColumns(doc.columns, rows) : new Set()), [doc, rows]);
  const changes = useMemo(() => (doc ? findChanges(doc.columns, rows, times) : []), [doc, rows, times]);
  const focusJoint = useMemo(() => {
    const m = /joint(\d+)/i.exec(doc?.meta?.cause || file);
    return m ? Number(m[1]) : 0;
  }, [doc, file]);

  const onEdit = useCallback(
    (id, k, value) => {
      const i = rows.findIndex((r) => r.id === id);
      if (i < 0 || rows[i].v[k] === value) return;
      const prev = rows[i].v[k];
      setHistory((h) => [...h, { type: "cell", id, k, prev, hadEdit: edited.has(`${id}:${k}`), orig: edited.get(`${id}:${k}`) }]);
      setEdited((m) => {
        const n = new Map(m);
        const key = `${id}:${k}`;
        if (!n.has(key)) n.set(key, prev);
        if (n.get(key) === value) n.delete(key);
        return n;
      });
      setRows((rs) => rs.map((r) => (r.id === id ? { ...r, v: r.v.map((x, j) => (j === k ? value : x)) } : r)));
    },
    [rows, edited]
  );

  const removeRows = async () => {
    const n = selectedRows.size;
    if (!n) return;
    if (n > 50 && !(await confirm({ title: `Remove ${n} rows from the view?`, message: "Undo brings them back. The file on the robot is not changed.", confirmLabel: "Remove" }))) return;
    const gone = [];
    rows.forEach((r, i) => selectedRows.has(r.id) && gone.push({ i, r }));
    setHistory((h) => [...h, { type: "rows", gone }]);
    setRows((rs) => rs.filter((r) => !selectedRows.has(r.id)));
    setRemoved((x) => x + gone.length);
    setSelectedRows(new Set());
    setCursor(-1);
  };

  const undo = () => {
    const last = history[history.length - 1];
    if (!last) return;
    setHistory((h) => h.slice(0, -1));
    if (last.type === "cell") {
      setRows((rs) => rs.map((r) => (r.id === last.id ? { ...r, v: r.v.map((x, j) => (j === last.k ? last.prev : x)) } : r)));
      setEdited((m) => {
        const n = new Map(m);
        const key = `${last.id}:${last.k}`;
        if (last.hadEdit) n.set(key, last.orig);
        else n.delete(key);
        return n;
      });
    } else {
      setRows((rs) => {
        const out = [...rs];
        for (const g of last.gone) out.splice(g.i, 0, g.r);
        return out;
      });
      setRemoved((x) => x - last.gone.length);
    }
  };

  const resetAll = async () => {
    if (!(await confirm({ title: "Drop every edit?", message: "The recording is shown as it is on the robot again.", confirmLabel: "Drop edits", tone: "danger" }))) return;
    setRows(doc.rows);
    setEdited(new Map());
    setRemoved(0);
    setHistory([]);
    setSelectedRows(new Set());
  };

  const dirty = edited.size > 0 || removed > 0;
  const note = dirty ? `edited in the NextUp console on ${new Date().toLocaleString()}: ${edited.size} cell(s) changed, ${removed} row(s) removed (from ${file})` : "";
  const download = () => {
    const blob = new Blob([toCsv(doc, rows, note)], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = dirty ? file.replace(/\.csv$/i, "_edited.csv") : file;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };
  const saveCopy = async () => {
    setSaving(true);
    try {
      const r = await fetch(`/robot/blackbox/${encodeURIComponent(file)}/copy`, { method: "POST", headers: { "Content-Type": "text/csv" }, body: toCsv(doc, rows, note) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.ok) throw new Error(j.message || `HTTP ${r.status}`);
      toast.success(j.message || "Copy saved", { title: "Black box" });
      onSaved?.();
    } catch (err) {
      toast.error(err.message, { title: "Copy not saved" });
    } finally {
      setSaving(false);
    }
  };

  const meta = doc?.meta || {};
  return (
    <FloatingWindow
      id="diag.blackbox"
      title="Black box"
      subtitle={meta.cause ? `${meta.cause} · ${meta.trigger_time || ""}` : file}
      icon={HardDriveDownload}
      size={{ w: Math.min(1400, window.innerWidth - 40), h: Math.min(820, window.innerHeight - 60) }}
      minSize={{ w: 640, h: 380 }}
      onClose={onClose}
      bodyClassName="bb-body"
    >
      {error ? (
        <div style={{ padding: 12 }}>
          <Alert tone="danger" title="Could not open the recording">{error}</Alert>
        </div>
      ) : !doc ? (
        <Loading label="Loading the recording…" />
      ) : (
        <>
          <div className="bb-head" data-tut="dg-bb-head">
            <Segmented size="sm" value={mode} onChange={setMode} options={[{ value: "chart", label: "Chart", icon: BarChart3 }, { value: "table", label: "Table", icon: Table2 }]} />
            <div className="bb-meta">
              {meta.cause && <Badge tone="danger">{meta.cause}</Badge>}
              <span className="small mono">{meta.trigger_time}</span>
              <span className="xs muted">{rows.length} rows{times.length ? ` · ${fmtT(times[0])} … ${fmtT(times[times.length - 1])}` : ""}{meta.window ? ` · ${meta.window}` : ""}</span>
              {dirty && <Badge tone="warning">{edited.size} edited · {removed} removed</Badge>}
            </div>
            <div className="bb-actions" data-tut="dg-bb-actions">
              {mode === "table" && (
                <Button size="sm" variant="ghost-danger" icon={Trash2} disabled={!selectedRows.size} onClick={removeRows}>
                  Remove {selectedRows.size || ""} row{selectedRows.size === 1 ? "" : "s"}
                </Button>
              )}
              <Button size="sm" variant="ghost" icon={Undo2} disabled={!history.length} onClick={undo}>Undo</Button>
              <Button size="sm" variant="ghost" icon={Eraser} disabled={!dirty} onClick={resetAll}>Reset</Button>
              <Button size="sm" icon={Download} onClick={download} title={dirty ? "Download the edited recording" : "Download the recording"}>CSV</Button>
              <Button size="sm" variant="primary" icon={Save} loading={saving} disabled={!dirty} onClick={saveCopy} title="Save the edited recording on the robot as a new file next to the original">Save copy</Button>
            </div>
          </div>
          {meta.units && <div className="bb-units xs muted" title={doc.metaLines.join("\n")}>{meta.units}{meta.phase ? ` · phase: ${meta.phase}` : ""}</div>}
          {mode === "chart" ? (
            <ChartView doc={doc} rows={rows} times={times} numeric={numeric} colIdx={colIdx} selected={selected} setSelected={setSelected} active={active} cursor={cursor} setCursor={setCursor} focusJoint={focusJoint} changes={changes} />
          ) : (
            <TableView doc={doc} rows={rows} times={times} edited={edited} selectedRows={selectedRows} setSelectedRows={setSelectedRows} onEdit={onEdit} cursor={cursor} setCursor={setCursor} focusJoint={focusJoint} />
          )}
        </>
      )}
    </FloatingWindow>
  );
}
