// Ready-made programs for "New program". Point names are the ones of the
// motion server's example file: after picking a template, the editor marks
// every point that is not taught yet and the point pickers offer the taught
// ones, so the template is a starting shape, not data.
import { normalizeProgram, STARTER_PROGRAM } from "./programRules.js";

const T = (id, label, use, program) => ({ id, label, use, program });

export const TEMPLATES = [
  T("blank", "Blank", "One PTP step to start from", {
    name: "new_program",
    description: "",
    repeat: 1,
    speed_mps: 0.25,
    acceleration_mps2: 1.0,
    steps: [{ point: "home", motion: "PTP" }],
  }),
  T("starter", "Simple move", "Home, 50 mm down and back (the starter program)", STARTER_PROGRAM),
  T("pick_place", "Pick and place", "PTP travel, LIN approach with offsets, blending", {
    name: "cnc1_pick",
    description: "pick from CNC1 chuck, place on conveyor",
    repeat: 1,
    speed_mps: 0.5,
    acceleration_mps2: 2.0,
    tool: "gripper",
    steps: [
      { point: "home", motion: "PTP", speed_mps: 1.0, blend_mm: 100 },
      { point: "PickpointCNC1", offset: { z: 80 }, motion: "PTP", blend_mm: 20, note: "80 mm above pick" },
      { point: "PickpointCNC1", motion: "LIN", speed_mps: 0.05, dwell_s: 0.5, note: "down, grip (BT closes gripper)" },
      { offset: { z: 80 }, motion: "LIN", speed_mps: 0.1, note: "straight up, relative" },
      { point: "PlacepointConvery", offset: { z: 100 }, motion: "PTP", blend_mm: 50 },
      { point: "PlacepointConvery", motion: "LIN", speed_mps: 0.05 },
      { offset: { z: 100 }, motion: "LIN" },
      { point: "home", motion: "PTP", speed_mps: 1.0 },
    ],
  }),
  T("pallet", "Palletizing", "One place program; the BT passes the slot offset per box", {
    name: "pallet_place",
    description: "place one box at pallet slot 0 (shifted per call)",
    repeat: 1,
    speed_mps: 1.0,
    acceleration_mps2: 3.0,
    tool: "vacuum",
    frame: "pallet_A",
    steps: [
      { point: "pallet_slot0", offset: { z: 150 }, motion: "PTP", blend_mm: 50 },
      { point: "pallet_slot0", motion: "LIN", speed_mps: 0.1 },
      { offset: { z: 150 }, motion: "LIN", speed_mps: 0.3 },
    ],
  }),
  T("weld", "Welding", "Seam with weave, arc seam, full circle with overlap", {
    name: "weld_bracket",
    description: "fillet weld along edge, arc corner, circular weld around a boss",
    repeat: 1,
    speed_mps: 0.008,
    acceleration_mps2: 0.5,
    tool: "torch",
    frame: "weld_table",
    steps: [
      { point: "seam_start", offset: { z: 20 }, motion: "PTP", speed_mps: 0.5 },
      { point: "seam_start", motion: "LIN", speed_mps: 0.05, note: "BT: arc on" },
      { point: "seam_end", motion: "LIN", weave: { shape: "sine", amplitude_mm: 3, wavelength_mm: 5 } },
      { point: "corner_end", via: "corner_mid", motion: "CIRC", note: "3-point arc" },
      { point: "boss_p1", motion: "LIN", speed_mps: 0.05 },
      { via: "boss_p2", point: "boss_p3", motion: "CIRCLE", angle_deg: 380, note: "3-point full circle + 20 deg overlap" },
      { offset: { z: 50 }, motion: "LIN", speed_mps: 0.2, note: "BT: arc off before this" },
    ],
  }),
  T("hole", "Drill / cut a hole", "Circle from one taught centre + radius", {
    name: "hole_circle_r25",
    description: "trace a 25 mm radius circle around a taught centre",
    repeat: 1,
    speed_mps: 0.02,
    tool: "spindle",
    steps: [
      { point: "hole_center", offset: { z: 30 }, motion: "PTP", speed_mps: 0.5 },
      { center: "hole_center", radius_mm: 25, motion: "CIRCLE", note: "1-point circle (moves to its start first)" },
      { offset: { z: 30 }, motion: "LIN", speed_mps: 0.2 },
    ],
  }),
  T("spray", "Spraying / painting", "Zig-zag raster with blending, constant speed", {
    name: "spray_panel",
    description: "four passes over a panel, 100 mm apart",
    repeat: 1,
    speed_mps: 0.3,
    acceleration_mps2: 2.0,
    tool: "spray_gun",
    frame: "panel",
    steps: [
      { point: "panel_start", offset: { x: -100 }, motion: "PTP", speed_mps: 0.8, note: "run-in before the panel" },
      { point: "panel_start", motion: "LIN", blend_mm: 20, note: "BT: spray on" },
      { point: "panel_end", motion: "LIN", blend_mm: 50 },
      { point: "panel_end", offset: { y: 100 }, motion: "LIN", blend_mm: 50 },
      { point: "panel_start", offset: { y: 100 }, motion: "LIN", blend_mm: 50 },
      { point: "panel_start", offset: { y: 200 }, motion: "LIN", blend_mm: 50 },
      { point: "panel_end", offset: { y: 200 }, motion: "LIN", blend_mm: 50 },
      { point: "panel_end", offset: { y: 300 }, motion: "LIN", blend_mm: 50 },
      { point: "panel_start", offset: { y: 300 }, motion: "LIN", note: "BT: spray off" },
      { offset: { x: -100 }, motion: "LIN", note: "run-out" },
    ],
  }),
  T("glue", "Gluing / sealing", "One smooth closed contour (spline)", {
    name: "glue_lid",
    description: "closed glue bead around a lid",
    repeat: 1,
    speed_mps: 0.05,
    tool: "dispenser",
    frame: "lid_fixture",
    steps: [
      { point: "glue_p1", offset: { z: 20 }, motion: "PTP", speed_mps: 0.5 },
      { point: "glue_p1", motion: "LIN", speed_mps: 0.05 },
      { points: ["glue_p2", "glue_p3", "glue_p4", "glue_p5", "glue_p1"], motion: "SPLINE" },
      { offset: { z: 20 }, motion: "LIN", speed_mps: 0.2 },
    ],
  }),
  T("polish", "Polishing / grinding", "Spiral out from a centre", {
    name: "polish_disc",
    description: "spiral out from the centre, 6 turns",
    repeat: 1,
    speed_mps: 0.03,
    tool: "polisher",
    steps: [
      { point: "disc_center", offset: { z: 20 }, motion: "PTP", speed_mps: 0.5 },
      { center: "disc_center", radius_mm: 40, turns: 6, motion: "SPIRAL", note: "add pitch_mm for a helix" },
      { offset: { z: 20 }, motion: "LIN", speed_mps: 0.2 },
    ],
  }),
  T("deburr", "Deburring", "Arc around a centre with a set sweep", {
    name: "deburr_quarter_edge",
    description: "follow a 90 deg rounded edge",
    repeat: 1,
    speed_mps: 0.02,
    tool: "deburr_spindle",
    steps: [
      { point: "edge_start", offset: { z: 10 }, motion: "PTP", speed_mps: 0.5 },
      { point: "edge_start", motion: "LIN", speed_mps: 0.05 },
      { center: "edge_center", angle_deg: 90, motion: "CIRC", note: "arc around a centre, 90 deg" },
      { offset: { z: 10 }, motion: "LIN", speed_mps: 0.2 },
    ],
  }),
];

/** A template as an editable program with a name that is free in `taken`. */
export function fromTemplate(tpl, taken = new Set()) {
  const p = normalizeProgram(JSON.parse(JSON.stringify(tpl.program)));
  let name = p.name;
  for (let i = 2; taken.has(name); i++) name = `${p.name}_${i}`;
  p.name = name;
  return p;
}
