// Kinematics of a serial robot read from its URDF (no dependencies).
//
// Used by the simulator (forward kinematics for the Cartesian values,
// Cartesian jog, go-to pose) and, as an identical copy in
// frontend/src/pages/points/viewer3d/kinematics.js, by the 3D view for the
// ghost preview of a Cartesian jog. Keep the two files the same.
//
// Model format (see robotModel/urdf.js): joints [{ name, type, parent, child,
// origin: { xyz, rpy }, axis, limit: { lower, upper, velocity } }].
// Matrices are 4x4, row-major, in plain arrays of 16 numbers.

export const ident = () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

export function mul(a, b) {
  const r = new Array(16);
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      r[i * 4 + j] = a[i * 4] * b[j] + a[i * 4 + 1] * b[4 + j] + a[i * 4 + 2] * b[8 + j] + a[i * 4 + 3] * b[12 + j];
    }
  }
  return r;
}

/** URDF origin: translation, then fixed-axis roll, pitch, yaw (R = Rz·Ry·Rx). */
export function fromXyzRpy(xyz = [0, 0, 0], rpy = [0, 0, 0]) {
  const [r, p, y] = rpy;
  const cr = Math.cos(r), sr = Math.sin(r), cp = Math.cos(p), sp = Math.sin(p), cy = Math.cos(y), sy = Math.sin(y);
  return [
    cy * cp, cy * sp * sr - sy * cr, cy * sp * cr + sy * sr, xyz[0],
    sy * cp, sy * sp * sr + cy * cr, sy * sp * cr - cy * sr, xyz[1],
    -sp, cp * sr, cp * cr, xyz[2],
    0, 0, 0, 1,
  ];
}

export function axisAngle(axis, a) {
  const n = Math.hypot(axis[0], axis[1], axis[2]) || 1;
  const x = axis[0] / n, y = axis[1] / n, z = axis[2] / n;
  const c = Math.cos(a), s = Math.sin(a), t = 1 - c;
  return [
    t * x * x + c, t * x * y - s * z, t * x * z + s * y, 0,
    t * x * y + s * z, t * y * y + c, t * y * z - s * x, 0,
    t * x * z - s * y, t * y * z + s * x, t * z * z + c, 0,
    0, 0, 0, 1,
  ];
}

const translate = (axis, d) => [1, 0, 0, axis[0] * d, 0, 1, 0, axis[1] * d, 0, 0, 1, axis[2] * d, 0, 0, 0, 1];

/** Roll, pitch, yaw (radians) of a rotation (same convention as fromXyzRpy). */
export function rpyOf(T) {
  const sp = -T[8];
  const pitch = Math.asin(Math.max(-1, Math.min(1, sp)));
  if (Math.abs(sp) > 0.999999) return [0, pitch, Math.atan2(-T[1], T[5])]; // gimbal lock: roll folded into yaw
  return [Math.atan2(T[9], T[10]), pitch, Math.atan2(T[4], T[0])];
}

const isMoving = (j) => j.type === 'revolute' || j.type === 'continuous' || j.type === 'prismatic';
const TIP_NAMES = ['end', 'tool0', 'tcp', 'flange', 'ee_link'];

/**
 * The serial chain from the model's root to its tool link: the first of
 * TIP_NAMES that exists, else the end of the longest chain of moving joints.
 */
export class Chain {
  constructor(model, tip) {
    const byChild = new Map(model.joints.map((j) => [j.child, j]));
    const children = new Map();
    for (const j of model.joints) {
      if (!children.has(j.parent)) children.set(j.parent, []);
      children.get(j.parent).push(j);
    }
    const linkNames = new Set(model.links.map((l) => l.name));
    model.joints.forEach((j) => { linkNames.add(j.parent); linkNames.add(j.child); });
    const pathTo = (link) => {
      const out = [];
      for (let j = byChild.get(link); j; j = byChild.get(j.parent)) out.unshift(j);
      return out;
    };
    let tipLink = tip && linkNames.has(tip) ? tip : TIP_NAMES.find((n) => linkNames.has(n) && pathTo(n).some(isMoving));
    if (!tipLink) {
      let best = null;
      let bestN = -1;
      for (const l of linkNames) {
        const n = pathTo(l).filter(isMoving).length;
        if (n > bestN) (best = l), (bestN = n);
      }
      tipLink = best;
    }
    this.tip = tipLink;
    this.segments = pathTo(tipLink).map((j) => ({
      joint: j,
      origin: fromXyzRpy(j.origin?.xyz, j.origin?.rpy),
      axis: j.axis || [1, 0, 0],
    }));
    this.joints = this.segments.filter((s) => isMoving(s.joint)).map((s) => s.joint);
    this.names = this.joints.map((j) => j.name);
    this.lower = this.joints.map((j) => (j.type === 'continuous' ? -Infinity : j.limit?.lower ?? -Math.PI));
    this.upper = this.joints.map((j) => (j.type === 'continuous' ? Infinity : j.limit?.upper ?? Math.PI));
    this.velocity = this.joints.map((j) => j.limit?.velocity || 0);
    this.root = this.segments[0]?.joint.parent || model.root;
  }

