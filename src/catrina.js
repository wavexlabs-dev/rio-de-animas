// Catrina sculptures (tall dressed skeleton figures in the Xochimilco Dia de Muertos tradition)
import * as THREE from 'three';
import { V, smin, smax, sdCapsule, sdCone, sdEll, sdBox, polygonize } from './sdf.js';
import { std } from './materials.js';
import { fbm3, mulberry32 } from './noise.js';
import { flowerCards } from './decor.js';
import { toWorld, terrainH, frame } from './river.js';
import { buildGeneratedCatrinas } from './sculptures.js';

function catrinaSDF(pose) {
  // unit: metres for a 1.8 m reference figure (scaled up later)
  const armL = pose.armL, armR = pose.armR;
  return (x, y, z) => {
    // long skirt
    let d = sdCone(x, y, z, V(0, 1.02, 0), V(0, 0.02, 0), 0.15, 0.44) - 0.02 * Math.sin(Math.atan2(z, x) * 12) * (1.02 - y);
    // skirt ruffles (bumps near hem)
    d = smin(d, sdEll(x, y, z, V(0, 0.08, 0), 0.5, 0.1, 0.5), 0.08);
    // bodice
    d = smin(d, sdEll(x, y, z, V(0, 1.22, 0), 0.14, 0.2, 0.1), 0.06);
    // shoulders / shawl
    d = smin(d, sdEll(x, y, z, V(0, 1.4, -0.01), 0.22, 0.07, 0.11), 0.06);
    // neck vertebrae
    for (let i = 0; i < 3; i++) d = smin(d, sdEll(x, y, z, V(0, 1.47 + i * 0.035, -0.01), 0.028, 0.018, 0.028), 0.01);
    // skull (cranium + cheekbones + jaw) with carved sockets
    let s = sdEll(x, y, z, V(0, 1.68, 0.0), 0.092, 0.11, 0.105);
    s = smin(s, sdEll(x, y, z, V(0, 1.6, 0.045), 0.06, 0.05, 0.055), 0.03);
    s = smin(s, sdEll(x, y, z, V(0.055, 1.635, 0.06), 0.03, 0.022, 0.03), 0.02);
    s = smin(s, sdEll(x, y, z, V(-0.055, 1.635, 0.06), 0.03, 0.022, 0.03), 0.02);
    s = smax(s, -sdEll(x, y, z, V(0.035, 1.665, 0.1), 0.026, 0.024, 0.03), 0.01);
    s = smax(s, -sdEll(x, y, z, V(-0.035, 1.665, 0.1), 0.026, 0.024, 0.03), 0.01);
    s = smax(s, -sdEll(x, y, z, V(0, 1.625, 0.105), 0.01, 0.016, 0.02), 0.006);
    d = smin(d, s, 0.015);
    // bony arms
    for (const a of [armL, armR]) {
      d = smin(d, sdCapsule(x, y, z, a[0], a[1], 0.022), 0.02);
      d = smin(d, sdEll(x, y, z, a[1], 0.03, 0.03, 0.03), 0.01);
      d = smin(d, sdCapsule(x, y, z, a[1], a[2], 0.018), 0.01);
      d = smin(d, sdEll(x, y, z, a[2], 0.03, 0.045, 0.02), 0.01);
    }
    // sleeves ruff
    d = smin(d, sdEll(x, y, z, armL[0], 0.06, 0.05, 0.06), 0.03);
    d = smin(d, sdEll(x, y, z, armR[0], 0.06, 0.05, 0.06), 0.03);
    // wide hat
    const hb = sdEll(x, y, z, V(0, 1.79, -0.01), 0.42, 0.028, 0.42);
    const hc = sdEll(x, y, z, V(0, 1.84, -0.01), 0.12, 0.08, 0.12);
    d = Math.min(d, smin(hb, hc, 0.03));
    return d;
  };
}

