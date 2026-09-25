// Photoscanned understorey (ferns, shrubs, small plants, rosettes, tall grass) and pueblo props (clay pots,
// jugs, baskets, crates, painted chairs, oil lanterns, a wooden pier, fallen trunks). Everything degrades
// gracefully: a model missing from the build is simply skipped.
import * as THREE from 'three';
import { scannedParts, scannedMat, hasModel, modelMeta } from './scanned.js';
import { LodInstances } from './lodinst.js';
import { std } from './materials.js';
import { mulberry32, smoothstep } from './noise.js';
import { R, toWorld, halfW, terrainH, bankKind, frame } from './river.js';
import { forestMask } from './terrain.js';
import { L, distToPaths } from './layout.js';
import { flowerCards } from './decor.js';

const TRANSL = /* glsl */`
{
  vec3 Lv = normalize((viewMatrix * vec4(uKeyDir, 0.0)).xyz);
  float bl = pow(max(dot(-geometryViewDir, Lv), 0.0), 3.0);
  reflectedLight.directDiffuse += diffuseColor.rgb * uKeyCol * bl * 0.55;
  reflectedLight.indirectDiffuse += diffuseColor.rgb * uAmbCol * 0.22;
  reflectedLight.indirectSpecular *= 0.35;
}`;

// wind weights from normalised height: stems stay planted, tips flutter
function addWind(g, h, k = 0.3) {
  const p = g.attributes.position, n = p.count;
  const w = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { const t = Math.max(0, p.getY(i)) / h; w[i * 3] = t * t * k; w[i * 3 + 1] = Math.min(1, t * 1.4); w[i * 3 + 2] = Math.abs(p.getX(i) * 3.7 + p.getZ(i) * 6.1) % 1; }
  g.setAttribute('aWind', new THREE.BufferAttribute(w, 3));
}

// a model as interchangeable variants (one per part): foliage sets, rock sets
function variants(name, o = {}) {
  if (!hasModel(name)) return [];
  if (o.mat && o.mat.alphaTest && !modelMeta(name).alpha) return []; // cut-out foliage needs its alpha map
  const parts = scannedParts(name, { center: true, sink: o.sink || 0 });
  const mats = {};
  const out = [];
  for (const part of parts) {
    const h = part.size.y || 1, r = Math.max(part.size.x, part.size.z) / 2 || 0.5;
    if (o.wind) for (const g of part.lod) addWind(g, h, o.wind);
    const mk = part.mat || 0;
    mats[mk] = mats[mk] || scannedMat(name, Object.assign({ mat: mk }, o.mat));
    out.push({ parts: [{ lod: part.lod, mat: mats[mk] }], h, r, name });
  }
  // fewer, larger variants: every variant costs a draw call per LOD
  if (o.max && out.length > o.max) { out.sort((a, b) => b.h * b.r - a.h * a.r); out.length = o.max; }
  return out;
}
// a model as one object made of several parts that move together (bucket + handle, lantern body + glass)
function assembly(name, o = {}) {
  if (!hasModel(name)) return [];
  const parts = scannedParts(name, { whole: true, sink: o.sink || 0, only: o.only });
  if (!parts.length) return [];
  const size = parts[0].wholeSize;
  const mats = {};
  const ps = parts.map((p) => {
    const mk = p.mat || 0;
    mats[mk] = mats[mk] || (o.mats && o.mats[mk]) || scannedMat(name, Object.assign({ mat: mk }, o.mat));
    return { lod: p.lod, mat: mats[mk] };
  });
  return [{ parts: ps, h: size.y || 1, r: Math.max(size.x, size.z) / 2 || 0.5, name }];
}

const foliage = (color, extra = {}) => Object.assign({ alphaTest: 0.5, side: THREE.DoubleSide, noFlip: true, wind: true, roughness: 0.9, porosity: 0.5, color, lightsExtra: TRANSL }, extra);

// place items {x,y,z,rot,k, h (target height) | s (scale)} over variants, one LodInstances per variant part
function place(world, vars, items, o) {
  if (!vars.length || !items.length) return 0;
  const buckets = vars.map(() => []);
  const e = new THREE.Euler(), q = new THREE.Quaternion(), sv = new THREE.Vector3(), tv = new THREE.Vector3();
  for (const it of items) {
    const vi = it.v !== undefined ? it.v % vars.length : Math.floor(it.k * vars.length) % vars.length;
    const v = vars[vi];
    const s = it.h ? it.h / v.h : (it.s || 1);
    e.set(it.tx || 0, it.rot, it.tz || 0); q.setFromEuler(e); sv.set(s, s * (it.sy || 1), s); tv.set(it.x, it.y, it.z);
    buckets[vi].push({ m: new THREE.Matrix4().compose(tv, q, sv), p: tv.clone(), r: v.r * s });
  }
  let n = 0;
  vars.forEach((v, i) => {
    if (!buckets[i].length) return;
    for (const p of v.parts) new LodInstances(world, p.lod, p.mat, buckets[i], Object.assign({ name: v.name }, o));
    n += buckets[i].length;
  });
  return n;
}

