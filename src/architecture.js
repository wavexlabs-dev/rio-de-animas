import * as THREE from 'three';
import { Batch, riverFrameMatrix, box, extrude, arcPts, frustum, cylinder, tubeAlong } from './archkit.js';
import { uvMat, boxUV } from './matlib.js';
import { std, depthMat, U } from './materials.js';
import { tex, ntex } from './textures.js';
import { mulberry32, lerp, smoothstep, clamp } from './noise.js';
import { R, toWorld, terrainH, frame, halfW, padLocal } from './river.js';
import { L } from './layout.js';

export function deckY(X) {
  const a = Math.abs(X);
  return a < 22 ? 3.2 + 3.2 * Math.cos(Math.PI * X / 44) : 3.2;
}

export function buildArchitecture(world) {
  const scene = world.scene;
  const rand = mulberry32(5150);
  const B = new Batch();
  const mats = {
    cantera: uvMat('cantera', { color: 0xfaece8, roughness: 0.82, porosity: 0.7, vertexColors: true }),
    braza: uvMat('braza', { color: 0xe8e0d8, roughness: 0.9, porosity: 0.8, vertexColors: true }),
    plaster: uvMat('plaster', { color: 0xffffff, roughness: 0.88, porosity: 0.6, vertexColors: true, uvMul: 0.42 }),
    plasterblue: uvMat('plasterblue', { color: 0xffffff, roughness: 0.85, porosity: 0.6, vertexColors: true }),
    doors: uvMat('doors', { color: 0xffffff, roughness: 0.8, porosity: 0.6, vertexColors: true }),
    talavera: uvMat('talavera', { color: 0xffffff, roughness: 0.22, porosity: 0.1, vertexColors: true }),
    wood: uvMat('planks', { color: 0x9a7a62, roughness: 0.78, porosity: 0.6, vertexColors: true }),
    cobble: uvMat('cobble', { color: 0xffffff, roughness: 0.85, porosity: 0.8, vertexColors: true }),
    soil: uvMat('soil', { color: 0xffffff, roughness: 0.95, porosity: 0.9, vertexColors: true }),
    iron: std({ color: 0x2c2825, roughness: 0.55, metalness: 0.7, vertexColors: true }, { porosity: 0.3 }),
    bronze: std({ color: 0x7a5c34, roughness: 0.38, metalness: 0.9, vertexColors: true }, { porosity: 0.2 }),
    cane: std({ color: 0xb49a66, roughness: 0.8, metalness: 0, vertexColors: true, map: tex('petate_c') }, { porosity: 0.6 }),
  };
  world.archMats = mats;
  world.bells = [];
  world.lanterns = [];
  world.candles = [];
  world.papelLines = [];

  // ================= BRIDGE =================================================
  const bu = L.bridge.u;
  const Mb = riverFrameMatrix(bu, 0, 0);
  world.bridgeMatrix = Mb;
  {
    const W = 4.6;
    const prof = [];
    for (let X = -24; X <= 24.001; X += 0.8) prof.push([X, deckY(X)]);
    const outline = [[-24, -3.6], [24, -3.6], ...prof.slice().reverse()];
    // arch openings
    const holes = [];
    const cen = arcPts(0, 1.0, 4.8, 0, Math.PI, 28);
    holes.push([[-4.8, -3.0], [4.8, -3.0], ...cen].reverse());
    const sideR = 5.7, sideC = 12.3, sideY = 4.2 - 5.7;
    for (const s of [-1, 1]) {
      const a0 = Math.acos(5.3 / sideR);
      const arc = arcPts(s * sideC, sideY, sideR, a0, Math.PI - a0, 24);
      const hl = [[s * sideC - 5.3, -3.0], [s * sideC + 5.3, -3.0], ...arc].reverse();
      holes.push(s < 0 ? hl : hl);
    }
    const body = extrude(outline, W, holes, null, 24);
    B.add('cantera', body, Mb, { uvScale: 4.0 });
    // voussoir rings on both faces
    const vous = (cx, cy, r, a0, a1, n) => {
      for (let i = 0; i < n; i++) {
        const t0 = a0 + (a1 - a0) * i / n + 0.004, t1 = a0 + (a1 - a0) * (i + 1) / n - 0.004;
        const r2 = r + 0.62;
        const pts = [[cx + Math.cos(t0) * r, cy + Math.sin(t0) * r], [cx + Math.cos(t0) * r2, cy + Math.sin(t0) * r2], [cx + Math.cos(t1) * r2, cy + Math.sin(t1) * r2], [cx + Math.cos(t1) * r, cy + Math.sin(t1) * r]];
        const c = 0.9 + rand() * 0.18;
        for (const zf of [-1, 1]) {
          const g = extrude(pts.reverse(), 0.12, [], zf * (W / 2) - (zf > 0 ? 0 : 0.12));
          pts.reverse();
          B.add('cantera', g, Mb, { uvScale: 4.0, color: [c, c * 0.98, c * 0.96] });
        }
      }
    };
    vous(0, 1.0, 4.8, 0, Math.PI, 21);
    for (const s of [-1, 1]) { const a0 = Math.acos(5.3 / sideR); vous(s * sideC, sideY, sideR, a0, Math.PI - a0, 17); }
    // piers + cutwaters (upstream = -Z)
    for (const px of L.bridge.piers) {
      const cw = extrude([[px - 1.1, -3.6], [px + 1.1, -3.6], [px + 1.1, 2.2], [px - 1.1, 2.2]], 0.01, [], 0);
      const tri = new THREE.BufferGeometry();
      const h0 = -3.6, h1 = 2.3, z0 = -W / 2, tip = -W / 2 - 2.0;
      const P = [[px - 1.1, z0], [px, tip], [px + 1.1, z0]];
      const pos = [];
      for (const [y0, y1] of [[h0, h1]]) {
        pos.push(P[0][0], y0, P[0][1], P[1][0], y0, P[1][1], P[1][0], y1, P[1][1], P[0][0], y0, P[0][1], P[1][0], y1, P[1][1], P[0][0], y1, P[0][1]);
        pos.push(P[1][0], y0, P[1][1], P[2][0], y0, P[2][1], P[2][0], y1, P[2][1], P[1][0], y0, P[1][1], P[2][0], y1, P[2][1], P[1][0], y1, P[1][1]);
      }
      // pyramidal cap
      pos.push(P[0][0], h1, P[0][1], P[1][0], h1, P[1][1], px, h1 + 1.4, z0);
      pos.push(P[1][0], h1, P[1][1], P[2][0], h1, P[2][1], px, h1 + 1.4, z0);
      tri.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      tri.computeVertexNormals();
      B.add('cantera', tri, Mb, { uvScale: 4.0 });
      // downstream buttress (rounded)
      const cyl = new THREE.CylinderGeometry(1.1, 1.15, 5.8, 16, 1, false, 0, Math.PI);
      cyl.rotateY(Math.PI / 2);
      cyl.translate(px, -0.7, W / 2);
      B.add('cantera', cyl, Mb, { uvScale: 4.0 });
      world.obstacles.push({ ...(() => { const p = new THREE.Vector3(px, 0, -W / 2 - 0.6).applyMatrix4(Mb); return { x: p.x, z: p.z }; })(), r: 1.2, kind: 'pier' });
    }
    // deck paving & parapets
    const pav = [];
    const deck = new THREE.BufferGeometry();
    const dp = [], du = [];
    for (let X = -22; X < 22; X += 0.5) {
      const y0 = deckY(X) + 0.02, y1 = deckY(X + 0.5) + 0.02;
      dp.push(X, y0, -1.95, X + 0.5, y1, -1.95, X + 0.5, y1, 1.95, X, y0, -1.95, X + 0.5, y1, 1.95, X, y0, 1.95);
    }
    deck.setAttribute('position', new THREE.Float32BufferAttribute(dp, 3));
    deck.computeVertexNormals();
    B.add('cobble', deck, Mb, { uvScale: 2.4 });
    for (const zf of [-1, 1]) {
      const pts = [];
      for (let X = -21.5; X <= 21.5001; X += 0.5) pts.push([X, deckY(X) + 0.95]);
      const outl = [[-21.5, deckY(-21.5) - 0.1], ...pts.map(([x, y]) => [x, y]).reverse().reverse(), [21.5, deckY(21.5) - 0.1]];
      const poly = [];
      for (let X = -21.5; X <= 21.5001; X += 0.5) poly.push([X, deckY(X) - 0.05]);
      const shape = poly.concat(pts.slice().reverse());
      const g = extrude(shape, 0.42, [], zf > 0 ? W / 2 - 0.42 : -W / 2);
      B.add('cantera', g, Mb, { uvScale: 4.0 });
      // coping
      const cp = [];
      for (let X = -21.6; X <= 21.6001; X += 0.5) cp.push([X, deckY(X) + 0.95]);
      const cp2 = cp.map(([x, y]) => [x, y + 0.14]).reverse();
      const gc = extrude(cp.concat(cp2), 0.56, [], zf > 0 ? W / 2 - 0.49 : -W / 2 - 0.07);
      B.add('cantera', gc, Mb, { uvScale: 4.0, color: [0.94, 0.92, 0.9] });
      // posts at bridge ends
      for (const xe of [-21.2, 21.2]) {
        B.add('cantera', box(0.7, 1.6, 0.7, xe, deckY(xe) - 0.1, zf * (W / 2 - 0.2)), Mb, { uvScale: 4.0 });
        B.add('cantera', frustum(0.7, 0.7, 0.1, 0.1, 0.5).translate(xe, deckY(xe) + 1.5, zf * (W / 2 - 0.2)), Mb, { uvScale: 4.0 });
      }
    }
    // abutment wing walls into the banks
    for (const s of [-1, 1]) {
      B.add('cantera', box(3.5, 6.5, W + 1.2, s * 23.2, -3.3, 0), Mb, { uvScale: 4.0 });
    }
    // river walls of the quays: face along the pad edge + end returns + coping
    for (const q of L.quays) {
      const p = q.pad;
      const A = new THREE.Vector3(p.ax, 0, p.az), Bv = new THREE.Vector3(p.bx, 0, p.bz);
      const C = new THREE.Vector3(p.x, 0, p.z);
      const faceB = -q.s * (q.hd + 0.42);
      const at = (a, b) => C.clone().addScaledVector(A, a).addScaledVector(Bv, b);
      const yaw = Math.atan2(p.ax, p.az);
      const wallSeg = (pa, pb, y0, y1, th, mat, col) => {
        const len = pa.distanceTo(pb);
        const mid = pa.clone().add(pb).multiplyScalar(0.5);
        const g = box(len, y1 - y0, th, 0, y0, 0);
        const m = new THREE.Matrix4().makeRotationY(Math.atan2(-(pb.z - pa.z), pb.x - pa.x)).setPosition(mid.x, 0, mid.z);
        B.add(mat, g, m, { uvScale: 2.2, color: col });
      };
      // river wall in 1.5 m panels whose top follows the quay (ramps down at the ends)
      for (let a = -q.hu - 9; a < q.hu + 9 - 0.01; a += 1.5) {
        const a1 = a + 1.5;
        const pm = at((a + a1) / 2, faceB + q.s * 0.7);
        const top = terrainH(pm.x, pm.z) + 0.12;
        if (top < 0.35) continue;
        const c = 1.12 + rand() * 0.16;
        wallSeg(at(a, faceB), at(a1 + 0.02, faceB), -1.6, top, 0.6, 'braza', [c, c * 0.96, c * 0.9]);
        wallSeg(at(a, faceB), at(a1 + 0.02, faceB), top - 0.02, top + 0.16, 0.78, 'cantera', [0.95, 0.92, 0.88]);
      }
      void yaw;
    }
    // stone revetment on the bank slopes under the side arches
    if (false) {
      const v = new THREE.Vector3();
      for (const s of [-1, 1]) {
        const xs = [], zs = [];
        for (let X = 13.0; X <= 25.5; X += 0.45) xs.push(s * X);
        for (let Z = -13; Z <= 13.01; Z += 0.55) zs.push(Z);
        const pos = [], col = [], idx = [];
        for (const Z of zs) for (const X of xs) {
          v.set(X, 0, Z).applyMatrix4(Mb);
          const hgt = Math.max(terrainH(v.x, v.z) + 0.1 + 0.05 * Math.sin(X * 1.7) * Math.sin(Z * 1.3), -0.9);
          pos.push(X, hgt, Z);
          const c = 0.85 + rand() * 0.2; col.push(c, c * 0.97, c * 0.93);
        }
        const nx = xs.length;
        for (let j = 0; j < zs.length - 1; j++) for (let i = 0; i < nx - 1; i++) {
          const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1;
          if (s > 0) idx.push(a, c, b, b, c, d); else idx.push(a, b, c, b, d, c);
        }
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
        g.setIndex(idx);
        g.computeVertexNormals();
        B.add('braza', g, Mb, { uvScale: 2.2 });
      }
    }
    // settled petals on deck
    world.deckPetals = [];
    for (let k = 0; k < 260; k++) {
      const X = (rand() - 0.5) * 40, Z = (rand() - 0.5) * 3.6;
      const p = new THREE.Vector3(X, deckY(X) + 0.05, Z).applyMatrix4(Mb);
      world.deckPetals.push({ x: p.x, y: p.y, z: p.z });
    }
    // papel picado over the deck
    for (const X of [-14, -5, 5, 14]) {
      const a = new THREE.Vector3(X, deckY(X) + 3.3, -W / 2 + 0.2).applyMatrix4(Mb);
      const b = new THREE.Vector3(X + 3.5, deckY(X + 3.5) + 3.3, W / 2 - 0.2).applyMatrix4(Mb);
      world.papelLines.push([a, b, 0.5]);
      for (const [pp, zz] of [[X, -W / 2 + 0.2], [X + 3.5, W / 2 - 0.2]]) {
        B.add('wood', cylinder(0.05, 0.04, 3.4, 6, pp, deckY(pp) + 0.9, zz), Mb, { uvScale: 1.5 });
      }
    }
  }

  // ================= ARCO DE CEMPASUCHIL ====================================
  {
    const X0 = L.arco.d;
    const y0 = deckY(22) - 0.1;
    const Ma = Mb.clone();
    const halfSpan = 2.1, postH = 3.1, rA = halfSpan;
    const pts = [];
    for (const zs of [-1, 1]) {
      const g = tubeAlong([new THREE.Vector3(X0, y0 - 0.5, zs * halfSpan), new THREE.Vector3(X0, y0 + postH * 0.5, zs * halfSpan * 1.01), new THREE.Vector3(X0, y0 + postH, zs * halfSpan)], 0.14, 6, 8);
      B.add('cane', g, Ma, { color: [0.85, 0.8, 0.7] });
    }
    const arc = [];
    for (let i = 0; i <= 16; i++) { const a = Math.PI * i / 16; arc.push(new THREE.Vector3(X0, y0 + postH + Math.sin(a) * rA * 1.1, Math.cos(a) * halfSpan)); }
    B.add('cane', tubeAlong(arc, 0.13, 32, 8), Ma, { color: [0.85, 0.8, 0.7] });
    // flower & leaf placement points along posts and arch
    const fl = [];
    const curvePts = [];
    for (const zs of [-1, 1]) for (let i = 0; i < 28; i++) { const t = i / 27; curvePts.push(new THREE.Vector3(X0, y0 + t * postH, zs * halfSpan)); }
    for (let i = 0; i <= 50; i++) { const a = Math.PI * i / 50; curvePts.push(new THREE.Vector3(X0, y0 + postH + Math.sin(a) * rA * 1.1, Math.cos(a) * halfSpan)); }
    for (const p of curvePts) {
      for (let k = 0; k < 7; k++) {
        const dir = new THREE.Vector3(rand() - 0.5, rand() - 0.5, rand() - 0.5).normalize();
        const q = p.clone().addScaledVector(dir, 0.16 + rand() * 0.06).applyMatrix4(Ma);
        fl.push({ p: q, n: dir.clone().transformDirection(Ma), kind: rand() < 0.86 ? 0 : 1 });
      }
    }
    world.arcoFlowers = fl;
  }

  // ================= ATRIUM, STEPS, WALLS ===================================
  const at = L.atrium;
  const Mt = riverFrameMatrix(at.u, at.d, 0);
  world.atriumMatrix = Mt;
  const hu = at.hu, hd = at.hd, Y = at.y;
  {
    // local: X across (d), Z downstream (-u). pad spans X in [-hd, hd], Z in [-hu, hu]
    const wallT = 1.2;
    const wall = (x0, z0, x1, z1, hTop, gaps = []) => {
      // wall segment along a line, thick outward; from ground to hTop (battered)
      const len = Math.hypot(x1 - x0, z1 - z0);
      const ang = Math.atan2(z1 - z0, x1 - x0);
      const segs = Math.ceil(len / 2.0);
      for (let i = 0; i < segs; i++) {
        const t0 = i / segs, t1 = (i + 1) / segs;
        const mid = (t0 + t1) / 2;
        if (gaps.some(([g0, g1]) => mid * len > g0 && mid * len < g1)) continue;
        const cxl = lerp(x0, x1, mid), czl = lerp(z0, z1, mid);
        const wp = new THREE.Vector3(cxl, 0, czl).applyMatrix4(Mt);
        const gy = Math.min(terrainH(wp.x + 1, wp.z), terrainH(wp.x - 1, wp.z)) - 1.2;
        const hgt = hTop - gy;
        const seg = frustum(len / segs + 0.02, wallT + hgt * 0.1, len / segs + 0.02, wallT, hgt);
        const m = new THREE.Matrix4().makeRotationY(-ang).setPosition(cxl, gy, czl);
        B.add('braza', seg, new THREE.Matrix4().multiplyMatrices(Mt, m), { uvScale: 2.2 });
      }
    };
    const o = wallT * 0.5 + 0.05;
    const stepZ = (L.steps.u - at.u) * -1; // local Z of steps (downstream positive)
    wall(-hd - o, -hu - o, -hd - o, hu + o, Y + 0.25, [[hu + o + stepZ - 1.9, hu + o + stepZ + 1.9]]);
    wall(hd + o, -hu - o, hd + o, hu + o, Y + 0.25);
    wall(-hd - o, -hu - o, hd + o, -hu - o, Y + 0.25);
    wall(-hd - o, hu + o, hd + o, hu + o, Y + 0.25);
    // atrial wall with merlons on top (plaster)
    const aw = (x0, z0, x1, z1, gaps = []) => {
      const len = Math.hypot(x1 - x0, z1 - z0), ang = Math.atan2(z1 - z0, x1 - x0);
      const n = Math.round(len / 1.25);
      for (let i = 0; i < n; i++) {
        const mid = (i + 0.5) / n;
        if (gaps.some(([g0, g1]) => mid * len > g0 && mid * len < g1)) continue;
        const cxl = lerp(x0, x1, mid), czl = lerp(z0, z1, mid);
        const m = new THREE.Matrix4().makeRotationY(-ang).setPosition(cxl, Y, czl);
        const mm = new THREE.Matrix4().multiplyMatrices(Mt, m);
        B.add('plaster', box(len / n + 0.01, 1.15, 0.6), mm, { uvScale: 3 });
        if (i % 2 === 0) {
          B.add('plaster', box(0.45, 0.5, 0.45, 0, 1.15, 0), mm, { uvScale: 3 });
          B.add('plaster', frustum(0.45, 0.45, 0.06, 0.06, 0.38).translate(0, 1.65, 0), mm, { uvScale: 3 });
        }
      }
    };
    const gz = stepZ;
    aw(-hd, -hu, -hd, hu, [[hu + gz - 1.8, hu + gz + 1.8]]);
    aw(hd, -hu, hd, hu);
    aw(-hd, -hu, hd, -hu);
    aw(-hd, hu, hd, hu);
    // gateway arch at top of steps
    {
      const m = new THREE.Matrix4().makeTranslation(-hd, Y, gz);
      const mm = new THREE.Matrix4().multiplyMatrices(Mt, m);
      const shape = [[-0.4, 0], [0.4, 0], [0.4, 4.6], [-0.4, 4.6]];
      const outer = [[-2.6, 0], [2.6, 0], [2.6, 4.2], [0, 5.3], [-2.6, 4.2]];
      const hole = [[-1.45, -0.01], [1.45, -0.01], ...arcPts(0, 2.4, 1.45, 0, Math.PI, 14)].reverse();
      const g = extrude(outer, 0.9, [hole]);
      g.rotateY(Math.PI / 2);
      B.add('plaster', g, mm, { uvScale: 3 });
      const cross = box(0.14, 0.9, 0.14, 0, 5.3, 0); B.add('cantera', cross, mm, { uvScale: 2 });
      B.add('cantera', box(0.14, 0.14, 0.55, 0, 5.85, 0), mm, { uvScale: 2 });
    }
    // steps (from path level up to the terrace)
    {
      const n = 17;
      const x0 = -hd - 8.6, x1 = -hd - 0.1;
      const wdt = 3.2;
      const baseY = 2.25;
      for (let i = 0; i < n; i++) {
        const t = i / n;
        const xs = lerp(x0, x1, t);
        const ys = lerp(baseY, Y, (i + 1) / n);
        const g = box(x1 - xs + 0.02, ys - (baseY - 1.2), wdt, (xs + x1) / 2, baseY - 1.2, gz);
        B.add('cantera', g, Mt, { uvScale: 2.4, color: [0.96 + rand() * 0.06, 0.95, 0.94] });
      }
      // alfardas (side ramps)
      for (const s of [-1, 1]) {
        const tri = extrude([[x0 - 0.2, baseY - 1.2], [x1 + 0.3, baseY - 1.2], [x1 + 0.3, Y + 0.9], [x0 - 0.2, baseY + 0.6]], 0.45, [], gz + s * (wdt / 2 + 0.225) - 0.225);
        B.add('braza', tri, Mt, { uvScale: 2.2 });
      }
      world.stepPetals = [];
      for (let k = 0; k < 120; k++) {
        const i = Math.floor(rand() * n);
        const xs = lerp(x0, x1, (i + rand()) / n), ys = lerp(baseY, Y, (i + 1) / n) + 0.03;
        const p = new THREE.Vector3(xs, ys, gz + (rand() - 0.5) * wdt * 0.9).applyMatrix4(Mt);
        world.stepPetals.push({ x: p.x, y: p.y, z: p.z });
      }
    }
    // atrium paving border strip
    // atrial cross
    {
      const m = new THREE.Matrix4().makeTranslation(-hd + 16, Y, 0);
      const mm = new THREE.Matrix4().multiplyMatrices(Mt, m);
      B.add('cantera', box(3.0, 0.45, 3.0), mm, { uvScale: 2 });
      B.add('cantera', box(2.2, 0.45, 2.2, 0, 0.45), mm, { uvScale: 2 });
      B.add('cantera', box(1.4, 0.45, 1.4, 0, 0.9), mm, { uvScale: 2 });
      B.add('cantera', box(0.8, 1.3, 0.8, 0, 1.35), mm, { uvScale: 2 });
      B.add('cantera', box(0.34, 3.2, 0.34, 0, 2.65), mm, { uvScale: 2 });
      B.add('cantera', box(0.34, 0.34, 1.9, 0, 4.9), mm, { uvScale: 2 });
      for (const zz of [-1.02, 1.02]) B.add('cantera', box(0.44, 0.44, 0.18, 0, 4.85, zz), mm, { uvScale: 2 });
      B.add('cantera', box(0.44, 0.18, 0.44, 0, 5.85), mm, { uvScale: 2 });
      B.add('cantera', box(0.46, 0.46, 0.46, 0, 4.84), mm, { uvScale: 2, color: [0.9, 0.88, 0.86] });
      world.crossPos = new THREE.Vector3(0, 0, 0).applyMatrix4(mm);
    }
    // capillas posas at the river-side corners
    for (const zs of [-1, 1]) {
      const m = new THREE.Matrix4().makeTranslation(-hd + 2.6, Y, zs * (hu - 2.6));
      const mm = new THREE.Matrix4().multiplyMatrices(Mt, m);
      const s = 4.2;
      const face = [[-s / 2, 0], [s / 2, 0], [s / 2, 4.0], [-s / 2, 4.0]];
      const hole = [[-1.1, -0.01], [1.1, -0.01], ...arcPts(0, 2.2, 1.1, 0, Math.PI, 12)].reverse();
      for (let k = 0; k < 4; k++) {
        const g = extrude(face, 0.5, k < 2 ? [hole] : []);
        g.translate(0, 0, s / 2 - 0.25);
        g.rotateY(k * Math.PI / 2);
        B.add('plaster', g, mm, { uvScale: 3 });
      }
      B.add('plaster', box(s + 0.3, 0.3, s + 0.3, 0, 4.0), mm, { uvScale: 3 });
      B.add('plaster', frustum(s + 0.1, s + 0.1, 0.3, 0.3, 2.4).translate(0, 4.3, 0), mm, { uvScale: 3, color: [0.93, 0.88, 0.82] });
      B.add('cantera', box(0.1, 0.7, 0.1, 0, 6.7, 0), mm, { uvScale: 2 });
      B.add('cantera', box(0.1, 0.1, 0.4, 0, 7.1, 0), mm, { uvScale: 2 });
      for (const cx2 of [-1, 1]) for (const cz2 of [-1, 1]) {
        B.add('plaster', box(0.45, 0.6, 0.45, cx2 * s / 2, 4.3, cz2 * s / 2), mm, { uvScale: 3 });
        B.add('plaster', frustum(0.45, 0.45, 0.05, 0.05, 0.4).translate(cx2 * s / 2, 4.9, cz2 * s / 2), mm, { uvScale: 3 });
      }
    }
  }

  // ================= CHURCH ================================================
  {
    // church local: facade plane at X = fX (faces -X toward river), nave extends to +X
    const fX = -hd + 22, len = 30, wid = 12.6, H = 13.5, t = 1.5;
    const Mc = new THREE.Matrix4().multiplyMatrices(Mt, new THREE.Matrix4().makeTranslation(fX, Y, 0));
    world.churchMatrix = Mc;
    // side walls
    for (const zs of [-1, 1]) {
      B.add('plaster', box(len, H, t, len / 2, 0, zs * (wid / 2 - t / 2)), Mc, { uvScale: 3.2 });
      // buttresses
      for (let k = 0; k < 5; k++) {
        const x = 3 + k * 6.2;
        const bt = frustum(1.4, 2.6, 1.2, 1.2, H - 1.5);
        bt.translate(x, 0, zs * (wid / 2 + 0.8));
        B.add('plaster', bt, Mc, { uvScale: 3.2, color: [0.95, 0.92, 0.88] });
        B.add('plaster', frustum(1.25, 1.25, 0.3, 0.3, 1.2).translate(x, H - 1.5, zs * (wid / 2 + 0.6)), Mc, { uvScale: 3.2 });
      }
      // merlons along top
      for (let k = 0; k < 16; k++) {
        const x = 1.0 + k * 1.9;
        B.add('plaster', box(0.55, 0.7, 0.55, x, H, zs * (wid / 2 - 0.4)), Mc, { uvScale: 3 });
        B.add('plaster', frustum(0.55, 0.55, 0.05, 0.05, 0.45).translate(x, H + 0.7, zs * (wid / 2 - 0.4)), Mc, { uvScale: 3 });
      }
      // small high windows
      for (let k = 0; k < 3; k++) {
        const x = 6 + k * 8;
        B.add('iron', box(0.1, 1.6, 0.9, x, H - 4.5, zs * (wid / 2 + 0.01)), Mc, { color: [0.35, 0.3, 0.28] });
      }
    }
    // apse wall
    B.add('plaster', box(t, H, wid, len - t / 2, 0, 0), Mc, { uvScale: 3.2 });
    // roof
    B.add('plaster', box(len, 0.6, wid, len / 2, H - 0.6, 0), Mc, { uvScale: 3.2, color: [0.85, 0.82, 0.78] });
    // interior floor & glow box (warm interior visible through doors)
    B.add('wood', box(len - 2 * t, 0.1, wid - 2 * t, len / 2, 0.02, 0), Mc, { uvScale: 2 });
    world.churchInterior = new THREE.Vector3(3, 2.2, 0).applyMatrix4(Mc);
    // facade with portal hole
    const fw = wid + 1.2, fh = H + 1.2;
    const doorW = 3.1, doorH = 5.2;
    const portalHole = [[-doorW / 2, -0.01], [doorW / 2, -0.01], ...arcPts(0, doorH - doorW / 2, doorW / 2, 0, Math.PI, 16)].reverse();
    const choirHole = [[-0.9, 8.0], [0.9, 8.0], ...arcPts(0, 9.6, 0.9, 0, Math.PI, 10)].reverse();
    const facade = extrude([[-fw / 2, 0], [fw / 2, 0], [fw / 2, fh], [-fw / 2, fh]], 1.8, [portalHole, choirHole]);
    facade.rotateY(Math.PI / 2);
    facade.translate(0.9, 0, 0);
    B.add('plaster', facade, Mc, { uvScale: 3.2 });
    // espadana (bell gable) on top of facade, 3 openings
    {
      const ew = 8.0, eh = 7.2;
      const holes = [];
      for (const [cx2, cy2, r2] of [[-2.1, 1.0, 1.0], [2.1, 1.0, 1.0], [0, 4.3, 0.85]]) {
        holes.push([[cx2 - r2, cy2], [cx2 + r2, cy2], ...arcPts(cx2, cy2 + 1.6, r2, 0, Math.PI, 12)].reverse());
      }
      const outline = [[-ew / 2, 0], [ew / 2, 0], [ew / 2, 3.9], [ew / 2 - 1.3, 3.9], [ew / 2 - 1.3, eh - 0.8], [0, eh], [-ew / 2 + 1.3, eh - 0.8], [-ew / 2 + 1.3, 3.9], [-ew / 2, 3.9]];
      const esp = extrude(outline, 1.2, holes);
      esp.rotateY(Math.PI / 2);
      esp.translate(0.6, fh, 0);
      B.add('plaster', esp, Mc, { uvScale: 3.2 });
      B.add('cantera', box(0.8, 0.35, ew + 0.3, 0.6, fh + 3.9 - 0.35, 0), Mc, { uvScale: 2 });
      B.add('cantera', box(0.14, 1.2, 0.14, 0.6, fh + eh, 0), Mc, { uvScale: 2 });
      B.add('cantera', box(0.14, 0.14, 0.7, 0.6, fh + eh + 0.75, 0), Mc, { uvScale: 2 });
      // bells (pivot points for animation)
      for (const [cz, cy, sc] of [[-2.1, 1.0 + 1.6, 1.0], [2.1, 1.0 + 1.6, 0.9], [0, 4.3 + 1.6, 0.7]]) {
        const piv = new THREE.Vector3(0.6, fh + cy + 0.55 * sc, cz).applyMatrix4(Mc);
        world.bells.push({ pos: piv, scale: sc, matrix: Mc.clone() });
      }
    }
    // carved cantera portal: jambs, archivolts, alfiz, cornice, pilasters
    {
      const px = -0.05;
      const pm = new THREE.Matrix4().multiplyMatrices(Mc, new THREE.Matrix4().makeRotationY(-Math.PI / 2));
      // in pm local: X along facade width, Y up, Z out of facade (toward river = -X of church => +Z here?)
      const zo = 0.0;
      for (const ring of [0, 1, 2]) {
        const r0 = doorW / 2 + ring * 0.32, r1 = r0 + 0.3;
        const pts = [...arcPts(0, doorH - doorW / 2, r1, 0, Math.PI, 18), ...arcPts(0, doorH - doorW / 2, r0, Math.PI, 0, 18)];
        const g = extrude(pts, 0.25 + ring * 0.08, [], zo);
        B.add('cantera', g, pm, { uvScale: 2.0, color: [1 - ring * 0.04, 0.98 - ring * 0.04, 0.96 - ring * 0.04] });
        for (const s of [-1, 1]) {
          B.add('cantera', box(0.3, doorH - doorW / 2, 0.25 + ring * 0.08, s * (r0 + 0.15), 0, zo + (0.25 + ring * 0.08) / 2), pm, { uvScale: 2.0 });
        }
      }
      // pilasters with capitals
      for (const s of [-1, 1]) {
        const x = s * (doorW / 2 + 1.35);
        B.add('cantera', box(0.55, 0.5, 0.6, x, 0, 0.3), pm, { uvScale: 2 });
        B.add('cantera', cylinder(0.2, 0.18, 5.4, 12, x, 0.5, 0.35), pm, { uvScale: 2 });
        B.add('cantera', box(0.6, 0.35, 0.6, x, 5.9, 0.3), pm, { uvScale: 2 });
      }
      // alfiz frame
      const aw2 = doorW / 2 + 1.75, ay0 = 6.3, ay1 = 6.65;
      B.add('cantera', box(aw2 * 2, ay1 - ay0, 0.45, 0, ay0, 0.22), pm, { uvScale: 2 });
      for (const s of [-1, 1]) B.add('cantera', box(0.3, ay1, 0.4, s * aw2, 0, 0.2), pm, { uvScale: 2 });
      // cornice and choir window frame
      B.add('cantera', box(fw - 1.0, 0.35, 0.5, 0, 7.4, 0.25), pm, { uvScale: 2 });
      const cw = [...arcPts(0, 9.6, 1.25, 0, Math.PI, 12), ...arcPts(0, 9.6, 0.9, Math.PI, 0, 12)];
      B.add('cantera', extrude(cw, 0.3, [], 0), pm, { uvScale: 2 });
      for (const s of [-1, 1]) B.add('cantera', box(0.35, 1.6, 0.3, s * 1.07, 8.0, 0.15), pm, { uvScale: 2 });
      B.add('cantera', box(2.8, 0.25, 0.4, 0, 7.8, 0.2), pm, { uvScale: 2 });
      // niche with shell top above choir window
      B.add('cantera', box(1.2, 0.2, 0.4, 0, 11.6, 0.2), pm, { uvScale: 2 });
      // rosettes (carved discs) on spandrels
      for (const s of [-1, 1]) B.add('cantera', cylinder(0.32, 0.32, 0.12, 14).rotateX(Math.PI / 2).translate(s * 2.4, 5.6, 0.1), pm, { uvScale: 2 });
      // wooden doors, slightly ajar, with iron studs
      for (const s of [-1, 1]) {
        const dw = doorW / 2 - 0.05;
        const leaf = box(dw, doorH - doorW / 2 + 0.5, 0.14, dw / 2, 0, 0);
        const g = leaf;
        const ang = s * 0.32;
        const m = new THREE.Matrix4().makeTranslation(s * (doorW / 2 - 0.02), 0, -0.5).multiply(new THREE.Matrix4().makeRotationY(ang)).multiply(new THREE.Matrix4().makeScale(-s, 1, 1));
        B.add('doors', g, new THREE.Matrix4().multiplyMatrices(pm, m), { uvScale: 1.4, color: [0.9, 0.82, 0.76] });
        for (let yy = 0.5; yy < doorH - 1.5; yy += 0.55) for (let xx = 0.2; xx < dw - 0.1; xx += 0.35) {
          const st = new THREE.SphereGeometry(0.035, 5, 4).translate(xx, yy, 0.15);
          B.add('iron', st, new THREE.Matrix4().multiplyMatrices(pm, m), {});
        }
      }
    }
    // side chapel with talavera dome
    {
      const cxl = 20, czl = wid / 2 + 3.2;
      B.add('plaster', box(6.4, 8.5, 6.4, cxl, 0, czl), Mc, { uvScale: 3.2 });
      B.add('plaster', cylinder(2.9, 2.9, 1.6, 20, cxl, 8.5, czl), Mc, { uvScale: 3.2 });
      const dome = new THREE.SphereGeometry(2.95, 28, 12, 0, Math.PI * 2, 0, Math.PI / 2);
      // spherical UVs for tiles
      const uv = dome.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 12, uv.getY(i) * 4);
      dome.translate(cxl, 10.1, czl);
      const dg = dome.toNonIndexed(); dg.applyMatrix4(Mc);
      B.groups.has('talavera') || B.groups.set('talavera', []);
      const cc = new Float32Array(dg.attributes.position.count * 3).fill(1);
      dg.setAttribute('color', new THREE.BufferAttribute(cc, 3));
      B.groups.get('talavera').push(dg);
      B.add('plaster', cylinder(0.55, 0.5, 1.3, 10, cxl, 12.9, czl), Mc, { uvScale: 3 });
      B.add('talavera', new THREE.SphereGeometry(0.6, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2).translate(cxl, 14.2, czl), Mc, { uvScale: 0.6 });
      B.add('cantera', box(0.08, 0.7, 0.08, cxl, 14.7, czl), Mc, { uvScale: 2 });
      B.add('cantera', box(0.08, 0.08, 0.36, cxl, 15.1, czl), Mc, { uvScale: 2 });
    }
  }

  // ================= STONE LANTERNS (tin) ALONG THE PATH ====================
  {
    const pts = [[236, 25.8], [244, 26.2], [252, 26.2], [259, 26.8], [266, 27.2], [274, 27.5], [236, 20.3]];
    for (const [u, d] of pts) {
      const p = toWorld(u, d);
      const h = terrainH(p.x, p.z, u);
      const m = new THREE.Matrix4().makeTranslation(p.x, h - 0.3, p.z);
      B.add('cantera', box(0.5, 0.25, 0.5), m, { uvScale: 2 });
      B.add('cantera', box(0.36, 0.95, 0.36, 0, 0.25), m, { uvScale: 2 });
      B.add('cantera', box(0.5, 0.12, 0.5, 0, 1.2), m, { uvScale: 2 });
      world.lanterns.push({ x: p.x, y: h - 0.3 + 1.32, z: p.z });
    }
  }

  // ================= CAPILLITA (far bank) ==================================
  {
    const c = L.capilla;
    const p = toWorld(c.u, c.d);
    const h = terrainH(p.x, p.z, c.u);
    const Mcp = riverFrameMatrix(c.u, c.d, h - 0.2, Math.PI / 2);
    B.add('plaster', box(1.8, 0.6, 1.5), Mcp, { uvScale: 2, color: [0.95, 0.95, 0.95] });
    const body = extrude([[-0.75, 0], [0.75, 0], [0.75, 1.9], [0, 2.5], [-0.75, 1.9]], 1.1, [[[-0.42, 0.25], [0.42, 0.25], ...arcPts(0, 1.25, 0.42, 0, Math.PI, 10)].reverse()]);
    body.translate(0, 0.6, 0);
    B.add('plasterblue', body, Mcp, { uvScale: 2, color: [0.5, 0.56, 1.3] });
    // white trim
    B.add('plaster', box(1.7, 0.12, 1.25, 0, 2.45), Mcp, { uvScale: 2, color: [0.96, 0.96, 0.96] });
    const roof = new THREE.BufferGeometry();
    roof.setAttribute('position', new THREE.Float32BufferAttribute([-0.85, 2.5 - 0.6 + 0.6, -0.65, 0, 3.15, -0.65, 0, 3.15, 0.65, -0.85, 1.9 + 0.6, -0.65, 0, 3.15, 0.65, -0.85, 2.5, 0.65, 0.85, 2.5, -0.65, 0.85, 2.5, 0.65, 0, 3.15, 0.65, 0.85, 2.5, -0.65, 0, 3.15, 0.65, 0, 3.15, -0.65], 3));
    roof.computeVertexNormals();
    B.add('plaster', roof, Mcp, { uvScale: 2, color: [0.72, 0.4, 0.28] });
    B.add('wood', box(0.07, 0.9, 0.07, 0, 0.9, -0.1), Mcp, { uvScale: 1, color: [0.5, 0.35, 0.25] });
    B.add('wood', box(0.5, 0.07, 0.07, 0, 1.4, -0.1), Mcp, { uvScale: 1, color: [0.5, 0.35, 0.25] });
    for (let k = 0; k < 5; k++) {
      const cp = new THREE.Vector3(-0.3 + k * 0.15, 0.62, 0.35).applyMatrix4(Mcp);
      world.candles.push({ x: cp.x, y: cp.y, z: cp.z, h: 0.12 + rand() * 0.08 });
    }
    world.capillaPos = new THREE.Vector3(0, 1.2, 0.3).applyMatrix4(Mcp);
  }

  // ================= PYRAMID ===============================================
  {
    const py = L.pyramid;
    const top = py.h * 0.92 + 0.2;
    const Mp = riverFrameMatrix(py.u, py.d, top - 0.6, Math.PI / 2);
    world.pyrMatrix = Mp;
    let y = 0;
    let s = 17;
    const tiers = 4;
    for (let k = 0; k < tiers; k++) {
      const h = 2.5;
      B.add('braza', frustum(s, s, s - 1.4, s - 1.4, h).translate(0, y, 0), Mp, { uvScale: 2.4, color: [0.96, 0.9, 0.84] });
      B.add('braza', box(s - 1.2, 0.35, s - 1.2, 0, y + h), Mp, { uvScale: 2.4, color: [0.9, 0.86, 0.8] });
      y += h + 0.35; s -= 2.9;
    }
    // shrine on top
    B.add('plaster', box(5.2, 3.0, 4.4, 0, y), Mp, { uvScale: 2.4, color: [0.86, 0.78, 0.68] });
    B.add('braza', box(5.8, 0.6, 5.0, 0, y + 3.0), Mp, { uvScale: 2.4 });
    B.add('iron', box(1.2, 1.9, 0.1, 0, y, 2.21), Mp, { color: [0.05, 0.04, 0.04] });
    // stairway (toward river = local +Z after rotation)
    const stairN = 26;
    const totalH = y;
    for (let i = 0; i < stairN; i++) {
      const t = (i + 1) / stairN;
      const z0 = 17 / 2 + 2.2 - t * (17 / 2 - 5.2 / 2 + 2.2);
      B.add('braza', box(3.2, t * totalH, 0.9, 0, 0, z0), Mp, { uvScale: 2.0, color: [0.92, 0.88, 0.82] });
    }
    for (const sx of [-1, 1]) {
      const al = extrude([[17 / 2 + 2.6, 0], [17 / 2 + 2.6, 0.8], [5.2 / 2, totalH + 0.4], [5.2 / 2 - 0.4, totalH + 0.4], [5.2 / 2 - 0.4, 0]].map(([z, yy]) => [z, yy]), 0.5, [], 0);
      al.rotateY(-Math.PI / 2);
      al.translate(sx * 1.85 + (sx > 0 ? 0.0 : 0.5), 0, 0);
      B.add('braza', al, Mp, { uvScale: 2.0 });
    }
    // brazier
    const bz = new THREE.Vector3(0, y + 0.0, 3.2).applyMatrix4(Mp);
    B.add('braza', box(0.8, 0.7, 0.8, 0, y, 3.1), Mp, { uvScale: 1.5 });
    B.add('soil', cylinder(0.25, 0.42, 0.35, 12, 0, y + 0.7, 3.1), Mp, { uvScale: 1, color: [0.7, 0.45, 0.32] });
    world.brazier = new THREE.Vector3(0, y + 1.1, 3.1).applyMatrix4(Mp);
  }

  // ================= PANTEON ===============================================
  {
    world.graves = [];
    for (const pad of L.pant) {
      const along = pad.hu, across = pad.hd;
      for (let gi = -along + 1.6; gi < along - 1.2; gi += 1.7 + rand() * 0.4) {
        for (let gj = -across + 1.2; gj < across - 1.4; gj += 2.6) {
          if (rand() < 0.12) continue;
          const lx = gi + (rand() - 0.5) * 0.3, lz = gj + (rand() - 0.5) * 0.3;
          const wx = pad.x + pad.ax * lx + pad.bx * lz, wz = pad.z + pad.az * lx + pad.bz * lz;
          const ang = Math.atan2(pad.bx, pad.bz);
          const m = new THREE.Matrix4().makeRotationY(ang).setPosition(wx, pad.h - 0.1, wz);
          const mound = new THREE.SphereGeometry(1, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2);
          mound.scale(0.55, 0.28, 1.05);
          B.add('soil', mound, m, { uvScale: 1.5, color: [0.9, 0.8, 0.72] });
          const kind = rand();
          if (kind < 0.55) {
            B.add('wood', box(0.08, 1.1, 0.08, 0, 0.1, -1.05), m, { uvScale: 1, color: [0.62, 0.5, 0.4] });
            B.add('wood', box(0.55, 0.08, 0.08, 0, 0.8, -1.05), m, { uvScale: 1, color: [0.62, 0.5, 0.4] });
          } else if (kind < 0.8) {
            B.add('cantera', box(0.7, 0.9, 0.14, 0, 0, -1.05), m, { uvScale: 1.2, color: [0.9, 0.9, 0.9] });
            B.add('cantera', cylinder(0.35, 0.35, 0.14, 10).rotateX(Math.PI / 2).translate(0, 0.9, -1.05), m, { uvScale: 1.2, color: [0.9, 0.9, 0.9] });
          } else {
            B.add('iron', box(0.05, 1.2, 0.05, 0, 0.1, -1.05), m, {});
            B.add('iron', box(0.6, 0.05, 0.05, 0, 0.9, -1.05), m, {});
          }
          const wp = new THREE.Vector3(wx, pad.h + 0.22, wz);
          world.graves.push({ pos: wp, ang, arch: rand() < 0.3 });
          for (let c = 0; c < 3 + Math.floor(rand() * 5); c++) {
            const cp = new THREE.Vector3((rand() - 0.5) * 1.1, 0.06, -1.25 + rand() * 0.25).applyMatrix4(m);
            world.candles.push({ x: cp.x, y: pad.h + 0.05, z: cp.z, h: 0.1 + rand() * 0.18 });
          }
        }
      }
      // low perimeter wall
      const corners = [[-along - 0.5, -across - 0.5], [along + 0.5, -across - 0.5], [along + 0.5, across + 0.5], [-along - 0.5, across + 0.5]];
      for (let k = 0; k < 4; k++) {
        const [ax0, az0] = corners[k], [ax1, az1] = corners[(k + 1) % 4];
        const len = Math.hypot(ax1 - ax0, az1 - az0);
        const n = Math.ceil(len / 2);
        for (let i = 0; i < n; i++) {
          const t = (i + 0.5) / n;
          if (k === 0 && Math.abs(t - 0.5) < 0.08) continue;
          const lx = lerp(ax0, ax1, t), lz = lerp(az0, az1, t);
          const wx = pad.x + pad.ax * lx + pad.bx * lz, wz = pad.z + pad.az * lx + pad.bz * lz;
          const gy = terrainH(wx, wz);
          const hgt = pad.h + 0.8 - (gy - 1.2);
          const ang = Math.atan2(pad.bx, pad.bz) + (k % 2 === 0 ? Math.PI / 2 : 0);
          const m = new THREE.Matrix4().makeRotationY(ang).setPosition(wx, gy - 1.2, wz);
          B.add('braza', box(len / n + 0.05, hgt, 0.6), m, { uvScale: 2 });
        }
      }
    }
    // papel picado along the path to the panteon
    const pathPts = [[L.landing.u + 2, 21.5], [L.landing.u + 9, 25], [L.landing.u + 17, 30.5], [L.panteon.u - 22, 37], [L.panteon.u - 13, 42], [L.panteon.u - 5, 48]];
    let prev = null;
    pathPts.forEach(([u, d], i) => {
      for (const s of [-1, 1]) {
        const f = frame(u);
        const p = toWorld(u, d);
        const x = p.x + f.tx * s * 1.6, z = p.z + f.tz * s * 1.6;
        const h = terrainH(x, z);
        B.add('wood', cylinder(0.06, 0.05, 3.6, 6, x, h - 0.4, z), null, { uvScale: 1.2, color: [0.6, 0.48, 0.38] });
        if (s > 0) {
          const top = new THREE.Vector3(x, h + 3.1, z);
          if (prev) world.papelLines.push([prev.b, top, 0.6]);
          const x2 = p.x - f.tx * 1.6, z2 = p.z - f.tz * 1.6;
          const h2 = terrainH(x2, z2);
          const top2 = new THREE.Vector3(x2, h2 + 3.1, z2);
          world.papelLines.push([top2, top, 0.4]);
          if (prev) world.papelLines.push([prev.a, top2, 0.6]);
          prev = { a: top2, b: top };
        }
      }
    });
  }
  // papel picado in the atrium: from facade to gateway & cross
  {
    const fa = new THREE.Vector3(0, 9.5, 0).applyMatrix4(world.churchMatrix);
    for (const zz of [-hu + 3, -hu / 2, 0, hu / 2, hu - 3]) {
      const b = new THREE.Vector3(-hd, Y + 3.2, zz).applyMatrix4(Mt);
      const a = fa.clone();
      world.papelLines.push([a, b, 1.2]);
      // pole at wall
      const bl = new THREE.Vector3(-hd, Y, zz).applyMatrix4(Mt);
      B.add('wood', cylinder(0.06, 0.05, 3.4, 6, bl.x, bl.y + 0.4, bl.z), null, { uvScale: 1.2, color: [0.6, 0.48, 0.38] });
    }
  }

  const meshes = B.build(scene, mats);
  for (const k of Object.keys(meshes)) { meshes[k].castShadow = true; }
  world.archMeshes = meshes;
  return meshes;
}
