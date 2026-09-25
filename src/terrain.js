import * as THREE from 'three';
import { terrainH, toWorld, toUD, halfW, plainW, bankKind, R, frame } from './river.js';
import { distToPaths, L, inPad } from './layout.js';
import { fbm2, simplex2, smoothstep, clamp, lerp } from './noise.js';
import { std, U } from './materials.js';
import { arrayTex } from './textures.js';

export const FIELDS = []; // cempasuchil / milpa fields in (u,d) boxes
export function initFields() {
  FIELDS.length = 0;
  FIELDS.push({ u0: 78, u1: 196, d0: 30, d1: 92, kind: 'cempa' });
  FIELDS.push({ u0: 150, u1: 214, d0: -44, d1: -27, kind: 'cempa' });
  FIELDS.push({ u0: 395, u1: 520, d0: -80, d1: -34, kind: 'milpa' });
  FIELDS.push({ u0: 305, u1: 360, d0: 36, d1: 70, kind: 'milpa' });
}
export function fieldAt(u, d) {
  for (const f of FIELDS) {
    if (u > f.u0 && u < f.u1 && d > f.d0 && d < f.d1) {
      const e = Math.min(u - f.u0, f.u1 - u, d - f.d0, f.d1 - d);
      return { f, edge: e };
    }
  }
  return null;
}

// Where forest grows (0..1). Used by terrain splat + tree placement.
export function forestMask(u, d, x, z, h) {
  const side = d >= 0 ? 1 : -1;
  const e = Math.abs(d) - halfW(u);
  const pw = plainW(u, side);
  let m = smoothstep(pw - 14, pw + 12, e);
  m *= 0.7 + 0.3 * smoothstep(-0.3, 0.4, fbm2(x * 0.01, z * 0.01, 3));
  m *= 1 - smoothstep(260, 420, h); // treeline
  return clamp(m, 0, 1);
}

export function splatAt(x, z, h, nY) {
  const ud = toUD(x, z);
  const u = ud.u, d = ud.d;
  const side = d >= 0 ? 1 : -1;
  const e = Math.abs(d) - halfW(u);
  const kk = bankKind(u, side);
  // path / cobble
  const pd = distToPaths(x, z);
  let cob = 1 - smoothstep(-0.2, 0.9, pd + simplex2(x * 0.7, z * 0.7) * 0.35);
  if (inPad(L.atriumPad, x, z, -0.5)) cob = Math.max(cob, 0.75 + 0.2 * smoothstep(0.2, 0.7, fbm2(x * 0.3, z * 0.3, 2)));
  // gravel bars
  const vil = smoothstep(80, 115, u) * (1 - smoothstep(440, 480, u));
  let grav = (1 - kk) * (1 - smoothstep(lerp(4, 0.8, vil), lerp(11, 3, vil), e + simplex2(x * 0.15, z * 0.15) * 3));
  grav = Math.max(grav, 1 - smoothstep(0.2, lerp(1.4, 0.7, vil), e));
  // earth banks
  let soil = Math.max(kk, vil * 0.8) * (1 - smoothstep(lerp(2.5, 1.2, vil), lerp(5.5, 3.2, vil), e + simplex2(x * 0.2, z * 0.2) * 1.5)) * smoothstep(-0.5, 0.2, e);
  const fld = fieldAt(u, d);
  if (fld) soil = Math.max(soil, smoothstep(0, 2.5, fld.edge) * (fld.f.kind === 'cempa' ? 0.75 : 0.55));
  soil = Math.max(soil, (1 - smoothstep(0.5, 3, pd)) * 0.3);
  // forest floor
  let forest = forestMask(u, d, x, z, h) * 0.9;
  if (h > 60) forest *= 0.7;
  return [cob, forest, grav, soil];
}

function dSamples(maxD, spNear, spFar, nearEnd) {
  const arr = [0];
  let d = 0;
  while (d < maxD) {
    const t = clamp((d - nearEnd) / (maxD - nearEnd), 0, 1);
    d += d < nearEnd ? spNear : spNear + (spFar - spNear) * t;
    arr.push(Math.min(d, maxD));
  }
  const out = [];
  for (let i = arr.length - 1; i > 0; i--) out.push(-arr[i]);
  return out.concat(arr);
}