export function buildUnderstorey(world) {
  const rand = mulberry32(5151);
  const P = {};
  const ferns = variants('fern_02', { wind: 0.25, mat: foliage(0xe4eec8) });
  const bushes = variants('shrub_02', { wind: 0.18, mat: foliage(0xe6ecca) });
  const small = [].concat(
    variants('shrub_01', { wind: 0.3, max: 4, mat: foliage(0xe2eac4) }),
    variants('shrub_03', { wind: 0.3, max: 3, mat: foliage(0xe0e8c0) }),
    variants('shrub_04', { wind: 0.3, mat: foliage(0xe4eac6) }),
    variants('nettle_plant', { wind: 0.3, max: 3, mat: foliage(0xdfe8c6) }));
  const rosettes = variants('weed_plant_02', { wind: 0.15, max: 3, mat: foliage(0xe8eecc) });
  const grass = variants('grass_medium_02', { wind: 0.35, max: 3, mat: foliage(0xeef0d0, { porosity: 0.4 }) });
  const flowers = variants('flower_gazania', { wind: 0.2, max: 4, mat: foliage(0xffffff) });
  const F = [], B = [], S = [], W = [], G = [], FL = [];
  const at = (u, d, list, extra) => {
    toWorld(u, d, P);
    const h = terrainH(P.x, P.z, u);
    if (h < 0.1 || h > 70) return false;
    if (world.isBlocked && world.isBlocked(P.x, P.z, 0.35)) return false;
    list.push(Object.assign({ x: P.x, y: h - 0.03, z: P.z, rot: rand() * 6.28, k: rand(), tx: (rand() - 0.5) * 0.14, tz: (rand() - 0.5) * 0.14 }, extra));
    return true;
  };
  // river banks: ferns and bushes on the steep earthen outer banks, small plants, rosettes and tall grass on the bars.
  // Plants cluster in drifts (a few around a seed point) the way they grow, instead of an even sprinkle.
  const drift = (u, d, list, n, spread, mk) => { for (let k = 0; k < n; k++) at(u + (rand() - 0.5) * spread, d + (rand() - 0.5) * spread * 0.6, list, mk()); };
  for (let u = -170; u < R.FALL_U - 10; u += 2.2) {
    const gorge = smoothstep(560, 680, u);
    const pueblo = (u > 205 && u < 300) ? 0.4 : 1;
    for (const side of [-1, 1]) {
      if (Math.abs(u - L.bridge.u) < 16 || Math.abs(u - L.landing.u) < 6) continue;
      const kk = bankKind(u, side), w = halfW(u);
      const uu = u + rand() * 2;
      if (rand() < (0.3 + 0.4 * kk + 0.3 * gorge) * pueblo) drift(uu, side * (w + 1.0 + rand() * (2.5 + 4 * kk)), F, 2 + Math.floor(rand() * 3), 3.0, () => ({ s: 1.6 + rand() * 0.9 }));
      if (rand() < (0.12 + 0.25 * kk) * pueblo) at(uu, side * (w + 2.5 + rand() * 5), B, { s: 1.0 + rand() * 0.6 });
      if (rand() < (0.45 - 0.15 * kk) * pueblo) drift(uu, side * (w + 0.4 + rand() * 3.5), S, 3 + Math.floor(rand() * 4), 2.2, () => ({ h: 0.5 + rand() * 0.45 }));
      if (rand() < (0.35 - 0.25 * kk) * (1 - gorge) * pueblo) drift(uu, side * (w + 0.2 + rand() * 2.5), rand() < 0.5 ? W : G, 3 + Math.floor(rand() * 3), 1.6, () => ({ s: 1.6 + rand() * 1.2 }));
    }
  }
  // forest edge undergrowth where the woods meet the fields
  for (let k = 0; k < 2400; k++) {
    const u = -150 + rand() * (R.FALL_U - 100), side = rand() < 0.5 ? -1 : 1;
    const d = side * (halfW(u) + 8 + rand() * 70);
    toWorld(u, d, P);
    const fm = forestMask(u, d, P.x, P.z, terrainH(P.x, P.z, u));
    if (fm < 0.25 || fm > 0.85 || rand() > 0.6) continue;
    const r = rand();
    if (r < 0.35) at(u, d, B, { s: 1.0 + rand() * 0.7 });
    else if (r < 0.7) drift(u, d, F, 2, 2.4, () => ({ s: 1.5 + rand() * 0.8 }));
    else drift(u, d, S, 3, 1.8, () => ({ h: 0.5 + rand() * 0.4 }));
  }
  // gazanias and rosettes along the pueblo paths (their orange echoes the cempasuchil)
  for (let k = 0; k < 700; k++) {
    const u = 150 + rand() * 360, side = rand() < 0.7 ? 1 : -1;
    const d = side * (halfW(u) + 3 + rand() * 40);
    toWorld(u, d, P);
    const pd = distToPaths(P.x, P.z);
    if (pd < 1.0 || pd > 2.8) continue;
    at(u, d, rand() < 0.7 ? FL : W, { s: 1.3 + rand() * 0.8 });
  }
  const n = [
    // small plants stay out of the water reflection (layer 5) and fade out early; bushes are reflected
    place(world, ferns, F, { near: 22, far: 115, castFar: false, layer: 5 }),
    place(world, bushes, B, { near: 30, far: 190, castFar: false }),
    place(world, small, S, { near: 18, far: 70, cast: false, layer: 5 }),
    place(world, rosettes, W, { near: 15, far: 55, cast: false, layer: 5 }),
    place(world, grass, G, { near: 15, far: 60, cast: false, layer: 5 }),
    place(world, flowers, FL, { near: 15, far: 55, cast: false, layer: 5 }),
  ];
  world.mark && world.mark('understorey ' + n.join('/'));
}

