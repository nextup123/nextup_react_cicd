// programRules.js
//
// The rules of programs.yaml (nextup_motion_server run_program) in one place:
// which keys each motion needs, which it must not have, the number ranges and
// the blend / stop rules. The editor uses it to build its dropdowns and to
// check a program while it is typed; the backend uses the same file
// (backend/ros/programRules.js is a verbatim copy) to check the file it reads.
//
// Source: motion_server_pkg yaml_store.cpp (readStep, stepShapeError,
// validateProgram) and the "programs.yaml — rules" guide of 12 Oct 2026.
// Pure ESM, no imports: keep it that way so both sides can load it.

export const MOTIONS = ["PTP", "LIN", "CIRC", "CIRCLE", "SPLINE", "SPIRAL"];

export const MOTION_INFO = {
  PTP: {
    name: "Joint move",
    short: "Fastest way, curved tool path",
    tip: "Point-to-point: every joint moves at once, so the tool path is a curve. Fastest and safest for travel moves in free space. Blendable.",
  },
  LIN: {
    name: "Straight line",
    short: "Tool moves in a straight line",
    tip: "Linear: the tool moves along a straight line. Use it to approach and leave parts. A LIN never falls back to PTP: if no straight line is possible the program stops with 'LIN not feasible'. Blendable.",
  },
  CIRC: {
    name: "Arc",
    short: "Part of a circle",
    tip: "An arc from where the robot is: through a via point to an end point, around a centre to an end point, or around a centre by an angle. Planned by Pilz inside the blended sequence.",
  },
  CIRCLE: {
    name: "Full circle",
    short: "Closed circle (or more with overlap)",
    tip: "A full circle: through 3 points (start, via, point) or around one taught centre with a radius. angle_deg changes the sweep: 360 by default, 380 = 20 degrees overlap.",
  },
  SPLINE: {
    name: "Smooth curve",
    short: "One curve through many points",
    tip: "One smooth curve through a list of points, no stops between them. Built by the server as a constant-speed Cartesian path, so it starts and ends with a stop.",
  },
  SPIRAL: {
    name: "Spiral / helix",
    short: "Spiral out from a centre",
    tip: "Spiral from the centre (or start radius) out to the radius in the given number of turns. A pitch makes it a helix that rises per turn along the tool axis. Starts and ends with a stop.",
  },
};

/** Ways to give each motion its geometry. `needs` must be set, `optional` may be set; everything else is cleared. */
export const FORMS = {
  PTP: [
    { id: "point", label: "To a point", needs: ["point"], optional: [], tip: "Go to a taught point." },
    { id: "point_offset", label: "To a point + offset", needs: ["point", "offset"], optional: ["offset_frame"], tip: "Go to a taught point shifted by an offset, for example 80 mm above a pick point." },
    { id: "relative", label: "Relative move", needs: ["offset"], optional: ["offset_frame"], tip: "Move by an offset from where the previous step ended, for example 'retract 50 mm up'. Not allowed as the first step." },
  ],
  LIN: [
    { id: "point", label: "To a point", needs: ["point"], optional: ["weave", "orientation"], tip: "Straight line to a taught point. Can carry a weave (welding)." },
    { id: "point_offset", label: "To a point + offset", needs: ["point", "offset"], optional: ["offset_frame"], tip: "Straight line to a taught point shifted by an offset." },
    { id: "relative", label: "Relative move", needs: ["offset"], optional: ["offset_frame"], tip: "Straight line by an offset from where the previous step ended, for example 'retract 80 mm up'." },
  ],
  CIRC: [
    { id: "via", label: "3-point arc (via + end)", needs: ["via", "point"], optional: ["angle_deg", "orientation", "weave"], tip: "Arc from the previous step's end, through the via point, to the end point. With angle_deg the arc keeps going on the same circle that many degrees (360 = back to the start)." },
    { id: "center_point", label: "Around a centre to an end", needs: ["center", "point"], optional: ["orientation", "weave"], tip: "Arc around a centre point to the end point, the shorter way. Start and end must be the same distance from the centre (within 2 mm)." },
    { id: "center_angle", label: "Around a centre by an angle", needs: ["center", "angle_deg"], optional: ["orientation", "weave"], tip: "Arc around a centre by a fixed angle, in the plane across the tool axis. Negative angle = the other way round." },
  ],
  CIRCLE: [
    { id: "via", label: "Circle through 3 points", needs: ["via", "point"], optional: ["angle_deg", "orientation", "weave"], tip: "Full circle through the previous step's end, the via point and the point. angle_deg 0 = 360, 380 = 20 degrees overlap." },
    { id: "center_radius", label: "Circle around a centre", needs: ["center", "radius_mm"], optional: ["angle_deg", "orientation", "weave"], tip: "Full circle around one taught centre with a radius (1-point circle). The robot first moves LIN to the nearest point of the circle. Plane = the centre point's tool XY." },
  ],
  SPLINE: [{ id: "points", label: "Through points", needs: ["points"], optional: ["orientation"], tip: "One smooth curve through the listed points, in order." }],
  SPIRAL: [{ id: "spiral", label: "Centre + radius + turns", needs: ["center", "radius_mm", "turns"], optional: ["start_radius_mm", "pitch_mm", "orientation"], tip: "Spiral around the centre out to the radius. start_radius_mm 0 = from the centre; pitch_mm ≠ 0 makes it a helix." },
  ],
};

