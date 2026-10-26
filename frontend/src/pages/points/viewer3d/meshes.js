// Loads the meshes the backend prepares (/robot-models/mesh/:id, format NXM1,
// see backend/robotModel/meshes.js) and keeps one geometry per mesh and
// detail level for the page's lifetime, shared by the robot and its ghost.
import { BufferAttribute, BufferGeometry } from "three";
import { fetchRetry } from "../../../lib/retry";

const MAGIC = 0x314d584e;
const cache = new Map(); // `${id}|${detail}` → Promise<BufferGeometry>

export function decodeMesh(buf) {
  const dv = new DataView(buf);
  if (dv.getUint32(0, true) !== MAGIC) throw new Error("Not a NextUp mesh");
  const vc = dv.getUint32(4, true);
  const ic = dv.getUint32(8, true);
  const wide = dv.getUint32(12, true) & 1;
  let o = 16;
  const pos = new Float32Array(buf, o, vc * 3);
  o += vc * 12;
  const nrm = new Int8Array(buf, o, vc * 3);
  o += Math.ceil((vc * 3) / 4) * 4;
  const idx = wide ? new Uint32Array(buf, o, ic) : new Uint16Array(buf, o, ic);
  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(pos, 3));
  g.setAttribute("normal", new BufferAttribute(nrm, 3, true));
  g.setIndex(new BufferAttribute(idx, 1));
  g.computeBoundingSphere();
  g.computeBoundingBox();
  return g;
}

export function loadMesh(id, detail, stamp) {
  const key = `${id}|${detail}`;
  if (!cache.has(key)) {
    const p = fetchRetry(`/robot-models/mesh/${encodeURIComponent(id)}?detail=${detail}&v=${stamp || ""}`)
      .then((r) => {
        if (!r.ok) throw new Error(`Mesh ${id}: HTTP ${r.status}`);
        return r.arrayBuffer();
      })
      .then(decodeMesh);
    p.catch(() => cache.delete(key));
    cache.set(key, p);
  }
  return cache.get(key);
}

export function clearMeshCache() {
  for (const p of cache.values()) p.then((g) => g.dispose()).catch(() => {});
  cache.clear();
}
