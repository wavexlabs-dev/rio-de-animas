import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { fbm3, vnoise3, mulberry32, smoothstep, clamp, lerp } from './noise.js';
import { triMat } from './matlib.js';
import { depthMat } from './materials.js';
import { R, toWorld, halfW, terrainH, toUD, bankKind, frame } from './river.js';
import { L } from './layout.js';
import { scannedParts, scannedMat } from './scanned.js';
import { LodInstances } from './lodinst.js';

export function rockGeometry(seed, detail = 4, sharp = 0.5) {
  let g = new THREE.IcosahedronGeometry(1, detail);
  g.deleteAttribute('normal'); g.deleteAttribute('uv');
  g = mergeVertices(g);
  const p = g.attributes.position;
  const r = mulberry32(seed);
  const ox = r() * 100, oy = r() * 100, oz = r() * 100;
  const sx = 0.8 + r() * 0.6, sy = 0.45 + r() * 0.35, sz = 0.8 + r() * 0.5;
  const col = new Float32Array(p.count * 3);
  // a couple of cutting planes for faceted look
  const planes = [];
  for (let k = 0; k < 5; k++) {
    const n = new THREE.Vector3(r() - 0.5, (r() - 0.3) * 0.8, r() - 0.5).normalize();
    planes.push([n, 0.55 + r() * 0.3]);
  }
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const n1 = fbm3(v.x * 1.3 + ox, v.y * 1.3 + oy, v.z * 1.3 + oz, 4);
    const n2 = fbm3(v.x * 4.1 + oz, v.y * 4.1 + ox, v.z * 4.1 + oy, 3);
    let rad = 1 + n1 * 0.28 + n2 * 0.07;
    v.multiplyScalar(rad);
    for (const [n, dd] of planes) {
      const t = v.dot(n);
      if (t > dd) v.addScaledVector(n, -(t - dd) * (0.6 + sharp * 0.4));
    }
    v.x *= sx; v.y *= sy; v.z *= sz;
    if (v.y < -0.15) v.y = -0.15 + (v.y + 0.15) * 0.3;
    p.setXYZ(i, v.x, v.y, v.z);
    const cav = clamp(0.75 + n2 * 1.2 + n1 * 0.4, 0.35, 1.05);
    col[i * 3] = cav; col[i * 3 + 1] = cav; col[i * 3 + 2] = cav;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

// Autopilot racing line (lateral offset in metres from centreline)
export function lineD(u) {
  const w = halfW(u);
  let d = 0.24 * w * Math.sin(u / 47 + 0.7) + 0.08 * w * Math.sin(u / 19 + 2.0);
  d *= 1 - Math.exp(-Math.pow((u - L.bridge.u) / 22, 2));
  return d;
}

export function buildRocks(world) {
  const scene = world.scene;
  const obstacles = world.obstacles;
  // photoscanned boulders (two Poly Haven sets), footprint-normalised to unit half-extent, base slightly sunk
  const WET = 'float wetL = smoothstep(0.55, 0.0, vWPos.y) * smoothstep(-1.5, 0.0, vWPos.y); diffuseColor.rgb *= mix(1.0, 0.6, wetL); diffuseColor.rgb *= mix(1.0, 0.72, smoothstep(0.0, -0.8, vWPos.y));';
  const SETS = ['rock_moss_set_01', 'rock_moss_set_02'];
  const scan = [];
  for (const set of SETS) {
    const mats = [scannedMat(set, { roughness: 1.0, porosity: 0.75, afterMap: WET }), scannedMat(set, { roughness: 1.0, porosity: 0.8, color: 0xdfe6cf, afterMap: WET })];
    for (const part of scannedParts(set, { normalize: true, sink: 0.12 })) scan.push({ set, mats, part });
  }
  const variants = scan.length;
  const inst = [];
  const rand = mulberry32(777);
  const add = (x, y, z, s, sy, rot, v, mossy = false, field = false) => inst.push({ x, y, z, s, sy, rot, v: v !== undefined ? v : Math.floor(rand() * variants), mossy, field });
  const P = {};
  // --- channel boulders, clear of the autopilot line
  let u = 40;
  while (u < R.FALL_U - 30) {
    const w = halfW(u);
    const gorge = smoothstep(650, 900, u);
    u += lerp(26, 11, gorge) * (0.6 + rand() * 0.8);
    if (Math.abs(u - L.bridge.u) < 30) continue;
    const ld = lineD(u);
    const side = rand() < 0.5 ? -1 : 1;
    const r = lerp(0.7, 1.6, rand()) * lerp(1, 1.35, gorge);
    const clear = r + 3.2;
    let d = ld + side * (clear + rand() * (w * 0.6));
    if (Math.abs(d) > w - 0.6) d = Math.sign(d) * (w - 0.6 - rand() * 2);
    if (Math.abs(d - ld) < clear) continue;
    toWorld(u, d, P);
    const bed = terrainH(P.x, P.z, u);
    const top = 0.25 + rand() * 0.9 * r;
    const sy = (top - bed) / (0.55 * 1.0);
    add(P.x, bed + (top - bed) * 0.45, P.z, r, Math.max(0.6, (top - bed) / (0.6 * r)) , rand() * 6.28);
    obstacles.push({ x: P.x, z: P.z, r: r * 0.95, kind: 'rock' });
    // companion small stones
    if (rand() < 0.6) {
      const d2 = d + (rand() - 0.5) * 3, u2 = u + 1.5 + rand() * 2;
      if (Math.abs(d2 - lineD(u2)) > 2.5 && Math.abs(d2) < w - 0.3) {
        toWorld(u2, d2, P);
        const b2 = terrainH(P.x, P.z, u2);
        const r2 = r * (0.35 + rand() * 0.3);
        add(P.x, b2 + 0.2, P.z, r2, 1.4, rand() * 6.28);
        obstacles.push({ x: P.x, z: P.z, r: r2 * 0.9, kind: 'rock', sub: 0.6 });
      }
    }
  }
  // --- bank boulders (water edge) and scattered field boulders
  for (let uu = -150; uu < R.FALL_U; uu += 2.2) {
    const gorge = smoothstep(650, 900, uu);
    const dens = lerp(0.18, 0.8, gorge);
    for (const side of [-1, 1]) {
      if (rand() > dens) continue;
      if (Math.abs(uu - L.bridge.u) < 14 || Math.abs(uu - L.landing.u) < 6) continue;
      const w = halfW(uu);
      const kk = bankKind(uu, side);
      const r = lerp(0.5, 1.8, rand() * rand()) * lerp(1, 1.8, gorge);
      const d = side * (w + (rand() - 0.35) * 2.5 + r * 0.3);
      toWorld(uu, d, P);
      const h = terrainH(P.x, P.z, uu);
      add(P.x, h - r * 0.15, P.z, r, 0.8 + rand() * 0.6, rand() * 6.28, undefined, kk > 0.5 || gorge > 0.5);
      if (Math.abs(d) - r < w) obstacles.push({ x: P.x, z: P.z, r: r * 0.9, kind: 'bank', sub: 0.5 });
    }
  }
  // gorge cliff-base boulders (large)
  for (let uu = 700; uu < R.FALL_U + 10; uu += 7) {
    for (const side of [-1, 1]) {
      if (rand() < 0.35) continue;
      const w = halfW(uu);
      const d = side * (w + 2 + rand() * 7);
      toWorld(uu, d, P);
      const h = terrainH(P.x, P.z, uu);
      const r = 1.8 + rand() * 2.8;
      add(P.x, h - r * 0.2, P.z, r, 0.9 + rand() * 0.5, rand() * 6.28, undefined, true);
      if (Math.abs(d) - r < w) obstacles.push({ x: P.x, z: P.z, r: r * 0.85, kind: 'bank', sub: 0.4 });
    }
  }
  // headwall rocks around waterfall
  for (let k = 0; k < 26; k++) {
    const uu = R.FALL_U + 1 + rand() * 6, d = (rand() - 0.5) * 34;
    if (Math.abs(d) < 3.8) continue;
    toWorld(uu, d, P);
    const h = terrainH(P.x, P.z, uu);
    const rr2 = 2.5 + rand() * 3; add(P.x, h - rr2 * 0.35, P.z, rr2, 1.3 + rand(), rand() * 6.28, undefined, true);
  }
  // plunge pool boulders
  for (let k = 0; k < 10; k++) {
    const uu = R.FALL_U - 4 - rand() * 18, d = (rand() < 0.5 ? -1 : 1) * (6 + rand() * 8);
    toWorld(uu, d, P);
    const h = terrainH(P.x, P.z, uu);
    const r = 1 + rand() * 1.5;
    add(P.x, Math.max(h, -1.2) + 0.1, P.z, r, 1.0, rand() * 6.28);
    obstacles.push({ x: P.x, z: P.z, r, kind: 'rock' });
  }
  world.rockList = inst;
  // field / forest boulders (mossy)
  for (let k = 0; k < 900; k++) {
    const uu = -300 + rand() * 1450;
    const side = rand() < 0.5 ? -1 : 1;
    const d = side * (halfW(uu) + 6 + rand() * 90);
    toWorld(uu, d, P);
    const h = terrainH(P.x, P.z, uu);
    if (h > 120) continue;
    if (world.isBlocked && world.isBlocked(P.x, P.z, 3)) continue;
    const r = 0.4 + rand() * rand() * 2.2;
    add(P.x, h - r * 0.2, P.z, r, 0.7 + rand() * 0.5, rand() * 6.28, undefined, true, true);
  }
  // build instanced meshes (near/channel rocks: LOD0, scattered field boulders: LOD1)
  const byV = new Map();
  for (const it of inst) {
    it.v = it.v % variants;
    const key = (it.field ? 'f' : '') + it.v + (it.mossy ? 'm' : '');
    if (!byV.has(key)) byV.set(key, []);
    byV.get(key).push(it);
  }
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), s = new THREE.Vector3(), t = new THREE.Vector3();
  for (const [key, list] of byV) {
    const field = key.startsWith('f');
    const v = parseInt(field ? key.slice(1) : key);
    const sc = scan[v];
    const mm = sc.mats[key.endsWith('m') ? 1 : 0];
    const items = list.map((it) => {
      e.set((rand() - 0.5) * 0.3, it.rot, (rand() - 0.5) * 0.3);
      q.setFromEuler(e);
      s.set(it.s, it.s * Math.min(it.sy, 1.5) * 0.8, it.s);
      t.set(it.x, it.y, it.z);
      return { m: new THREE.Matrix4().compose(t, q, s), p: t.clone(), r: it.s };
    });
    // detailed scan only within a few tens of metres; field boulders fade out far away
    // field boulders use the two coarser levels, channel/bank rocks the two finer ones (LOD switch far from the boat)
    const L = sc.part.lod;
    new LodInstances(world, field ? [L[1], L[2] || L[1]] : [L[0], L[1]], mm, items, field ? { near: 20, far: 200, name: 'fieldRocks', cast: false, layer: 5 } : { near: 70, far: 420, name: 'rocks' });
  }
  buildCliffs(world, rand);
  return {};
}

