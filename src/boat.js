import * as THREE from 'three';
import { Batch, box, extrude, arcPts, cylinder, tubeAlong } from './archkit.js';
import { std, depthMat, U } from './materials.js';
import { tex, ntex } from './textures.js';
import { uvMat } from './matlib.js';
import { mulberry32, lerp, clamp, smoothstep } from './noise.js';
import { R, toWorld, toUD, frame, halfW, flowAt, terrainH } from './river.js';
import { lineD } from './rocks.js';
import { Character, sombrero, suyacal, xolo, fitJoints } from './characters.js';
import { scannedParts, scannedMat, hasModel } from './scanned.js';

// the generated trajinero scan, scaled to a 1.66 m body (hat on top), with its fitted joints
function trajineroMesh() {
  if (!hasModel('trajinero_w')) return null;
  const parts = scannedParts('trajinero_w', { whole: true });
  if (!parts.length) return null;
  const geo = parts[0].lod[0];
  let fit = fitJoints(geo);
  const k = 1.66 / fit.Hb;
  geo.scale(k, k, k);
  geo.computeBoundingBox(); geo.computeBoundingSphere();
  fit = fitJoints(geo);
  return { geo, fit, mat: scannedMat('trajinero_w', { roughness: 0.85, porosity: 0.5 }) };
}

export const HULL = { L: 8.6, hb0: 0.95 };
export function hb(z) { return 0.95 - 0.23 * Math.pow(z / 4.3, 2); }
export function yb(z) { return -0.3 + 0.17 * smoothstep(0.55, 1, Math.abs(z) / 4.3); }
export function yg(z) { return 0.42 + 0.07 * Math.pow(z / 4.3, 2); }

function section(z, inset) {
  const b = hb(z) - inset, bot = yb(z) + inset, top = yg(z) - (inset ? 0.0 : 0);
  const hbot = b - 0.13;
  return [[b, top], [b - 0.045, (top + bot) / 2 + 0.05], [hbot, bot + 0.03], [hbot - 0.06, bot], [-hbot + 0.06, bot], [-hbot, bot + 0.03], [-b + 0.045, (top + bot) / 2 + 0.05], [-b, top]];
}

function hullGeometry() {
  const zs = [];
  for (let i = 0; i <= 36; i++) zs.push(-4.3 + 8.6 * i / 36);
  const out = { p: [], n: [], uv: [], c: [], paint: [], i: [] };
  const inn = { p: [], n: [], uv: [], c: [], paint: [], i: [] };
  const band = (y) => {
    if (y > yg(0) - 0.07) return [0.88, 0.66, 0.12];
    if (y > yg(0) - 0.1) return [0.72, 0.14, 0.16];
    if (y < 0.02) return [0.36, 0.14, 0.1];
    return [0.1, 0.42, 0.52];
  };
  const build = (buf, inset, flip) => {
    const nsec = section(0, inset).length;
    zs.forEach((z) => {
      const sec = section(z, inset);
      let s = 0;
      sec.forEach(([x, y], k) => {
        if (k > 0) s += Math.hypot(x - sec[k - 1][0], y - sec[k - 1][1]);
        buf.p.push(x, y, z);
        buf.n.push(0, 0, 0);
        buf.uv.push(z / 2.4, s / 1.2);
        buf.c.push(...(inset ? [1, 1, 1] : band(y)));
        buf.paint.push(inset ? 0 : 1);
      });
    });
    for (let i = 0; i < zs.length - 1; i++) for (let k = 0; k < nsec - 1; k++) {
      const a = i * nsec + k, b = a + 1, c = a + nsec, d = c + 1;
      if (!flip) buf.i.push(a, c, b, b, c, d); else buf.i.push(a, b, c, b, d, c);
    }
  };
  build(out, 0, false);
  build(inn, 0.05, true);
  const mk = (buf) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(buf.p, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(buf.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(buf.c, 3));
    g.setAttribute('aPaint', new THREE.Float32BufferAttribute(buf.paint, 1));
    g.setIndex(buf.i);
    g.computeVertexNormals();
    return g;
  };
  return { outer: mk(out), inner: mk(inn) };
}

function transom(z, flip) {
  const so = section(z, 0), si = section(z, 0.05);
  const shape = new THREE.Shape(so.map(([x, y]) => new THREE.Vector2(x, y)));
  const g = new THREE.ShapeGeometry(shape);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) p.setZ(i, z);
  if (flip) g.scale(1, 1, 1);
  g.computeVertexNormals();
  return g;
}

