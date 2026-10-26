// 2D preview of the program's tool path from the taught coordinates: top,
// front or side view, every step in its motion colour, numbered step ends,
// the selected step highlighted, the robot's tool while it runs, and a
// "play" dot that runs the path in order. An approximation (PTP is drawn
// straight; the real joint move is curved) to see what a program does.
import { useEffect, useMemo, useRef, useState } from "react";
import { Pause, Play, Maximize2 } from "lucide-react";
import { Segmented, cx } from "../../components/ui";
import { buildPath } from "./programPath";
import { describeStep } from "./programRules";
import { useRobot } from "../../store/robot";

const VIEWS = [
  { value: "xy", label: "Top", axes: [0, 1], names: ["X", "Y"], tip: "Looking down: X right, Y up" },
  { value: "xz", label: "Front", axes: [0, 2], names: ["X", "Z"], tip: "From the front: X right, Z up" },
  { value: "yz", label: "Side", axes: [1, 2], names: ["Y", "Z"], tip: "From the side: Y right, Z up" },
];
const VIEW_KEY = "nextup.programs.view";

function niceStep(span) {
  const raw = span / 6;
  const p = 10 ** Math.floor(Math.log10(raw || 1));
  return [1, 2, 5, 10].map((m) => m * p).find((s) => s >= raw) || p * 10;
}

function useSize(ref) {
  const [size, setSize] = useState({ w: 400, h: 300 });
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([e]) => setSize({ w: Math.max(160, e.contentRect.width), h: Math.max(140, e.contentRect.height) }));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, [ref]);
  return size;
}

