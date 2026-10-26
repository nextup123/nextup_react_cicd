// programPath.js
//
// Approximate tool path of a motion program, in mm, from the taught points.
// Used by the editor's preview and by the simulated motion server
// (backend/ros/programPath.js is a verbatim copy). The real server plans
// with Pilz / IK; this follows the same geometry rules closely enough to see
// what a program does: PTP is drawn straight (the real joint move is curved),
// rx / ry / rz offsets only turn the tool, the call offset shifts every point.
//
// lookup(name) -> { p: [x, y, z] mm, R?: 3x3 row-major rotation of the tool } | null
// Pure ESM, no imports.

import { detectForm } from "./programRules.js";

const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mulS = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const norm = (a) => {
  const l = len(a);
  return l > 1e-9 ? mulS(a, 1 / l) : null;
};
const rotV = (R, v) => [R[0] * v[0] + R[1] * v[1] + R[2] * v[2], R[3] * v[0] + R[4] * v[1] + R[5] * v[2], R[6] * v[0] + R[7] * v[1] + R[8] * v[2]];
const toolZ = (R) => (R ? norm([R[2], R[5], R[8]]) : null);
const n0 = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const DEG = Math.PI / 180;

/** Any unit vector perpendicular to n. */
function perp(n) {
  const a = Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  return norm(cross(n, a));
}

/** Rotate v about unit axis k by angle a (Rodrigues). */
function rotAxis(v, k, a) {
  const c = Math.cos(a), s = Math.sin(a);
  return add(add(mulS(v, c), mulS(cross(k, v), s)), mulS(k, dot(k, v) * (1 - c)));
}

/** Circle through 3 points: { c, n, r } or null when they are on one line. */
export function circle3(a, b, c) {
  const ab = sub(b, a), ac = sub(c, a);
  const n = cross(ab, ac);
  const nn = dot(n, n);
  if (nn < 1e-6) return null;
  const t = add(mulS(cross(n, ab), dot(ac, ac)), mulS(cross(ac, n), dot(ab, ab)));
  const center = add(a, mulS(t, 1 / (2 * nn)));
  return { c: center, n: norm(n), r: len(sub(a, center)) };
}

/** Signed angle from u to v about axis n (radians, -π..π). */
function angleAbout(u, v, n) {
  return Math.atan2(dot(cross(u, v), n), dot(u, v));
}

/** Points of an arc: start point `s` rotated about centre c / axis n by `sweep` (rad). */
function arcPoints(c, n, s, sweep, stepRad = 5 * DEG) {
  const k = Math.max(2, Math.ceil(Math.abs(sweep) / stepRad));
  const r0 = sub(s, c);
  const out = [];
  for (let i = 0; i <= k; i++) out.push(add(c, rotAxis(r0, n, (sweep * i) / k)));
  return out;
}

/** Catmull-Rom through the points (centripetal enough for a preview). */
function splinePoints(list, per = 12) {
  if (list.length < 2) return list.slice();
  const out = [list[0]];
  for (let i = 0; i < list.length - 1; i++) {
    const p0 = list[i - 1] || list[i], p1 = list[i], p2 = list[i + 1], p3 = list[i + 2] || list[i + 1];
    for (let j = 1; j <= per; j++) {
      const t = j / per, t2 = t * t, t3 = t2 * t;
      out.push([0, 1, 2].map((d) => 0.5 * (2 * p1[d] + (-p0[d] + p2[d]) * t + (2 * p0[d] - 5 * p1[d] + 4 * p2[d] - p3[d]) * t2 + (-p0[d] + 3 * p1[d] - 3 * p2[d] + p3[d]) * t3)));
    }
  }
  return out;
}

/** Lay a weave over a polyline: lateral offsets across the path, in the plane normal to `up`. */
function weavePoints(line, w, up) {
  const amp = n0(w.amplitude_mm), wl = n0(w.wavelength_mm);
  if (!(amp > 0 && wl > 0) || line.length < 2) return line;
  const shape = w.shape || "sine";
  const wave = (ph) => {
    const f = ((ph / (2 * Math.PI)) % 1 + 1) % 1;
    switch (shape) {
      case "triangle":
      case "zigzag":
        return f < 0.25 ? 4 * f : f < 0.75 ? 2 - 4 * f : 4 * f - 4;
      case "square":
        return f < 0.5 ? 1 : -1;
      case "sawtooth":
        return 2 * f - 1;
      case "trapezoid":
        return Math.max(-1, Math.min(1, 2 * (f < 0.25 ? 4 * f : f < 0.75 ? 2 - 4 * f : 4 * f - 4)));
      default:
        return Math.sin(ph);
    }
  };
  const out = [];
  let s = 0;
  for (let i = 0; i < line.length - 1; i++) {
    const a = line[i], b = line[i + 1];
    const d = sub(b, a);
    const L = len(d);
    if (L < 1e-9) continue;
    const dir = mulS(d, 1 / L);
    const side = norm(cross(up || [0, 0, 1], dir)) || perp(dir);
    const n = Math.max(1, Math.ceil(L / (wl / 12)));
    for (let j = i === 0 ? 0 : 1; j <= n; j++) {
      const t = j / n;
      const ph = ((s + L * t) / wl) * 2 * Math.PI;
      let lat = wave(ph), fwd = 0;
      if (shape === "circular") {
        fwd = Math.sin(ph);
        lat = 1 - Math.cos(ph);
      } else if (shape === "figure8") {
        fwd = 0.6 * Math.sin(2 * ph);
        lat = Math.sin(ph);
      }
      out.push(add(add(a, mulS(d, t)), add(mulS(side, amp * lat), mulS(dir, amp * fwd))));
    }
    s += L;
  }
  return out.length ? out : line;
}