export function buildBoatMesh() {
  const B = new Batch();
  const rand = mulberry32(31);
  const hull = hullGeometry();
  const mats = {
    paint: std({ map: tex('planks_c'), normalMap: ntex('planks_n'), vertexColors: true, roughness: 0.6, metalness: 0 }, {
      porosity: 0.4, key: 'hullpaint',
      vertexPre: 'attribute float aPaint; varying float vPaint;\n',
      vertexBegin: 'vPaint = aPaint;',
      fragmentPre: 'varying float vPaint;\n',
      mapFragment: /* glsl */`
        vec4 tx = texture2D(map, vMapUv);
        float pm = tx.a * vPaint;
        vec3 wood = tx.rgb * vec3(1.05, 0.95, 0.86);
        vec3 pc = vColor.rgb * (0.78 + 0.35 * tx.g);
        diffuseColor.rgb = mix(wood, pc, pm);
      `,
    }),
    wood: uvMat('planks', { color: 0xe0c8b0, roughness: 0.82, porosity: 0.6, vertexColors: true }),
    petate: uvMat('petate', { color: 0xfff2dc, roughness: 0.85, porosity: 0.7, vertexColors: true, side: THREE.DoubleSide }),
    cane: std({ vertexColors: true, color: 0xcfb880, roughness: 0.55, metalness: 0 }, { porosity: 0.4, key: 'otate' }),
    iron: std({ color: 0x2a2624, roughness: 0.5, metalness: 0.75, vertexColors: true }, { porosity: 0.3, key: 'bIron' }),
    clay: std({ color: 0xa25a36, roughness: 0.92, metalness: 0, vertexColors: true }, { porosity: 0.8, key: 'clay' }),
    glaze: std({ color: 0x2c5a36, roughness: 0.16, metalness: 0.0, vertexColors: true }, { porosity: 0.0, key: 'glaze' }),
    fruit: std({ vertexColors: true, roughness: 0.5, metalness: 0 }, { porosity: 0.2, key: 'fruit' }),
    arch: std({ map: tex('f_arch'), roughness: 0.6, metalness: 0, vertexColors: true, side: THREE.DoubleSide }, { porosity: 0.3, key: 'archpaint' }),
    tin: std({ color: 0xbab5aa, roughness: 0.32, metalness: 0.85, vertexColors: true, emissive: 0xffa040, emissiveMap: tex('f_tin'), emissiveIntensity: 0 }, { porosity: 0.1, key: 'tin' }),
  };
  mats.paint.vertexColors = true;
  // hull
  B.add('paint', hull.outer, null, {});
  B.add('wood', hull.inner, null, {});
  // hack: Batch strips custom attributes, so hull outer gets its own mesh
  const group = new THREE.Group();
  const outerMesh = new THREE.Mesh(hull.outer, mats.paint);
  outerMesh.castShadow = true; outerMesh.receiveShadow = true;
  group.add(outerMesh);
  B.groups.delete('paint');
  // transoms
  for (const z of [-4.3, 4.3]) {
    const t = transom(z);
    B.add('wood', t, null, { uvScale: 1.2, color: [0.2, 0.5, 0.6] });
    const t2 = transom(z); t2.rotateY(Math.PI); t2.translate(0, 0, 2 * z);
    B.add('wood', t2, null, { uvScale: 1.2, color: [0.2, 0.5, 0.6] });
  }
  // gunwale caps + rub rails
  for (const s of [-1, 1]) {
    const pts = [], pts2 = [];
    for (let i = 0; i <= 20; i++) { const z = -4.3 + 8.6 * i / 20; pts.push(new THREE.Vector3(s * (hb(z) - 0.02), yg(z) + 0.015, z)); pts2.push(new THREE.Vector3(s * (hb(z) + 0.015), yg(z) - 0.06, z)); }
    const cap = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 40, 0.035, 4, false);
    B.add('wood', cap, null, { color: [0.9, 0.7, 0.2] });
    const rail = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts2), 40, 0.028, 4, false);
    B.add('wood', rail, null, { color: [0.78, 0.18, 0.18] });
  }
  // ribs
  for (let z = -3.9; z <= 3.9; z += 0.58) {
    const sec = section(z, 0.07);
    for (let k = 0; k < sec.length - 1; k++) {
      const [x0, y0] = sec[k], [x1, y1] = sec[k + 1];
      const len = Math.hypot(x1 - x0, y1 - y0);
      const g = new THREE.BoxGeometry(0.045, len + 0.02, 0.07);
      g.rotateZ(Math.atan2(x1 - x0, -(y1 - y0)) + Math.PI);
      g.translate((x0 + x1) / 2, (y0 + y1) / 2, z);
      B.add('wood', g, null, { uvScale: 1, color: [0.85, 0.8, 0.75] });
    }
  }
  // floorboards
  for (let k = -2; k <= 2; k++) {
    const g = box(0.26, 0.03, 7.6, k * 0.29, yb(0) + 0.07, 0);
    B.add('wood', g, null, { uvScale: 1.6, color: [0.95 + rand() * 0.1, 0.92, 0.9] });
  }
  // thwarts with iron knees
  for (const z of [-2.8, -0.7, 1.6, 3.1]) {
    const w = (hb(z) - 0.06) * 2;
    B.add('wood', box(w, 0.05, 0.24, 0, yg(z) - 0.12, z), null, { uvScale: 1.2 });
    for (const s of [-1, 1]) {
      B.add('iron', box(0.03, 0.18, 0.05, s * (hb(z) - 0.08), yg(z) - 0.28, z), null, {});
      B.add('iron', box(0.14, 0.02, 0.05, s * (hb(z) - 0.15), yg(z) - 0.08, z), null, {});
      B.add('iron', new THREE.CylinderGeometry(0.012, 0.012, 0.03, 6).rotateZ(Math.PI / 2).translate(s * (hb(z) + 0.02), yg(z) - 0.1, z), null, {});
    }
  }
  // stern deck platform
  for (let k = 0; k < 6; k++) {
    const z = -4.15 + k * 0.2;
    const w = (hb(z) - 0.06) * 2;
    B.add('wood', box(w, 0.04, 0.18, 0, 0.18, z), null, { uvScale: 1.2, color: [0.9, 0.86, 0.8] });
  }
  B.add('wood', box(1.2, 0.3, 0.08, 0, -0.12, -3.1), null, { uvScale: 1.2 });
  // bow deck
  for (let k = 0; k < 5; k++) {
    const z = 3.3 + k * 0.2;
    const w = (hb(z) - 0.06) * 2;
    B.add('wood', box(w, 0.04, 0.18, 0, 0.14, z), null, { uvScale: 1.2, color: [0.9, 0.86, 0.8] });
  }
  // canopy hoops (otate) with nodes
  const hoopZ = [-1.9, -1.1, -0.3, 0.5, 1.3, 2.1];
  const canopyH = 0.95;
  for (const z of hoopZ) {
    const r = hb(z) - 0.02;
    const pts = [];
    for (let i = 0; i <= 16; i++) { const a = Math.PI * i / 16; pts.push(new THREE.Vector3(Math.cos(a) * r, yg(z) + Math.sin(a) * canopyH, z)); }
    B.add('cane', tubeAlong(pts, 0.024, 24, 6), null, { color: [0.82, 0.72, 0.46] });
    for (let i = 1; i < 16; i += 2) {
      const a = Math.PI * i / 16;
      const tor = new THREE.TorusGeometry(0.027, 0.008, 4, 8);
      tor.rotateY(Math.PI / 2); tor.rotateX(0);
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1, 0, 0), new THREE.Vector3(-Math.sin(a), Math.cos(a) * canopyH / r, 0).normalize());
      tor.applyQuaternion(q);
      tor.translate(Math.cos(a) * r, yg(z) + Math.sin(a) * canopyH, z);
      B.add('cane', tor, null, { color: [0.62, 0.52, 0.32] });
    }
    for (const s of [-1, 1]) {
      const lash = new THREE.TorusGeometry(0.04, 0.012, 5, 10);
      lash.rotateX(Math.PI / 2);
      lash.translate(s * r, yg(z) + 0.03, z);
      B.add('cane', lash, null, { color: [0.55, 0.45, 0.3] });
    }
  }
  // petate canopy surface
  {
    const nz = 30, na = 22;
    const pos = [], uv = [], idx = [];
    const z0 = -2.0, z1 = 2.2;
    for (let i = 0; i <= nz; i++) {
      const z = z0 + (z1 - z0) * i / nz;
      let sag = 0;
      let dmin = 9;
      for (const hz of hoopZ) dmin = Math.min(dmin, Math.abs(z - hz));
      sag = -0.035 * Math.pow(Math.min(1, dmin / 0.4), 2);
      const r = hb(z) + 0.005;
      for (let k = 0; k <= na; k++) {
        const a = Math.PI * k / na;
        const rr = r + 0.012;
        pos.push(Math.cos(a) * rr, yg(z) + Math.sin(a) * (canopyH + 0.02) + sag * Math.sin(a), z);
        uv.push(a * 1.2, z / 0.8);
      }
    }
    for (let i = 0; i < nz; i++) for (let k = 0; k < na; k++) {
      const a = i * (na + 1) + k, b = a + 1, c = a + na + 1, d = c + 1;
      idx.push(a, b, c, b, d, c);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    B.add('petate', g, null, {});
  }
  // bow arch with painted board
  {
    const z = 3.55;
    const r0 = 0.72, r1 = 0.98;
    const cy = yg(z) + 0.95;
    for (const s of [-1, 1]) B.add('wood', box(0.07, cy - yg(z) + 0.1, 0.07, s * 0.86, yg(z) - 0.05, z), null, { uvScale: 1, color: [0.85, 0.2, 0.2] });
    const pts = [...arcPts(0, cy, r1, 0.12, Math.PI - 0.12, 24), ...arcPts(0, cy, r0, Math.PI - 0.12, 0.12, 24)];
    const g = extrude(pts, 0.05, [], z - 0.025, 24);
    const p = g.attributes.position, uv = g.attributes.uv, n = g.attributes.normal;
    for (let i = 0; i < p.count; i++) {
      const a = Math.atan2(p.getY(i) - cy, p.getX(i));
      const r = Math.hypot(p.getX(i), p.getY(i) - cy);
      let u = 1 - (a - 0.12) / (Math.PI - 0.24);
      if (n.getZ(i) < 0) u = 1 - u;
      uv.setXY(i, u, (r - r0) / (r1 - r0));
    }
    B.add('arch', g, null, {});
    B.add('wood', box(1.9, 0.06, 0.08, 0, yg(z) + 0.05, z), null, { uvScale: 1, color: [0.88, 0.66, 0.12] });
  }
  // bow lantern pole & lantern
  const poleTip = new THREE.Vector3(0, 2.3, 5.05);
  {
    const pts = [new THREE.Vector3(0, 0.15, 3.95), new THREE.Vector3(0, 1.2, 4.2), new THREE.Vector3(0, 2.05, 4.6), new THREE.Vector3(0, 2.38, 5.1)];
    B.add('cane', tubeAlong(pts, 0.022, 20, 6), null, { color: [0.8, 0.7, 0.45] });
    B.add('iron', cylinder(0.003, 0.003, 0.22, 4, 0, 2.08, 5.1), null, {});
    B.add('tin', cylinder(0.075, 0.075, 0.2, 10, 0, 1.86, 5.1), null, {});
    B.add('tin', cylinder(0.08, 0.01, 0.09, 10, 0, 2.06, 5.1), null, {});
    B.add('tin', cylinder(0.085, 0.085, 0.02, 10, 0, 1.85, 5.1), null, {});
  }
  // oar (stern quarter) and spare pole
  B.add('wood', cylinder(0.028, 0.028, 3.4, 8).rotateX(Math.PI / 2).translate(-hb(-2.5) + 0.12, yg(-2.5) + 0.05, -2.6), null, { uvScale: 1, color: [0.75, 0.62, 0.5] });
  B.add('wood', box(0.12, 0.02, 0.6, -hb(-4) + 0.14, yg(-4) + 0.02, -4.4), null, { uvScale: 1, color: [0.75, 0.62, 0.5] });
  B.add('wood', cylinder(0.024, 0.024, 4.6, 8).rotateX(Math.PI / 2).translate(hb(0) - 0.14, yg(0) - 0.08, 0.1), null, { uvScale: 1, color: [0.7, 0.58, 0.44] });
  // cargo -------------------------------------------------------------
  const floorY = yb(0) + 0.09;
  // rolled petates
  for (const [x, z] of [[-0.4, -1.55], [0.35, -1.62]]) B.add('petate', cylinder(0.14, 0.14, 1.0, 14).rotateZ(Math.PI / 2).translate(x * 0.3, floorY + 0.14, z), null, {});
  // chiquihuites (baskets)
  const basket = (x, z, r, h, fill) => {
    B.add('petate', cylinder(r * 0.8, r, h, 16, x, floorY, z), null, { color: [0.95, 0.85, 0.65] });
    const rim = new THREE.TorusGeometry(r, 0.02, 5, 16); rim.rotateX(Math.PI / 2); rim.translate(x, floorY + h, z);
    B.add('petate', rim, null, { color: [0.8, 0.68, 0.48] });
    for (let k = 0; k < 14; k++) {
      const a = rand() * 6.28, rr = Math.sqrt(rand()) * r * 0.8;
      const sp = new THREE.SphereGeometry(fill === 'bread' ? 0.07 : 0.045, 8, 6);
      if (fill === 'bread') sp.scale(1, 0.6, 1);
      sp.translate(x + Math.cos(a) * rr, floorY + h - 0.01 + rand() * 0.03, z + Math.sin(a) * rr);
      B.add('fruit', sp, null, { color: fill === 'bread' ? [0.62, 0.38, 0.18] : [0.95, 0.5, 0.08] });
    }
  };
  basket(-0.42, -0.75, 0.2, 0.28, 'orange');
  basket(0.42, -0.6, 0.22, 0.3, 'bread');
  basket(0.4, 0.35, 0.19, 0.26, 'orange');
  // clay pots (ollas)
  const olla = (x, z, s, key) => {
    const pts = [[0.0, 0], [0.12, 0.01], [0.2, 0.08], [0.22, 0.16], [0.18, 0.26], [0.1, 0.31], [0.09, 0.35], [0.11, 0.37]].map(([r, y]) => new THREE.Vector2(r * s, y * s));
    const g = new THREE.LatheGeometry(pts, 18);
    g.translate(x, floorY, z);
    B.add(key, g, null, {});
  };
  olla(-0.35, 0.9, 1.0, 'clay'); olla(0.3, 1.25, 0.85, 'clay'); olla(-0.4, 1.55, 0.75, 'clay'); olla(-0.42, 0.25, 1.15, 'glaze');
  // sugar cane bundle
  for (let k = 0; k < 11; k++) {
    const x = -0.12 + (k % 4) * 0.06, y = floorY + 0.35 + Math.floor(k / 4) * 0.05;
    const g = cylinder(0.018, 0.016, 2.3, 6).rotateX(Math.PI / 2).translate(x, y, 0.35);
    B.add('cane', g, null, { color: [0.55, 0.6, 0.25] });
    for (let n = -1.0; n <= 1.0; n += 0.25) B.add('cane', new THREE.TorusGeometry(0.019, 0.004, 3, 6).translate(x, y, 0.35 + n), null, { color: [0.4, 0.42, 0.18] });
  }
  for (const z of [-0.5, 1.2]) { const t = new THREE.TorusGeometry(0.13, 0.012, 4, 12); t.translate(0.0, floorY + 0.4, z); B.add('cane', t, null, { color: [0.5, 0.4, 0.26] }); }
  // coiled rope on stern deck
  {
    const pts = [];
    for (let i = 0; i < 60; i++) { const a = i * 0.45, r = 0.08 + i * 0.0035; pts.push(new THREE.Vector3(-0.45 + Math.cos(a) * r, 0.23 + Math.floor(i / 20) * 0.022, -3.95 + Math.sin(a) * r)); }
    B.add('cane', tubeAlong(pts, 0.014, 120, 5), null, { color: [0.62, 0.52, 0.36] });
  }
  // cempasuchil bundles: stems + flower points
  const flowers = [];
  const bundle = (x, y, z, ang, len = 0.75) => {
    const g = cylinder(0.1, 0.13, len, 10).rotateZ(Math.PI / 2).rotateY(ang).translate(x, y, z);
    B.add('cane', g, null, { color: [0.3, 0.42, 0.16] });
    const dir = new THREE.Vector3(Math.cos(ang), 0, -Math.sin(ang));
    for (let k = 0; k < 22; k++) {
      const off = dir.clone().multiplyScalar(len / 2 + rand() * 0.12);
      const a = rand() * 6.28, rr = rand() * 0.15;
      const p = new THREE.Vector3(x, y, z).add(off).add(new THREE.Vector3(Math.cos(a) * rr * dir.z, Math.sin(a) * rr, Math.cos(a) * rr * -dir.x));
      flowers.push({ p, n: new THREE.Vector3(rand() - 0.5, 0.6 + rand() * 0.4, rand() - 0.5).normalize() });
    }
  };
  bundle(0.0, floorY + 0.15, 1.9, 1.3); bundle(-0.3, floorY + 0.2, 2.3, 1.7); bundle(0.3, floorY + 0.2, 2.6, 1.5);
  bundle(0.05, floorY + 0.4, 2.2, 1.6); bundle(-0.25, floorY + 0.15, -0.1, 0.2, 0.6); bundle(0.25, floorY + 0.5, 0.9, 1.4);
  bundle(0.0, floorY + 0.55, 1.6, 1.2); bundle(-0.2, floorY + 0.3, 3.0, 1.55, 0.55);
  // loose flowers on bow deck
  for (let k = 0; k < 30; k++) flowers.push({ p: new THREE.Vector3((rand() - 0.5) * 1.0, 0.2, 3.35 + rand() * 0.7), n: new THREE.Vector3(0, 1, 0) });
  const meshes = B.build(group, mats);
  // flower cards
  const fm = std({ map: tex('f_cempa'), alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.75 }, {
    porosity: 0.5, noFlip: true, key: 'boatFlower',
    lightsExtra: `{ vec3 Lv = normalize((viewMatrix * vec4(uKeyDir, 0.0)).xyz); float bl = pow(max(dot(-geometryViewDir, Lv), 0.0), 3.0); reflectedLight.directDiffuse += diffuseColor.rgb * uKeyCol * bl * 0.8; }`,
  });
  fm.alphaToCoverage = true;
  const fg = new THREE.PlaneGeometry(0.2, 0.2);
  const uv = fg.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 0.5, 0.5 + uv.getY(i) * 0.5);
  const fim = new THREE.InstancedMesh(fg, fm, flowers.length);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion();
  flowers.forEach((f, i) => {
    q.setFromUnitVectors(new THREE.Vector3(0, 0, 1), f.n);
    m4.compose(f.p, q, new THREE.Vector3(1, 1, 1).multiplyScalar(0.8 + rand() * 0.5));
    fim.setMatrixAt(i, m4);
  });
  fim.castShadow = true;
  group.add(fim);
  group.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return { group, mats, lanternPos: new THREE.Vector3(0, 1.86, 5.1) };
}