export default function PathPreview({ program, lookup, sel, runningStep, onSelect, callOffset, running }) {
  const [view, setView] = useState(() => {
    try {
      return localStorage.getItem(VIEW_KEY) || "xy";
    } catch {
      return "xy";
    }
  });
  const box = useRef(null);
  const { w, h } = useSize(box);
  const [hover, setHover] = useState(null);
  const [playing, setPlaying] = useState(false);
  const [playPos, setPlayPos] = useState(null);
  const cart = useRobot((s) => s.cartesian);

  const path = useMemo(() => buildPath(program, lookup, { callOffset }), [program, lookup, callOffset]);
  const V = VIEWS.find((v) => v.value === view) || VIEWS[0];
  const [ax, ay] = V.axes;

  const used = useMemo(() => {
    const names = new Set();
    program.steps.forEach((s) => [s.point, s.via, s.center, ...(s.points || [])].filter(Boolean).forEach((n) => names.add(n)));
    return [...names].map((n) => ({ name: n, q: lookup(n) })).filter((x) => x.q);
  }, [program, lookup]);

  // fit
  const fit = useMemo(() => {
    const pts = path.segments.flatMap((s) => s.pts).concat(used.map((u) => u.q.p));
    if (!pts.length) return null;
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const p of pts) {
      x0 = Math.min(x0, p[ax]);
      x1 = Math.max(x1, p[ax]);
      y0 = Math.min(y0, p[ay]);
      y1 = Math.max(y1, p[ay]);
    }
    const span = Math.max(x1 - x0, y1 - y0, 200); // a lone point still gets a sensible scale
    const pad = 34;
    const k = Math.min((w - 2 * pad) / Math.max(x1 - x0, span * 0.2, 200), (h - 2 * pad) / Math.max(y1 - y0, span * 0.2, 200));
    const cx0 = (x0 + x1) / 2, cy0 = (y0 + y1) / 2;
    return { k, cx0, cy0, span };
  }, [path, used, ax, ay, w, h]);

  const X = (p) => w / 2 + (p[ax] - fit.cx0) * fit.k;
  const Y = (p) => h / 2 - (p[ay] - fit.cy0) * fit.k;
  const poly = (pts) => pts.map((p) => `${X(p).toFixed(1)},${Y(p).toFixed(1)}`).join(" ");

  // play: a dot that runs the whole path at a constant on-screen speed
  const flat = useMemo(() => path.segments.flatMap((s) => s.pts.map((p) => ({ p, step: s.step }))), [path]);
  useEffect(() => {
    if (!playing || flat.length < 2) return undefined;
    let raf, i = 0, t0 = performance.now();
    const lens = [0];
    for (let k = 1; k < flat.length; k++) lens.push(lens[k - 1] + Math.hypot(...[0, 1, 2].map((d) => flat[k].p[d] - flat[k - 1].p[d])));
    const total = lens[lens.length - 1] || 1;
    const dur = Math.min(14000, Math.max(3500, total * 6));
    const tick = (now) => {
      const s = (((now - t0) % dur) / dur) * total;
      while (i < lens.length - 1 && lens[i + 1] < s) i++;
      if (lens[i] > s) i = 0;
      const a = flat[i], b = flat[Math.min(i + 1, flat.length - 1)];
      const f = lens[i + 1] > lens[i] ? (s - lens[i]) / (lens[i + 1] - lens[i]) : 0;
      setPlayPos({ p: [0, 1, 2].map((d) => a.p[d] + (b.p[d] - a.p[d]) * f), step: b.step });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      setPlayPos(null);
    };
  }, [playing, flat]);

  const robot = running && cart?.length >= 3 && cart.slice(0, 3).every((v) => Number.isFinite(Number(v))) ? [cart[0] * 10, cart[1] * 10, cart[2] * 10] : null;
  const missing = [...path.missing];
  const grid = fit ? niceStep(fit.span) : 100;

  const setV = (v) => {
    setView(v);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="mp-preview">
      <div className="mp-preview-bar" data-tut="mp-preview-bar">
        <Segmented size="sm" value={view} onChange={setV} options={VIEWS.map((v) => ({ value: v.value, label: v.label, title: v.tip }))} />
        <span className="grow" />
        <button type="button" data-tut="mp-play" className={cx("mp-tool", playing && "is-on")} onClick={() => setPlaying((p) => !p)} title={playing ? "Stop" : "Play the path in order"} disabled={flat.length < 2}>
          {playing ? <Pause size={14} /> : <Play size={14} />}
        </button>
        {fit && <span className="mp-scale">grid {grid} mm</span>}
      </div>
      <div ref={box} className="mp-preview-canvas" data-tut="mp-canvas">
        {!fit ? (
          <div className="mp-preview-empty">
            <Maximize2 size={18} />
            <span>{program.steps.length ? "No taught coordinates for these points yet. Teach them on Teach Points to see the path." : "Add steps to see the path."}</span>
          </div>
        ) : (
          <svg width={w} height={h} className="mp-svg" onMouseLeave={() => setHover(null)}>
            <g className="mp-grid">
              {(() => {
                const lines = [];
                const xs = Math.ceil((fit.cx0 - w / 2 / fit.k) / grid) * grid;
                for (let v = xs; v < fit.cx0 + w / 2 / fit.k; v += grid) {
                  const x = w / 2 + (v - fit.cx0) * fit.k;
                  lines.push(<line key={`x${v}`} x1={x} x2={x} y1={0} y2={h} />);
                }
                const ys = Math.ceil((fit.cy0 - h / 2 / fit.k) / grid) * grid;
                for (let v = ys; v < fit.cy0 + h / 2 / fit.k; v += grid) {
                  const y = h / 2 - (v - fit.cy0) * fit.k;
                  lines.push(<line key={`y${v}`} x1={0} x2={w} y1={y} y2={y} />);
                }
                return lines;
              })()}
            </g>
            <text className="mp-axis" x={w - 8} y={h - 8} textAnchor="end">
              {V.names[0]} →
            </text>
            <text className="mp-axis" x={8} y={14}>
              ↑ {V.names[1]}
            </text>
            {used.map((u) => (
              <g key={u.name} className="mp-tpoint">
                <rect x={X(u.q.p) - 3.5} y={Y(u.q.p) - 3.5} width={7} height={7} transform={`rotate(45 ${X(u.q.p)} ${Y(u.q.p)})`} />
                <text x={X(u.q.p) + 7} y={Y(u.q.p) - 6}>
                  {u.name}
                </text>
              </g>
            ))}
            {path.segments.map((s, k) =>
              s.pts.length < 2 ? null : (
                <g key={k} className={cx("mp-seg", `kind-${s.kind}`, `mot-${program.steps[s.step]?.motion?.toLowerCase()}`, sel === s.step && "is-sel", hover === s.step && "is-hover", runningStep === s.step && "is-running")}>
                  <polyline points={poly(s.pts)} className="mp-seg-hit" onMouseEnter={() => setHover(s.step)} onClick={() => onSelect(s.step)} />
                  <polyline points={poly(s.pts)} className="mp-seg-line" />
                </g>
              )
            )}
            {path.ends.map((p, i) =>
              p ? (
                <g key={i} className={cx("mp-end", sel === i && "is-sel")} onClick={() => onSelect(i)} onMouseEnter={() => setHover(i)}>
                  <circle cx={X(p)} cy={Y(p)} r={sel === i ? 9 : 7.5} />
                  <text x={X(p)} y={Y(p) + 3.5} textAnchor="middle">
                    {i + 1}
                  </text>
                </g>
              ) : null
            )}
            {playPos && <circle className="mp-play" cx={X(playPos.p)} cy={Y(playPos.p)} r={6} />}
            {robot && <circle className="mp-robot" cx={X(robot)} cy={Y(robot)} r={7} />}
          </svg>
        )}
        {hover !== null && program.steps[hover] && (
          <div className="mp-preview-hover">
            <b>{hover + 1}</b> {program.steps[hover].motion} {describeStep(program.steps[hover])}
          </div>
        )}
      </div>
      <div className="mp-preview-foot" data-tut="mp-preview-foot">
        {missing.length ? <span className="mp-warn-text">No coordinates for {missing.slice(0, 4).join(", ")}{missing.length > 4 ? ` +${missing.length - 4}` : ""}</span> : <span>Approximate tool path from the taught coordinates; PTP is drawn straight.</span>}
      </div>
    </div>
  );
}
