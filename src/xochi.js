// Xochimilco-style Dia de Muertos elements: ahuejotes, moored ofrenda trajineras, boat garlands, veladoras
import * as THREE from 'three';
import { generateTree, SPECIES } from './treegen.js';
import { barkMat, leafMat } from './forest.js';
import { buildBoatMesh, hb, yg, yb } from './boat.js';
import { buildPapel, buildCandles, flowerCards } from './decor.js';
import { std } from './materials.js';
import { mulberry32, smoothstep, lerp } from './noise.js';
import { R, toWorld, halfW, terrainH, frame } from './river.js';
import { L } from './layout.js';
import { deckY } from './architecture.js';
import { uvMat } from './matlib.js';

function toParent(world, meshes, parent) { (meshes || []).forEach((m) => { world.scene.remove(m); parent.add(m); }); }

export function buildAhuejotes(world) {
  const r = mulberry32(606);
  const variants = [1, 2, 3].map((k) => generateTree('ahuejote', { seed: 900 + k * 13, scale: 0.9 + k * 0.08, lod: 0.6 }));
  const wm = barkMat('ahuejote'), lm = leafMat('f_ahue', { transl: 0.7, color: 0xd6eaa8 });
  const lists = [[], [], []];
  const P = {};
  for (const side of [-1, 1]) {
    let u = -160 + r() * 4;
    while (u < 385) {
      u += 5 + r() * 3.5;
      if (Math.abs(u - L.bridge.u) < 14 || (side > 0 && u > 244 && u < 300)) continue;
      if (r() < 0.12) { u += 8; continue; }
      const d = side * (halfW(u) + 2.6 + r() * 2.5);
      toWorld(u, d, P);
      if (world.isBlocked(P.x, P.z, 1.0)) continue;
      const h = terrainH(P.x, P.z, u);
      if (h < 0.2) continue;
      lists[Math.floor(r() * 3)].push({ x: P.x, y: h - 0.2, z: P.z, s: 0.85 + r() * 0.35, rot: r() * 6.28 });
      world.blockers.push({ x: P.x, z: P.z, r: 1.2 });
      world.canopies.push({ x: P.x, y: h + 8, z: P.z, r: 2.6, kind: 'ahuejote', trunk: { x: P.x, z: P.z, r: 0.4 } });
    }
  }
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sv = new THREE.Vector3(), tv = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  lists.forEach((list, i) => {
    if (!list.length) return;
    const w = new THREE.InstancedMesh(variants[i].wood, wm, list.length);
    const l = new THREE.InstancedMesh(variants[i].leaves, lm, list.length);
    list.forEach((t, k) => { q.setFromAxisAngle(up, t.rot); sv.setScalar(t.s); tv.set(t.x, t.y, t.z); m4.compose(tv, q, sv); w.setMatrixAt(k, m4); l.setMatrixAt(k, m4); });
    for (const m of [w, l]) { m.castShadow = true; m.receiveShadow = true; m.computeBoundingSphere(); m.name = 'ahuejotes'; world.scene.add(m); }
  });
}

// extra veladoras across the pueblo (must run before buildCandles)
export function extraCandles(world) {
  const r = mulberry32(707);
  const Mb = world.bridgeMatrix;
  for (let k = 0; k < 22; k++) {
    const X = -19 + k * 1.8 + (r() - 0.5) * 0.4;
    for (const zs of [-1, 1]) {
      if (r() < 0.45) continue;
      const p = new THREE.Vector3(X, deckY(X) + 1.09, zs * (4.6 / 2 - 0.2)).applyMatrix4(Mb);
      world.candles.push({ x: p.x, y: p.y, z: p.z, h: 0.08 + r() * 0.06 });
    }
  }
  // steps
  for (const s of world.stepPetals.filter((_, i) => i % 3 === 0)) world.candles.push({ x: s.x, y: s.y - 0.03, z: s.z, h: 0.1 + r() * 0.08 });
  // atrial cross base
  if (world.crossPos) for (let k = 0; k < 14; k++) { const a = k / 14 * 6.28; world.candles.push({ x: world.crossPos.x + Math.cos(a) * 1.6, y: world.crossPos.y + 0.02, z: world.crossPos.z + Math.sin(a) * 1.6, h: 0.1 + r() * 0.1 }); }
  // landing
  const lp = toWorld(L.landing.u, halfW(L.landing.u) + 3);
  for (let k = 0; k < 16; k++) { const x = lp.x + (r() - 0.5) * 5, z = lp.z + (r() - 0.5) * 4; world.candles.push({ x, y: terrainH(x, z) + 0.02, z, h: 0.1 + r() * 0.12 }); }
  // around the catrinas
  for (const c of world.catrinaLights || []) for (let k = 0; k < 10; k++) { const a = r() * 6.28, d = 1.3 + r() * 0.8; const x = c.x + Math.cos(a) * d, z = c.z + Math.sin(a) * d; world.candles.push({ x, y: terrainH(x, z) + 0.02, z, h: 0.1 + r() * 0.12 }); }
}

