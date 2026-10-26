// URDF (already expanded) → the model the 3D view and the simulator use.
import { DOMParser } from 'xmldom';

const nums = (s, n, def) => {
  const v = String(s ?? '').trim().split(/\s+/).map(Number);
  return v.length >= n && v.slice(0, n).every(Number.isFinite) ? v.slice(0, n) : def;
};
const kids = (el, name) => Array.from(el.childNodes || []).filter((n) => n.nodeType === 1 && n.nodeName === name);
const kid = (el, name) => kids(el, name)[0];

function origin(el) {
  const o = el && kid(el, 'origin');
  return { xyz: nums(o?.getAttribute('xyz'), 3, [0, 0, 0]), rpy: nums(o?.getAttribute('rpy'), 3, [0, 0, 0]) };
}

/**
 * Returns { name, root, links: [{ name, visuals: [{ origin, geometry, color }] }],
 * joints: [...], meshes: [absolute file per mesh reference] }. resolveMesh
 * turns a mesh filename (package://, file://, relative) into an absolute path.
 */
export function parseUrdf(xml, { resolveMesh }) {
  const doc = new DOMParser({ errorHandler: { warning: () => {}, error: () => {}, fatalError: (m) => { throw new Error(m); } } }).parseFromString(xml, 'text/xml');
  const robot = doc.documentElement;
  // Included descriptions may use another root name (nextupCobot.urdf.xacro has <cobot>).
  if (!robot || !kids(robot, 'link').length) throw new Error('no <link> elements: not a URDF robot description');

  // Named materials at the top level (<material name="x"><color rgba/></material>)
  const materials = {};
  for (const m of kids(robot, 'material')) {
    const c = kid(m, 'color');
    if (c) materials[m.getAttribute('name')] = nums(c.getAttribute('rgba'), 4, null);
  }

  const meshes = [];
  const links = kids(robot, 'link').map((l) => ({
    name: l.getAttribute('name'),
    visuals: kids(l, 'visual').map((v) => {
      const g = kid(v, 'geometry');
      const shape = g && Array.from(g.childNodes).find((n) => n.nodeType === 1);
      let geometry = null;
      if (shape?.nodeName === 'mesh') {
        const file = resolveMesh(shape.getAttribute('filename'));
        if (file) {
          let idx = meshes.indexOf(file);
          if (idx < 0) idx = meshes.push(file) - 1;
          geometry = { type: 'mesh', mesh: idx, scale: nums(shape.getAttribute('scale'), 3, [1, 1, 1]) };
        } else geometry = { type: 'missing', filename: shape.getAttribute('filename') };
      } else if (shape?.nodeName === 'box') geometry = { type: 'box', size: nums(shape.getAttribute('size'), 3, [0.1, 0.1, 0.1]) };
      else if (shape?.nodeName === 'cylinder') geometry = { type: 'cylinder', radius: Number(shape.getAttribute('radius')) || 0.05, length: Number(shape.getAttribute('length')) || 0.1 };
      else if (shape?.nodeName === 'sphere') geometry = { type: 'sphere', radius: Number(shape.getAttribute('radius')) || 0.05 };
      const mat = kid(v, 'material');
      const c = mat && kid(mat, 'color');
      const color = (c && nums(c.getAttribute('rgba'), 4, null)) || (mat && materials[mat.getAttribute('name')]) || null;
      return { origin: origin(v), geometry, color };
    }).filter((v) => v.geometry && !(v.color && v.color[3] === 0)), // fully transparent = hidden helper
  }));

  const joints = kids(robot, 'joint').map((j) => {
    const lim = kid(j, 'limit');
    const num = (n) => (lim && lim.hasAttribute(n) ? Number(lim.getAttribute(n)) : undefined);
    return {
      name: j.getAttribute('name'),
      type: j.getAttribute('type'),
      parent: kid(j, 'parent')?.getAttribute('link'),
      child: kid(j, 'child')?.getAttribute('link'),
      origin: origin(j),
      axis: nums(kid(j, 'axis')?.getAttribute('xyz'), 3, [1, 0, 0]),
      limit: lim ? { lower: num('lower'), upper: num('upper'), velocity: num('velocity'), effort: num('effort') } : null,
    };
  });

  const childLinks = new Set(joints.map((j) => j.child));
  const root = links.find((l) => !childLinks.has(l.name))?.name || links[0]?.name;
  return { name: robot.getAttribute('name') || '', root, links, joints, meshes };
}