// gorge walls and the headwall dressed with photoscanned rock faces
function buildCliffs(world, rand) {
  const faces = ['rock_face_01', 'rock_face_02'].map((n) => ({ n, part: scannedParts(n, { normalize: true, sink: 0.3 })[0], mat: scannedMat(n, { roughness: 1.0, porosity: 0.7 }) }));
  const lists = faces.map(() => []);
  const P = {};
  for (let u = 600; u < R.FALL_U + 8; u += 5 + rand() * 6) {
    const gorge = smoothstep(600, 860, u);
    for (const side of [-1, 1]) {
      if (rand() > 0.35 + 0.6 * gorge) continue;
      const w = halfW(u);
      const d = side * (w + 2.5 + rand() * (4 + 6 * (1 - gorge)));
      toWorld(u, d, P);
      const h = terrainH(P.x, P.z, u);
      const k = Math.floor(rand() * faces.length);
      const f = faces[k];
      const sz = f.part.size;
      // turn the thin horizontal axis of the scan toward the river
      const thinX = sz.x < sz.z;
      const fr = frame(u);
      const toRiver = Math.atan2(-side * fr.nx, -side * fr.nz);
      const rot = toRiver + (thinX ? -Math.PI / 2 : 0) + (rand() < 0.5 ? Math.PI : 0) * 0 + (rand() - 0.5) * 0.5;
      const s = lerp(4.5, 9.5, rand()) * lerp(0.8, 1.35, gorge);
      lists[k].push({ x: P.x, y: h - 0.6, z: P.z, s, sy: lerp(1.0, 2.2, gorge) * (0.8 + rand() * 0.5), rot });
      if (Math.abs(d) - s * 0.4 < w) world.obstacles.push({ x: P.x, z: P.z, r: s * 0.35, kind: 'bank', sub: 0.4 });
    }
  }
  // headwall around the fall
  for (let k = 0; k < 14; k++) {
    const u = R.FALL_U + 2 + rand() * 6, d = (rand() - 0.5) * 38;
    if (Math.abs(d) < 4.5) continue;
    toWorld(u, d, P);
    const h = terrainH(P.x, P.z, u);
    const fr = frame(u);
    const kk = k % faces.length;
    lists[kk].push({ x: P.x, y: h - 1.5, z: P.z, s: 6 + rand() * 5, sy: 1.6 + rand() * 1.2, rot: Math.atan2(fr.tx, fr.tz) + (rand() - 0.5) * 0.8 });
  }
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), sv = new THREE.Vector3(), tv = new THREE.Vector3();
  faces.forEach((f, i) => {
    const list = lists[i];
    if (!list.length) return;
    const items = list.map((it) => { e.set((rand() - 0.5) * 0.15, it.rot, (rand() - 0.5) * 0.15); q.setFromEuler(e); sv.set(it.s, it.s * it.sy, it.s); tv.set(it.x, it.y, it.z); return { m: new THREE.Matrix4().compose(tv, q, sv), p: tv.clone(), r: it.s }; });
    new LodInstances(world, f.part.lod, f.mat, items, { near: 40, name: 'cliffs' });
  });
}

