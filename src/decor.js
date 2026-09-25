import * as THREE from 'three';
import { std, U, GLSL_COMMON, GLSL_FOG, depthMat } from './materials.js';
import { tex } from './textures.js';
import { mulberry32, lerp, clamp } from './noise.js';

const PAPEL_COLS = [[0.93, 0.25, 0.55], [1.0, 0.55, 0.1], [0.55, 0.22, 0.75], [0.2, 0.7, 0.35], [0.98, 0.85, 0.2], [0.2, 0.55, 0.92], [0.95, 0.2, 0.2]];

export function buildPapel(world, linesIn, parent) {
  const lines = linesIn || world.papelLines;
  const rand = mulberry32(88);
  const A = [], T = [], C = [], D = [];
  const threadPts = [];
  for (const [a, b, sag] of lines) {
    const len = a.distanceTo(b);
    const n = Math.max(2, Math.floor(len / 0.44));
    let prev = null;
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const p = a.clone().lerp(b, t);
      p.y -= sag * 4 * t * (1 - t);
      if (prev) threadPts.push(prev.clone(), p.clone());
      prev = p;
      if (i === n) break;
      const t2 = (i + 1) / n;
      const p2 = a.clone().lerp(b, t2); p2.y -= sag * 4 * t2 * (1 - t2);
      const tan = p2.clone().sub(p).normalize();
      const mid = p.clone().lerp(p2, 0.5);
      A.push(mid.x, mid.y, mid.z); T.push(tan.x, tan.y, tan.z);
      C.push(...PAPEL_COLS[Math.floor(rand() * PAPEL_COLS.length)]);
      D.push(Math.floor(rand() * 4), rand() * 6.28);
    }
  }
  const g = new THREE.InstancedBufferGeometry();
  const base = new THREE.PlaneGeometry(1, 1, 3, 3);
  base.translate(0, -0.5, 0);
  g.index = base.index;
  g.setAttribute('position', base.attributes.position);
  g.setAttribute('uv', base.attributes.uv);
  g.setAttribute('iA', new THREE.InstancedBufferAttribute(new Float32Array(A), 3));
  g.setAttribute('iT', new THREE.InstancedBufferAttribute(new Float32Array(T), 3));
  g.setAttribute('iC', new THREE.InstancedBufferAttribute(new Float32Array(C), 3));
  g.setAttribute('iD', new THREE.InstancedBufferAttribute(new Float32Array(D), 2));
  g.instanceCount = A.length / 3;
  const mat = new THREE.ShaderMaterial({
    uniforms: Object.assign({}, U, { tMask: { value: tex('f_papel', { srgb: false }) } }),
    vertexShader: GLSL_COMMON + /* glsl */`
      attribute vec3 iA; attribute vec3 iT; attribute vec3 iC; attribute vec2 iD;
      varying vec2 vUv; varying vec3 vC; varying vec3 vW; varying vec3 vN; varying float vD;
      void main() {
        vec3 dn = vec3(0.0, -1.0, 0.0);
        vec3 nr = normalize(cross(iT, dn));
        float w = 0.38, h = 0.44;
        float y = -position.y; // 0 top .. 1 bottom
        float g = 0.5 + 0.5 * sin(dot(iA.xz, uWind.xy) * 0.05 - uTime * 1.3);
        float fl = sin(uTime * (4.0 + g * 3.0) + iD.y + position.x * 2.0) * (0.25 + uWind.z * 0.9 * g) * y * y;
        vec3 p = iA + iT * position.x * w + dn * y * h + nr * fl * 0.22 + vec3(uWind.x, 0.0, uWind.y) * y * y * uWind.z * 0.12;
        vW = p; vN = nr; vUv = vec2((uv.x + iD.x) / 4.0, uv.y); vC = iC;
        vec4 wp4 = modelMatrix * vec4(p, 1.0); vW = wp4.xyz; vN = normalize(mat3(modelMatrix) * nr);
        gl_Position = projectionMatrix * viewMatrix * wp4;
      }`,
    fragmentShader: GLSL_COMMON + GLSL_FOG + /* glsl */`
      uniform sampler2D tMask;
      varying vec2 vUv; varying vec3 vC; varying vec3 vW; varying vec3 vN;
      void main() {
        float m = texture2D(tMask, vUv).r;
        if (m < 0.5) discard;
        vec3 V = normalize(cameraPosition - vW);
        vec3 N = normalize(vN); if (dot(N, V) < 0.0) N = -N;
        vec3 c = vC * vC;
        float dif = abs(dot(N, uKeyDir)) * 0.7 + 0.3;
        float back = pow(max(dot(-V, uKeyDir), 0.0), 2.0);
        vec3 col = c * (uAmbCol * 1.6 + uKeyCol * dif * 0.7) + c * uKeyCol * back * 0.9;
        col += c * uFlash * 0.4;
        col = applyFog(col, vW);
        gl_FragColor = vec4(col, 1.0);
      }`,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(g, mat);
  mesh.frustumCulled = false;
  mesh.name = 'papel';
  (parent || world.scene).add(mesh);
  const tg = new THREE.BufferGeometry().setFromPoints(threadPts);
  const tl = new THREE.LineSegments(tg, new THREE.LineBasicMaterial({ color: 0x2a2420 }));
  tl.name = 'threads';
  (parent || world.scene).add(tl);
  return mesh;
}

// flowers placed as instanced cards: list of {p, n, kind}
export function flowerCards(world, list, atlas = 'f_cempa', cell = 0, size = 0.24, layer = 0) {
  if (!list.length) return null;
  const m = std({ map: tex(atlas), alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.75 }, {
    porosity: 0.5, noFlip: true, key: 'fcard' + atlas,
    lightsExtra: `{ vec3 Lv = normalize((viewMatrix * vec4(uKeyDir, 0.0)).xyz); float bl = pow(max(dot(-geometryViewDir, Lv), 0.0), 3.0); reflectedLight.directDiffuse += diffuseColor.rgb * uKeyCol * bl * 0.8; reflectedLight.indirectDiffuse += diffuseColor.rgb * uAmbCol * 0.3; }`,
  });
  m.alphaToCoverage = true;
  const groups = {};
  for (const f of list) (groups[f.kind || 0] = groups[f.kind || 0] || []).push(f);
  const out = [];
  for (const k of Object.keys(groups)) {
    const c = k === '1' ? 2 : cell;
    const g = new THREE.PlaneGeometry(size, size);
    const uv = g.attributes.uv;
    const cu = (c % 2) * 0.5, cv = c < 2 ? 0.5 : 0;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, cu + uv.getX(i) * 0.5, cv + uv.getY(i) * 0.5);
    const arr = groups[k];
    const im = new THREE.InstancedMesh(g, m, arr.length);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), rq = new THREE.Quaternion();
    const rand = mulberry32(arr.length);
    arr.forEach((f, i) => {
      q.setFromUnitVectors(new THREE.Vector3(0, 0, 1), f.n);
      rq.setFromAxisAngle(f.n, rand() * 6.28);
      q.premultiply(rq);
      m4.compose(f.p, q, new THREE.Vector3(1, 1, 1).multiplyScalar((0.75 + rand() * 0.55) * (k === '1' ? 1.6 : 1)));
      im.setMatrixAt(i, m4);
    });
    im.castShadow = true; im.receiveShadow = true;
    im.layers.set(layer);
    im.name = 'flowerCards';
    world.scene.add(im);
    out.push(im);
  }
  return out;
}

