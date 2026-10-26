// Mesh preparation for the 3D view: an STL (binary or ASCII) becomes a small,
// indexed mesh in a compact binary format, at one of three detail levels.
//
//   full    every triangle (vertices welded, so about 1/3 of the STL size)
//   medium  simplified to about 35 % of the triangles (at most 6000)
//   low     simplified to about 12 % (at most 1800)
//
// Simplification uses meshoptimizer (pure WebAssembly, no native build).
// Normals are split at sharp edges (crease angle) so machined parts keep
// crisp edges while curved surfaces stay smooth. Results are cached in memory
// and on disk (user_config/mesh_cache), keyed by file, size, mtime and level.
//
// Format "NXM1" (little endian):
//   u32 magic, u32 vertexCount, u32 indexCount, u32 flags (1 = 32-bit indices)
//   f32 positions[3 * vertexCount]
//   i8  normals[3 * vertexCount] (×127), padded to 4 bytes
//   u16|u32 indices[indexCount]
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

export const DETAILS = {
  low: { ratio: 0.12, max: 1800, error: 0.012 },
  medium: { ratio: 0.35, max: 6000, error: 0.004 },
  full: null,
};
const CREASE_COS = Math.cos((38 * Math.PI) / 180);
const MAGIC = 0x314d584e; // "NXM1"

let simplifier = null;
let simplifierTried = false;
async function getSimplifier() {
  if (simplifierTried) return simplifier;
  simplifierTried = true;
  try {
    const { MeshoptSimplifier } = await import('meshoptimizer');
    await MeshoptSimplifier.ready;
    simplifier = MeshoptSimplifier;
  } catch (err) {
    console.warn('[robot-models] meshoptimizer not installed: meshes are sent without simplification', err.message);
  }
  return simplifier;
}

/** STL → Float32Array of triangle corner positions (9 per triangle). */
export function parseStl(buf) {
  if (buf.length >= 84) {
    const n = buf.readUInt32LE(80);
    if (84 + n * 50 === buf.length) {
      const out = new Float32Array(n * 9);
      for (let i = 0; i < n; i++) {
        const o = 84 + i * 50 + 12;
        for (let k = 0; k < 9; k++) out[i * 9 + k] = buf.readFloatLE(o + k * 4);
      }
      return out;
    }
  }
  const text = buf.toString('latin1');
  const v = [];
  const re = /vertex\s+([-+\d.eE]+)\s+([-+\d.eE]+)\s+([-+\d.eE]+)/g;
  let m;
  while ((m = re.exec(text))) v.push(Number(m[1]), Number(m[2]), Number(m[3]));
  if (!v.length || v.length % 9) throw new Error('not a valid STL file');
  return new Float32Array(v);
}

/** Merges identical corners: returns { positions, indices }. */
function weld(tri) {
  let min = Infinity;
  let max = -Infinity;
  for (const x of tri) {
    if (x < min) min = x;
    if (x > max) max = x;
  }
  const q = Math.max(1e-7, (max - min) * 1e-6);
  const map = new Map();
  const pos = [];
  const idx = new Uint32Array(tri.length / 3);
  for (let i = 0; i < tri.length; i += 3) {
    const key = `${Math.round(tri[i] / q)},${Math.round(tri[i + 1] / q)},${Math.round(tri[i + 2] / q)}`;
    let id = map.get(key);
    if (id === undefined) {
      id = pos.length / 3;
      map.set(key, id);
      pos.push(tri[i], tri[i + 1], tri[i + 2]);
    }
    idx[i / 3] = id;
  }
  // Drop degenerate triangles (two corners welded together).
  const keep = [];
  for (let i = 0; i < idx.length; i += 3) {
    const a = idx[i], b = idx[i + 1], c = idx[i + 2];
    if (a !== b && b !== c && a !== c) keep.push(a, b, c);
  }
  return { positions: new Float32Array(pos), indices: new Uint32Array(keep) };
}