  get dof() {
    return this.joints.length;
  }

  clamp(q) {
    return q.map((v, i) => Math.min(this.upper[i], Math.max(this.lower[i], v)));
  }

  /** Tool pose for joint values q; with frames=true also each moving joint's world frame. */
  fk(q, frames = false) {
    let T = ident();
    const out = [];
    let k = 0;
    for (const s of this.segments) {
      T = mul(T, s.origin);
      if (isMoving(s.joint)) {
        if (frames) out.push({ T, axis: s.axis, prismatic: s.joint.type === 'prismatic' });
        const v = q[k++] || 0;
        T = mul(T, s.joint.type === 'prismatic' ? translate(s.axis, v) : axisAngle(s.axis, v));
      }
    }
    return frames ? { T, frames: out } : T;
  }

  /** Geometric Jacobian (6 x dof, rows vx vy vz wx wy wz) in the root frame. */
  jacobian(q) {
    const { T, frames } = this.fk(q, true);
    const p = [T[3], T[7], T[11]];
    return frames.map(({ T: F, axis, prismatic }) => {
      const z = [
        F[0] * axis[0] + F[1] * axis[1] + F[2] * axis[2],
        F[4] * axis[0] + F[5] * axis[1] + F[6] * axis[2],
        F[8] * axis[0] + F[9] * axis[1] + F[10] * axis[2],
      ];
      const n = Math.hypot(...z) || 1;
      z[0] /= n; z[1] /= n; z[2] /= n;
      if (prismatic) return [z[0], z[1], z[2], 0, 0, 0];
      const r = [p[0] - F[3], p[1] - F[7], p[2] - F[11]];
      return [z[1] * r[2] - z[2] * r[1], z[2] * r[0] - z[0] * r[2], z[0] * r[1] - z[1] * r[0], z[0], z[1], z[2]];
    }); // column per joint
  }

  /**
   * Joint step for a Cartesian velocity v = [vx vy vz wx wy wz] (root frame),
   * damped least squares: dq = Jᵀ (J Jᵀ + λ² I)⁻¹ v.
   */
  velocityIk(q, v, lambda = 0.05) {
    const cols = this.jacobian(q);
    const n = cols.length;
    const A = Array.from({ length: 6 }, (_, i) => Array.from({ length: 6 }, (_, j) => {
      let s = i === j ? lambda * lambda : 0;
      for (let k = 0; k < n; k++) s += cols[k][i] * cols[k][j];
      return s;
    }));
    const y = solve6(A, v);
    if (!y) return new Array(n).fill(0);
    return cols.map((c) => c.reduce((s, cv, i) => s + cv * y[i], 0));
  }

  /** Joint values reaching tool pose T (4x4) from q0, or null. */
  ik(Tgoal, q0, { iters = 300, tolPos = 5e-4, tolRot = 2e-3 } = {}) {
    let q = this.clamp([...q0]);
    for (let it = 0; it < iters; it++) {
      const T = this.fk(q);
      const e = poseError(T, Tgoal);
      if (Math.hypot(e[0], e[1], e[2]) < tolPos && Math.hypot(e[3], e[4], e[5]) < tolRot) return q;
      const lambda = it < iters / 2 ? 0.02 : 0.08;
      const dq = this.velocityIk(q, e, lambda);
      const m = Math.max(...dq.map(Math.abs));
      const k = m > 0.3 ? 0.3 / m : 1;
      q = this.clamp(q.map((v, i) => v + dq[i] * k));
    }
    return null;
  }
}

/** Position and rotation error (axis·angle) from T to G, in the root frame. */
export function poseError(T, G) {
  const ep = [G[3] - T[3], G[7] - T[7], G[11] - T[11]];
  // R_err = G_R · T_Rᵀ
  const R = new Array(9);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) R[i * 3 + j] = G[i * 4] * T[j * 4] + G[i * 4 + 1] * T[j * 4 + 1] + G[i * 4 + 2] * T[j * 4 + 2];
  const c = Math.max(-1, Math.min(1, (R[0] + R[4] + R[8] - 1) / 2));
  const a = Math.acos(c);
  let w = [R[7] - R[5], R[2] - R[6], R[3] - R[1]];
  const s = Math.sin(a);
  if (s > 1e-6) w = w.map((x) => (x * a) / (2 * s));
  else if (a > 3) {
    // 180°: axis from the diagonal
    w = [Math.sqrt(Math.max(0, (R[0] + 1) / 2)), Math.sqrt(Math.max(0, (R[4] + 1) / 2)), Math.sqrt(Math.max(0, (R[8] + 1) / 2))].map((x) => x * a);
  } else w = w.map((x) => x / 2);
  return [...ep, ...w];
}

function solve6(A, b) {
  const n = 6;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-12) return null;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((row, i) => row[n] / row[i]);
}

/** Rotates a 3-vector by the rotation part of T. */
export const rotate = (T, v) => [
  T[0] * v[0] + T[1] * v[1] + T[2] * v[2],
  T[4] * v[0] + T[5] * v[1] + T[6] * v[2],
  T[8] * v[0] + T[9] * v[1] + T[10] * v[2],
];