// veladoras (glass votive jars) in clusters along both banks of the village reach
export function bankVeladoras(world) {
  const r = mulberry32(4242);
  const pal = [[0.95, 0.14, 0.1], [1.0, 0.55, 0.12], [1.0, 0.93, 0.8], [0.62, 0.22, 0.85], [1.0, 0.32, 0.55], [1.0, 0.55, 0.12], [0.95, 0.14, 0.1]];
  const list = [];
  const place = (u, side, e0) => {
    for (let t = 0; t < 4; t++) {
      const e = e0 + t * 0.45;
      const p = toWorld(u, side * (halfW(u) + e));
      const h = terrainH(p.x, p.z, u);
      const p2 = toWorld(u, side * (halfW(u) + e + 0.4));
      const h2 = terrainH(p2.x, p2.z, u);
      if (h > 0.14 && Math.abs(h2 - h) < 0.28) return { x: p.x, y: h - 0.01, z: p.z };
    }
    return null;
  };
  for (const side of [-1, 1]) {
    for (let u = 92; u < 470; u += 2.2 + r() * 2.6) {
      if (Math.abs(u - L.bridge.u) < 9) continue;
      if (r() > 0.62) continue;
      const nC = 2 + Math.floor(r() * r() * 7);
      const e0 = 0.35 + r() * 0.9;
      for (let k = 0; k < nC; k++) {
        const q = place(u + (r() - 0.5) * 1.6, side, e0 + (r() - 0.5) * 0.5);
        if (!q) continue;
        const c = pal[Math.floor(r() * pal.length)];
        list.push({ x: q.x, y: q.y, z: q.z, h: 0.1 + r() * 0.07, col: c });
      }
    }
  }
  world.veladoras = list;
  buildCandles(world, list, null, { jar: true });
}

function ofrenda(world, group, r) {
  const cloth = std({ color: 0xf2eee6, roughness: 0.9 }, { key: 'cloth' });
  const z0 = -3.55;
  const tiers = [[1.5, 0.22, 0.9, 0.2], [1.2, 0.2, 0.62, 0.42], [0.9, 0.18, 0.38, 0.62]];
  const flowers = [], candles = [], bread = [];
  for (const [w, h, d, y] of tiers) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), cloth);
    b.position.set(0, y + h / 2, z0 + (0.9 - d) / 2);
    b.castShadow = true; b.receiveShadow = true;
    group.add(b);
    for (let k = 0; k < 14; k++) flowers.push({ p: new THREE.Vector3((k / 13 - 0.5) * w, y + h * 0.6, z0 + (0.9 - d) / 2 + d / 2 + 0.03), n: new THREE.Vector3(0, 0.3, 1).normalize(), kind: 0 });
    for (let k = 0; k < 5; k++) candles.push({ x: (k / 4 - 0.5) * (w - 0.2), y: y + h, z: z0 + (0.9 - d) / 2 - d * 0.2, h: 0.12 + r() * 0.08 });
    for (let k = 0; k < 3; k++) bread.push(new THREE.Vector3((k - 1) * w * 0.3, y + h + 0.04, z0 + (0.9 - d) / 2 + d * 0.15));
  }
  const bm = std({ color: 0x9a5a2a, roughness: 0.7 }, { key: 'bread' });
  for (const p of bread) { const s = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 6), bm); s.scale.set(1, 0.6, 1); s.position.copy(p); group.add(s); }
  // flower cross on top
  for (let k = 0; k < 9; k++) flowers.push({ p: new THREE.Vector3(0, 0.95 + k * 0.07, z0 + 0.3), n: new THREE.Vector3(0, 0, 1), kind: 0 });
  for (let k = -3; k <= 3; k++) flowers.push({ p: new THREE.Vector3(k * 0.07, 1.33, z0 + 0.3), n: new THREE.Vector3(0, 0, 1), kind: 0 });
  toParent(world, flowerCards(world, flowers, 'f_cempa', 0, 0.16), group);
  buildCandles(world, candles, group);
}

