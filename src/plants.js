import * as THREE from 'three';
import { std, depthMat, U } from './materials.js';
import { tex } from './textures.js';
import { mulberry32, smoothstep, lerp, clamp, fbm2, simplex2 } from './noise.js';
import { R, toWorld, halfW, terrainH, toUD, frame, bankKind } from './river.js';
import { FIELDS, fieldAt, forestMask } from './terrain.js';
import { L, distToPaths, inPad } from './layout.js';

export const CX_GLSL = /* glsl */`
float gss(float a, float b, float x) { float t = clamp((x - a) / (b - a), 0.0, 1.0); return t * t * (3.0 - 2.0 * t); }
float cxG(float u) { float g = gss(700.0, 900.0, u); return 34.0 * sin(u / 165.0 + 0.4) + 18.0 * sin(u / 88.0 + 2.1) + g * 7.0 * sin(u / 52.0 + 1.3) - 20.0; }
float cxdG(float u) { float g = gss(700.0, 900.0, u); return 34.0 / 165.0 * cos(u / 165.0 + 0.4) + 18.0 / 88.0 * cos(u / 88.0 + 2.1) + g * 7.0 / 52.0 * cos(u / 52.0 + 1.3); }
vec2 udToXZ(vec2 ud) { float c = cxG(ud.x), c1 = cxdG(ud.x); float il = inversesqrt(1.0 + c1 * c1); return vec2(c + ud.y * il, -ud.x + ud.y * c1 * il); }
float hash12g(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
`;

// ---------- (u,d) data texture from the terrain grid -------------------------
function buildUDTex(world, terrain) {
  const g = terrain.grid, uArr = terrain.uArr, dArr = terrain.dArr;
  const u0 = uArr[0], du = uArr[1] - uArr[0];
  const D0 = -118, D1 = 118, DS = 0.5;
  const nd = Math.round((D1 - D0) / DS) + 1;
  const US = 1.0;
  const U1 = uArr[uArr.length - 1];
  const nu = Math.floor((U1 - u0) / US) + 1;
  const data = new Uint16Array(nd * nu * 4);
  const toHalf = THREE.DataUtils.toHalfFloat;
  // column lookup
  const colIdx = new Int32Array(nd), colT = new Float32Array(nd);
  for (let j = 0; j < nd; j++) {
    const d = D0 + j * DS;
    let k = 0;
    while (k < dArr.length - 2 && dArr[k + 1] < d) k++;
    colIdx[j] = k; colT[j] = clamp((d - dArr[k]) / (dArr[k + 1] - dArr[k]), 0, 1);
  }
  const G = g.nd;
  const P = {};
  for (let i = 0; i < nu; i++) {
    const u = u0 + i * US;
    const fi = (u - u0) / du;
    const r0 = Math.min(g.nu - 2, Math.floor(fi)), rt = fi - r0;
    for (let j = 0; j < nd; j++) {
      const c0 = colIdx[j], ct = colT[j];
      const idx = (r, c) => r * G + c;
      const bil = (arr, stride, off) => {
        const a = arr[idx(r0, c0) * stride + off], b = arr[idx(r0, c0 + 1) * stride + off];
        const c = arr[idx(r0 + 1, c0) * stride + off], d = arr[idx(r0 + 1, c0 + 1) * stride + off];
        return lerp(lerp(a, b, ct), lerp(c, d, ct), rt);
      };
      const h = bil(g.pos, 3, 1);
      const ny = bil(g.nrm, 3, 1);
      const cob = bil(g.spl, 4, 0), forest = bil(g.spl, 4, 1), grav = bil(g.spl, 4, 2), soil = bil(g.spl, 4, 3);
      const d = D0 + j * DS;
      let dens = 1;
      dens *= 1 - smoothstep(0.1, 0.5, cob);
      dens *= 1 - smoothstep(0.2, 0.7, grav);
      dens *= 1 - smoothstep(0.3, 0.9, soil) * 0.85;
      dens *= 1 - forest * 0.55;
      dens *= smoothstep(0.55, 0.8, ny);
      dens *= smoothstep(0.12, 0.45, h);
      toWorld(u, d, P);
      if (world.isBlocked(P.x, P.z, 0.2, true)) dens *= 0.0;
      if (inPad(L.atriumPad, P.x, P.z, 0.5)) dens *= 0.12;
      const fld = fieldAt(u, d);
      if (fld) dens *= 0.25;
      dens *= 0.8 + 0.2 * simplex2(P.x * 0.08, P.z * 0.08);
      const dry = 0.5 + 0.5 * fbm2(P.x * 0.03, P.z * 0.03, 3);
      const k = (i * nd + j) * 4;
      data[k] = toHalf(h); data[k + 1] = toHalf(clamp(dens, 0, 1)); data[k + 2] = toHalf(dry); data[k + 3] = toHalf(ny);
    }
  }
  const t = new THREE.DataTexture(data, nd, nu, THREE.RGBAFormat, THREE.HalfFloatType);
  t.minFilter = THREE.LinearFilter; t.magFilter = THREE.LinearFilter; t.generateMipmaps = false;
  t.needsUpdate = true;
  return { tex: t, box: new THREE.Vector4(u0, D0, 1 / (nu - 1) / US, 1 / (nd - 1) / DS), D0, D1, u0, U1 };
}