function buildGrid(uArr, dArr, mapFn, withSplat) {
  const nu = uArr.length, nd = dArr.length;
  const N = nu * nd;
  const pos = new Float32Array(N * 3);
  const p = {};
  let lastU = uArr[0];
  for (let i = 0; i < nu; i++) {
    for (let j = 0; j < nd; j++) {
      mapFn(uArr[i], dArr[j], p);
      const h = terrainH(p.x, p.z, uArr[i]);
      const k = (i * nd + j) * 3;
      pos[k] = p.x; pos[k + 1] = h; pos[k + 2] = p.z;
    }
  }
  // normals from grid
  const nrm = new Float32Array(N * 3);
  const idx = (i, j) => (clamp(i, 0, nu - 1) * nd + clamp(j, 0, nd - 1)) * 3;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), n = new THREE.Vector3();
  for (let i = 0; i < nu; i++) {
    for (let j = 0; j < nd; j++) {
      const i0 = idx(i - 1, j), i1 = idx(i + 1, j), j0 = idx(i, j - 1), j1 = idx(i, j + 1);
      a.set(pos[i1] - pos[i0], pos[i1 + 1] - pos[i0 + 1], pos[i1 + 2] - pos[i0 + 2]);
      b.set(pos[j1] - pos[j0], pos[j1 + 1] - pos[j0 + 1], pos[j1 + 2] - pos[j0 + 2]);
      n.crossVectors(b, a).normalize();
      if (n.y < 0) n.negate();
      const k = (i * nd + j) * 3;
      nrm[k] = n.x; nrm[k + 1] = n.y; nrm[k + 2] = n.z;
    }
  }
  // AO + splat
  const misc = new Float32Array(N * 2);
  const spl = withSplat ? new Float32Array(N * 4) : null;
  for (let i = 0; i < nu; i++) {
    for (let j = 0; j < nd; j++) {
      const k = i * nd + j;
      const h = pos[k * 3 + 1];
      let acc = 0, cnt = 0;
      for (const [di, dj] of [[-2, 0], [2, 0], [0, -2], [0, 2], [-4, 0], [4, 0], [0, -4], [0, 4]]) {
        const q = idx(i + di, j + dj);
        const dx = pos[q] - pos[k * 3], dz = pos[q + 2] - pos[k * 3 + 2];
        const dist = Math.sqrt(dx * dx + dz * dz) + 0.5;
        acc += Math.max(0, (pos[q + 1] - h) / dist); cnt++;
      }
      const occ = acc / cnt;
      misc[k * 2] = clamp(1 - occ * 0.9, 0.45, 1);
      misc[k * 2 + 1] = simplex2(pos[k * 3] * 0.05, pos[k * 3 + 2] * 0.05) * 0.5 + 0.5;
      if (spl) {
        const s = splatAt(pos[k * 3], pos[k * 3 + 2], h, nrm[k * 3 + 1]);
        spl.set(s, k * 4);
      }
    }
  }
  return { pos, nrm, misc, spl, nu, nd };
}