export const WEAVE_SHAPES = ["sine", "triangle", "zigzag", "square", "sawtooth", "trapezoid", "circular", "figure8"];
export const WEAVE_TIPS = {
  sine: "Smooth side-to-side wave. The usual choice for fillet welds.",
  triangle: "Straight zig-zag with sharp turns; even heat across the seam.",
  zigzag: "Same as triangle.",
  square: "Jumps side to side and holds: dwell-like heat at both edges.",
  sawtooth: "Slow sweep one way, fast return.",
  trapezoid: "Sweeps across and holds at each edge: good for wide gaps.",
  circular: "Small circles along the seam (forward and sideways).",
  figure8: "Figure-eight along the seam; wide bead, heat at the centre.",
};

export const ORIENTATIONS = [
  { value: "", label: "Default", tip: "The motion's default tool orientation." },
  { value: "constant", label: "Constant", tip: "The tool keeps the orientation it had at the start of the path." },
  { value: "interpolate", label: "Interpolate", tip: "The tool turns smoothly from the start orientation to the end point's orientation. Needs a real end point: not on CIRCLE, SPIRAL or an arc by angle." },
  { value: "path", label: "Follow path", tip: "The tool turns with the path (like a torch along a curve). Makes an arc a Cartesian path: it then starts and ends with a stop." },
];

export const OFFSET_FRAMES = [
  { value: "", label: "Base", tip: "Offset along the robot base axes (default)." },
  { value: "tool", label: "Tool", tip: "Offset along the tool's own axes at the target, for example z along the tool = towards the part." },
];

/** Hover tips for every key the editor shows. */
export const TIPS = {
  name: "Program name used by the behaviour tree (RunProgram program=\"…\"). Letters, digits, _ and -, up to 64 characters.",
  description: "Free text: what the program does.",
  repeat: "How many times the step list runs. 1 = once, N = N loops, 0 = until finish_program or stop. A RunProgram node in a tree refuses 0 (a tree step must end).",
  program_speed: "Default tool speed for steps that set none, in m/s. Empty = the motion server's go-to default. Capped by goto_config max speed; the supervisor's speed override still applies.",
  program_acc: "Default tool acceleration for steps that set none, in m/s². Empty = the motion server's go-to default.",
  tool: "TCP / tool name (gripper, torch …). Saved in the file; the motion server loads it but does not use it yet.",
  frame: "User frame the points and offsets are in (a point with is_tf: true). Saved in the file; the motion server loads it but does not use it yet (default base).",
  motion: "How the robot gets there. The fields below change with the motion so only valid keys can be set.",
  form: "Which taught points define this motion.",
  point: "Target point taught on the Teach Points page.",
  via: "A point on the arc or circle, between the start and the end.",
  center: "Centre point of the arc, circle or spiral.",
  points: "Points the curve passes through, in order. The curve starts where the previous step ended.",
  offset: "Shift in mm / deg. With a point: go to the point shifted (\"80 mm above pick\"). Without a point: move relative to where the previous step ended (\"retract 50 up\").",
  offset_frame: "Axes the offset is measured in: the robot base (default) or the tool at the target.",
  radius_mm: "Circle / spiral radius in mm (1 to 5000).",
  start_radius_mm: "Radius the spiral starts on, in mm. 0 = from the centre.",
  angle_deg: "Sweep in degrees. CIRC by angle: how far to go round (negative = other way). CIRC via: keep going this far on the same circle. CIRCLE: 0 = 360; 380 = 20° overlap.",
  turns: "Number of turns of the spiral (negative = clockwise). Within ±200.",
  pitch_mm: "Rise per turn along the tool axis, in mm. 0 = flat spiral; ≠ 0 = helix.",
  orientation: "How the tool turns along a path motion.",
  weave: "Lay a weave over the path (welding): the tool oscillates side to side while it moves forward.",
  weave_shape: "Pattern of the oscillation.",
  amplitude_mm: "Half width of the weave in mm (0 to 50). Must be below 90 % of the smallest arc radius it rides on.",
  wavelength_mm: "Path length of one oscillation in mm (0 to 100).",
  speed_mps: "Tool speed for this step in m/s. Empty = the program's speed.",
  acceleration_mps2: "Tool acceleration for this step in m/s². Empty = the program's acceleration.",
  blend_mm: "Corner radius in mm: the robot rounds this corner without stopping. 0 = stop exactly at the point. Must be 0 on the last step, at a dwell, on a path and on the step before a path.",
  dwell_s: "Wait this long at the point before the next step, in s (0 to 3600). The robot stops there, so blend must be 0.",
  note: "Your note for this step. Saved as a comment next to the step (for example 'BT: gripper closes').",
};

/** Number ranges of the server. */
export const LIMITS = {
  blend_mm: [0, 1000],
  dwell_s: [0, 3600],
  speed_mps: [0, 10],
  acceleration_mps2: [0, 50],
  radius_mm: [0, 5000],
  start_radius_mm: [0, 5000],
  angle_deg: [-3600, 3600],
  turns: [-200, 200],
  pitch_mm: [-500, 500],
  offset_mm: [-5000, 5000],
  offset_deg: [-360, 360],
  amplitude_mm: [0, 50],
  wavelength_mm: [0, 100],
  repeat: [0, 100000],
  steps: 500,
  spline_points: 200,
};

