// plc/paths.js -- where the NextPLC files live. Every root comes from config/roots.js.
//
//   Project (active_project_configs/plc_data): only what the node runs for this cell, saved and
//   versioned with the project
//     program.yaml      this project's program (node parameter program_file)
//     retain.yaml       the node's retained registers (node parameter retain_file, never written here)
//   Library (user_config_files/plc): shared by every project, kept when the project changes
//     programs/*.yaml   saved programs anyone can open, edit or use in their project
//     scenarios/*.sim   test scenarios of those programs
//     blocks/           your own library blocks (node parameter block_dirs)
//     backups/          the project program a "Use in this project" replaced
//   App (backend/user_config/nextplc): the console's own state, never read by the node
//     mode.json, sim_retain.yaml, sim_active.json; package/ = bundled copy of the nextplc package
//     (library blocks, manuals, examples) used when the package is not installed
//
// Env overrides: NEXTPLC_DIR (library folder), NEXTPLC_PKG (package), NEXTPLC_BIN (tools).
import fs from "node:fs";
import path from "node:path";
import { USER_CONFIG_FILES, ACTIVE_PROJECT_DIR, APP_USER_CONFIG, NEXTUP_WS } from "../config/roots.js";

const exists = (p) => { try { fs.accessSync(p); return true; } catch { return false; } };

export const ROBOT_PLC_DIR = process.env.NEXTPLC_DIR || path.join(USER_CONFIG_FILES, "plc");
export const PROGRAMS_DIR = path.join(ROBOT_PLC_DIR, "programs");
export const SCENARIOS_DIR = path.join(ROBOT_PLC_DIR, "scenarios");
export const USER_BLOCKS_DIR = path.join(ROBOT_PLC_DIR, "blocks");
export const BACKUPS_DIR = path.join(ROBOT_PLC_DIR, "backups");
const SEED_MARK = path.join(PROGRAMS_DIR, ".nextplc_seeded");

export const PROJECT_PLC_DIR = path.join(ACTIVE_PROJECT_DIR, "plc_data");
/** This project's program: what the PLC runs (and loads at its start) for this project. */
export const PROJECT_PROGRAM = path.join(PROJECT_PLC_DIR, "program.yaml");
export const PROJECT_RETAIN = path.join(PROJECT_PLC_DIR, "retain.yaml");
/** Name the API uses for the project program (library names cannot contain "@"). */
export const PROJECT_NAME = "@project";

export const STATE_DIR = path.join(APP_USER_CONFIG, "nextplc");
export const SIM_RETAIN_FILE = path.join(STATE_DIR, "sim_retain.yaml");
export const SIM_ACTIVE_FILE = path.join(STATE_DIR, "sim_active.json");
export const MODE_FILE = path.join(STATE_DIR, "mode.json");
const BUNDLED_PKG = path.join(STATE_DIR, "package");

function findPackage() {
  const candidates = [process.env.NEXTPLC_PKG, path.join(NEXTUP_WS, "src", "nextplc")];
  for (const p of (process.env.AMENT_PREFIX_PATH || "").split(":")) if (p) candidates.push(path.join(p, "share", "nextplc"));
  for (const c of candidates) if (c && exists(path.join(c, "blocks"))) return { dir: c, bundled: false };
  return { dir: BUNDLED_PKG, bundled: true };
}
const PKG = findPackage();
export const PKG_DIR = PKG.dir;
export const PKG_BUNDLED = PKG.bundled;
export const LIB_BLOCKS_DIR = path.join(PKG_DIR, "blocks");
// manuals: the installed package's, else the bundled copy (always the newer v5 docs)
export const DOCS_DIR = exists(path.join(PKG_DIR, "doc")) ? path.join(PKG_DIR, "doc") : path.join(BUNDLED_PKG, "doc");
export const EXAMPLES_DIR = exists(path.join(PKG_DIR, "programs")) ? path.join(PKG_DIR, "programs") : path.join(BUNDLED_PKG, "programs");

