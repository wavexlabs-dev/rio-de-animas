// Generated folk-art sculptures (image -> 3D): cartoneria Catrina and Catrin, and a pair of alebrijes
import * as THREE from 'three';
import { scannedParts, scannedMat, hasModel } from './scanned.js';
import { LodInstances } from './lodinst.js';
import { toWorld, terrainH, frame } from './river.js';
import { L } from './layout.js';

function statue(name, h, o = {}) {
  if (!hasModel(name)) return null;
  const parts = scannedParts(name, { whole: true, sink: o.sink || 0.02 });
  if (!parts.length) return null;
  const size = parts[0].wholeSize;
  const mat = scannedMat(name, { roughness: o.roughness || 0.75, porosity: 0.35 });
  return { parts, mat, s: h / (size.y || 1), r: Math.max(size.x, size.z) / 2 };
}

function put(world, st, list) {
  const e = new THREE.Euler(), q = new THREE.Quaternion(), sv = new THREE.Vector3(), tv = new THREE.Vector3();
  const items = list.map((it) => {
    e.set(0, it.rot, 0); q.setFromEuler(e); sv.setScalar(st.s * (it.k || 1)); tv.set(it.x, it.y, it.z);
    return { m: new THREE.Matrix4().compose(tv, q, sv), p: tv.clone(), r: st.r * st.s };
  });
  for (const p of st.parts) new LodInstances(world, p.lod, st.mat, items, { near: 60, far: 1e9, name: 'sculpture' });
}

// returns true when the generated statues replaced the procedural catrinas
export function buildGeneratedCatrinas(world, spots) {
  const A = statue('catrina_w', 4.0), B = statue('catrin_w', 4.15);
  if (!A || !B) return false;
  world.catrinaLights = [];
  const la = [], lb = [];
  spots.forEach((sp, i) => {
    const w = toWorld(sp.u, sp.d);
    const f = frame(sp.u);
    const sg = Math.sign(sp.d);
    // face the river (the scans look down +z)
    const rot = Math.atan2(-f.nx * sg, -f.nz * sg) + sp.rot * 0.35 + (sp.face || 0);
    const it = { x: w.x, y: terrainH(w.x, w.z, sp.u) - 0.04, z: w.z, rot };
    (i % 2 === 0 ? la : lb).push(it);
    world.blockers.push({ x: w.x, z: w.z, r: 1.3 });
    world.catrinaLights.push(new THREE.Vector3(w.x - f.nx * sg * 1.6, it.y + 2.2, w.z - f.nz * sg * 1.6));
  });
  put(world, A, la);
  put(world, B, lb);
  return true;
}

// two alebrijes guard the foot of the church steps, looking out over the river
export function buildAlebrijes(world) {
  const st = statue('alebrije_w', 2.0, { roughness: 0.6 });
  if (!st) return;
  // they light up when touched (story.js): emissive from their own paint, off until then
  st.mat.emissive = new THREE.Color(1, 1, 1); st.mat.emissiveMap = st.mat.map; st.mat.emissiveIntensity = 0;
  const list = [];
  for (const du of [-3.7, 3.7]) {
    const u = L.steps.u + du, d = 24.3;
    const w = toWorld(u, d);
    const f = frame(u);
    const rot = Math.atan2(-f.nx, -f.nz) + (du < 0 ? 0.45 : -0.45);
    list.push({ x: w.x, y: 2.3 - 0.02, z: w.z, rot, k: du < 0 ? 1 : 0.94 });
    world.blockers.push({ x: w.x, z: w.z, r: 1.4 });
  }
  put(world, st, list);
  world.alebrijes = { mat: st.mat, list };
}