export const NAME_RE = /^[A-Za-z0-9_-]{1,64}$/;
const OFFSET_KEYS = ["x", "y", "z", "rx", "ry", "rz"];
const MOTION_ALIASES = { ptp: "PTP", joint: "PTP", lin: "LIN", cart: "LIN", cartesian: "LIN", line: "LIN", circ: "CIRC", arc: "CIRC", circle: "CIRCLE", spline: "SPLINE", spiral: "SPIRAL", helix: "SPIRAL" };

const num = (v) => {
  if (v === undefined || v === null || v === "") return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
};
const str = (v) => (v === undefined || v === null ? "" : String(v).trim());
const round = (v, d = 6) => Math.round(v * 10 ** d) / 10 ** d;

/** "lin" -> "LIN"; unknown -> null. */
export function parseMotion(text) {
  if (text === undefined || text === null || text === "") return "PTP";
  return MOTION_ALIASES[String(text).trim().toLowerCase()] || null;
}

export const emptyOffset = () => ({ x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0 });
export const offsetAny = (o) => Boolean(o) && OFFSET_KEYS.some((k) => num(o[k]) !== 0);

/**
 * A step as the editor keeps it. Numbers are numbers (0 = not set), strings
 * are "" when not set, `offset` / `weave` are null when the step has none.
 * Unknown keys survive in `extra`; `note` is the YAML comment of the step.
 */
export function normalizeStep(raw = {}) {
  const r = raw && typeof raw === "object" ? raw : {};
  const known = new Set(["point", "point_name", "motion", "motion_type", "offset", "offset_frame", "via", "via_point", "center", "centre", "center_point", "points", "radius_mm", "start_radius_mm", "angle_deg", "angle", "turns", "pitch_mm", "orientation", "weave", "speed_mps", "speed", "acceleration_mps2", "acceleration", "blend_mm", "blend_radius_mm", "dwell_s", "wait_s", "note", "extra", "_motionText"]);
  const motionText = r.motion ?? r.motion_type;
  const motion = parseMotion(motionText);
  const step = {
    motion: motion || "PTP",
    point: str(r.point ?? r.point_name),
    offset: null,
    offset_frame: str(r.offset_frame).toLowerCase() === "base" ? "" : str(r.offset_frame).toLowerCase(),
    via: str(r.via ?? r.via_point),
    center: str(r.center ?? r.centre ?? r.center_point),
    points: Array.isArray(r.points) ? r.points.map(str).filter(Boolean) : [],
    radius_mm: num(r.radius_mm),
    start_radius_mm: num(r.start_radius_mm),
    angle_deg: num(r.angle_deg ?? r.angle),
    turns: num(r.turns),
    pitch_mm: num(r.pitch_mm),
    orientation: str(r.orientation).toLowerCase(),
    weave: null,
    speed_mps: num(r.speed_mps ?? r.speed),
    acceleration_mps2: num(r.acceleration_mps2 ?? r.acceleration),
    blend_mm: num(r.blend_mm ?? r.blend_radius_mm),
    dwell_s: num(r.dwell_s ?? r.wait_s),
    note: str(r.note),
    extra: { ...(r.extra || {}) },
  };
  if (!motion) step._motionText = String(motionText);
  if (r.points !== undefined && !Array.isArray(r.points)) step._pointsNotList = true;
  if (r.offset && typeof r.offset === "object") {
    const o = emptyOffset();
    for (const [k, v] of Object.entries(r.offset)) {
      const key = String(k).toLowerCase().replace(/_(mm|deg)$/, "");
      if (OFFSET_KEYS.includes(key)) o[key] = num(v);
      else (step._badOffsetKeys ||= []).push(String(k));
    }
    step.offset = o;
  } else if (r.offset !== undefined && r.offset !== null) {
    step._offsetNotMap = true;
  }
  if (r.weave && typeof r.weave === "object") {
    step.weave = {
      shape: str(r.weave.shape).toLowerCase().replace(/[-_ ]/g, "") || "sine",
      amplitude_mm: num(r.weave.amplitude_mm ?? r.weave.amplitude),
      wavelength_mm: num(r.weave.wavelength_mm ?? r.weave.pitch_mm),
    };
  }
  for (const [k, v] of Object.entries(r)) if (!known.has(k)) step.extra[k] = v;
  return step;
}

/** Program as the editor keeps it. Unknown program keys survive in `extra`, the comment above it in `comment`. */
export function normalizeProgram(raw = {}, keyName = "") {
  const r = raw && typeof raw === "object" ? raw : {};
  const known = new Set(["name", "description", "repeat", "speed_mps", "acceleration_mps2", "tool", "frame", "steps", "comment", "extra"]);
  const p = {
    name: str(r.name) || keyName,
    description: str(r.description),
    repeat: r.repeat === undefined || r.repeat === null || r.repeat === "" ? 1 : num(r.repeat),
    speed_mps: num(r.speed_mps),
    acceleration_mps2: num(r.acceleration_mps2),
    tool: str(r.tool),
    frame: str(r.frame),
    steps: Array.isArray(r.steps) ? r.steps.map(normalizeStep) : [],
    comment: str(r.comment),
    extra: { ...(r.extra || {}) },
  };
  if (r.steps !== undefined && !Array.isArray(r.steps)) p._stepsNotList = true;
  for (const [k, v] of Object.entries(r)) if (!known.has(k)) p.extra[k] = v;
  return p;
}