export function findBinary(name) {
  const candidates = [];
  if (process.env.NEXTPLC_BIN) candidates.push(path.join(process.env.NEXTPLC_BIN, name));
  for (const d of (process.env.PATH || "").split(":")) if (d) candidates.push(path.join(d, name));
  for (const p of (process.env.AMENT_PREFIX_PATH || "").split(":")) if (p) candidates.push(path.join(p, "lib", "nextplc", name));
  for (const c of candidates) { try { fs.accessSync(c, fs.constants.X_OK); return c; } catch { /* next */ } }
  return null;
}
export const CHECK_BIN = findBinary("nextplc_check");
export const SIM_BIN = findBinary("nextplc_sim");

const PROGRAM_FILE = /^[A-Za-z0-9_][A-Za-z0-9_.-]*\.ya?ml$/i;
const sameText = (a, b) => { try { return fs.readFileSync(a, "utf8") === fs.readFileSync(b, "utf8"); } catch { return false; } };

/**
 * Move one file into a library folder. Same name and text there: dropped. Same name, other
 * text: kept as <name>_<tag>. Returns the library file name or "".
 */
function moveToLibrary(src, dir, tag) {
  const f = path.basename(src);
  const ext = path.extname(f), base = f.slice(0, -ext.length);
  let to = path.join(dir, f);
  if (exists(to)) {
    if (sameText(src, to)) { fs.rmSync(src, { force: true }); return f; }
    const t = String(tag || "project").replace(/[^A-Za-z0-9_]/g, "_") || "project";
    let n = 0;
    do { to = path.join(dir, `${base}_${t}${n ? `_${n}` : ""}${ext}`); n++; } while (exists(to) && !sameText(src, to));
    if (exists(to)) { fs.rmSync(src, { force: true }); return path.basename(to); }
  }
  fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(src, to);
  fs.rmSync(src, { force: true });
  return path.basename(to);
}

/**
 * Bring one plc_data folder (the active project or a saved project) to the layout above: every
 * program except program.yaml and every scenario moves to the library, the old seed marker goes.
 * Safe to run any number of times. Returns the number of files moved.
 */
export function migrateProjectPlcDir(dir, tag) {
  let moved = 0;
  if (!exists(dir)) return 0;
  try {
    for (const f of fs.readdirSync(dir)) {
      const p = path.join(dir, f);
      if (f === "program.yaml" || f === "retain.yaml") continue;
      if (f === ".nextplc_seeded") { fs.rmSync(p, { force: true }); continue; }
      if (f === "scenarios" && fs.statSync(p).isDirectory()) {
        for (const s of fs.readdirSync(p)) if (s.endsWith(".sim")) { moveToLibrary(path.join(p, s), SCENARIOS_DIR, tag); moved++; }
        if (!fs.readdirSync(p).length) fs.rmdirSync(p);
        continue;
      }
      if (f === "blocks" && fs.statSync(p).isDirectory()) {
        for (const s of fs.readdirSync(p)) if (s.endsWith(".yaml")) { moveToLibrary(path.join(p, s), USER_BLOCKS_DIR, tag); moved++; }
        if (!fs.readdirSync(p).length) fs.rmdirSync(p);
        continue;
      }
      if (PROGRAM_FILE.test(f)) { moveToLibrary(p, PROGRAMS_DIR, tag); moved++; }
    }
  } catch { /* a read-only folder stays as it is */ }
  return moved;
}

/**
 * The library folder before this layout held the robot's startup program, its dated backups and
 * the retained registers. The startup program (what the robot ran) becomes the active project's
 * program and joins the library unless it is there already, the backups go to backups/,
 * retain.yaml moves to the active project. Never throws.
 */
