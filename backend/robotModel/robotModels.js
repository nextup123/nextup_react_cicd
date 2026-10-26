// Robot models offered in the 3D view: every robot description in
// robotModelPaths.URDF_DIR. Picks up new files on every listing, expands
// xacro (ROS tool or built-in), parses the URDF and serves the meshes.
// The chosen model is saved in user_config/robot_model.json and announced to
// every browser (ROBOT_MODEL) and to the simulator, which takes its joints,
// limits and kinematics from it.
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { robotModelPaths } from '../config/path.js';
import { expandXacro } from './xacro.js';
import { parseUrdf } from './urdf.js';
import { meshCache } from './meshes.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const USER_CONFIG = path.join(__dirname, '..', 'user_config');
const SELECTION_FILE = path.join(USER_CONFIG, 'robot_model.json');
const MODEL_RE = /\.(urdf\.xacro|xacro|urdf)$/i;

const getMesh = meshCache(path.join(USER_CONFIG, 'mesh_cache'));
const modelCache = new Map(); // id → { stamp, model }
const meshFiles = new Map(); // mesh id → absolute file
const listeners = new Set();

const idOf = (file) => path.basename(file).replace(MODEL_RE, '');

/** "nextupRobot1" → "Robot 1", "nextupCobot" → "Cobot". */
function labelOf(id) {
  const s = id.replace(/^nextup[_-]?/i, '') || id;
  return s
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z])([A-Z0-9])/g, '$1 $2')
    .replace(/^./, (c) => c.toUpperCase());
}

function urdfDir() {
  return robotModelPaths.URDF_DIR;
}

function packageDirs() {
  const dirs = [...robotModelPaths.PACKAGE_DIRS];
  for (const p of String(process.env.AMENT_PREFIX_PATH || '').split(':').filter(Boolean)) dirs.push(path.join(p, 'share'));
  return dirs;
}

const pkgCache = new Map();
/** Directory of a ROS package: <dir>/<pkg>, <dir>/<pkg>/share/<pkg> or one level deeper in a source tree. */
export function findPackage(pkg) {
  if (pkgCache.has(pkg)) return pkgCache.get(pkg);
  let found = null;
  const isPkg = (d) => fs.existsSync(path.join(d, 'package.xml')) || fs.existsSync(path.join(d, 'CMakeLists.txt'));
  for (const d of packageDirs()) {
    const cands = [path.join(d, pkg), path.join(d, pkg, 'share', pkg)];
    try {
      for (const sub of fs.readdirSync(d, { withFileTypes: true })) if (sub.isDirectory()) cands.push(path.join(d, sub.name, pkg));
    } catch {
      /* missing dir */
    }
    found = cands.find((c) => fs.existsSync(c) && isPkg(c));
    if (found) break;
  }
  // The URDF folder's own package (…/<pkg>/urdf) as a last resort.
  if (!found && path.basename(path.dirname(urdfDir())) === pkg) found = path.dirname(urdfDir());
  if (found) pkgCache.set(pkg, found);
  return found;
}

function resolveMeshFor(baseDir) {
  return (filename) => {
    if (!filename) return null;
    let f = filename;
    if (f.startsWith('package://')) {
      const [pkg, ...rest] = f.slice(10).split('/');
      const dir = findPackage(pkg);
      if (!dir) return null;
      f = path.join(dir, ...rest);
    } else if (f.startsWith('file://')) f = f.slice(7);
    else if (!path.isAbsolute(f)) f = path.resolve(baseDir, f);
    if (fs.existsSync(f)) return f;
    // Exports from CAD tools often differ only in case (Link1.STL / link1.stl).
    try {
      const want = path.basename(f).toLowerCase();
      const hit = fs.readdirSync(path.dirname(f)).find((n) => n.toLowerCase() === want);
      return hit ? path.join(path.dirname(f), hit) : null;
    } catch {
      return null;
    }
  };
}