/**
 * Plain object for programs.yaml: only keys that carry a value, in the order
 * people write them (point first, motion, then the motion's keys, speeds last).
 */
export function stepToYaml(st) {
  const o = {};
  if (st.point) o.point = st.point;
  if (st.points?.length) o.points = [...st.points];
  if (st.via) o.via = st.via;
  if (st.center) o.center = st.center;
  if (st.offset) {
    const off = {};
    for (const k of OFFSET_KEYS) if (num(st.offset[k])) off[k] = round(num(st.offset[k]));
    if (!Object.keys(off).length) off.z = 0;
    o.offset = off;
  }
  if (st.offset_frame) o.offset_frame = st.offset_frame;
  o.motion = st._motionText && !parseMotion(st._motionText) ? st._motionText : st.motion || "PTP";
  for (const k of ["radius_mm", "start_radius_mm", "turns", "pitch_mm", "angle_deg"]) if (num(st[k])) o[k] = round(num(st[k]));
  if (st.orientation) o.orientation = st.orientation;
  if (st.weave) {
    o.weave = { shape: st.weave.shape || "sine" };
    if (num(st.weave.amplitude_mm)) o.weave.amplitude_mm = round(num(st.weave.amplitude_mm));
    if (num(st.weave.wavelength_mm)) o.weave.wavelength_mm = round(num(st.weave.wavelength_mm));
  }
  for (const k of ["speed_mps", "acceleration_mps2", "blend_mm", "dwell_s"]) if (num(st[k])) o[k] = round(num(st[k]));
  for (const [k, v] of Object.entries(st.extra || {})) if (!(k in o)) o[k] = v;
  return o;
}

export function programToYaml(p) {
  const o = { name: p.name };
  if (p.description) o.description = p.description;
  o.repeat = Number.isFinite(num(p.repeat)) ? Math.round(num(p.repeat)) : 1;
  if (num(p.speed_mps)) o.speed_mps = round(num(p.speed_mps));
  if (num(p.acceleration_mps2)) o.acceleration_mps2 = round(num(p.acceleration_mps2));
  if (p.tool) o.tool = p.tool;
  if (p.frame) o.frame = p.frame;
  for (const [k, v] of Object.entries(p.extra || {})) if (!(k in o) && k !== "steps") o[k] = v;
  o.steps = (p.steps || []).map(stepToYaml);
  return o;
}

/* ───────────── shape of a step ───────────── */

const has = {
  point: (s) => Boolean(s.point),
  offset: (s) => Boolean(s.offset),
  offset_frame: (s) => Boolean(s.offset_frame),
  via: (s) => Boolean(s.via),
  center: (s) => Boolean(s.center),
  points: (s) => s.points?.length > 0,
  radius_mm: (s) => num(s.radius_mm) !== 0,
  start_radius_mm: (s) => num(s.start_radius_mm) !== 0,
  angle_deg: (s) => num(s.angle_deg) !== 0,
  turns: (s) => num(s.turns) !== 0,
  pitch_mm: (s) => num(s.pitch_mm) !== 0,
  orientation: (s) => Boolean(s.orientation),
  weave: (s) => Boolean(s.weave),
};
export const GEOMETRY_KEYS = Object.keys(has);

export const isArc = (s) => s.motion === "CIRC" || s.motion === "CIRCLE";
/** Built by the server as a dense Cartesian path that starts and ends with a stop. */
export const isCartesianPath = (s) => s.motion === "SPLINE" || s.motion === "SPIRAL" || Boolean(s.weave) || (isArc(s) && s.orientation === "path");
/** Anything that is not a plain PTP / LIN to a target. */
export const isPath = (s) => isArc(s) || isCartesianPath(s);

/** The form a step currently has (best match), e.g. "point_offset" for a LIN with point + offset. */
export function detectForm(st) {
  const forms = FORMS[st.motion] || FORMS.PTP;
  if (st.motion === "PTP" || st.motion === "LIN") {
    if (!st.point && st.offset) return "relative";
    if (st.point && st.offset) return "point_offset";
    return "point";
  }
  if (st.motion === "CIRC") {
    if (st.via) return "via";
    if (st.center && !st.point && has.angle_deg(st)) return "center_angle";
    if (st.center) return st.point ? "center_point" : "center_angle";
    return "via";
  }
  if (st.motion === "CIRCLE") return st.center ? "center_radius" : "via";
  return forms[0].id;
}

export const formOf = (motion, id) => (FORMS[motion] || []).find((f) => f.id === id) || (FORMS[motion] || [])[0];

/** Keys the step may carry in its current form (geometry keys only). */
export function allowedKeys(st, formId = detectForm(st)) {
  const f = formOf(st.motion, formId);
  return new Set([...(f?.needs || []), ...(f?.optional || [])]);
}