// ---------------------------------------------------------------------------------------------
// pueblo props on the quays, by the ofrendas, at the church atrium and the panteon
export function buildPueblo(world) {
  const rand = mulberry32(6262);
  const clay = { roughness: 1, porosity: 0.8 };
  const pots = assembly('planter_pot_clay', { mat: clay });
  const ollas = assembly('ceramic_pot', { mat: clay });
  const jugs = assembly('jug_01', { mat: clay });
  const baskets = assembly('wicker_basket_01', { mat: { roughness: 1, porosity: 0.6 } });
  const buckets = assembly('wooden_bucket_01', { mat: { roughness: 1, porosity: 0.7 } });
  const crates = assembly('wooden_crate_01', { mat: { roughness: 1, porosity: 0.7 } });
  const chairs = assembly('painted_wooden_chair_01', { mat: { roughness: 1, porosity: 0.5 } });
  const benches = assembly('painted_wooden_bench', { mat: { roughness: 1, porosity: 0.5 } });
  // oil lantern: the glass glows warm at night around its candle
  const glass = std({ color: 0xfff0d8, roughness: 0.15, metalness: 0, emissive: 0xffa24a, emissiveIntensity: 0 }, { porosity: 0, key: 'lanGlass' });
  world.updaters.push(() => { glass.emissiveIntensity = (world.tod.night * 0.95 + world.tod.dusk * 0.4) * 2.4; });
  const lanterns = assembly('Lantern_01', { mat: { roughness: 0.6 }, mats: { 1: glass } });
  const items = { pots: [], ollas: [], jugs: [], baskets: [], buckets: [], crates: [], chairs: [], benches: [], lanterns: [] };
  const flowers = [];
  const clear = (x, z, r) => !(world.blockers && world.blockers.hit(x, z, r)) && distToPaths(x, z) > r + 0.3;
  const put = (kind, x, z, extra, y) => {
    if (!clear(x, z, 0.3)) return null;
    const it = Object.assign({ x, y: y !== undefined ? y : terrainH(x, z), z, rot: rand() * 6.28, k: rand() }, extra);
    items[kind].push(it);
    world.blockers.push({ x, z, r: 0.35 });
    return it;
  };
  const potFlowers = (it, h) => {
    const top = it.y + h * 0.9;
    for (let k = 0; k < 8; k++) { const aa = rand() * 6.28, rr = rand() * h * 0.45; flowers.push({ p: new THREE.Vector3(it.x + Math.cos(aa) * rr, top + rand() * 0.14, it.z + Math.sin(aa) * rr), n: new THREE.Vector3((rand() - 0.5) * 0.6, 1, (rand() - 0.5) * 0.6).normalize(), kind: 0 }); }
  };
  const Q = {};
  // quay tops: pots of cempasuchil, jugs and lanterns along the river wall; baskets, crates and chairs at the back
  for (const q of L.quays || []) {
    const u0 = L.bridge.u;
    for (let a = -q.hu + 1.2; a < q.hu - 1.2; a += 0.9 + rand() * 1.4) {
      if (Math.abs(a) < 4.4) continue; // bridge ramps
      const u = u0 + a;
      const f = frame(u);
      const rot = Math.atan2(f.tx, f.tz);
      toWorld(u, q.s * (halfW(u) + 0.3 + 0.5), Q);
      const r = rand();
      if (r < 0.36) { const s = 1.4 + rand() * 0.5; const it = put('pots', Q.x, Q.z, { s }); if (it) potFlowers(it, 0.22 * s); }
      else if (r < 0.46) put('ollas', Q.x, Q.z, { s: 0.75 + rand() * 0.2 });
      else if (r < 0.58) put('jugs', Q.x, Q.z, { s: 1.1 + rand() * 0.5 });
      else if (r < 0.7) { const it = put('lanterns', Q.x, Q.z, { s: 1.1 }); if (it) world.candles.push({ x: it.x, y: it.y + 0.06, z: it.z, h: 0.05 }); }
      toWorld(u, q.s * (halfW(u) + 0.3 + q.hd * 2 - 0.8), Q);
      const r2 = rand();
      if (r2 < 0.2) put('baskets', Q.x, Q.z, { s: 1 + rand() * 0.3 });
      else if (r2 < 0.38) { const it = put('crates', Q.x, Q.z, { s: 0.9, rot: rot + (rand() - 0.5) * 0.3 }); if (it && rand() < 0.5) items.crates.push({ x: it.x, y: it.y + 0.3, z: it.z, s: 0.9, rot: it.rot + (rand() - 0.5) * 0.4, k: it.k }); }
      else if (r2 < 0.5) put('buckets', Q.x, Q.z, { s: 1 });
      else if (r2 < 0.64) put('chairs', Q.x, Q.z, { s: 1, rot: rot + (q.s > 0 ? Math.PI : 0) + Math.PI / 2 + (rand() - 0.5) * 0.7 });
    }
  }
  // benches facing the river on the atrium terrace and by the capilla
  const bench = (u, d, face, y) => { toWorld(u, d, Q); const f = frame(u); put('benches', Q.x, Q.z, { s: 1, rot: Math.atan2(f.tx, f.tz) + face }, y); };
  if (L.atrium) for (const du of [-15, -7, 7, 15]) bench(L.atrium.u + du, L.atrium.d - L.atrium.hd + 1.4, 0, L.atrium.y);
  if (L.capilla) bench(L.capilla.u + 3.5, L.capilla.d + 3.8, Math.PI);
  // panteon: pots of cempasuchil and jugs along the terrace fronts
  for (const pad of L.pant || []) {
    for (let k = 0; k < 12; k++) {
      const a = (rand() - 0.5) * 2 * (pad.hu - 1), b = -pad.hd + 0.7;
      const x = pad.x + a * pad.ax + b * pad.bx, z = pad.z + a * pad.az + b * pad.bz;
      const r = rand();
      if (r < 0.6) { const s = 1.3 + rand() * 0.5; const it = put('pots', x, z, { s }, pad.h); if (it) potFlowers(it, 0.22 * s); }
      else if (r < 0.85) put('jugs', x, z, { s: 1.1 + rand() * 0.4 }, pad.h);
      else { const it = put('lanterns', x, z, { s: 1.1 }, pad.h); if (it) world.candles.push({ x: it.x, y: it.y + 0.06, z: it.z, h: 0.05 }); }
    }
  }
  const o = { near: 22, far: 160, castFar: false, layer: 5 };
  const counts = Object.entries({ pots, ollas, jugs, baskets, buckets, crates, chairs, benches, lanterns }).map(([k, v]) => place(world, v, items[k], o));
  if (flowers.length) flowerCards(world, flowers, 'f_cempa', 0, 0.12);
  buildPier(world);
  world.mark && world.mark('pueblo props ' + counts.join('/'));
}