/** Per-corner normals, split where faces meet at more than the crease angle. */
function creaseNormals(positions, indices) {
  const triCount = indices.length / 3;
  const fn = new Float32Array(triCount * 3); // area-weighted face normals
  const vertFaces = Array.from({ length: positions.length / 3 }, () => []);
  for (let t = 0; t < triCount; t++) {
    const a = indices[t * 3] * 3, b = indices[t * 3 + 1] * 3, c = indices[t * 3 + 2] * 3;
    const ux = positions[b] - positions[a], uy = positions[b + 1] - positions[a + 1], uz = positions[b + 2] - positions[a + 2];
    const vx = positions[c] - positions[a], vy = positions[c + 1] - positions[a + 1], vz = positions[c + 2] - positions[a + 2];
    fn[t * 3] = uy * vz - uz * vy;
    fn[t * 3 + 1] = uz * vx - ux * vz;
    fn[t * 3 + 2] = ux * vy - uy * vx;
    for (let k = 0; k < 3; k++) vertFaces[indices[t * 3 + k]].push(t);
  }
  const unit = (t) => {
    const x = fn[t * 3], y = fn[t * 3 + 1], z = fn[t * 3 + 2];
    const l = Math.hypot(x, y, z) || 1;
    return [x / l, y / l, z / l];
  };
  const outPos = [];
  const outNrm = [];
  const outIdx = new Uint32Array(indices.length);
  const seen = new Map();
  for (let t = 0; t < triCount; t++) {
    const nt = unit(t);
    for (let k = 0; k < 3; k++) {
      const v = indices[t * 3 + k];
      let x = 0, y = 0, z = 0;
      for (const f of vertFaces[v]) {
        const nf = unit(f);
        if (nf[0] * nt[0] + nf[1] * nt[1] + nf[2] * nt[2] >= CREASE_COS) {
          x += fn[f * 3];
          y += fn[f * 3 + 1];
          z += fn[f * 3 + 2];
        }
      }
      const l = Math.hypot(x, y, z) || 1;
      const n = [Math.round((x / l) * 127), Math.round((y / l) * 127), Math.round((z / l) * 127)];
      const key = `${v},${n[0]},${n[1]},${n[2]}`;
      let id = seen.get(key);
      if (id === undefined) {
        id = outPos.length / 3;
        seen.set(key, id);
        outPos.push(positions[v * 3], positions[v * 3 + 1], positions[v * 3 + 2]);
        outNrm.push(...n);
      }
      outIdx[t * 3 + k] = id;
    }
  }
  return { positions: new Float32Array(outPos), normals: new Int8Array(outNrm), indices: outIdx };
}

function pack({ positions, normals, indices }) {
  const vc = positions.length / 3;
  const wide = vc > 65535;
  const nBytes = Math.ceil(normals.length / 4) * 4;
  const buf = Buffer.alloc(16 + positions.byteLength + nBytes + indices.length * (wide ? 4 : 2));
  buf.writeUInt32LE(MAGIC, 0);
  buf.writeUInt32LE(vc, 4);
  buf.writeUInt32LE(indices.length, 8);
  buf.writeUInt32LE(wide ? 1 : 0, 12);
  let o = 16;
  Buffer.from(positions.buffer, positions.byteOffset, positions.byteLength).copy(buf, o);
  o += positions.byteLength;
  Buffer.from(normals.buffer, normals.byteOffset, normals.byteLength).copy(buf, o);
  o += nBytes;
  const ib = wide ? new Uint32Array(indices) : new Uint16Array(indices);
  Buffer.from(ib.buffer).copy(buf, o);
  return buf;
}

/** Builds the binary mesh for a file at a detail level. */
export async function buildMesh(file, detail = 'medium') {
  const tri = parseStl(fs.readFileSync(file));
  let { positions, indices } = weld(tri);
  const sourceTriangles = tri.length / 9;
  const cfg = DETAILS[detail];
  if (cfg) {
    const s = await getSimplifier();
    const target = Math.min(cfg.max * 3, Math.max(300, Math.floor((indices.length * cfg.ratio) / 3) * 3));
    if (s && target < indices.length) {
      const [out] = s.simplify(indices, positions, 3, target, cfg.error, ['LockBorder']);
      if (out.length >= 36) {
        const [remap, unique] = s.compactMesh(out);
        // compactMesh rewrote `out` to use vertices 0..unique-1; remap[old] is the new index
        const np = new Float32Array(unique * 3);
        for (let i = 0; i < remap.length; i++) {
          const r = remap[i];
          if (r !== 0xffffffff) np.set(positions.subarray(i * 3, i * 3 + 3), r * 3);
        }
        positions = np;
        indices = out;
      }
    }
  }
  const mesh = creaseNormals(positions, indices);
  return { buffer: pack(mesh), triangles: mesh.indices.length / 3, sourceTriangles };
}

// ───────────────────────── cache ─────────────────────────

const memory = new Map(); // key → { buffer, etag }
const MEMORY_MAX = 64;
const pending = new Map();

export function meshCache(cacheDir) {
  return async function get(file, detail) {
    const st = fs.statSync(file);
    const key = crypto.createHash('sha1').update(`${file}|${st.size}|${st.mtimeMs}|${detail}|v1`).digest('hex').slice(0, 20);
    if (memory.has(key)) return memory.get(key);
    if (pending.has(key)) return pending.get(key);
    const job = (async () => {
      const disk = path.join(cacheDir, `${key}.nxm`);
      let buffer;
      try {
        buffer = fs.readFileSync(disk);
      } catch {
        buffer = (await buildMesh(file, detail)).buffer;
        try {
          fs.mkdirSync(cacheDir, { recursive: true });
          fs.writeFileSync(disk, buffer);
        } catch {
          /* cache is optional */
        }
      }
      const entry = { buffer, etag: `"${key}"` };
      memory.set(key, entry);
      if (memory.size > MEMORY_MAX) memory.delete(memory.keys().next().value);
      return entry;
    })();
    pending.set(key, job);
    try {
      return await job;
    } finally {
      pending.delete(key);
    }
  };
}