/**
 * Switch a step to another motion / form. Keeps every value the new form can
 * use (a point becomes the centre when the new form needs a centre and has
 * no point, the last spline point becomes the target ...), clears the rest,
 * and fills required numbers with sensible starting values.
 */
export function applyForm(step, motion, formId) {
  const f = formOf(motion, formId);
  const allowed = new Set([...f.needs, ...f.optional]);
  const s = { ...step, motion };
  delete s._motionText;
  const anyPoint = step.point || step.points?.[step.points.length - 1] || step.center || step.via || "";
  // carry names over
  if (allowed.has("point") && !s.point) s.point = step.points?.[step.points.length - 1] || (f.needs.includes("center") ? "" : step.center) || "";
  if (allowed.has("center") && !s.center) s.center = f.needs.includes("point") ? "" : step.point || step.center || "";
  if (allowed.has("points") && !s.points?.length) s.points = anyPoint ? [anyPoint] : [];
  // clear what the form does not use
  for (const k of GEOMETRY_KEYS) {
    if (allowed.has(k)) continue;
    if (k === "points") s.points = [];
    else if (k === "offset" || k === "weave") s[k] = null;
    else if (typeof s[k] === "number") s[k] = 0;
    else s[k] = "";
  }
  // required values
  if (f.needs.includes("offset") && !s.offset) s.offset = { ...emptyOffset(), z: 50 };
  if (f.needs.includes("radius_mm") && !num(s.radius_mm)) s.radius_mm = 25;
  if (f.needs.includes("turns") && !num(s.turns)) s.turns = 3;
  if (f.needs.includes("angle_deg") && !num(s.angle_deg)) s.angle_deg = 90;
  if (s.orientation === "interpolate" && !interpolateOk(s)) s.orientation = "";
  return s;
}

const interpolateOk = (s) => !(s.motion === "CIRCLE" || s.motion === "SPIRAL" || (s.motion === "CIRC" && !s.point));
export const orientationAllowed = (s, value) => (value === "interpolate" ? interpolateOk(s) : true);
export const weaveAllowed = (s) => (s.motion === "LIN" && Boolean(s.point) && !s.offset) || s.motion === "CIRC" || s.motion === "CIRCLE";

/** Why blend_mm must be 0 on step i (null = blending allowed). */
export function blendLockReason(steps, i) {
  const st = steps[i];
  if (!st) return null;
  if (i === steps.length - 1) return "The last step stops exactly: blend must be 0.";
  if (num(st.dwell_s) > 0) return "This step has a dwell, so the robot stops here: blend must be 0.";
  if (isCartesianPath(st)) return `${pathLabel(st)} paths start and end with a stop: blend must be 0.`;
  const next = steps[i + 1];
  if (next && isCartesianPath(next)) return `The next step is a ${pathLabel(next)} path, which starts from a stop: blend must be 0 here.`;
  return null;
}
const pathLabel = (s) => `${s.motion}${s.weave ? " weave" : ""}${isArc(s) && s.orientation === "path" ? " (orientation path)" : ""}`;

/** "LIN PickpointCNC1 z+80" style one-liner (like the server's describe()). */
export function describeStep(st) {
  const off = (o) => {
    const parts = OFFSET_KEYS.filter((k) => num(o?.[k])).map((k) => `${k}${num(o[k]) > 0 ? "+" : ""}${round(num(o[k]), 3)}`);
    return parts.length ? parts.join(" ") : "0";
  };
  let s;
  switch (st.motion) {
    case "CIRC":
      s = `arc${st.via ? ` via ${st.via}` : ""}${st.center ? ` around ${st.center}` : ""}${st.point ? ` to ${st.point}` : ""}${num(st.angle_deg) ? ` ${round(num(st.angle_deg), 2)}°` : ""}`;
      break;
    case "CIRCLE":
      s = st.center ? `circle around ${st.center} r${round(num(st.radius_mm), 2)}` : `circle via ${st.via || "?"} ${st.point || "?"}`;
      if (num(st.angle_deg) && num(st.angle_deg) !== 360) s += ` ${round(num(st.angle_deg), 2)}°`;
      break;
    case "SPLINE":
      s = `spline through ${st.points.length} point${st.points.length === 1 ? "" : "s"}`;
      break;
    case "SPIRAL":
      s = `spiral around ${st.center || "?"} r${round(num(st.radius_mm), 2)} × ${round(num(st.turns), 2)}${num(st.pitch_mm) ? ` helix ${round(num(st.pitch_mm), 2)} mm` : ""}`;
      break;
    default:
      s = st.point ? `${st.point}${st.offset ? ` ${off(st.offset)}` : ""}` : `relative ${off(st.offset)}`;
  }
  if (st.weave) s += ` · weave ${st.weave.shape}`;
  return s;
}

/** Every point name the step uses. */
export const stepPointNames = (st) => [st.point, st.via, st.center, ...(st.points || [])].filter(Boolean);

/* ───────────── checks ───────────── */

