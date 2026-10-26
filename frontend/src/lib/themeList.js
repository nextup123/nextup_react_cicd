// Accent colours and modes offered in the Theme window. Safety colours
// (emergency, fault, OK, warning, E-STOP) are not part of a theme and never
// change. scripts/gen-themes.mjs builds styles/themes.css from this list.
export const ACCENTS = [
  // Indigo is the original NextUp colour: light mode keeps its exact values.
  {
    id: "indigo",
    label: "Indigo",
    color: "#5b5fe0",
    exact: { light: { 50: "#eef0ff", 100: "#e0e3ff", 200: "#c5caff", 500: "#5b5fe0", 600: "#4a4ec9", 700: "#3d40a8", ink: "#4a4ec9" } },
  },
  { id: "royal", label: "Royal blue", color: "#2563eb" },
  { id: "sky", label: "Sky", color: "#0284c7" },
  { id: "cyan", label: "Cyan", color: "#0891b2" },
  { id: "teal", label: "Teal", color: "#0d9488" },
  { id: "violet", label: "Violet", color: "#7c3aed" },
  { id: "orchid", label: "Orchid", color: "#c026d3" },
  { id: "graphite", label: "Graphite", color: "#475569" },
  // Round 20: more distinct hues. Kept clear of the safety colours (no red, amber or bright green).
  { id: "navy", label: "Navy", color: "#1e3a8a" },
  { id: "denim", label: "Denim", color: "#3f5f8a" },
  { id: "plum", label: "Plum", color: "#86198f" },
  { id: "pink", label: "Pink", color: "#db2777" },
  { id: "mocha", label: "Mocha", color: "#8b5a2b" },
  { id: "olive", label: "Olive", color: "#5f7a1a" },
  { id: "spruce", label: "Spruce", color: "#2f5d50" },
  { id: "aubergine", label: "Aubergine", color: "#5b2a86" },
];

// `surface` is the card colour of each mode (used to mix the accent tints).
export const MODES = {
  light: { label: "Light", surface: "#ffffff", dark: false },
  gray: { label: "Gray", surface: "#e4e7eb", dark: false },
  dark: { label: "Dark", surface: "#171a21", dark: true },
};