function catrinaColor(pal) {
  return (x, y, z) => {
    if (y > 1.76 && (Math.hypot(x, z + 0.01) > 0.1 || y > 1.8)) return pal.hat;
    if (y > 1.52 && y < 1.8) {
      // skull: white with painted details
      const eyeL = Math.hypot(x - 0.035, y - 1.665, (z - 0.1) * 0.9), eyeR = Math.hypot(x + 0.035, y - 1.665, (z - 0.1) * 0.9);
      if (eyeL < 0.03 || eyeR < 0.03) return [0.02, 0.02, 0.03];
      if (Math.hypot(x, y - 1.625) < 0.018 && z > 0.08) return [0.03, 0.03, 0.03];
      if (Math.abs(eyeL - 0.04) < 0.006 || Math.abs(eyeR - 0.04) < 0.006) return pal.paint;
      if (y < 1.6 && y > 1.585 && z > 0.07 && Math.abs(x) < 0.04 && (Math.floor(x * 120) % 2 === 0)) return [0.08, 0.08, 0.08];
      if (Math.abs(x) < 0.012 && y > 1.72 && z > 0.04) return pal.paint;
      return [0.9, 0.88, 0.82];
    }
    if (y > 1.45 && y <= 1.52 && Math.abs(x) < 0.05) return [0.85, 0.83, 0.78];
    if (y > 1.3 && y < 1.5) return pal.shawl;
    if (Math.abs(x) > 0.2 && y > 0.8) return [0.88, 0.86, 0.8];
    if (y < 1.02) {
      if (y < 0.16) return pal.skirt2;
      if (Math.abs(y - 0.42) < 0.03) return pal.skirt2;
      const pleat = 0.9 + 0.1 * Math.sin(Math.atan2(z, x) * 24);
      return pal.skirt.map((v) => v * pleat);
    }
    return pal.bodice;
  };
}