/** Shape problem of one step (keys its motion needs / must not have); null = fine. Mirrors stepShapeError(). */
export function shapeError(st) {
  const pt = has.point(st), via = has.via(st), ctr = has.center(st), ang = has.angle_deg(st), rad = has.radius_mm(st);
  const pts = has.points(st), turns = has.turns(st), pitch = has.pitch_mm(st), srad = has.start_radius_mm(st);
  const only = (list) => {
    for (const [on, key] of list) if (on) return { message: `${key} is not used by ${st.motion}`, field: key.split(" ")[0] };
    return null;
  };
  if (st.offset && st.motion !== "PTP" && st.motion !== "LIN") return { message: "offset is only for PTP / LIN steps", field: "offset" };
  if (st.weave && !["LIN", "CIRC", "CIRCLE"].includes(st.motion)) return { message: "weave works on LIN, CIRC and CIRCLE", field: "weave" };
  if (st.weave && st.motion === "LIN" && !pt) return { message: "a LIN weave needs a point (the seam end)", field: "point" };
  switch (st.motion) {
    case "PTP":
    case "LIN":
      if (!pt && !st.offset) return { message: "needs a point, or an offset for a relative move", field: "point" };
      return only([[via, "via"], [ctr, "center"], [pts, "points"], [rad, "radius_mm"], [ang, "angle_deg"], [turns, "turns"], [pitch, "pitch_mm"], [srad, "start_radius_mm"]]);
    case "CIRC":
      if (via && ctr) return { message: "give via OR center, not both", field: "center" };
      if (via && !pt) return { message: "a 3-point arc needs via and point", field: "point" };
      if (ctr && !pt && !ang) return { message: "an arc around a center needs point or angle_deg", field: "point" };
      if (ctr && pt && ang) return { message: "around a center give point OR angle_deg", field: "angle_deg" };
      if (!via && !ctr) return { message: "needs via + point, center + point or center + angle_deg", field: "via" };
      if (via && num(st.angle_deg) < 0) return { message: "angle_deg must be > 0 with via (the direction comes from the points)", field: "angle_deg" };
      return only([[pts, "points"], [rad, "radius_mm"], [turns, "turns"], [pitch, "pitch_mm"], [srad, "start_radius_mm"]]);
    case "CIRCLE":
      if (via && ctr) return { message: "give via + point (3 points) OR center + radius_mm, not both", field: "center" };
      if (via && !pt) return { message: "a 3-point circle needs via and point", field: "point" };
      if (ctr && !rad) return { message: "a circle around a center needs radius_mm", field: "radius_mm" };
      if (!via && !ctr) return { message: "needs via + point (3 points) or center + radius_mm", field: "via" };
      if (ctr && pt) return { message: "a circle around a center starts on the circle: no point", field: "point" };
      if (via && num(st.angle_deg) < 0) return { message: "angle_deg must be > 0 with via (the direction comes from the points)", field: "angle_deg" };
      if (via && rad) return { message: "radius_mm is not used with via (the 3 points fix the circle)", field: "radius_mm" };
      return only([[pts, "points"], [turns, "turns"], [pitch, "pitch_mm"], [srad, "start_radius_mm"]]);
    case "SPLINE":
      if (!pts) return { message: "needs points: [p1, p2, ...]", field: "points" };
      return only([[pt, "point (put it in points)"], [via, "via"], [ctr, "center"], [rad, "radius_mm"], [ang, "angle_deg"], [turns, "turns"], [pitch, "pitch_mm"], [srad, "start_radius_mm"]]);
    case "SPIRAL":
      if (!ctr || !rad || !turns) return { message: "needs center, radius_mm and turns", field: !ctr ? "center" : !rad ? "radius_mm" : "turns" };
      return only([[pt, "point"], [via, "via"], [pts, "points"], [ang, "angle_deg"]]);
    default:
      return null;
  }
}

/**
 * Check a program like the motion server does (and a little more: warnings
 * for things the server only finds at run time).
 *
 * ctx.points: Map name -> { hasJoints: bool, isTf: bool } (optional; without it point names are not checked)
 * Returns [{ level: 'error'|'warning', step: index|null, field, message, fix?: { label, patch: (program) => program } }]
 */