function migrateOldRobotFolder() {
  try {
    const old = path.join(ROBOT_PLC_DIR, "program.yaml");
    if (exists(old)) {
      // the robot ran this one: it becomes the active project's program (saved project too), a
      // different program.yaml the project had stays in the library
      fs.mkdirSync(PROJECT_PLC_DIR, { recursive: true });
      const tag = activeProjectTag();
      if (exists(PROJECT_PROGRAM) && !sameText(PROJECT_PROGRAM, old)) {
        const keep = path.join(PROJECT_PLC_DIR, `program_${tag.replace(/[^A-Za-z0-9_]/g, "_") || "project"}.yaml`);
        fs.copyFileSync(PROJECT_PROGRAM, keep);
        moveToLibrary(keep, PROGRAMS_DIR, tag);
      }
      fs.copyFileSync(old, PROJECT_PROGRAM);
      const saved = savedProjectDir();
      if (saved && exists(saved)) { fs.mkdirSync(path.join(saved, "plc_data"), { recursive: true }); fs.copyFileSync(old, path.join(saved, "plc_data", "program.yaml")); }
      const lib = path.join(PROGRAMS_DIR, "startup_program.yaml");
      const known = fs.readdirSync(PROGRAMS_DIR).some((f) => PROGRAM_FILE.test(f) && sameText(path.join(PROGRAMS_DIR, f), old));
      if (!known && !exists(lib)) fs.copyFileSync(old, lib);
      fs.rmSync(old, { force: true });
    }
    for (const f of fs.readdirSync(ROBOT_PLC_DIR)) {
      if (/^program\.yaml\.bak_/.test(f)) {
        fs.mkdirSync(BACKUPS_DIR, { recursive: true });
        fs.renameSync(path.join(ROBOT_PLC_DIR, f), path.join(BACKUPS_DIR, f.replace(/^program\.yaml\.bak_(.*)$/, "program_$1.yaml")));
      }
    }
    const oldRetain = path.join(ROBOT_PLC_DIR, "retain.yaml");
    if (exists(oldRetain)) {
      fs.mkdirSync(PROJECT_PLC_DIR, { recursive: true });
      if (!exists(PROJECT_RETAIN)) fs.copyFileSync(oldRetain, PROJECT_RETAIN);
      fs.rmSync(oldRetain, { force: true });
    }
  } catch { /* ignore */ }
}

/**
 * Make sure the folders exist and the files are in the layout above. The library gets the package
 * examples once (marker file), so deleting every program does not bring them back.
 * Never throws: a missing or read-only folder only disables what needs it.
 */
export function ensureDirs() {
  for (const d of [STATE_DIR, PROGRAMS_DIR, SCENARIOS_DIR, USER_BLOCKS_DIR]) {
    try { fs.mkdirSync(d, { recursive: true }); } catch { /* reported by the routes */ }
  }
  try { fs.mkdirSync(PROJECT_PLC_DIR, { recursive: true }); } catch { /* no active project folder */ }
  migrateProjectPlcDir(PROJECT_PLC_DIR, activeProjectTag());
  migrateOldRobotFolder();
  try {
    if (exists(SEED_MARK)) return;
    const have = fs.readdirSync(PROGRAMS_DIR).some((f) => PROGRAM_FILE.test(f));
    if (!have && exists(EXAMPLES_DIR)) {
      for (const f of fs.readdirSync(EXAMPLES_DIR)) {
        if (/^(example_cell|cell_with_blocks|first_test|blink_cycle)\.(yaml|sim)$/.test(f)) {
          const to = f.endsWith(".sim") ? path.join(SCENARIOS_DIR, f) : path.join(PROGRAMS_DIR, f);
          if (!exists(to)) fs.copyFileSync(path.join(EXAMPLES_DIR, f), to);
        }
      }
    }
    fs.writeFileSync(SEED_MARK, "the library was set up by the web console\n");
  } catch { /* ignore */ }
}

/** Saved folder of the active project (user_config_files/projects/<active_project>). */
function savedProjectDir() {
  try {
    const m = /^active_project:\s*['"]?([^'"\n]+)/m.exec(fs.readFileSync(path.join(USER_CONFIG_FILES, "active_project.yaml"), "utf8"));
    const n = m && m[1].trim();
    return n && n !== "null" && !n.includes("/") ? path.join(USER_CONFIG_FILES, "projects", n) : "";
  } catch { return ""; }
}

/** Name of the active project (from its project.yaml), for library names on a clash. */
function activeProjectTag() {
  try {
    const t = fs.readFileSync(path.join(ACTIVE_PROJECT_DIR, "project.yaml"), "utf8");
    const m = /^name:\s*['"]?([^'"\n]+)/m.exec(t);
    return m ? m[1].trim() : "project";
  } catch { return "project"; }
}

/** Block search order of the node: the program's own folder, the robot's blocks, the library. */
export function blockDirs(programPath) {
  const dirs = [];
  if (programPath) dirs.push(path.join(path.dirname(programPath), "blocks"));
  dirs.push(USER_BLOCKS_DIR, LIB_BLOCKS_DIR);
  return dirs;
}