function gridChunk(g, i0, i1) {
  const nd = g.nd;
  const rows = i1 - i0 + 1;
  const geo = new THREE.BufferGeometry();
  const s = i0 * nd, e = (i1 + 1) * nd;
  geo.setAttribute('position', new THREE.BufferAttribute(g.pos.slice(s * 3, e * 3), 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(g.nrm.slice(s * 3, e * 3), 3));
  geo.setAttribute('aMisc', new THREE.BufferAttribute(g.misc.slice(s * 2, e * 2), 2));
  geo.setAttribute('aSplat', new THREE.BufferAttribute(g.spl ? g.spl.slice(s * 4, e * 4) : new Float32Array((e - s) * 4), 4));
  const index = [];
  for (let i = 0; i < rows - 1; i++) {
    for (let j = 0; j < nd - 1; j++) {
      const a = i * nd + j, b = a + 1, c = a + nd, d = c + 1;
      // choose diagonal for better shape
      index.push(a, b, c, b, d, c);
    }
  }
  geo.setIndex(index);
  geo.computeBoundingSphere();
  geo.computeBoundingBox();
  return geo;
}

const TERRAIN_FRAG_PRE = /* glsl */`
uniform sampler2DArray tAlb;
uniform sampler2DArray tNrm;
uniform float uCaus;
varying vec4 vSplat;
varying vec2 vMisc;
varying vec3 vNrmW;
vec3 tAlbS(vec2 uv, float l) { return texture(tAlb, vec3(uv, l)).rgb; }
vec3 tNrmS(vec2 uv, float l) { vec3 n = texture(tNrm, vec3(uv, l)).xyz * 2.0 - 1.0; n.y = -n.y; return n; }
float hb(float w, float h, float sharp) { return clamp((w * 1.6 - (1.0 - h)) * sharp + 0.5, 0.0, 1.0) * step(0.001, w); }
`;

const TERRAIN_MAP = /* glsl */`
vec3 P = vWPos;
vec3 Ng = normalize(vNrmW);
float camD = length(P - cameraPosition);
float near = 1.0 - smoothstep(90.0, 220.0, camD);
vec2 m = vec2(texture(tNoise, P.xz / 211.0).r, texture(tNoise, P.xz / 53.0).g);
float slope = 1.0 - Ng.y;
float under = smoothstep(0.15, -0.35, P.y);
float shore = smoothstep(0.6, 0.05, P.y) * (1.0 - under);
float steepP = 1.0 - smoothstep(0.26, 0.5, 1.0 - Ng.y);
float vilZ = smoothstep(80.0, 125.0, -P.z) * (1.0 - smoothstep(430.0, 490.0, -P.z));
float wPeb = max(vSplat.b * steepP, max(under, shore * 0.85 * steepP * (1.0 - 0.7 * vilZ)));
float wRock = smoothstep(0.3, 0.46, slope + (m.y - 0.5) * 0.14) * (1.0 - under * 0.6);
float wSoil = max(vSplat.a, shore * vilZ * 0.75);
float wFor = vSplat.g;
float wCob = vSplat.r;
// UVs with two scales to break tiling
vec2 uvG = P.xz / 3.4, uvG2 = P.xz / 9.7 + 0.37;
vec3 alb = mix(tAlbS(uvG, 0.0), tAlbS(uvG2, 0.0), 0.35 + 0.25 * m.x);
vec3 nm = tNrmS(uvG, 0.0);
float rough = 0.95;
// grass tint: greener near water, drier gold on slopes
vec3 tint = mix(vec3(0.92, 1.02, 0.86), vec3(1.14, 1.0, 0.72), smoothstep(0.35, 0.75, m.x + slope * 0.6 + smoothstep(8.0, 40.0, P.y) * 0.3));
tint *= 0.85 + 0.3 * vMisc.y;
alb *= tint;
if (wFor > 0.001) {
  vec3 a2 = tAlbS(P.xz / 4.1, 4.0) * vec3(0.95, 1.0, 0.92);
  float b = hb(wFor, dot(a2, vec3(0.33)) * 1.8, 3.0);
  alb = mix(alb, a2, b); nm = mix(nm, tNrmS(P.xz / 4.1, 4.0), b);
}
if (wSoil > 0.001) {
  vec3 a2 = tAlbS(P.xz / 3.0, 1.0);
  float b = hb(wSoil, 0.5 + dot(a2 - alb, vec3(0.5)), 3.0);
  alb = mix(alb, a2, b); nm = mix(nm, tNrmS(P.xz / 3.0, 1.0), b); rough = mix(rough, 0.9, b);
}
if (wPeb > 0.001) {
  vec2 uvP = P.xz / 2.3;
  vec3 a2 = mix(tAlbS(uvP, 2.0), tAlbS(P.xz / 6.1 + 0.5, 2.0), 0.3) * vec3(0.96, 0.93, 0.9);
  float b = hb(wPeb, dot(a2, vec3(0.4)), 4.0);
  alb = mix(alb, a2, b); nm = mix(nm, tNrmS(uvP, 2.0), b); rough = mix(rough, 0.72, b);
}
if (wCob > 0.001) {
  vec3 a2 = tAlbS(P.xz / 2.6, 5.0);
  float b = hb(wCob, dot(a2, vec3(0.5)), 5.0);
  alb = mix(alb, a2, b); nm = mix(nm, tNrmS(P.xz / 2.6, 5.0), b); rough = mix(rough, 0.8, b);
}
vec3 triW = pow(abs(Ng), vec3(4.0)); triW /= dot(triW, vec3(1.0));
vec3 nWorld;
if (wRock > 0.001) {
  float sc = 1.0 / 6.5;
  vec3 ax = tAlbS(P.zy * sc, 3.0), ay = tAlbS(P.xz * sc, 3.0), az = tAlbS(P.xy * sc, 3.0);
  vec3 ar = ax * triW.x + ay * triW.y + az * triW.z;
  ar *= mix(vec3(1.0), vec3(1.08, 1.0, 0.9), m.x);
  // moss on upward-facing parts of rock
  float moss = smoothstep(0.55, 0.8, Ng.y + (m.y - 0.5) * 0.4) * (1.0 - smoothstep(30.0, 90.0, P.y));
  ar = mix(ar, vec3(0.2, 0.26, 0.1), moss * 0.55);
  float b = hb(wRock, dot(ar, vec3(0.4)), 3.0);
  alb = mix(alb, ar, b);
  rough = mix(rough, 0.86, b);
  vec3 nx = tNrmS(P.zy * sc, 3.0), ny = tNrmS(P.xz * sc, 3.0), nz = tNrmS(P.xy * sc, 3.0);
  nx = vec3(nx.xy + Ng.zy, abs(nx.z) * Ng.x);
  ny = vec3(ny.xy + Ng.xz, abs(ny.z) * Ng.y);
  nz = vec3(nz.xy + Ng.xy, abs(nz.z) * Ng.z);
  vec3 nr = normalize(nx.zyx * triW.x + ny.xzy * triW.y + nz.xyz * triW.z);
  vec3 T = normalize(vec3(1.0, 0.0, 0.0) - Ng * Ng.x);
  vec3 B = normalize(cross(T, Ng));
  vec3 np = normalize(T * nm.x + B * nm.y + Ng * max(nm.z, 0.2));
  nWorld = normalize(mix(np, nr, b));
} else {
  vec3 T = normalize(vec3(1.0, 0.0, 0.0) - Ng * Ng.x);
  vec3 B = normalize(cross(T, Ng));
  nWorld = normalize(T * nm.x + B * nm.y + Ng * max(nm.z, 0.2));
}
nWorld = normalize(mix(Ng, nWorld, 0.35 + 0.65 * near));
// wet shoreline band and riverbed
float wetLine = smoothstep(0.7, 0.05, P.y) * smoothstep(-0.8, 0.0, P.y);
alb *= mix(1.0, 0.62, wetLine);
rough = mix(rough, 0.5, wetLine);
alb *= mix(1.0, 0.8, under);
// AO
alb *= mix(1.0, vMisc.x, 0.85);
diffuseColor.rgb = alb;
float terrRough = rough;
`;

const TERRAIN_NORMAL = /* glsl */`
normal = normalize((viewMatrix * vec4(nWorld, 0.0)).xyz);
`;

export function buildTerrain(scene) {
  const albNames = ['ground_c', 'soil_c', 'pebbles_c', 'rock_c', 'forest_c', 'cobble_c'];
  const nrmNames = ['ground_n', 'soil_n', 'pebbles_n', 'rock_n', 'forest_n', 'cobble_n'];
  const tAlb = arrayTex(albNames, 1024, true);
  const tNrm = arrayTex(nrmNames, 512, false);
  const mat = std({ color: 0xffffff, roughness: 0.95, metalness: 0 }, {
    porosity: 0.8,
    uniforms: { tAlb: { value: tAlb }, tNrm: { value: tNrm }, uCaus: { value: 1 } },
    vertexPre: 'attribute vec4 aSplat; attribute vec2 aMisc; varying vec4 vSplat; varying vec2 vMisc; varying vec3 vNrmW;\n',
    vertexBegin: 'vSplat = aSplat; vMisc = aMisc; vNrmW = normalize(mat3(modelMatrix) * normal);',
    fragmentPre: TERRAIN_FRAG_PRE,
    mapFragment: TERRAIN_MAP,
    normalFragment: TERRAIN_NORMAL,
    replace: [['#include <roughnessmap_fragment>', 'float roughnessFactor = terrRough;']],
    emissiveExtra: `
      {
        float uw = smoothstep(0.05, -0.4, vWPos.y) * smoothstep(-6.0, -0.8, vWPos.y);
        vec2 cp = vWPos.xz * 0.23;
        float n1 = texture(tNoise, cp + vec2(uTime * 0.021, uTime * 0.013)).b;
        float n2 = texture(tNoise, cp * 1.31 - vec2(uTime * 0.017, -uTime * 0.019)).b;
        float c = pow(1.0 - abs(n1 - n2), 9.0) * 2.2;
        totalEmissiveRadiance += diffuseColor.rgb * c * uw * uKeyCol * uCaus * max(uKeyDir.y, 0.0) * 0.35;
      }`,
  });
  const group = new THREE.Group();
  // near corridor
  const uArr = [];
  for (let u = R.U_MIN + 120; u <= 1215; u += 1.5) uArr.push(u);
  const dArr = dSamples(118, 0.72, 3.6, 24);
  const g = buildGrid(uArr, dArr, (u, d, p) => toWorld(u, d, p), true);
  const CH = 60;
  for (let i = 0; i < uArr.length - 1; i += CH) {
    const geo = gridChunk(g, i, Math.min(i + CH, uArr.length - 1));
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    mesh.castShadow = true;
    mesh.name = 'terrain';
    group.add(mesh);
  }
  // outer valley (coarse, blends from river-aligned to straight grid)
  const uArr2 = [];
  for (let u = R.U_MIN - 500; u <= R.U_MAX + 600; u += 7) uArr2.push(u);
  const dO = [];
  let d = 108;
  while (d < 1900) { dO.push(d); d += 4 + (d - 108) * 0.035; }
  const dArr2 = dO.slice().reverse().map((v) => -v).concat(dO);
  const mid = dO.length; // column index where sides split
  const g2 = buildGrid(uArr2, dArr2, (u, dd, p) => {
    toWorld(u, dd, p);
    const t = smoothstep(150, 700, Math.abs(dd));
    p.x = p.x * (1 - t) + (-20 + dd) * t;
    p.z = p.z * (1 - t) + (-u) * t;
  }, true);
  const mat2 = mat.clone();
  mat2.onBeforeCompile = mat.onBeforeCompile;
  mat2.customProgramCacheKey = mat.customProgramCacheKey;
  mat2.polygonOffset = true; mat2.polygonOffsetFactor = 2; mat2.polygonOffsetUnits = 8;
  // drop the innermost columns below the corridor, build two sides separately
  for (const [j0, j1] of [[0, mid - 1], [mid, dArr2.length - 1]]) {
    const sub = { nu: g2.nu, nd: j1 - j0 + 1 };
    const N = sub.nu * sub.nd;
    sub.pos = new Float32Array(N * 3); sub.nrm = new Float32Array(N * 3); sub.misc = new Float32Array(N * 2); sub.spl = new Float32Array(N * 4);
    for (let i = 0; i < g2.nu; i++) for (let j = j0; j <= j1; j++) {
      const s = i * g2.nd + j, t = i * sub.nd + (j - j0);
      for (let c = 0; c < 3; c++) { sub.pos[t * 3 + c] = g2.pos[s * 3 + c]; sub.nrm[t * 3 + c] = g2.nrm[s * 3 + c]; }
      sub.misc[t * 2] = g2.misc[s * 2]; sub.misc[t * 2 + 1] = g2.misc[s * 2 + 1];
      for (let c = 0; c < 4; c++) sub.spl[t * 4 + c] = g2.spl[s * 4 + c];
      if (Math.abs(dArr2[j]) < 112) sub.pos[t * 3 + 1] -= 2.5;
    }
    for (let i = 0; i < g2.nu - 1; i += 40) {
      const geo = gridChunk(sub, i, Math.min(i + 40, g2.nu - 1));
      const mesh = new THREE.Mesh(geo, mat2);
      mesh.receiveShadow = true;
      mesh.name = 'terrainFar';
      group.add(mesh);
    }
  }
  scene.add(group);
  return { group, mat, grid: g, uArr, dArr };
}