export function checkProgram(p, ctx = {}) {
  const out = [];
  const err = (step, field, message, fix) => out.push({ level: "error", step, field, message, fix });
  const warn = (step, field, message, fix) => out.push({ level: "warning", step, field, message, fix });
  const setStep = (i, patch) => (prog) => ({ ...prog, steps: prog.steps.map((s, k) => (k === i ? { ...s, ...patch } : s)) });

  if (!p.name) err(null, "name", "program name is empty");
  else if (!NAME_RE.test(p.name)) err(null, "name", `program name '${p.name}': only letters, digits, _ and - (up to 64)`);
  if (p._stepsNotList) err(null, "steps", "steps must be a list");
  const steps = p.steps || [];
  if (!steps.length) err(null, "steps", "no steps");
  if (steps.length > LIMITS.steps) err(null, "steps", `at most ${LIMITS.steps} steps`);
  if (!Number.isInteger(num(p.repeat)) || num(p.repeat) < 0) err(null, "repeat", "repeat must be a whole number ≥ 0 (0 = until stopped)");
  if (!(num(p.speed_mps) >= 0)) err(null, "speed_mps", "speed_mps must be ≥ 0");
  if (!(num(p.acceleration_mps2) >= 0)) err(null, "acceleration_mps2", "acceleration_mps2 must be ≥ 0");
  if (num(p.repeat) === 0) warn(null, "repeat", "repeat 0 runs until stopped; a RunProgram node in a tree refuses it");
  if (ctx.points && p.frame && !ctx.points.get(p.frame)?.isTf) warn(null, "frame", `frame '${p.frame}' is not a point with is_tf: true`);

  const inRange = (v, [lo, hi]) => Number.isFinite(v) && v >= lo && v <= hi;
  let blendRun = 0;
  steps.forEach((st, i) => {
    const n = i + 1;
    if (st._motionText) {
      err(i, "motion", `motion '${st._motionText}' is unknown: use PTP, LIN, CIRC, CIRCLE, SPLINE or SPIRAL`);
      return;
    }
    if (st._offsetNotMap) err(i, "offset", "offset must be a map {x, y, z, rx, ry, rz}");
    if (st._badOffsetKeys?.length) err(i, "offset", `offset key '${st._badOffsetKeys[0]}' (use x y z in mm, rx ry rz in deg)`);
    if (st._pointsNotList) err(i, "points", "points must be a list [p1, p2, ...]");
    const shape = shapeError(st);
    if (shape) err(i, shape.field, shape.message, shapeFix(st, i, setStep));
    if (i === 0 && (isPath(st) || !st.point))
      err(i, "motion", "the first step must be a PTP or LIN to a point (a program starts from a known position)", st.point ? { label: "Make it a PTP", patch: setStep(i, applyForm(st, "PTP", "point")) } : null);

    for (const [k, lim] of [["blend_mm", LIMITS.blend_mm], ["speed_mps", [0, Infinity]], ["acceleration_mps2", [0, Infinity]], ["dwell_s", LIMITS.dwell_s]])
      if (!inRange(num(st[k]), lim)) err(i, k, `${k} must be in [${lim[0]}, ${lim[1] === Infinity ? "∞" : lim[1]}]`);

    const lock = blendLockReason(steps, i);
    if (lock && num(st.blend_mm) !== 0) err(i, "blend_mm", lock.replace(/: blend must be 0\.$/, "").replace(/\.$/, "") + ": blend_mm must be 0", { label: "Set blend to 0", patch: setStep(i, { blend_mm: 0 }) });

    if (st.offset) {
      const o = st.offset;
      if (!["x", "y", "z"].every((k) => inRange(num(o[k]), LIMITS.offset_mm))) err(i, "offset", "offset x / y / z must be within ±5000 mm");
      if (!["rx", "ry", "rz"].every((k) => inRange(num(o[k]), LIMITS.offset_deg))) err(i, "offset", "offset rx / ry / rz must be within ±360 deg");
      if (!offsetAny(o)) warn(i, "offset", st.point ? "offset is all zero (same as no offset)" : "relative move of 0: the robot does not move", st.point ? { label: "Remove offset", patch: setStep(i, { offset: null, offset_frame: "" }) } : null);
    }
    if (st.offset_frame && !["base", "tool"].includes(st.offset_frame)) err(i, "offset_frame", "offset_frame must be base or tool");
    if (st.offset_frame && !st.offset) warn(i, "offset_frame", "offset_frame without an offset does nothing");
    if (st.orientation) {
      if (!["constant", "interpolate", "path"].includes(st.orientation)) err(i, "orientation", "orientation must be constant, interpolate or path");
      else if (!isPath(st)) err(i, "orientation", "orientation is for path motions (CIRC, CIRCLE, SPLINE, SPIRAL, weave)", { label: "Remove orientation", patch: setStep(i, { orientation: "" }) });
      else if (st.orientation === "interpolate" && !interpolateOk(st)) err(i, "orientation", "orientation interpolate needs an end point (CIRC to a point, SPLINE, LIN weave)", { label: "Use constant", patch: setStep(i, { orientation: "constant" }) });
    }
    const r = num(st.radius_mm);
    if (!inRange(r, LIMITS.radius_mm)) err(i, "radius_mm", "radius_mm must be in [0, 5000]");
    else if (r > 0 && r < 1) err(i, "radius_mm", "radius_mm must be at least 1 mm");
    if (!inRange(num(st.start_radius_mm), LIMITS.start_radius_mm)) err(i, "start_radius_mm", "start_radius_mm must be in [0, 5000]");
    if (!inRange(num(st.angle_deg), LIMITS.angle_deg)) err(i, "angle_deg", "angle_deg must be within ±3600");
    if (!inRange(num(st.turns), LIMITS.turns) || (st.motion === "SPIRAL" && num(st.turns) === 0)) err(i, "turns", "turns must be within ±200 and not 0 (negative = clockwise)");
    if (!inRange(num(st.pitch_mm), LIMITS.pitch_mm)) err(i, "pitch_mm", "pitch_mm must be within ±500");
    if (st.motion === "SPIRAL" && num(st.radius_mm) === num(st.start_radius_mm) && num(st.pitch_mm) === 0)
      err(i, "pitch_mm", "a SPIRAL with start_radius_mm = radius_mm needs pitch_mm (helix), else use CIRCLE");
    if (st.motion === "SPIRAL" && num(st.start_radius_mm) > num(st.radius_mm)) warn(i, "start_radius_mm", "start radius is larger than the radius: the spiral runs inwards");
    if (st.points.length > LIMITS.spline_points) err(i, "points", `at most ${LIMITS.spline_points} points in a SPLINE`);
    if (st.weave) {
      if (!WEAVE_SHAPES.includes(st.weave.shape)) err(i, "weave_shape", `weave shape must be ${WEAVE_SHAPES.join(", ")}`);
      if (!(num(st.weave.amplitude_mm) > 0 && num(st.weave.amplitude_mm) <= 50)) err(i, "amplitude_mm", "weave amplitude_mm must be in (0, 50]");
      if (!(num(st.weave.wavelength_mm) > 0 && num(st.weave.wavelength_mm) <= 100)) err(i, "wavelength_mm", "weave wavelength_mm must be in (0, 100]");
      if (st.motion !== "LIN" && num(st.radius_mm) && num(st.weave.amplitude_mm) >= 0.9 * num(st.radius_mm)) warn(i, "amplitude_mm", "the amplitude must be smaller than 90 % of the arc radius it rides on");
    }
    if (num(st.speed_mps) > 2) warn(i, "speed_mps", `${num(st.speed_mps)} m/s is fast (Pilz Cartesian limit 2 m/s); the server caps it at the go-to max speed`);
    blendRun = num(st.blend_mm) > 0 ? blendRun + 1 : 0;
    if (blendRun === 50) warn(i, "blend_mm", "more than 50 blended steps in a row: put a blend 0 step in between (max_sequence_steps)");

    // points.yaml
    if (ctx.points) {
      for (const name of stepPointNames(st)) {
        const info = ctx.points.get(name);
        const field = name === st.point ? "point" : name === st.via ? "via" : name === st.center ? "center" : "points";
        if (!info) err(i, field, `not a taught point: ${name}`);
        else if (!info.hasJoints) err(i, field, `point '${name}' is not usable (joints_values missing): re-teach it`);
      }
    }
    // geometry the client can check from taught points
    if (ctx.points && st.motion === "CIRC" && st.via && st.point && st.via === st.point) err(i, "via", "start, via and end must be three different points");
    if (st.motion === "SPLINE" && st.points.length && new Set(st.points).size === 1 && n > 1 && steps[i - 1]?.point === st.points[0]) warn(i, "points", "the spline needs at least one point away from the start");
  });
  return out;
}