// photoscanned exposed roots at the feet of the riverside ahuehuetes, and old stumps in the woods and fields
export function buildGroundProps(world) {
  const rand = mulberry32(9191);
  const P = {};
  const roots = scannedParts('root_cluster_01', { normalize: true, sink: 0.22 })[0];
  const stump = scannedParts('tree_stump_01', { normalize: true, sink: 0.1 })[0];
  if (!roots || !stump) return;
  const rMat = scannedMat('root_cluster_01', { roughness: 1.0, porosity: 0.8 });
  const sMat = scannedMat('tree_stump_01', { roughness: 1.0, porosity: 0.7 });
  const e = new THREE.Euler(), q = new THREE.Quaternion(), sv = new THREE.Vector3(), tv = new THREE.Vector3();
  const mk = (x, y, z, s, rot, tilt = 0.08) => { e.set((rand() - 0.5) * tilt, rot, (rand() - 0.5) * tilt); q.setFromEuler(e); sv.set(s, s, s); tv.set(x, y, z); return { m: new THREE.Matrix4().compose(tv, q, sv), p: tv.clone(), r: s }; };
  const ri = [];
  for (const t of world.heroTrunks || []) {
    for (let k = 0; k < 3; k++) {
      const a = rand() * 6.28, dd = t.r * 1.6 + 0.5 + rand() * 0.6;
      const x = t.x + Math.cos(a) * dd, z = t.z + Math.sin(a) * dd;
      ri.push(mk(x, terrainH(x, z) - 0.08, z, 0.8 + rand() * 0.5, a + Math.PI / 2));
    }
  }
  // along earthen banks
  for (let k = 0; k < 70; k++) {
    const u = 20 + rand() * 900, side = rand() < 0.5 ? -1 : 1;
    if (bankKind(u, side) < 0.5) continue;
    const d = side * (halfW(u) + 0.6 + rand() * 1.8);
    toWorld(u, d, P);
    const h = terrainH(P.x, P.z, u);
    if (h < 0.05 || (world.isBlocked && world.isBlocked(P.x, P.z, 0.5, true))) continue;
    ri.push(mk(P.x, h - 0.1, P.z, 0.6 + rand() * 0.5, rand() * 6.28, 0.2));
  }
  new LodInstances(world, roots.lod, rMat, ri, { near: 30, far: 260, name: 'roots', layer: 5 });
  const si = [];
  for (let k = 0; k < 160 && si.length < 55; k++) {
    const u = -150 + rand() * 1000, side = rand() < 0.5 ? -1 : 1;
    const d = side * (halfW(u) + 6 + rand() * 50);
    toWorld(u, d, P);
    const h = terrainH(P.x, P.z, u);
    if (h > 90 || (world.isBlocked && world.isBlocked(P.x, P.z, 1.5))) continue;
    si.push(mk(P.x, h - 0.05, P.z, 0.35 + rand() * 0.3, rand() * 6.28));
  }
  new LodInstances(world, stump.lod, sMat, si, { near: 25, far: 220, name: 'stumps', layer: 5 });
}