// ------------------------------------------------------------------------------
export class Boat {
  constructor(world) {
    this.world = world;
    const mesh = buildBoatMesh();
    this.group = mesh.group;
    this.mats = mesh.mats;
    this.lanternLocal = mesh.lanternPos;
    this.root = new THREE.Group();
    this.root.add(this.group);
    world.scene.add(this.root);
    // trajinero
    const scanned = trajineroMesh();
    if (scanned) {
      // generated trajinero (hat, manta, faja and huaraches are part of the scan)
      this.man = new Character(scanned);
      this.group.add(this.man.group);
      this.man.group.position.set(0.4, 0.2, -3.45);
      this.cape = new THREE.Object3D();
    } else {
      this.man = new Character({ scale: 0.92, skin: [0.44, 0.28, 0.18], shirt: [0.86, 0.83, 0.75], pantsCol: [0.83, 0.79, 0.7], sash: [0.62, 0.12, 0.12], widePants: true, pants: 0.02, hair: [0.05, 0.04, 0.035], mustache: [0.08, 0.06, 0.05], sleeves: true });
      this.group.add(this.man.group);
      this.man.group.position.set(0.4, 0.2, -3.45);
      this.hat = sombrero(0.28, 0.13);
      this.man.b.head.add(this.hat);
      this.hat.position.set(0, (1.74 - 1.58) * 0.92, -0.005);
      this.hat.rotation.x = -0.08;
      this.cape = suyacal(0.92);
      this.man.b.chest.add(this.cape);
      this.cape.position.set(0, -1.3 * 0.92 + 0.02, 0.0);
    }
    // xolo on the bow deck
    this.dog = xolo();
    this.dog.position.set(-0.05, 0.16, 2.95);
    this.dog.rotation.y = 0.6;
    this.dog.scale.setScalar(0.95);
    this.group.add(this.dog);
    // pole
    const pg = new THREE.CylinderGeometry(0.028, 0.032, 1, 8, 1);
    pg.translate(0, 0.5, 0);
    this.poleLen = 5.4;
    this.pole = new THREE.Mesh(pg, uvMat('planks', { color: 0xa88a66, roughness: 0.7 }));
    this.pole.castShadow = true;
    world.scene.add(this.pole);
    // physics state
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.fwd = new THREE.Vector3(0, 0, -1);
    this.heading = Math.PI;
    this.omega = 0;
    this.roll = 0; this.rollV = 0; this.pitch = 0; this.pitchV = 0; this.heave = 0;
    this.phase = 0.3;
    this.throttle = 1;
    this.steer = 0;
    this.manual = 0; // seconds since last manual input (Infinity = auto)
    this.lastInput = -99;
    this.speedRel = 0;
    this.plantW = null;
    this.tipLocal = new THREE.Vector3(1.45, -1.5, -3.2);
    this.reset(R.START_U);
  }
  reset(u) {
    const d = lineD(u);
    const p = toWorld(u, d);
    this.pos.set(p.x, 0, p.z);
    const f = frame(u + 3);
    this.heading = Math.atan2(f.tx, f.tz);
    this.vel.set(f.tx, 0, f.tz).multiplyScalar(1.4);
    this.omega = 0;
    this.phase = 0.2;
    this.plantW = null;
  }
  local(v) { return this.group.worldToLocal(v.clone()); }
  world_(v) { return this.group.localToWorld(v.clone()); }
  update(dt, input, time) {
    const w = this.world;
    const sub = 3;
    const h = dt / sub;
    const ud = toUD(this.pos.x, this.pos.z);
    this.u = ud.u; this.d = ud.d;
    // --- control
    let steer = 0, thr = 1;
    const manualActive = time - this.lastInput < 6.0;
    if (input.any) this.lastInput = time;
    const blend = clamp((time - this.lastInput - 5.0) / 1.5, 0, 1); // 0 manual, 1 auto
    // autopilot
    const look = ud.u + 11 + this.vel.length() * 2;
    const tp = toWorld(look, lineD(look));
    const dx = tp.x - this.pos.x, dz = tp.z - this.pos.z;
    const want = Math.atan2(dx, dz);
    let err = want - this.heading;
    while (err > Math.PI) err -= Math.PI * 2;
    while (err < -Math.PI) err += Math.PI * 2;
    let aSteer = clamp(err * 2.6 - this.omega * 1.4, -1, 1);
    // obstacle avoidance
    const f = new THREE.Vector3(Math.sin(this.heading), 0, Math.cos(this.heading));
    const rgt = new THREE.Vector3(-Math.cos(this.heading), 0, Math.sin(this.heading));
    for (const o of w.obstacles) {
      const ox = o.x - this.pos.x, oz = o.z - this.pos.z;
      const ahead = ox * f.x + oz * f.z;
      if (ahead < -3 || ahead > 16) continue;
      const lat = ox * rgt.x + oz * rgt.z;
      const need = o.r + 1.5;
      // weight fades in from 16 m and back out as the obstacle comes abeam (no steering jerk when it passes)
      const wgt = (1 - Math.max(ahead, 0) / 16) * smoothstep(-3, 2.5, ahead);
      if (Math.abs(lat) < need) aSteer += -Math.sign(lat || 1) * (need - Math.abs(lat)) / need * wgt * 1.6;
    }
    aSteer = clamp(aSteer, -1, 1);
    const mSteer = (input.left ? 1 : 0) - (input.right ? 1 : 0);
    const mThr = input.up ? 1.4 : input.down ? -0.6 : 0.68;
    steer = lerp(mSteer, aSteer, blend);
    // autopilot leans harder on the pole where the current is stronger (gorge)
    const flc = flowAt(this.u || 0, 0, {}).s;
    thr = lerp(mThr + flc * 0.3, 0.68 + flc * 0.42, blend);
    this.steer = lerp(this.steer, steer, 1 - Math.exp(-dt * 6));
    this.throttle = lerp(this.throttle, thr, 1 - Math.exp(-dt * 3));
    this.autoBlend = blend;
    // --- stroke phase
    const period = this.throttle >= 0 ? 2.5 / (0.75 + 0.35 * Math.abs(this.throttle)) : 2.9;
    const prevPhase = this.phase;
    this.phase = (this.phase + dt / period) % 1;
    const P0 = 0.1, P1 = 0.6;
    let push = 0;
    if (this.phase > P0 && this.phase < P1) push = Math.sin(Math.PI * (this.phase - P0) / (P1 - P0));
    // --- physics substeps
    const fl = {};
    for (let s = 0; s < sub; s++) {
      const fwd = new THREE.Vector3(Math.sin(this.heading), 0, Math.cos(this.heading));
      const right = new THREE.Vector3(-Math.cos(this.heading), 0, Math.sin(this.heading));
      const u2 = toUD(this.pos.x, this.pos.z, {}, this.u);
      flowAt(u2.u, u2.d, fl);
      const vr = new THREE.Vector3(this.vel.x - fl.x, 0, this.vel.z - fl.z);
      const vf = vr.dot(fwd), vl = vr.dot(right);
      const m = 950, I = 5600;
      const F = new THREE.Vector3();
      F.addScaledVector(fwd, -(vf * Math.abs(vf) * 78 + vf * 40));
      F.addScaledVector(right, -(vl * 850 + vl * Math.abs(vl) * 300));
      F.addScaledVector(fwd, push * 1750 * this.throttle);
      let tau = this.steer * 1500 * (0.4 + 0.6 * clamp(Math.abs(vf) / 1.5, 0, 1)) - this.omega * 2600 - this.omega * Math.abs(this.omega) * 5000;
      this.vel.addScaledVector(F, h / m);
      this.omega += tau / I * h;
      // collisions: obstacles vs hull capsule
      const bowP = this.pos.clone().addScaledVector(fwd, 4.1), sternP = this.pos.clone().addScaledVector(fwd, -4.1);
      for (const o of w.obstacles) {
        const ox = o.x - this.pos.x, oz = o.z - this.pos.z;
        if (ox * ox + oz * oz > 100) continue;
        const t = clamp(((o.x - sternP.x) * (bowP.x - sternP.x) + (o.z - sternP.z) * (bowP.z - sternP.z)) / (8.2 * 8.2), 0, 1);
        const cxp = sternP.x + (bowP.x - sternP.x) * t, czp = sternP.z + (bowP.z - sternP.z) * t;
        const ddx = cxp - o.x, ddz = czp - o.z;
        const dist = Math.hypot(ddx, ddz);
        const minD = o.r + 0.9;
        if (dist < minD && dist > 1e-4) {
          const nx = ddx / dist, nz = ddz / dist;
          const pen = minD - dist;
          // resolve penetration over a few substeps instead of snapping the hull out in one go
          this.pos.x += nx * pen * 0.35; this.pos.z += nz * pen * 0.35;
          const vn = this.vel.x * nx + this.vel.z * nz;
          if (vn < 0) { this.vel.x -= vn * nx * 1.25; this.vel.z -= vn * nz * 1.25; }
          const lever = (t - 0.5) * 8.2;
          this.omega += (lever * (nx * right.x + nz * right.z)) * pen * 0.35;
          this.bump = (this.bump || 0) + pen;
        }
      }
      // banks: sample hull points for depth
      for (const [lz, lx] of [[4.1, 0], [-4.1, 0], [2.6, 0.9], [2.6, -0.9], [-2.6, 0.9], [-2.6, -0.9], [0, 0.95], [0, -0.95]]) {
        const px = this.pos.x + fwd.x * lz - right.x * lx, pz = this.pos.z + fwd.z * lz - right.z * lx;
        const hgt = terrainH(px, pz, u2.u);
        const pen = hgt + 0.32;
        if (pen > 0) {
          const q = toUD(px, pz, {}, u2.u);
          const fr = frame(q.u);
          const sg = -Math.sign(q.d);
          const nx = fr.nx * sg, nz = fr.nz * sg;
          const k = Math.min(pen, 0.6);
          this.pos.x += nx * k * 0.3; this.pos.z += nz * k * 0.3;
          const vn = this.vel.x * nx + this.vel.z * nz;
          if (vn < 0) { this.vel.x -= vn * nx * 1.1; this.vel.z -= vn * nz * 1.1; }
          this.vel.multiplyScalar(1 - 0.6 * h);
          this.omega += lz * (nx * right.x + nz * right.z) * -0.02 * k;
        }
      }
      this.pos.addScaledVector(this.vel, h);
      this.heading += this.omega * h;
    }
    this.fwd.set(Math.sin(this.heading), 0, Math.cos(this.heading));
    const vr2 = new THREE.Vector3(this.vel.x - fl.x, 0, this.vel.z - fl.z);
    this.speedRel = vr2.dot(this.fwd);
    this.speed = this.vel.length();
    // heel / pitch / heave
    const rollT = clamp(-this.omega * this.speedRel * 0.09, -0.14, 0.14) + Math.sin(time * 0.9) * 0.008;
    this.rollV += ((rollT - this.roll) * 30 - this.rollV * 5) * dt;
    this.roll += this.rollV * dt;
    const pitchT = -push * 0.012 * this.throttle + Math.sin(time * 1.3) * 0.004;
    this.pitchV += ((pitchT - this.pitch) * 25 - this.pitchV * 4) * dt;
    this.pitch += this.pitchV * dt;
    this.heave = Math.sin(time * 1.4) * 0.012 + push * 0.006;
    this.root.position.set(this.pos.x, this.heave, this.pos.z);
    this.root.rotation.set(0, this.heading, 0);
    this.group.rotation.set(this.pitch, 0, this.roll);
    this.root.updateMatrixWorld(true);
    this.animateMan(dt, time, push, prevPhase);
    w.water.setBoat(this);
  }
  animateMan(dt, time, push, prevPhase) {
    const man = this.man, b = man.b;
    const ph = this.phase;
    man.reset();
    const P0 = 0.1, P1 = 0.6, P2 = 0.76;
    // grip point (local to boat group)
    const pushT = ph > P0 && ph < P1 ? (ph - P0) / (P1 - P0) : ph >= P1 ? 1 : 0;
    const lean = ph < P0 ? lerp(0.15, 0.35, ph / P0) : ph < P1 ? lerp(0.35, 0.62, Math.sin(pushT * Math.PI / 2)) : ph < P2 ? lerp(0.62, 0.2, (ph - P1) / (P2 - P1)) : lerp(0.2, 0.15, (ph - P2) / (1 - P2));
    const G = new THREE.Vector3(0.76, lerp(1.36, 1.02, lean), -3.15 + lean * 0.3);
    // tip position (local)
    const bedAt = (lp) => { const wp = this.world_(lp); return terrainH(wp.x, wp.z) + 0.03; };
    const plantL = new THREE.Vector3(1.48, 0, -3.05);
    let tip;
    if (ph >= P0 && ph < P1) {
      if (!this.plantW) {
        const lp = plantL.clone(); lp.y = bedAt(lp);
        this.plantW = this.world_(lp);
        this.world.water.pole(this.plantW.x, this.plantW.z, -0.014, 0.08);
        if (this.world.onPoleSplash) this.world.onPoleSplash(this.plantW, 1);
      }
      tip = this.local(this.plantW);
    } else if (ph >= P1 && ph < P2) {
      const t = smoothstep(0, 1, (ph - P1) / (P2 - P1));
      const end = this.plantW ? this.local(this.plantW) : plantL.clone().setY(-1.5);
      if (!this.liftStart) this.liftStart = end.clone();
      const lifted = G.clone().lerp(this.liftStart, 0.3);
      lifted.x = Math.max(lifted.x, 1.25);
      tip = this.liftStart.clone().lerp(lifted, t);
      if (this.plantW && t > 0.35 && !this.dripped) { this.dripped = true; if (this.world.onPoleSplash) this.world.onPoleSplash(this.world_(tip), 0.5); this.world.water.pole(this.world_(tip).x, this.world_(tip).z, 0.015, 0.06); }
    } else {
      this.plantW = null; this.dripped = false;
      const t = ph >= P2 ? smoothstep(0, 1, (ph - P2) / (1 - P2 + P0)) : smoothstep(0, 1, (ph + 1 - P2) / (1 - P2 + P0));
      const from = this.liftStart ? G.clone().lerp(this.liftStart, 0.3) : plantL.clone().setY(0.3);
      from.x = Math.max(from.x, 1.25);
      const to = plantL.clone();
      to.y = ph < P0 ? lerp(0.25, bedAt(plantL), ph / P0) : 0.35;
      if (ph < P0) tip = new THREE.Vector3(plantL.x, to.y, plantL.z);
      else tip = from.clone().lerp(new THREE.Vector3(plantL.x, 0.35, plantL.z), t);
      if (ph < P0 || ph > 0.95) this.liftStart = null;
    }
    // keep pole clear of hull
    const dir = G.clone().sub(tip).normalize();
    for (let k = 0; k < 6; k++) {
      let bad = false;
      for (let s = 0; s <= 10; s++) {
        const p = tip.clone().addScaledVector(dir, s * 0.3);
        if (Math.abs(p.z) < 4.4 && p.y < yg(p.z) + 0.08 && p.x < hb(p.z) + 0.06 && p.y > yb(p.z) - 0.05) { bad = true; break; }
      }
      if (!bad) break;
      tip.x += 0.12;
      dir.copy(G).sub(tip).normalize();
    }
    // pole transform in world
    const tipW = this.world_(tip), gW = this.world_(G);
    const pdir = gW.clone().sub(tipW).normalize();
    this.pole.position.copy(tipW).addScaledVector(pdir, -0.05);
    this.pole.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), pdir);
    this.pole.scale.set(1, this.poleLen, 1);
    this.poleTipW = tipW;
    this.poleDir = pdir;
    // --- body pose (bones local to character, character faces +Z = boat forward)
    const s = man.scale;
    b.hips.position.y = man.hipY - lean * 0.14;
    b.hips.position.z += lean * 0.06;
    b.hips.rotation.set(lean * 0.22, 0.5 + lean * 0.12, 0);
    b.spine.rotation.set(lean * 0.38, 0.12, -0.04 - lean * 0.06);
    b.chest.rotation.set(lean * 0.32, 0.18, -0.06 - lean * 0.08);
    b.neck.rotation.set(-lean * 0.4, -0.3, 0);
    b.head.rotation.set(-lean * 0.3 + 0.08, -0.45, 0);
    man.group.updateMatrixWorld(true);
    // hands on the pole
    const up = gW.clone();
    const low = gW.clone().addScaledVector(pdir, -0.5);
    const shoulderPole = (side) => this.world_(new THREE.Vector3(side > 0 ? 1.5 : -0.8, 0.4, -3.6));
    man.ik2(b.shR, b.elR, b.wrR, up, this.world_(new THREE.Vector3(0.2, 0.6, -4.6)));
    man.ik2(b.shL, b.elL, b.wrL, low, this.world_(new THREE.Vector3(1.4, 0.5, -4.2)));
    // legs: feet planted on deck
    const footL = this.world_(new THREE.Vector3(0.6, 0.28, -3.1));
    const footR = this.world_(new THREE.Vector3(0.28, 0.28, -3.78));
    man.ik2(b.hipL, b.knL, b.anL, footL, this.world_(new THREE.Vector3(1.2, 0.8, -1.8)));
    man.ik2(b.hipR, b.knR, b.anR, footR, this.world_(new THREE.Vector3(0.6, 0.8, -2.3)));
    // cape reacts to stroke
    this.cape.rotation.x = -lean * 0.2 - 0.05;
    // dog breathing
    const br = 1 + Math.sin(time * 1.6) * 0.012;
    this.dog.scale.set(0.95, 0.95 * br, 0.95);
    this.lean = lean;
  }
  lanternWorld() { return this.world_(this.lanternLocal); }
}
