// Architecture helpers: local frames, geometry batching per material, primitives
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { frame, toWorld } from './river.js';
import { boxUV } from './matlib.js';

export function riverFrameMatrix(u, d, y = 0, rot = 0) {
  const f = frame(u);
  const p = toWorld(u, d);
  // local X = across river (normal, +d), local Z = along river (tangent, upstream), Y up
  const X = new THREE.Vector3(f.nx, 0, f.nz), Z = new THREE.Vector3(f.tx, 0, f.tz), Y = new THREE.Vector3(0, 1, 0);
  // make right-handed: X x Y should be Z
  const test = new THREE.Vector3().crossVectors(X, Y);
  if (test.dot(Z) < 0) Z.negate();
  const m = new THREE.Matrix4().makeBasis(X, Y, Z);
  if (rot) m.multiply(new THREE.Matrix4().makeRotationY(rot));
  m.setPosition(p.x, y, p.z);
  return m;
}

export class Batch {
  constructor() { this.groups = new Map(); }
  add(key, geo, matrix, o = {}) {
    let g = geo.index ? geo.toNonIndexed() : geo.clone();
    if (!g.attributes.normal) g.computeVertexNormals();
    if (o.uvScale) boxUV(g, o.uvScale, o.uvOffset || [0, 0, 0]);
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    if (!g.attributes.color) {
      const c = new Float32Array(g.attributes.position.count * 3);
      const col = o.color || [1, 1, 1];
      for (let i = 0; i < c.length; i += 3) { c[i] = col[0]; c[i + 1] = col[1]; c[i + 2] = col[2]; }
      g.setAttribute('color', new THREE.BufferAttribute(c, 3));
    }
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv', 'color'].includes(k)) g.deleteAttribute(k);
    if (matrix) g.applyMatrix4(matrix);
    if (!this.groups.has(key)) this.groups.set(key, []);
    this.groups.get(key).push(g);
    return g;
  }
  build(scene, mats, opts = {}) {
    const out = {};
    for (const [key, list] of this.groups) {
      const merged = mergeGeometries(list, false);
      merged.computeBoundingSphere();
      const m = new THREE.Mesh(merged, mats[key]);
      m.castShadow = opts.cast !== false; m.receiveShadow = true;
      m.name = 'arch_' + key;
      scene.add(m);
      out[key] = m;
    }
    return out;
  }
}

export function box(w, h, d, x = 0, y = 0, z = 0) {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(x, y + h / 2, z);
  return g;
}
// extruded polygon in XY plane, depth along Z (centred)
export function extrude(pts, depth, holes = [], z0 = null, curveSegs = 12) {
  const s = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)));
  for (const h of holes) s.holes.push(new THREE.Path(h.map(([x, y]) => new THREE.Vector2(x, y))));
  const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: false, curveSegments: curveSegs });
  g.translate(0, 0, z0 === null ? -depth / 2 : z0);
  return g;
}
export function arcPts(cx, cy, r, a0, a1, n) {
  const out = [];
  for (let i = 0; i <= n; i++) { const a = a0 + (a1 - a0) * i / n; out.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]); }
  return out;
}
// frustum (truncated pyramid) with square base, y from 0..h
export function frustum(w0, d0, w1, d1, h) {
  const g = new THREE.BufferGeometry();
  const b = [[-w0 / 2, 0, -d0 / 2], [w0 / 2, 0, -d0 / 2], [w0 / 2, 0, d0 / 2], [-w0 / 2, 0, d0 / 2]];
  const t = [[-w1 / 2, h, -d1 / 2], [w1 / 2, h, -d1 / 2], [w1 / 2, h, d1 / 2], [-w1 / 2, h, d1 / 2]];
  const pos = [];
  const quad = (a, b2, c, d) => { pos.push(...a, ...b2, ...c, ...a, ...c, ...d); };
  quad(b[0], t[0], t[1], b[1]); quad(b[1], t[1], t[2], b[2]); quad(b[2], t[2], t[3], b[3]); quad(b[3], t[3], t[0], b[0]);
  quad(t[0], t[3], t[2], t[1]); quad(b[0], b[1], b[2], b[3]);
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}
export function cylinder(r0, r1, h, seg = 12, x = 0, y = 0, z = 0) {
  const g = new THREE.CylinderGeometry(r1, r0, h, seg, 1);
  g.translate(x, y + h / 2, z);
  return g;
}
export function tubeAlong(points, r, seg = 6, radialSeg = 6) {
  const c = new THREE.CatmullRomCurve3(points);
  return new THREE.TubeGeometry(c, seg, r, radialSeg, false);
}