function boatGarlands(world, group, r, withPapel = true) {
  const fl = [], mag = [];
  // along the bow arch
  const z = 3.55, cy = yg(z) + 0.95;
  for (let k = 0; k <= 40; k++) {
    const a = 0.12 + (Math.PI - 0.24) * k / 40;
    for (const rr of [1.0, 0.7]) {
      const p = new THREE.Vector3(Math.cos(a) * rr, cy + Math.sin(a) * rr, z + (r() - 0.5) * 0.06);
      (k % 5 === 0 ? mag : fl).push({ p, n: new THREE.Vector3(Math.cos(a), Math.sin(a), 0.4).normalize(), kind: 0 });
    }
  }
  // drooping garlands along gunwales
  for (const s of [-1, 1]) {
    for (let seg = 0; seg < 5; seg++) {
      const z0 = -1.9 + seg * 0.8, z1 = z0 + 0.8;
      for (let k = 0; k <= 8; k++) {
        const t = k / 8;
        const zz = lerp(z0, z1, t);
        const p = new THREE.Vector3(s * (hb(zz) + 0.04), yg(zz) + 0.02 - Math.sin(Math.PI * t) * 0.22, zz);
        fl.push({ p, n: new THREE.Vector3(s, 0.2, 0).normalize(), kind: 0 });
      }
    }
  }
  toParent(world, flowerCards(world, fl, 'f_cempa', 0, 0.15), group);
  toParent(world, flowerCards(world, mag, 'f_buga', 0, 0.16), group);
  if (withPapel) {
    const top = yg(0) + 0.99;
    const lines = [[new THREE.Vector3(0.35, top, 2.05), new THREE.Vector3(0.35, top, -1.85), 0.05], [new THREE.Vector3(-0.35, top, 2.05), new THREE.Vector3(-0.35, top, -1.85), 0.05], [new THREE.Vector3(0, cy + 1.0, z), new THREE.Vector3(0, 2.3, 5.0), 0.1]];
    buildPapel(world, lines, group);
  }
}

