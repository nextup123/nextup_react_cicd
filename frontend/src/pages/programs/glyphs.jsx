// Small line drawings for the motion types and weave shapes (currentColor).

const P = { fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round" };

const MOTION_PATHS = {
  PTP: (
    <>
      <path d="M3 17 C 6 4, 15 4, 19 12" {...P} strokeDasharray="2.6 2.4" />
      <circle cx="3" cy="17" r="1.8" fill="currentColor" />
      <circle cx="19" cy="12" r="1.8" fill="currentColor" />
    </>
  ),
  LIN: (
    <>
      <path d="M3 17 L19 6" {...P} />
      <circle cx="3" cy="17" r="1.8" fill="currentColor" />
      <circle cx="19" cy="6" r="1.8" fill="currentColor" />
    </>
  ),
  CIRC: (
    <>
      <path d="M3 17 A 9 9 0 0 1 19 13" {...P} />
      <circle cx="3" cy="17" r="1.8" fill="currentColor" />
      <circle cx="11" cy="7.6" r="1.4" {...P} strokeWidth="1.4" />
      <circle cx="19" cy="13" r="1.8" fill="currentColor" />
    </>
  ),
  CIRCLE: (
    <>
      <circle cx="11" cy="11.5" r="7.5" {...P} />
      <circle cx="11" cy="11.5" r="1.3" fill="currentColor" />
      <circle cx="18.5" cy="11.5" r="1.8" fill="currentColor" />
    </>
  ),
  SPLINE: (
    <>
      <path d="M2.5 15 C 6 3, 9 3, 11 11 S 16 20, 19.5 7" {...P} />
      <circle cx="2.5" cy="15" r="1.6" fill="currentColor" />
      <circle cx="11" cy="11" r="1.4" fill="currentColor" />
      <circle cx="19.5" cy="7" r="1.6" fill="currentColor" />
    </>
  ),
  SPIRAL: <path d="M11 11.5 c 1.5 0 1.8 2 0 2.4 c -2.6 .5 -3.6 -2.6 -1.6 -4.4 c 2.6 -2.2 6.4 -.4 6.3 3.2 c -.1 4 -4.4 5.8 -7.8 4.2 c -3.8 -1.8 -4.4 -7 -1.4 -9.9 c 3.4 -3.2 9.8 -2 11.3 2.9" {...P} />,
};

export function MotionGlyph({ motion, size = 22 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 22 22" aria-hidden="true">
      {MOTION_PATHS[motion] || MOTION_PATHS.PTP}
    </svg>
  );
}

const W = (fn, n = 80) => {
  let d = "";
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const [x, y] = fn(t);
    d += `${i ? "L" : "M"}${(2 + x * 36).toFixed(2)} ${(10 - y * 6).toFixed(2)}`;
  }
  return d;
};
const tri = (f) => (f < 0.25 ? 4 * f : f < 0.75 ? 2 - 4 * f : 4 * f - 4);
const WEAVE_D = {
  sine: W((t) => [t, Math.sin(t * 4 * Math.PI)]),
  triangle: W((t) => [t, tri((t * 2) % 1)]),
  zigzag: W((t) => [t, tri((t * 2) % 1)]),
  square: W((t) => [t, (t * 2) % 1 < 0.5 ? 1 : -1], 400),
  sawtooth: W((t) => [t, 2 * ((t * 2) % 1) - 1], 400),
  trapezoid: W((t) => [t, Math.max(-1, Math.min(1, 2 * tri((t * 2) % 1)))]),
  circular: W((t) => {
    const ph = t * 4 * Math.PI;
    return [t + Math.sin(ph) * 0.06, 1 - Math.cos(ph) - 1];
  }),
  figure8: W((t) => {
    const ph = t * 4 * Math.PI;
    return [t + 0.6 * Math.sin(2 * ph) * 0.06, Math.sin(ph)];
  }),
};

export function WeaveGlyph({ shape, width = 40 }) {
  return (
    <svg width={width} height={20} viewBox="0 0 40 20" aria-hidden="true">
      <path d={WEAVE_D[shape] || WEAVE_D.sine} {...P} strokeWidth="1.5" />
    </svg>
  );
}