/** Shift a position by an offset {x,y,z} (mm) in base axes, or tool axes when R is given. */
function offsetPos(p, off, R) {
  const v = [n0(off?.x), n0(off?.y), n0(off?.z)];
  return add(p, R ? rotV(R, v) : v);
}

/**
 * Build the path. Returns
 *   { segments: [{ step, kind, pts: [[x,y,z] mm], end, approach? }], ends: [[x,y,z] | null per step], missing: Set(names), bounds }
 * kind: "ptp" | "lin" | "arc" | "circle" | "spline" | "spiral" | "approach"
 * callOffset: {x,y,z} mm, shifts every taught point (run_program call offset).
 */
export function buildPath(program, lookup, { callOffset = null } = {}) {
  const segments = [];
  const ends = [];
  const missing = new Set();
  let cur = null;
  let curR = null;
  const shift = (p) => (callOffset ? add(p, [n0(callOffset.x), n0(callOffset.y), n0(callOffset.z)]) : p);
  const get = (name) => {
    if (!name) return null;
    const q = lookup(name);
    if (!q?.p || q.p.some((v) => !Number.isFinite(v))) {
      missing.add(name);
      return null;
    }
    return { p: shift(q.p), R: q.R || null };
  };

  (program.steps || []).forEach((raw, i) => {
    const st = raw;
    const push = (kind, pts, extra = {}) => {
      if (pts.length >= 2 || kind === "ptp") segments.push({ step: i, kind, pts, ...extra });
    };
    const end = (p, R) => {
      cur = p;
      if (R) curR = R;
      ends[i] = p;
    };
    ends[i] = null;
    const m = st.motion;
    try {
      if (m === "PTP" || m === "LIN") {
        let target = null, R = null;
        if (st.point) {
          const q = get(st.point);
          if (!q) return;
          R = q.R;
          target = st.offset ? offsetPos(q.p, st.offset, st.offset_frame === "tool" ? q.R : null) : q.p;
        } else if (st.offset && cur) {
          target = offsetPos(cur, st.offset, st.offset_frame === "tool" ? curR : null);
        }
        if (!target) return;
        if (cur) {
          let line = [cur, target];
          if (m === "LIN" && st.weave) {
            const n = Math.max(2, Math.ceil(len(sub(target, cur)) / 2));
            line = Array.from({ length: n + 1 }, (_, k) => add(cur, mulS(sub(target, cur), k / n)));
            line = weavePoints(line, st.weave, toolZ(R || curR));
            line[line.length - 1] = target;
          }
          push(m === "PTP" ? "ptp" : "lin", line);
        } else segments.push({ step: i, kind: "ptp", pts: [target] });
        end(target, R);
        return;
      }
      if (!cur) return;
      const form = detectForm(st);
      if (m === "CIRC" || m === "CIRCLE") {
        let pts = null, finalP = null;
        if (form === "via") {
          const v = get(st.via), e = get(st.point);
          if (!v || !e) return;
          const C = circle3(cur, v.p, e.p);
          if (!C) {
            push("lin", [cur, v.p, e.p], { degenerate: true });
            end(e.p, e.R);
            return;
          }
          const toVia = angleAbout(sub(cur, C.c), sub(v.p, C.c), C.n);
          const dirSign = toVia >= 0 ? 1 : -1;
          let toEnd = angleAbout(sub(cur, C.c), sub(e.p, C.c), C.n);
          if (Math.sign(toEnd) !== dirSign) toEnd += dirSign * 2 * Math.PI;
          let sweep = m === "CIRCLE" ? (n0(st.angle_deg) || 360) * DEG * dirSign : n0(st.angle_deg) > 0 ? n0(st.angle_deg) * DEG * dirSign : toEnd;
          pts = arcPoints(C.c, C.n, cur, sweep);
          finalP = pts[pts.length - 1];
          if (m === "CIRC" && !(n0(st.angle_deg) > 0)) finalP = e.p;
          if (st.weave) pts = weavePoints(pts, st.weave, C.n);
          push(m === "CIRCLE" ? "circle" : "arc", pts);
          end(finalP, e.R);
          return;
        }
        const c = get(st.center);
        if (!c) return;
        if (m === "CIRC" && form === "center_point") {
          const e = get(st.point);
          if (!e) return;
          let n = norm(cross(sub(cur, c.p), sub(e.p, c.p))) || toolZ(curR) || [0, 0, 1];
          const sweep = angleAbout(sub(cur, c.p), sub(e.p, c.p), n);
          pts = arcPoints(c.p, n, cur, sweep);
          if (st.weave) pts = weavePoints(pts, st.weave, n);
          push("arc", pts);
          end(e.p, e.R);
          return;
        }
        if (m === "CIRC") {
          const n = toolZ(curR) || [0, 0, 1];
          const rel = sub(cur, c.p);
          const startOnPlane = add(c.p, sub(rel, mulS(n, dot(rel, n))));
          pts = arcPoints(c.p, n, startOnPlane, n0(st.angle_deg) * DEG);
          if (len(sub(startOnPlane, cur)) > 0.5) pts.unshift(cur);
          if (st.weave) pts = weavePoints(pts, st.weave, n);
          push("arc", pts);
          end(pts[pts.length - 1]);
          return;
        }
        // CIRCLE around a centre: LIN to the nearest point of the circle, then round
        const n = toolZ(c.R) || [0, 0, 1];
        const r = n0(st.radius_mm);
        const rel = sub(cur, c.p);
        const inPlane = sub(rel, mulS(n, dot(rel, n)));
        const u = norm(inPlane) || perp(n);
        const start = add(c.p, mulS(u, r));
        push("approach", [cur, start], { approach: true });
        const sweep = (n0(st.angle_deg) || 360) * DEG;
        pts = arcPoints(c.p, n, start, sweep);
        if (st.weave) pts = weavePoints(pts, st.weave, n);
        push("circle", pts);
        end(pts[pts.length - 1]);
        return;
      }
      if (m === "SPLINE") {
        const list = [cur];
        for (const nm of st.points || []) {
          const q = get(nm);
          if (q) list.push(q.p);
        }
        if (list.length < 2) return;
        push("spline", splinePoints(list));
        const last = get(st.points[st.points.length - 1]);
        end(list[list.length - 1], last?.R);
        return;
      }
      if (m === "SPIRAL") {
        const c = get(st.center);
        if (!c) return;
        const n = toolZ(c.R) || [0, 0, 1];
        const rel = sub(cur, c.p);
        const u = norm(sub(rel, mulS(n, dot(rel, n)))) || perp(n);
        const r0 = n0(st.start_radius_mm), r1 = n0(st.radius_mm), turns = n0(st.turns) || 1, pitch = n0(st.pitch_mm);
        const start = add(c.p, mulS(u, r0));
        push("approach", [cur, start], { approach: true });
        const total = Math.abs(turns) * 2 * Math.PI;
        const k = Math.max(24, Math.ceil(total / (6 * DEG)));
        const pts = [];
        for (let j = 0; j <= k; j++) {
          const t = j / k;
          const a = Math.sign(turns) * total * t;
          const rr = r0 + (r1 - r0) * t;
          pts.push(add(add(c.p, rotAxis(mulS(u, rr), n, a)), mulS(n, -pitch * Math.abs(turns) * t)));
        }
        push("spiral", pts);
        end(pts[pts.length - 1]);
      }
    } catch {
      /* a broken step draws nothing */
    }
  });

  const all = segments.flatMap((s) => s.pts);
  const bounds = all.length
    ? all.reduce((b, p) => ({ min: b.min.map((v, d) => Math.min(v, p[d])), max: b.max.map((v, d) => Math.max(v, p[d])) }), { min: [...all[0]], max: [...all[0]] })
    : null;
  return { segments, ends, missing, bounds };
}

/** Lookup from points.yaml objects: coordinate x/y/z in cm, r/p/w in deg (R = Rz(w)·Ry(p)·Rx(r)). */
export function lookupFromPoints(points = []) {
  const map = new Map();
  for (const pt of points || []) {
    const c = pt?.coordinate;
    if (!pt?.name || !c) continue;
    const p = [Number(c.x) * 10, Number(c.y) * 10, Number(c.z) * 10];
    if (p.some((v) => !Number.isFinite(v))) continue;
    const r = Number(c.r) * DEG || 0, pi = Number(c.p) * DEG || 0, y = Number(c.w) * DEG || 0;
    const cr = Math.cos(r), sr = Math.sin(r), cp = Math.cos(pi), sp = Math.sin(pi), cy = Math.cos(y), sy = Math.sin(y);
    const R = [cy * cp, cy * sp * sr - sy * cr, cy * sp * cr + sy * sr, sy * cp, sy * sp * sr + cy * cr, sy * sp * cr - cy * sr, -sp, cp * sr, cp * cr];
    map.set(pt.name, { p, R });
  }
  return (name) => map.get(name) || null;
}