// candles with flickering flames (opts.jar -> glass veladoras tinted per instance)
export function buildCandles(world, listIn, parent, opts = {}) {
  const list = listIn || world.candles;
  const n = list.length;
  const jar = !!opts.jar;
  const wax = jar ? new THREE.CylinderGeometry(0.036, 0.034, 1, 10) : new THREE.CylinderGeometry(0.022, 0.024, 1, 8);
  wax.translate(0, 0.5, 0);
  const wm = jar
    ? std({ color: 0xffffff, roughness: 0.15, metalness: 0, emissive: 0xffffff, emissiveIntensity: 0 }, { porosity: 0.0, key: 'vjar', emissiveExtra: 'totalEmissiveRadiance *= vColor.rgb * vColor.rgb;' })
    : std({ color: 0xf2ead8, roughness: 0.5, emissive: 0xffa050, emissiveIntensity: 0 }, { porosity: 0.1, key: 'wax' });
  const im = new THREE.InstancedMesh(wax, wm, n);
  const m4 = new THREE.Matrix4();
  const col = new THREE.Color();
  list.forEach((c, i) => {
    m4.makeScale(1, c.h, 1).setPosition(c.x, c.y, c.z); im.setMatrixAt(i, m4);
    if (jar) { col.setRGB(c.col[0], c.col[1], c.col[2]); im.setColorAt(i, col); }
  });
  im.name = jar ? 'veladoras' : 'candles';
  (parent || world.scene).add(im);
  // flames: additive billboards with a soft halo that grows with distance
  const g = new THREE.InstancedBufferGeometry();
  const base = new THREE.PlaneGeometry(1, 1);
  g.index = base.index;
  g.setAttribute('position', base.attributes.position);
  g.setAttribute('uv', base.attributes.uv);
  const P = new Float32Array(n * 4);
  const C = new Float32Array(n * 3);
  list.forEach((c, i) => {
    P.set([c.x, c.y + (jar ? c.h * 0.72 : c.h), c.z, Math.random() * 100], i * 4);
    const cc = jar ? c.col : [1, 0.62, 0.3];
    C.set([0.55 + cc[0] * 0.45, 0.4 + cc[1] * 0.45, 0.25 + cc[2] * 0.4], i * 3);
  });
  g.setAttribute('iP', new THREE.InstancedBufferAttribute(P, 4));
  g.setAttribute('iC', new THREE.InstancedBufferAttribute(C, 3));
  g.instanceCount = n;
  const mat = new THREE.ShaderMaterial({
    uniforms: Object.assign({}, U, { uOn: { value: 0 }, uHalo: { value: jar ? 1.25 : 1.0 } }),
    vertexShader: GLSL_COMMON + /* glsl */`
      attribute vec4 iP; attribute vec3 iC; uniform float uOn;
      varying vec2 vQ; varying vec2 vUv; varying float vF; varying float vFar; varying vec3 vC;
      void main() {
        vec3 wpos = (modelMatrix * vec4(iP.xyz, 1.0)).xyz;
        vec3 toC = normalize(cameraPosition - wpos);
        vec3 r = normalize(cross(vec3(0.0, 1.0, 0.0), toC));
        r = normalize((inverse(modelMatrix) * vec4(r, 0.0)).xyz);
        float fl = 0.8 + 0.2 * sin(uTime * 13.0 + iP.w) * sin(uTime * 7.3 + iP.w * 2.0);
        float Q = 0.34 * step(0.01, uOn);
        vec3 p = iP.xyz + vec3(0.0, 0.03, 0.0) + r * position.x * Q + vec3(0.0, position.y * Q, 0.0);
        vQ = position.xy * Q; vUv = uv; vF = fl * uOn; vC = iC;
        vec4 mv = viewMatrix * modelMatrix * vec4(p, 1.0);
        float d = -mv.z;
        float far = clamp(d * 0.006, 0.0, 0.9);
        vFar = far;
        mv.xy += position.xy * far * step(0.01, uOn);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`
      uniform float uHalo;
      varying vec2 vQ; varying vec2 vUv; varying float vF; varying float vFar; varying vec3 vC;
      void main() {
        vec2 q = vQ / 0.05;
        q.y += 0.15;
        q.x *= 2.3 - clamp(q.y, -0.5, 1.0) * 0.6;
        float d = length(q * vec2(1.0, q.y > 0.0 ? 0.62 : 1.2));
        float core = exp(-d * d * 3.2);
        float body = exp(-d * d * 0.9) * 0.35;
        vec2 h = vUv - 0.5;
        float rr = dot(h, h) * 4.0;
        float halo = exp(-rr * (7.0 - vFar * 3.0)) * (0.09 + vFar * 0.5) * uHalo;
        vec3 c = mix(vec3(1.0, 0.38, 0.07), vec3(1.0, 0.78, 0.42), core) * (core * (7.0 - vFar * 4.0) + body * 2.6);
        c += vC * vC * halo * 2.6;
        gl_FragColor = vec4(c * vF, 1.0);
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const flames = new THREE.Mesh(g, mat);
  flames.frustumCulled = false;
  flames.layers.set(2);
  flames.name = 'flames';
  (parent || world.scene).add(flames);
  world.updaters.push(() => { const on = world.tod.night * 0.95 + world.tod.dusk * 0.3; mat.uniforms.uOn.value = on; wm.emissiveIntensity = on * (jar ? 1.6 : 0.25); });
  return { flames, mat };
}

// church bells
export function buildBells(world) {
  const pts = [[0, 0.62], [0.06, 0.6], [0.14, 0.55], [0.18, 0.45], [0.2, 0.3], [0.24, 0.12], [0.3, 0.02], [0.31, 0], [0.26, 0.02], [0.21, 0.12], [0.17, 0.3], [0.14, 0.45], [0.1, 0.52], [0, 0.55]].map(([r, y]) => new THREE.Vector2(r, y - 0.62));
  const g = new THREE.LatheGeometry(pts, 24);
  const bm = std({ color: 0x8a6634, roughness: 0.35, metalness: 0.9 }, { porosity: 0.1, key: 'bell' });
  const yoke = new THREE.BoxGeometry(0.1, 0.14, 1.1);
  const ym = world.archMats ? world.archMats.wood : bm;
  world.bellMeshes = [];
  for (const b of world.bells) {
    const piv = new THREE.Group();
    piv.position.copy(b.pos);
    const q = new THREE.Quaternion().setFromRotationMatrix(b.matrix);
    piv.quaternion.copy(q);
    const bell = new THREE.Mesh(g, bm);
    bell.scale.setScalar(b.scale * 1.25);
    bell.castShadow = true;
    const y = new THREE.Mesh(yoke, ym);
    y.scale.set(1, 1, b.scale * 1.3);
    piv.add(bell, y);
    world.scene.add(piv);
    world.bellMeshes.push({ piv, amp: 0, phase: Math.random() * 6, speed: 1.6 + Math.random() * 0.5, lastSide: 0 });
  }
}

// pierced-tin lanterns on the pedestals + dotted light pools; church interior glow
export function buildLanterns(world) {
  const tinMat = std({ color: 0xb8b2a6, roughness: 0.3, metalness: 0.85, emissive: 0xffa04a, emissiveMap: tex('f_tin'), emissiveIntensity: 0 }, { porosity: 0.1, key: 'tinL' });
  const body = new THREE.CylinderGeometry(0.13, 0.13, 0.3, 8, 1, false);
  const uv = body.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 2, uv.getY(i));
  const cap = new THREE.ConeGeometry(0.16, 0.16, 8);
  const ring = new THREE.TorusGeometry(0.05, 0.01, 4, 10);
  const poolMat = new THREE.ShaderMaterial({
    uniforms: Object.assign({}, U, { tTin: { value: tex('f_tin', { srgb: false }) }, uOn: { value: 0 } }),
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: /* glsl */`
      uniform sampler2D tTin; uniform float uOn; varying vec2 vUv;
      void main() {
        vec2 q = vUv - 0.5; float r = length(q) * 2.0;
        float a = atan(q.y, q.x);
        float dots = texture2D(tTin, vec2(0.5) + vec2(cos(a), sin(a)) * (0.12 + r * 0.33)).r;
        float fall = pow(max(0.0, 1.0 - r), 2.0);
        gl_FragColor = vec4(vec3(1.0, 0.62, 0.28) * (fall * 0.25 + dots * fall * 0.9) * uOn, 1.0);
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4,
  });
  for (const l of world.lanterns) {
    const g = new THREE.Group();
    const b = new THREE.Mesh(body, tinMat); b.position.y = 0.15;
    const c = new THREE.Mesh(cap, tinMat); c.position.y = 0.38;
    const r = new THREE.Mesh(ring, tinMat); r.position.y = 0.5;
    g.add(b, c, r);
    g.position.set(l.x, l.y, l.z);
    g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    world.scene.add(g);
    const pool = new THREE.Mesh(new THREE.CircleGeometry(2.6, 32), poolMat);
    pool.rotation.x = -Math.PI / 2;
    pool.position.set(l.x, l.y - 1.18, l.z);
    pool.layers.set(3);
    world.scene.add(pool);
  }
  // church interior warm glow seen through the open doors
  const gm = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.0, 0.55, 0.22) });
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(9, 6), gm);
  const m = new THREE.Matrix4().multiplyMatrices(world.churchMatrix, new THREE.Matrix4().makeTranslation(4.5, 3, 0).multiply(new THREE.Matrix4().makeRotationY(-Math.PI / 2)));
  glow.applyMatrix4(m);
  world.scene.add(glow);
  world.updaters.push(() => {
    const on = world.tod.night * 0.95 + world.tod.dusk * 0.4;
    tinMat.emissiveIntensity = on * 3.5;
    poolMat.uniforms.uOn.value = on;
    gm.color.setRGB(1.0, 0.55, 0.22).multiplyScalar(0.05 + on * 2.2);
    if (world.boat) world.boat.mats.tin.emissiveIntensity = on * 3.5;
  });
}