// wooden embarcadero reaching into the canal between the two moored ofrenda trajineras
function buildPier(world) {
  if (!hasModel('modular_wooden_pier')) return;
  const parts = scannedParts('modular_wooden_pier', { only: [2, 3, 4, 5] });
  if (!parts.length) return;
  const mats = [scannedMat('modular_wooden_pier', { mat: 0, roughness: 1, porosity: 0.8 }), scannedMat('modular_wooden_pier', { mat: 1, roughness: 1, porosity: 0.8 })];
  const u = 260.5, w = halfW(u);
  const f = frame(u);
  const g = new THREE.Group();
  // local +z of the kit runs toward the bank; deck top (y 2.65 in the kit) sits 0.55 m above the water
  const land = toWorld(u, w + 1.6);
  g.position.set(land.x, 0.55 - 2.65, land.z);
  g.rotation.y = Math.atan2(f.nx, f.nz);
  for (const p of parts) {
    const m = new THREE.Mesh(p.lod[0], mats[p.mat || 0]);
    m.castShadow = true; m.receiveShadow = true; m.name = 'pier';
    g.add(m);
  }
  world.scene.add(g);
  g.updateMatrixWorld(true);
  for (let z = 0; z > -6.2; z -= 1.2) {
    const c = new THREE.Vector3(0, 2.65, z).applyMatrix4(g.matrixWorld);
    world.obstacles.push({ x: c.x, z: c.z, r: 1.3, kind: 'pier', sub: 0.3 });
    world.blockers.push({ x: c.x, z: c.z, r: 1.4 });
  }
}