/** The model ROS itself loads: robot_type in the description xacro. */
export function rosModelId() {
  try {
    const text = fs.readFileSync(robotModelPaths.DESCRIPTION_XACRO, 'utf8').replace(/<!--[\s\S]*?-->/g, '');
    const type = /<xacro:property\s+name="robot_type"\s+value="([^"]+)"/.exec(text)?.[1];
    if (!type) return null;
    const block = new RegExp(`<xacro:if\\s+value="\\$\\{\\s*robot_type\\s*==\\s*'${type}'\\s*\\}"\\s*>([\\s\\S]*?)</xacro:if>`).exec(text);
    const file = block && /filename="([^"]+)"/.exec(block[1])?.[1];
    return file ? idOf(file) : null;
  } catch {
    return null;
  }
}

function readSelection() {
  try {
    return JSON.parse(fs.readFileSync(SELECTION_FILE, 'utf8')).id || null;
  } catch {
    return null;
  }
}

export function listModels() {
  let files = [];
  try {
    files = fs.readdirSync(urdfDir()).filter((f) => MODEL_RE.test(f)).sort();
  } catch {
    /* folder missing: empty list */
  }
  // a.urdf.xacro and a.urdf: keep the xacro
  const seen = new Set();
  const models = [];
  for (const f of files.sort((a, b) => (/\.xacro$/i.test(a) ? -1 : 1) - (/\.xacro$/i.test(b) ? -1 : 1) || a.localeCompare(b))) {
    const id = idOf(f);
    if (seen.has(id)) continue;
    seen.add(id);
    models.push({ id, file: f, label: labelOf(id) });
  }
  models.sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));
  const ros = rosModelId();
  const saved = readSelection();
  const ids = models.map((m) => m.id);
  const selected = ids.includes(saved) ? saved : ids.includes(ros) ? ros : ids[0] || null;
  return { dir: urdfDir(), models: models.map((m) => ({ ...m, ros: m.id === ros })), selected, rosModel: ros };
}

export function selectedModelId() {
  return listModels().selected;
}

/** Expanded and parsed model, cached until the file changes. */
export async function loadModel(id) {
  const entry = listModels().models.find((m) => m.id === id);
  if (!entry) throw Object.assign(new Error(`No robot model '${id}' in ${urdfDir()}`), { status: 404 });
  const file = path.join(urdfDir(), entry.file);
  const st = fs.statSync(file);
  const stamp = `${st.size}|${st.mtimeMs}`;
  const hit = modelCache.get(id);
  if (hit?.stamp === stamp) return hit.model;

  const { xml, tool, toolError } = await expandXacro(file, { findPackage });
  const parsed = parseUrdf(xml, { resolveMesh: resolveMeshFor(path.dirname(file)) });
  const meshIds = parsed.meshes.map((f) => {
    const mid = crypto.createHash('sha1').update(f).digest('hex').slice(0, 16);
    meshFiles.set(mid, f);
    return mid;
  });
  for (const l of parsed.links) {
    for (const v of l.visuals) if (v.geometry.type === 'mesh') v.geometry.mesh = meshIds[v.geometry.mesh];
  }
  const missing = parsed.links.flatMap((l) => l.visuals.filter((v) => v.geometry.type === 'missing').map((v) => v.geometry.filename));
  const model = {
    id,
    label: entry.label,
    file: entry.file,
    name: parsed.name,
    root: parsed.root,
    links: parsed.links,
    joints: parsed.joints,
    expandedWith: tool,
    toolError: toolError || undefined,
    missingMeshes: missing,
    stamp: crypto.createHash('sha1').update(stamp + xml.length).digest('hex').slice(0, 10),
  };
  modelCache.set(id, { stamp, model });
  return model;
}

export async function meshFor(meshId, detail) {
  let file = meshFiles.get(meshId);
  if (!file) {
    // After a restart: load the selected model (fills the table) and look again.
    await loadModel(selectedModelId()).catch(() => {});
    file = meshFiles.get(meshId);
  }
  if (!file) throw Object.assign(new Error('Unknown mesh'), { status: 404 });
  return getMesh(file, detail);
}

export async function selectModel(id) {
  const model = await loadModel(id); // validates first
  fs.mkdirSync(USER_CONFIG, { recursive: true });
  fs.writeFileSync(SELECTION_FILE, JSON.stringify({ id, at: new Date().toISOString() }, null, 1));
  for (const fn of listeners) {
    try {
      fn(model);
    } catch (err) {
      console.error('[robot-models] listener failed', err);
    }
  }
  return model;
}

/** Called with the model whenever the selection changes. */
export function onModelSelected(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