export function mooredTrajineras(world) {
  const r = mulberry32(808);
  world.moored = [];
  for (const [u, dOff, head] of [[252, -1.4, 0.08], [269, -1.3, -0.05]]) {
    const w = halfW(u);
    const d = w + dOff;
    const p = toWorld(u, d);
    const f = frame(u);
    const mesh = buildBoatMesh();
    const g = mesh.group;
    const root = new THREE.Group();
    root.add(g);
    root.position.set(p.x, 0, p.z);
    root.rotation.y = Math.atan2(f.tx, f.tz) + head;
    world.scene.add(root);
    ofrenda(world, g, r);
    root.updateMatrixWorld(true);
    (world.ofrendaGlow = world.ofrendaGlow || []).push(new THREE.Vector3(0, 1.0, -3.2).applyMatrix4(g.matrixWorld));
    boatGarlands(world, g, r, true);
    // mooring rope to a stake on the bank
    const stakeP = toWorld(u - 3, w + 1.5);
    const sh = terrainH(stakeP.x, stakeP.z);
    const stake = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 1.0, 6), uvMat('planks', { color: 0x8a6a50 }));
    stake.position.set(stakeP.x, sh + 0.3, stakeP.z);
    world.scene.add(stake);
    root.updateMatrixWorld(true);
    const bowW = new THREE.Vector3(0, yg(-4.3) + 0.05, -4.2).applyMatrix4(g.matrixWorld);
    const rope = new THREE.Mesh(new THREE.TubeGeometry(new THREE.QuadraticBezierCurve3(bowW, bowW.clone().lerp(stake.position, 0.5).add(new THREE.Vector3(0, -0.4, 0)), stake.position.clone().add(new THREE.Vector3(0, 0.4, 0))), 12, 0.012, 4), std({ color: 0x8a7050, roughness: 0.9 }, { key: 'rope' }));
    world.scene.add(rope);
    for (let k = -3; k <= 3; k++) {
      const q = new THREE.Vector3(0, 0, k * 1.2).applyMatrix4(g.matrixWorld);
      world.obstacles.push({ x: q.x, z: q.z, r: 1.05, kind: 'boat', sub: 0.2 });
    }
    world.moored.push({ root, g, phase: r() * 6 });
    world.glowSources.push((list, cp) => {
      const n = world.tod.night * 0.95 + world.tod.dusk * 0.3;
      if (n < 0.02) return;
      const c = new THREE.Vector3(0, 0.9, -3.3).applyMatrix4(g.matrixWorld);
      list.push({ x: c.x, y: c.y, z: c.z, r: 8, cr: 1.8 * n, cg: 1.0 * n, cb: 0.4 * n, w: 10 / (1 + cp.distanceTo(c) * 0.08) });
    });
  }
  world.updaters.push((dt, t) => { for (const m of world.moored) { m.g.rotation.set(Math.sin(t * 0.8 + m.phase) * 0.006, 0, Math.sin(t * 0.6 + m.phase) * 0.012); m.g.position.y = Math.sin(t * 1.1 + m.phase) * 0.01; } });
}

export function decorateHeroBoat(world) {
  const r = mulberry32(909);
  const b = world.boat;
  boatGarlands(world, b.group, r, true);
  const c = [];
  for (let k = 0; k < 6; k++) c.push({ x: -0.45 + k * 0.18, y: 0.16, z: 3.3 + (k % 2) * 0.12, h: 0.1 + r() * 0.05 });
  for (let k = 0; k < 3; k++) c.push({ x: -0.5 + k * 0.5, y: yg(1.6) - 0.1, z: 1.6, h: 0.09 });
  buildCandles(world, c, b.group);
  // hanging tin lantern under the rear canopy hoop, lights the cargo and the boatman
  const lm = std({ color: 0xb8b2a6, roughness: 0.35, metalness: 0.8, emissive: 0xffa04a, emissiveIntensity: 0 }, { key: 'heroLan' });
  const lg = new THREE.Group();
  const y0 = yg(-1.9) + 0.95 - 0.42;
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.17, 10), lm); body.position.y = 0;
  const cap = new THREE.Mesh(new THREE.ConeGeometry(0.085, 0.08, 10), lm); cap.position.y = 0.125;
  const wire = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.24, 4), std({ color: 0x222222, roughness: 0.6 }, { key: 'wire' })); wire.position.y = 0.28;
  lg.add(body, cap, wire);
  lg.position.set(0, y0, -1.9);
  b.group.add(lg);
  buildCandles(world, [{ x: 0, y: y0 - 0.08, z: -1.9, h: 0.07 }], b.group);
  const lp = new THREE.Vector3();
  world.updaters.push(() => { const n = world.tod.night * 0.95 + world.tod.dusk * 0.4; lm.emissiveIntensity = n * 2.2; });
  world.glowSources.push((list) => {
    const n = world.tod.night * 0.95 + world.tod.dusk * 0.4;
    if (n < 0.02) return;
    lg.getWorldPosition(lp);
    const f = 0.9 + 0.1 * Math.sin(world.time * 12.3) * Math.sin(world.time * 7.1);
    list.push({ x: lp.x, y: lp.y - 0.1, z: lp.z, r: 7, cr: 1.9 * n * f, cg: 1.05 * n * f, cb: 0.42 * n * f, w: 95 });
  });
}