function shapeFix(st, i, setStep) {
  // Clean the step into its detected form: removes keys its motion does not use.
  const fixed = applyForm(st, st.motion, detectForm(st));
  const changed = GEOMETRY_KEYS.some((k) => JSON.stringify(fixed[k]) !== JSON.stringify(st[k]));
  return changed ? { label: "Remove unused keys", patch: setStep(i, fixed) } : null;
}

/** Program-name list check (duplicates). */
export function checkProgramList(programs) {
  const seen = new Map();
  const out = [];
  programs.forEach((p) => {
    if (seen.has(p.name)) out.push({ name: p.name, message: `program '${p.name}' appears twice: the motion server keeps the first one` });
    seen.set(p.name, true);
  });
  return out;
}

/** Map for checkProgram from points.yaml point objects. */
export function pointsIndex(points = []) {
  const m = new Map();
  for (const pt of points || []) {
    if (!pt?.name) continue;
    const jv = pt.joints_values || {};
    const hasJoints = ["joint1", "joint2", "joint3", "joint4", "joint5", "joint6"].every((k) => Number.isFinite(Number(jv[k])) && jv[k] !== null && jv[k] !== "");
    m.set(pt.name, { hasJoints, isTf: pt.is_tf === true || pt.is_tf === "true", coordinate: pt.coordinate || null, nature: pt.nature || "" });
  }
  return m;
}

/** A new step that fits after `prev` (same point, PTP), or a starter step. */
export function newStep(kind = "ptp", prev = null, pointNames = []) {
  const base = normalizeStep({});
  const at = prev?.point || prev?.points?.[prev.points.length - 1] || pointNames[0] || "";
  switch (kind) {
    case "lin":
      return { ...base, motion: "LIN", point: at };
    case "above":
      return { ...base, motion: "PTP", point: at, offset: { ...emptyOffset(), z: 80 } };
    case "retract":
      return { ...base, motion: "LIN", offset: { ...emptyOffset(), z: 80 } };
    case "arc":
      return applyForm({ ...base, point: at }, "CIRC", "via");
    case "circle":
      return applyForm({ ...base, center: at }, "CIRCLE", "center_radius");
    case "spline":
      return { ...base, motion: "SPLINE", points: at ? [at] : [] };
    case "spiral":
      return applyForm({ ...base, center: at }, "SPIRAL", "spiral");
    case "weave":
      return { ...base, motion: "LIN", point: at, weave: { shape: "sine", amplitude_mm: 3, wavelength_mm: 5 } };
    default:
      return { ...base, motion: "PTP", point: at };
  }
}

/** The program a new project starts with (also in backend pm_defaults/programs.yaml). */
export const STARTER_PROGRAM = {
  name: "simple_move",
  description: "starter program: home, 50 mm down and back (edit or delete it)",
  repeat: 1,
  speed_mps: 0.25,
  acceleration_mps2: 1.0,
  steps: [
    { point: "home", motion: "PTP" },
    { offset: { z: -50 }, motion: "LIN", speed_mps: 0.1 },
    { point: "home", motion: "LIN", speed_mps: 0.1 },
  ],
};