// fallen trunks, a second stump variant and river stones on the gravel bars
export function buildBankWood(world) {
  const rand = mulberry32(7373);
  const P = {};
  const logs = assembly('dead_tree_trunk', { mat: { roughness: 1, porosity: 0.85 } });
  const stumps = assembly('tree_stump_02', { mat: { roughness: 1, porosity: 0.8 } });
  const stones = [].concat(assembly('rock_07', { mat: { roughness: 1, porosity: 0.7 } }), assembly('stone_01', { mat: { roughness: 1, porosity: 0.7 } }));
  const LG = [], ST = [], SN = [];
  for (let k = 0; k < 80 && LG.length < 16; k++) {
    const u = 320 + rand() * (R.FALL_U - 360), side = rand() < 0.5 ? -1 : 1;
    const d = side * (halfW(u) + 1.5 + rand() * 6);
    toWorld(u, d, P);
    const h = terrainH(P.x, P.z, u);
    if (h < 0.1 || (world.isBlocked && world.isBlocked(P.x, P.z, 2.5))) continue;
    const f = frame(u);
    LG.push({ x: P.x, y: h - 0.08, z: P.z, s: 0.9 + rand() * 0.5, rot: Math.atan2(f.tx, f.tz) + (rand() - 0.5) * 1.2, k: rand(), tx: (rand() - 0.5) * 0.06 });
    world.blockers.push({ x: P.x, z: P.z, r: 2.2 });
  }
  for (let k = 0; k < 200 && ST.length < 30; k++) {
    const u = -150 + rand() * 1000, side = rand() < 0.5 ? -1 : 1;
    const d = side * (halfW(u) + 6 + rand() * 50);
    toWorld(u, d, P);
    const h = terrainH(P.x, P.z, u);
    if (h > 90 || (world.isBlocked && world.isBlocked(P.x, P.z, 1.5))) continue;
    ST.push({ x: P.x, y: h - 0.08, z: P.z, s: 0.6 + rand() * 0.5, rot: rand() * 6.28, k: rand() });
  }
  for (let u = -170; u < R.FALL_U - 10; u += 1.4) {
    for (const side of [-1, 1]) {
      const kk = bankKind(u, side);
      if (rand() > 0.4 * (1 - kk)) continue;
      const d = side * (halfW(u) - 0.5 + rand() * 3.2);
      toWorld(u, d, P);
      const h = terrainH(P.x, P.z, u);
      if (h < -0.5 || h > 1.2) continue;
      for (let j = 0; j < 3; j++) SN.push({ x: P.x + (rand() - 0.5) * 1.2, y: h - 0.04, z: P.z + (rand() - 0.5) * 1.2, s: 0.8 + rand() * 1.4, rot: rand() * 6.28, k: rand(), tx: (rand() - 0.5) * 0.4, tz: (rand() - 0.5) * 0.4 });
    }
  }
  place(world, logs, LG, { near: 45, far: 300, castFar: false });
  place(world, stumps, ST, { near: 22, far: 180, castFar: false, layer: 5 });
  place(world, stones, SN, { near: 14, far: 70, cast: false, layer: 5 });
  world.mark && world.mark('bank wood ' + [LG.length, ST.length, SN.length].join('/'));
}