export function buildCatrinas(world) {
  const r = mulberry32(333);
  const spots = [
    { u: 150, d: 44, rot: 0.3, pal: 0, pairWith: 1 },
    { u: 150, d: 52, rot: 0.3, pal: 1 },
    { u: 420, d: 21, rot: 2.6, pal: 2 },
    { u: 108, d: -40, rot: -1.2, pal: 3 },
  ];
  const pals = [
    { skirt: [0.65, 0.08, 0.3], skirt2: [0.9, 0.45, 0.06], bodice: [0.55, 0.06, 0.25], shawl: [0.08, 0.06, 0.1], hat: [0.06, 0.05, 0.07], paint: [0.95, 0.4, 0.05] },
    { skirt: [0.15, 0.45, 0.6], skirt2: [0.95, 0.75, 0.1], bodice: [0.1, 0.35, 0.5], shawl: [0.5, 0.05, 0.2], hat: [0.12, 0.08, 0.2], paint: [0.8, 0.1, 0.4] },
    { skirt: [0.95, 0.5, 0.06], skirt2: [0.6, 0.05, 0.15], bodice: [0.85, 0.35, 0.05], shawl: [0.06, 0.05, 0.06], hat: [0.08, 0.06, 0.06], paint: [0.2, 0.5, 0.9] },
    { skirt: [0.4, 0.1, 0.55], skirt2: [0.9, 0.9, 0.85], bodice: [0.32, 0.08, 0.45], shawl: [0.1, 0.1, 0.12], hat: [0.1, 0.07, 0.12], paint: [0.95, 0.55, 0.1] },
  ];
  if (buildGeneratedCatrinas(world, spots)) { catrinaExtras(world, r); return; }
  const mat = std({ vertexColors: true, roughness: 0.62, metalness: 0 }, { porosity: 0.3, key: 'catrina' });
  const S = 2.05;
  const poses = [
    { armL: [V(0.2, 1.4, 0), V(0.34, 1.22, 0.08), V(0.46, 1.3, 0.22)], armR: [V(-0.2, 1.4, 0), V(-0.28, 1.15, 0.1), V(-0.2, 1.08, 0.24)] },
    { armL: [V(0.2, 1.4, 0), V(0.3, 1.16, 0.08), V(0.25, 1.05, 0.25)], armR: [V(-0.2, 1.4, 0), V(-0.34, 1.22, 0.08), V(-0.46, 1.3, 0.22)] },
  ];
  const geos = poses.map((p) => {
    const f0 = catrinaSDF(p);
    return polygonize((x, y, z) => f0(x / S, y / S, z / S) * S, V(-1.1, -0.02, -1.1), V(1.1, 1.95 * S, 1.1), 0.036);
  });
  world.catrinaLights = [];
  const flowers = [], mags = [];
  spots.forEach((sp, i) => {
    const g = geos[i % 2 === 1 ? 1 : 0].clone();
    const cf = catrinaColor(pals[sp.pal]);
    const p = g.attributes.position;
    const col = new Float32Array(p.count * 3);
    for (let k = 0; k < p.count; k++) {
      const c = cf(p.getX(k) / S, p.getY(k) / S, p.getZ(k) / S);
      const n = 0.9 + 0.15 * fbm3(p.getX(k) * 9, p.getY(k) * 9, p.getZ(k) * 9, 2);
      col[k * 3] = c[0] * n; col[k * 3 + 1] = c[1] * n; col[k * 3 + 2] = c[2] * n;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const w = toWorld(sp.u, sp.d);
    const h = terrainH(w.x, w.z, sp.u);
    const m = new THREE.Mesh(g, mat);
    m.position.set(w.x, h - 0.08, w.z);
    const f = frame(sp.u);
    const sg = Math.sign(sp.d);
    m.rotation.y = Math.atan2(-f.nx * sg, -f.nz * sg) + sp.rot * 0.35;
    m.castShadow = true; m.receiveShadow = true;
    m.name = 'catrina';
    world.scene.add(m);
    m.updateMatrixWorld();
    world.blockers.push({ x: w.x, z: w.z, r: 1.3 });
    // flower crown + corsage
    for (let k = 0; k < 26; k++) {
      const a = k / 26 * Math.PI * 2;
      const lp = new THREE.Vector3(Math.cos(a) * 0.13 * S, 1.84 * S + 0.05, Math.sin(a) * 0.13 * S - 0.02).applyMatrix4(m.matrixWorld);
      const n = new THREE.Vector3(Math.cos(a) * 0.4, 1, Math.sin(a) * 0.4).normalize();
      (k % 3 === 0 ? mags : flowers).push({ p: lp, n, kind: 0 });
    }
    for (let k = 0; k < 7; k++) {
      const lp = new THREE.Vector3((r() - 0.5) * 0.16 * S, (1.28 + r() * 0.1) * S, 0.11 * S + 0.03).applyMatrix4(m.matrixWorld);
      flowers.push({ p: lp, n: new THREE.Vector3(0, 0, 1).applyQuaternion(m.quaternion), kind: 0 });
    }
    const lp = new THREE.Vector3(0, 2.2, 1.6).applyMatrix4(m.matrixWorld);
    world.catrinaLights.push(lp);
  });
  flowerCards(world, flowers, 'f_cempa', 0, 0.28);
  flowerCards(world, mags, 'f_buga', 0, 0.3);
  catrinaExtras(world, r);
}

function catrinaExtras(world, r) {
  // garland held between the two catrinas in the field
  const a = toWorld(150, 44), b = toWorld(150, 52);
  const ya = terrainH(a.x, a.z) + 2.55, yb = terrainH(b.x, b.z) + 2.55;
  const gl = [];
  for (let k = 0; k <= 60; k++) {
    const t = k / 60;
    const p = new THREE.Vector3(a.x + (b.x - a.x) * t, ya + (yb - ya) * t - Math.sin(Math.PI * t) * 1.0, a.z + (b.z - a.z) * t);
    for (let j = 0; j < 3; j++) gl.push({ p: p.clone().add(new THREE.Vector3((r() - 0.5) * 0.12, (r() - 0.5) * 0.12, (r() - 0.5) * 0.12)), n: new THREE.Vector3(r() - 0.5, r() - 0.5, r() - 0.5).normalize(), kind: 0 });
  }
  flowerCards(world, gl, 'f_cempa', 0, 0.22);
  world.glowSources.push((list, cp) => {
    const n = world.tod.night * 0.9 + world.tod.dusk * 0.3;
    if (n < 0.02) return;
    for (const p of world.catrinaLights) list.push({ x: p.x, y: p.y, z: p.z, r: 9, cr: 1.8 * n, cg: 1.0 * n, cb: 0.6 * n, w: 8 / (1 + cp.distanceTo(p) * 0.05) });
  });
}