function grassClump(blades, segs, seed) {
  const r = mulberry32(seed);
  const pos = [], bl = [], col = [], idx = [];
  let vc = 0;
  for (let b = 0; b < blades; b++) {
    const ox = (r() - 0.5) * 0.28, oz = (r() - 0.5) * 0.28, ang = r() * 6.28, hs = 0.6 + r() * 0.6;
    for (let s = 0; s <= segs; s++) {
      const t = s / segs;
      for (const side of [-0.5, 0.5]) {
        pos.push(side, t, 0);
        bl.push(ox, oz, ang);
        col.push(hs, r(), 1);
      }
    }
    for (let s = 0; s < segs; s++) {
      const a = vc + s * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    vc += (segs + 1) * 2;
  }
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aBlade', new THREE.Float32BufferAttribute(bl, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(new Float32Array(pos.length).fill(0).map((v, i) => (i % 3 === 1 ? 1 : 0)), 3));
  g.setIndex(idx);
  return g;
}

function grassMesh(udt, spacing, N, blades, segs, sizeMul, inner) {
  const g = grassClump(blades, segs, 99 + N);
  g.instanceCount = N * N;
  const uniforms = { tUD: { value: udt.tex }, uUDBox: { value: udt.box }, uOrigin: { value: new THREE.Vector2() }, uSpacing: { value: spacing }, uGridN: { value: N }, uSize: { value: sizeMul }, uInner: { value: inner }, uOuter: { value: N * spacing * 0.5 } };
  const m = std({ color: 0xffffff, roughness: 0.85, metalness: 0, vertexColors: true, side: THREE.DoubleSide }, {
    porosity: 0.5, noFlip: true, uniforms, key: 'grass' + N,
    vertexPre: CX_GLSL + /* glsl */`
      attribute vec3 aBlade;
      uniform sampler2D tUD; uniform vec4 uUDBox; uniform vec2 uOrigin; uniform float uSpacing; uniform float uGridN; uniform float uSize; uniform float uInner; uniform float uOuter;
      varying float vGY;
      vec3 gCol;
    `,
    replace: [],
    vertexBegin: '',
  });
  // custom vertex placement: override begin_vertex & beginnormal
  const prev = m.onBeforeCompile;
  m.onBeforeCompile = (sh, r) => {
    prev(sh, r);
    sh.vertexShader = sh.vertexShader.replace('#include <beginnormal_vertex>', /* glsl */`
      float id = float(gl_InstanceID);
      float gi = mod(id, uGridN), gj = floor(id / uGridN);
      vec2 cell = vec2(gi, gj) - uGridN * 0.5;
      vec2 ud = uOrigin + cell * uSpacing;
      vec2 cid = floor(ud / uSpacing + 0.5);
      float h1 = hash12g(cid), h2 = hash12g(cid + 17.3), h3 = hash12g(cid + 41.7), h4 = hash12g(cid + 71.1);
      ud += (vec2(h1, h2) - 0.5) * uSpacing * 0.95;
      vec2 xz = udToXZ(ud);
      vec2 tuv = vec2((ud.y - uUDBox.y) * uUDBox.w, (ud.x - uUDBox.x) * uUDBox.z);
      vec4 T = texture(tUD, tuv);
      float dc = length(xz - cameraPosition.xz);
      float fade = (1.0 - smoothstep(uOuter * 0.72, uOuter * 0.98, dc)) * smoothstep(uInner * 0.8, uInner, dc);
      float keep = step(h3, T.g * fade) * step(0.0, tuv.x) * step(tuv.x, 1.0) * step(0.0, tuv.y) * step(tuv.y, 1.0);
      float ca = cos(aBlade.z + h4 * 6.28), sa = sin(aBlade.z + h4 * 6.28);
      float H = (0.28 + 0.45 * h1) * (0.55 + 0.6 * T.g) * uSize * color.x * keep;
      float Wd = 0.075 * uSize;
      float y = position.y;
      vec3 lp = vec3(position.x * Wd * (1.0 - y * 0.85), y * H, 0.0);
      // bend
      float bendAmt = (0.25 + h2 * 0.35) * y * y * H;
      lp.z += bendAmt;
      vec3 wp = vec3(xz.x + aBlade.x * uSize, T.r - 0.02, xz.y + aBlade.y * uSize);
      vec3 rp = vec3(lp.x * ca - lp.z * sa, lp.y, lp.x * sa + lp.z * ca);
      float g = 0.5 + 0.5 * sin(dot(xz, uWind.xy) * 0.045 - uTime * 1.25) * sin(dot(xz, uWind.xy) * 0.011 - uTime * 0.37 + 1.3);
      float wamt = uWind.z * (0.3 + 0.9 * g * g) * y * y * H * 0.9;
      rp.xz += uWind.xy * wamt + vec2(sin(uTime * 2.3 + h1 * 6.0), cos(uTime * 1.9 + h2 * 6.0)) * 0.03 * y * H * uWind.z;
      vec3 transformedG = wp + rp;
      vec3 objectNormal = normalize(vec3(-sa * 0.5, 1.0, ca * 0.5));
      float dry = T.b;
      gCol = mix(mix(vec3(0.16, 0.26, 0.06), vec3(0.34, 0.46, 0.12), color.y), mix(vec3(0.44, 0.4, 0.16), vec3(0.58, 0.5, 0.22), color.y), smoothstep(0.45, 0.9, dry));
      gCol *= (1.0 - 0.35 * uNight) * (1.0 - 0.3 * uRain);
      vGY = y;
    `);
    sh.vertexShader = sh.vertexShader.replace('#include <begin_vertex>', 'vec3 transformed = transformedG;\n vColor.rgb = mix(gCol * 0.62, gCol * 1.15, vGY);');
    sh.fragmentShader = sh.fragmentShader.replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
      { vec3 Lv = normalize((viewMatrix * vec4(uKeyDir, 0.0)).xyz); float bl = pow(max(dot(-geometryViewDir, Lv), 0.0), 3.0); reflectedLight.directDiffuse += diffuseColor.rgb * uKeyCol * bl * 0.45; reflectedLight.indirectSpecular *= 0.2; }`);
  };
  const mesh = new THREE.Mesh(g, m);
  mesh.frustumCulled = false;
  mesh.receiveShadow = true;
  mesh.layers.set(5);
  mesh.name = 'grass';
  return { mesh, uniforms, spacing };
}

// ---------- generic instanced card plants -----------------------------------
function crossCard(w, h, cols, rows, cells, n = 2, upTilt = 0) {
  const pos = [], uv = [], nrm = [], wind = [], idx = [];
  let vc = 0;
  for (let k = 0; k < n; k++) {
    const a = k / n * Math.PI;
    const cx = Math.cos(a), cz = Math.sin(a);
    const cell = cells[k % cells.length];
    const cu = (cell % cols) / cols, cv = 1 - (Math.floor(cell / cols) + 1) / rows;
    for (const [x, y] of [[-0.5, 0], [0.5, 0], [-0.5, 1], [0.5, 1]]) {
      pos.push(cx * x * w, y * h, cz * x * w);
      uv.push(cu + (x + 0.5) / cols, cv + y / rows);
      nrm.push(cx * x * 0.6, 1, cz * x * 0.6);
      wind.push(y * y * 0.25, 1, 0);
    }
    idx.push(vc, vc + 1, vc + 2, vc + 1, vc + 3, vc + 2);
    vc += 4;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('aWind', new THREE.Float32BufferAttribute(wind, 3));
  g.setIndex(idx);
  return g;
}
function flatCard(w, cols, rows, cell, y = 0) {
  const g = new THREE.PlaneGeometry(w, w);
  g.rotateX(-Math.PI / 2);
  g.translate(0, y, 0);
  const uv = g.attributes.uv;
  const cu = (cell % cols) / cols, cv = 1 - (Math.floor(cell / cols) + 1) / rows;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, cu + uv.getX(i) / cols, cv + uv.getY(i) / rows);
  const wind = new Float32Array(uv.count * 3);
  for (let i = 0; i < uv.count; i++) { wind[i * 3] = 0.3; wind[i * 3 + 1] = 1; }
  g.setAttribute('aWind', new THREE.BufferAttribute(wind, 3));
  return g;
}
function cardMat(atlas, o = {}) {
  const m = std({ map: tex(atlas), alphaTest: o.alphaTest || 0.45, side: THREE.DoubleSide, roughness: 0.8, metalness: 0, color: new THREE.Color(o.color || 0xffffff) }, {
    wind: true, noFlip: true, porosity: 0.5, key: 'card' + atlas,
    lightsExtra: `{ vec3 Lv = normalize((viewMatrix * vec4(uKeyDir, 0.0)).xyz); float bl = pow(max(dot(-geometryViewDir, Lv), 0.0), 3.0); reflectedLight.directDiffuse += diffuseColor.rgb * uKeyCol * bl * ${(o.transl || 0.6).toFixed(2)}; reflectedLight.indirectDiffuse += diffuseColor.rgb * uAmbCol * 0.3; reflectedLight.indirectSpecular *= 0.3; }`,
  });
  m.alphaToCoverage = true;
  m.customDepthMaterial = depthMat(m, { wind: true });
  return m;
}
function scatter(scene, geo, mat, list, opts = {}) {
  if (!list.length) return null;
  const im = new THREE.InstancedMesh(geo, mat, list.length);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), t = new THREE.Vector3(), e = new THREE.Euler();
  list.forEach((it, i) => {
    e.set(it.tx || 0, it.rot, it.tz || 0);
    q.setFromEuler(e);
    s.set(it.s, it.sy || it.s, it.s);
    t.set(it.x, it.y, it.z);
    m4.compose(t, q, s);
    im.setMatrixAt(i, m4);
  });
  im.castShadow = !!opts.cast; im.receiveShadow = true;
  im.computeBoundingSphere();
  if (opts.layer !== undefined) im.layers.set(opts.layer);
  else if (opts.name !== 'reeds') { im.layers.set(5); im.userData.noRefl = true; }
  im.name = opts.name || 'plants';
  scene.add(im);
  return im;
}

function reedGeometry(seed) {
  const r = mulberry32(seed);
  const pos = [], nrm = [], col = [], wind = [], idx = [];
  let vc = 0;
  for (let b = 0; b < 15; b++) {
    const ang = r() * 6.28, lean = r() * 0.3, H = 0.9 + r() * 1.4, ox = (r() - 0.5) * 0.35, oz = (r() - 0.5) * 0.35;
    const dx = Math.cos(ang), dz = Math.sin(ang);
    const segs = 4;
    for (let s = 0; s <= segs; s++) {
      const t = s / segs;
      const off = lean * t * t * H;
      for (const side of [-1, 1]) {
        const w = 0.032 * (1 - t * 0.85);
        pos.push(ox + dx * off + -dz * side * w, t * H, oz + dz * off + dx * side * w);
        nrm.push(dx * 0.3, 1, dz * 0.3);
        const tip = smoothstep(0.6, 1, t);
        col.push(lerp(0.22, 0.52, tip), lerp(0.32, 0.44, tip), lerp(0.1, 0.2, tip));
        wind.push(t * t * H * 0.35, 0.3, r());
      }
    }
    for (let s = 0; s < segs; s++) { const a = vc + s * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    vc += (segs + 1) * 2;
    if (b % 3 === 0) { // cattail head
      const hy = H * 0.85;
      for (let k = 0; k < 6; k++) {
        const a2 = k / 6 * 6.28;
        pos.push(ox + dx * lean * H * 0.72 + Math.cos(a2) * 0.03, hy, oz + dz * lean * H * 0.72 + Math.sin(a2) * 0.03);
        pos.push(ox + dx * lean * H * 0.8 + Math.cos(a2) * 0.03, hy + 0.22, oz + dz * lean * H * 0.8 + Math.sin(a2) * 0.03);
        for (let z = 0; z < 2; z++) { nrm.push(Math.cos(a2), 0, Math.sin(a2)); col.push(0.3, 0.2, 0.12); wind.push(H * 0.3, 0.3, 0.5); }
      }
      for (let k = 0; k < 6; k++) { const a = vc + k * 2, b2 = vc + ((k + 1) % 6) * 2; idx.push(a, b2, a + 1, b2, b2 + 1, a + 1); }
      vc += 12;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('aWind', new THREE.Float32BufferAttribute(wind, 3));
  g.setIndex(idx);
  return g;
}

function agaveGeometry(seed) {
  const r = mulberry32(seed);
  const pos = [], nrm = [], col = [], idx = [];
  let vc = 0;
  const leaves = 18;
  for (let k = 0; k < leaves; k++) {
    const a = k * 2.39996 + r() * 0.2;
    const tilt = lerp(0.25, 1.25, (k / leaves)) + r() * 0.15;
    const L = lerp(0.7, 1.3, 1 - k / leaves) * (0.85 + r() * 0.3);
    const W = 0.13 * L;
    const segs = 4;
    const dx = Math.cos(a), dz = Math.sin(a);
    for (let s = 0; s <= segs; s++) {
      const t = s / segs;
      const el = Math.PI / 2 - tilt - t * t * 0.5;
      const rr = Math.cos(el) * L * t, yy = Math.sin(el) * L * t;
      const w = W * Math.sin(Math.PI * Math.min(1, t * 1.1 + 0.05)) * (1 - t * 0.7);
      for (const side of [-1, 0, 1]) {
        const lift = side === 0 ? w * 0.4 : 0;
        pos.push(dx * rr - dz * side * w, yy + lift + 0.05, dz * rr + dx * side * w);
        nrm.push(dx * 0.4 * (side === 0 ? 1 : 0.5), 1, dz * 0.4);
        const edge = side !== 0 ? 1 : 0;
        const c = [lerp(0.33, 0.62, edge * 0.6), lerp(0.46, 0.58, edge * 0.5), lerp(0.4, 0.3, edge)];
        col.push(...c);
      }
    }
    for (let s = 0; s < segs; s++) {
      const a0 = vc + s * 3;
      idx.push(a0, a0 + 1, a0 + 3, a0 + 1, a0 + 4, a0 + 3, a0 + 1, a0 + 2, a0 + 4, a0 + 2, a0 + 5, a0 + 4);
    }
    vc += (segs + 1) * 3;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function organoGeometry(seed) {
  const r = mulberry32(seed);
  const parts = [];
  const arms = 3 + Math.floor(r() * 5);
  const mk = (x, z, h, rad) => {
    const ribs = 7, segs = 8;
    const pos = [], col = [];
    const idx = [];
    for (let s = 0; s <= segs; s++) {
      const t = s / segs;
      const top = t > 0.9 ? Math.cos((t - 0.9) / 0.1 * Math.PI / 2) : 1;
      for (let k = 0; k <= ribs * 2; k++) {
        const a = k / (ribs * 2) * 6.2832;
        const rib = (k % 2 === 0 ? 1 : 0.8);
        const rr = rad * rib * top * (0.95 + 0.05 * Math.sin(t * 20));
        pos.push(x + Math.cos(a) * rr, t * h, z + Math.sin(a) * rr);
        const c = k % 2 === 0 ? [0.36, 0.46, 0.26] : [0.2, 0.3, 0.16];
        col.push(...c.map((v) => v * (0.8 + 0.2 * t)));
      }
    }
    const rw = ribs * 2 + 1;
    for (let s = 0; s < segs; s++) for (let k = 0; k < ribs * 2; k++) {
      const a = s * rw + k, b = a + 1, c = a + rw, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    parts.push(g);
  };
  for (let k = 0; k < arms; k++) {
    const a = r() * 6.28, rr = k === 0 ? 0 : 0.18 + r() * 0.25;
    mk(Math.cos(a) * rr, Math.sin(a) * rr, 2.2 + r() * 3.2, 0.14 + r() * 0.05);
  }
  return mergeSimple(parts);
}
export function mergeSimple(geos) {
  const out = new THREE.BufferGeometry();
  const attrs = Object.keys(geos[0].attributes);
  let vtot = 0, itot = 0;
  for (const g of geos) { vtot += g.attributes.position.count; itot += g.index ? g.index.count : g.attributes.position.count; }
  for (const a of attrs) {
    const sz = geos[0].attributes[a].itemSize;
    const arr = new Float32Array(vtot * sz);
    let o = 0;
    for (const g of geos) { arr.set(g.attributes[a].array, o); o += g.attributes[a].array.length; }
    out.setAttribute(a, new THREE.BufferAttribute(arr, sz));
  }
  const idx = new Uint32Array(itot);
  let io = 0, vo = 0;
  for (const g of geos) {
    const ix = g.index ? g.index.array : Array.from({ length: g.attributes.position.count }, (_, i) => i);
    for (let i = 0; i < ix.length; i++) idx[io++] = ix[i] + vo;
    vo += g.attributes.position.count;
  }
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  out.computeBoundingSphere();
  return out;
}

export function buildPlants(world, terrain) {
  const scene = world.scene;
  const rand = mulberry32(9090);
  const P = {};
  // grass rings
  const udt = buildUDTex(world, terrain);
  world.udt = udt;
  // grids are pushed ahead of the camera so few instances are wasted behind it
  const SHIFT = 0.3;
  const g1 = grassMesh(udt, 0.38, 140, 3, 3, 1.0, 0);
  const g2 = grassMesh(udt, 1.0, 96, 4, 2, 1.55, 30);
  for (const g of [g1, g2]) g.uniforms.uOuter.value *= 1 + SHIFT;
  scene.add(g1.mesh, g2.mesh);
  world.grassFar = g2.mesh;
  const fwd = new THREE.Vector3();
  const origin = (g) => {
    world.cam.getWorldDirection(fwd);
    fwd.y = 0; if (fwd.lengthSq() < 1e-6) fwd.set(0, 0, -1); fwd.normalize();
    const ahead = g.uniforms.uOuter.value / (1 + SHIFT) * SHIFT;
    const ud = toUD(world.cam.position.x + fwd.x * ahead, world.cam.position.z + fwd.z * ahead);
    const s = g.spacing;
    g.uniforms.uOrigin.value.set(Math.round(ud.u / s) * s, Math.round(ud.d / s) * s);
  };
  world.updaters.push(() => { origin(g1); origin(g2); });

  // reeds along banks
  const reedGeos = [reedGeometry(1), reedGeometry(2), reedGeometry(3)];
  const reedMat = std({ vertexColors: true, roughness: 0.8, side: THREE.DoubleSide }, { wind: true, noFlip: true, porosity: 0.4, key: 'reed', lightsExtra: 'reflectedLight.indirectSpecular *= 0.3;' });
  reedMat.customDepthMaterial = depthMat(reedMat, { wind: true });
  const reeds = [[], [], []];
  for (let u = -200; u < R.FALL_U - 20; u += 0.9) {
    for (const side of [-1, 1]) {
      const kk = bankKind(u, side);
      const dens = lerp(0.7, 0.3, kk) * (1 - smoothstep(700, 900, u) * 0.6) * (0.5 + 0.5 * simplex2(u * 0.02, side * 5));
      if (rand() > dens) continue;
      if (Math.abs(u - L.bridge.u) < 9 || Math.abs(u - L.landing.u) < 5) continue;
      const w = halfW(u);
      const d = side * (w - 0.8 + rand() * 2.6);
      toWorld(u, d, P);
      const h = terrainH(P.x, P.z, u);
      if (h < -0.35 || h > 0.9) continue;
      reeds[Math.floor(rand() * 3)].push({ x: P.x, y: h - 0.05, z: P.z, s: 0.8 + rand() * 0.6, rot: rand() * 6.28 });
    }
  }
  reeds.forEach((l, i) => scatter(scene, reedGeos[i], reedMat, l, { cast: false, name: 'reeds' }));

  // cempasuchil fields (rows) and cosmos meadows
  const cempaMat = cardMat('f_cempa', { transl: 0.8 });
  const cempaPlant = crossCard(0.75, 0.95, 2, 2, [2, 1], 2);
  const cempaTop = flatCard(0.42, 2, 2, 0, 0.0);
  const plants = [], tops = [];
  for (const f of FIELDS) {
    if (f.kind !== 'cempa') continue;
    for (let u = f.u0 + 1.5; u < f.u1 - 1.5; u += 0.55) {
      for (let d = f.d0 + 1.5; d < f.d1 - 1.5; d += 0.9) {
        if (rand() < 0.08) continue;
        const uu = u + (rand() - 0.5) * 0.25, dd = d + (rand() - 0.5) * 0.18;
        toWorld(uu, dd, P);
        if (world.isBlocked(P.x, P.z, 0.5)) continue;
        const h = terrainH(P.x, P.z, uu);
        const s = 0.8 + rand() * 0.45;
        plants.push({ x: P.x, y: h - 0.05, z: P.z, s, rot: rand() * 6.28 });
        if (rand() < 0.9) tops.push({ x: P.x + (rand() - 0.5) * 0.2, y: h + 0.8 * s, z: P.z + (rand() - 0.5) * 0.2, s: 0.85 + rand() * 0.5, rot: rand() * 6.28, tx: (rand() - 0.5) * 0.4, tz: (rand() - 0.5) * 0.4 });
      }
    }
  }
  // wild cempasuchil clumps along paths and near arco / panteon
  for (let k = 0; k < 700; k++) {
    const u = 60 + rand() * 460, side = rand() < 0.7 ? 1 : -1;
    const d = side * (halfW(u) + 3 + rand() * 40);
    toWorld(u, d, P);
    const pd = distToPaths(P.x, P.z);
    if (pd > 2.5 && rand() < 0.8) continue;
    if (pd < 0.3 || world.isBlocked(P.x, P.z, 0.4)) continue;
    const h = terrainH(P.x, P.z, u);
    const s = 0.7 + rand() * 0.4;
    plants.push({ x: P.x, y: h - 0.05, z: P.z, s, rot: rand() * 6.28 });
    tops.push({ x: P.x, y: h + 0.78 * s, z: P.z, s: 0.9, rot: rand() * 6.28 });
  }
  scatter(scene, cempaPlant, cempaMat, plants, { cast: true, name: 'cempa' });
  scatter(scene, cempaTop, cempaMat, tops, { cast: false, name: 'cempaTop' });
  // cosmos
  const cosMat = cardMat('f_cosmos', { transl: 0.9 });
  const cosPlant = crossCard(0.6, 1.1, 2, 2, [3, 3], 2);
  const cosFlowers = [flatCard(0.2, 2, 2, 0), flatCard(0.2, 2, 2, 1), flatCard(0.2, 2, 2, 2)];
  const cp = [], cf = [[], [], []];
  for (let k = 0; k < 5200; k++) {
    const u = -150 + rand() * 900, side = rand() < 0.5 ? -1 : 1;
    const e = 2 + rand() * 70;
    const d = side * (halfW(u) + e);
    toWorld(u, d, P);
    const patch = fbm2(P.x * 0.02, P.z * 0.02, 3);
    if (patch < 0.12 + rand() * 0.2) continue;
    if (world.isBlocked(P.x, P.z, 0.5) || fieldAt(u, d) || distToPaths(P.x, P.z) < 0.8) continue;
    const h = terrainH(P.x, P.z, u);
    if (h > 25 || h < 0.3) continue;
    const s = 0.7 + rand() * 0.6;
    cp.push({ x: P.x, y: h - 0.05, z: P.z, s, rot: rand() * 6.28 });
    const nf = 2 + Math.floor(rand() * 3);
    for (let f = 0; f < nf; f++) cf[Math.floor(rand() * 3)].push({ x: P.x + (rand() - 0.5) * 0.35 * s, y: h + (0.75 + rand() * 0.3) * s, z: P.z + (rand() - 0.5) * 0.35 * s, s: 0.9 + rand() * 0.4, rot: rand() * 6.28, tx: 0.4 + (rand() - 0.5) * 0.6, tz: (rand() - 0.5) * 0.6 });
  }
  scatter(scene, cosPlant, cosMat, cp, { cast: false, name: 'cosmos' });
  cf.forEach((l, i) => scatter(scene, cosFlowers[i], cosMat, l, { cast: false, name: 'cosmosF' }));
  // ferns in the gorge & shaded banks
  const fernMat = cardMat('f_fern', { transl: 0.5 });
  const fernG = crossCard(1.2, 1.1, 2, 1, [0, 1, 0], 3);
  const ferns = [];
  for (let k = 0; k < 2600; k++) {
    const u = 350 + rand() * 820, side = rand() < 0.5 ? -1 : 1;
    const d = side * (halfW(u) + 0.8 + rand() * 18);
    toWorld(u, d, P);
    const h = terrainH(P.x, P.z, u);
    if (h < 0.3 || h > 60) continue;
    if (world.isBlocked(P.x, P.z, 0.5)) continue;
    ferns.push({ x: P.x, y: h - 0.1, z: P.z, s: 0.6 + rand() * 0.7, rot: rand() * 6.28 });
  }
  scatter(scene, fernG, fernMat, ferns, { cast: false, name: 'ferns' });
  // milpa (dry corn)
  const cornMat = cardMat('f_corn', { transl: 0.5 });
  const cornG = crossCard(0.9, 2.3, 1, 1, [0], 2);
  const corn = [];
  for (const f of FIELDS) {
    if (f.kind !== 'milpa') continue;
    for (let u = f.u0 + 1; u < f.u1 - 1; u += 0.8) for (let d = f.d0 + 1; d < f.d1 - 1; d += 1.1) {
      if (rand() < 0.15) continue;
      toWorld(u + (rand() - 0.5) * 0.3, d, P);
      if (world.isBlocked(P.x, P.z, 0.5)) continue;
      const h = terrainH(P.x, P.z);
      corn.push({ x: P.x, y: h - 0.05, z: P.z, s: 0.8 + rand() * 0.4, rot: rand() * 6.28 });
    }
  }
  scatter(scene, cornG, cornMat, corn, { cast: true, name: 'corn' });
  // agaves & organo cacti on dry slopes
  const vcMat = std({ vertexColors: true, roughness: 0.7 }, { porosity: 0.3, key: 'vc' });
  const agG = [agaveGeometry(5), agaveGeometry(6)];
  const orG = [organoGeometry(7), organoGeometry(8), organoGeometry(9)];
  const ag = [[], []], org = [[], [], []];
  for (let k = 0; k < 2400; k++) {
    const u = -250 + rand() * 1350, side = rand() < 0.5 ? -1 : 1;
    const d = side * (halfW(u) + 12 + rand() * 160);
    toWorld(u, d, P);
    const h = terrainH(P.x, P.z, u);
    if (h < 2 || h > 160) continue;
    const ud = toUD(P.x, P.z);
    if (forestMask(ud.u, ud.d, P.x, P.z, h) > 0.55 && rand() < 0.8) continue;
    if (world.isBlocked(P.x, P.z, 1.5)) continue;
    const slope = Math.abs(terrainH(P.x + 2, P.z) - terrainH(P.x - 2, P.z)) + Math.abs(terrainH(P.x, P.z + 2) - terrainH(P.x, P.z - 2));
    if (h < 12 || slope < 0.8) { if (rand() < 0.5) ag[k % 2].push({ x: P.x, y: h - 0.05, z: P.z, s: 0.7 + rand() * 0.8, rot: rand() * 6.28 }); continue; }
    if (rand() < 0.65) ag[k % 2].push({ x: P.x, y: h - 0.05, z: P.z, s: 0.7 + rand() * 0.8, rot: rand() * 6.28 });
    else org[k % 3].push({ x: P.x, y: h - 0.2, z: P.z, s: 0.8 + rand() * 0.6, rot: rand() * 6.28 });
  }
  // agaves on terraces edges near the pueblo
  for (let k = 0; k < 60; k++) {
    const u = L.atrium.u - 25 + rand() * 50, d = 26 + rand() * 4;
    toWorld(u, d, P);
    if (world.isBlocked(P.x, P.z, 0.8)) continue;
    const h = terrainH(P.x, P.z, u);
    ag[k % 2].push({ x: P.x, y: h - 0.05, z: P.z, s: 0.6 + rand() * 0.5, rot: rand() * 6.28 });
  }
  ag.forEach((l, i) => scatter(scene, agG[i], vcMat, l, { cast: false, name: 'agave' }));
  org.forEach((l, i) => scatter(scene, orG[i], vcMat, l, { cast: false, name: 'organo' }));
  // settled petals on the banks near trees & paths
  const petMat = cardMat('f_petals', { alphaTest: 0.4, transl: 0.3 });
  const petG = [0, 1, 2, 3].map((c) => flatCard(0.09, 4, 1, c, 0.0));
  const pets = [[], [], [], []];
  for (const c of world.canopies || []) {
    const kind = c.kind === 'cazahuate' ? 2 : c.kind === 'ahuehuete' ? 3 : 3;
    for (let k = 0; k < 90; k++) {
      const a = rand() * 6.28, r = Math.sqrt(rand()) * c.r * 1.1;
      const x = c.x + Math.cos(a) * r, z = c.z + Math.sin(a) * r;
      const h = terrainH(x, z);
      if (h < 0.05) continue;
      pets[kind].push({ x, y: h + 0.03, z, s: 0.8 + rand() * 0.8, rot: rand() * 6.28 });
    }
  }
  for (let k = 0; k < 2500; k++) {
    const u = 60 + rand() * 440, side = rand() < 0.7 ? 1 : -1;
    const d = side * (halfW(u) + rand() * 45);
    toWorld(u, d, P);
    if (distToPaths(P.x, P.z) > 1.5 && rand() < 0.7) continue;
    const h = terrainH(P.x, P.z, u);
    if (h < 0.05) continue;
    pets[rand() < 0.75 ? 0 : 1].push({ x: P.x, y: h + 0.03, z: P.z, s: 0.8 + rand() * 0.8, rot: rand() * 6.28 });
  }
  pets.forEach((l, i) => scatter(scene, petG[i], petMat, l, { cast: false, layer: 5, name: 'petalsGround' }));
  return { udt };
}
