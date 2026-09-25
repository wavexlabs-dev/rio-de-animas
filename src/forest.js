import * as THREE from 'three';
import { generateTree, SPECIES } from './treegen.js';
import { std, depthMat, U, GLSL_COMMON, GLSL_FOG } from './materials.js';
import { tex, ntex } from './textures.js';
import { mulberry32, smoothstep, lerp, fbm2, clamp } from './noise.js';
import { R, toWorld, halfW, terrainH, toUD, frame, plainW } from './river.js';
import { forestMask, fieldAt } from './terrain.js';
import { L, distToPaths, inPad } from './layout.js';

const TRANSL = /* glsl */`
{
  vec3 Lv = normalize((viewMatrix * vec4(uKeyDir, 0.0)).xyz);
  float bl = pow(max(dot(-geometryViewDir, Lv), 0.0), 3.0);
  reflectedLight.directDiffuse += diffuseColor.rgb * uKeyCol * bl * uTransl;
  reflectedLight.indirectDiffuse += diffuseColor.rgb * uAmbCol * 0.25;
  reflectedLight.indirectSpecular *= 0.3;
}`;
const DITHER = /* glsl */`
float bayer4(vec2 p) { ivec2 q = ivec2(mod(p, 4.0)); int i = q.x + q.y * 4;
  float m[16] = float[16](0.,8.,2.,10.,12.,4.,14.,6.,3.,11.,1.,9.,15.,7.,13.,5.); return (m[i] + 0.5) / 16.0; }
`;

export function barkMat(kind, far = 0) {
  const sp = SPECIES[kind];
  // scanned barks: fibrous cypress/willow, plated pine, fissured oak, smooth pale amate/cazahuate
  const name = { ahuehuete: 'barkahue', ahuejote: 'barkahue', pino: 'bark', encino: 'barksm', cazahuate: 'barkliso', amate: 'barkliso' }[kind] || 'barksm';
  const tint = { ahuehuete: 0xe8ddd4, ahuejote: 0xd8d2c8, pino: 0xf0e4dc, encino: 0xe6e0d8, cazahuate: 0xf4efe6, amate: 0xfff6e0 }[kind] || 0xffffff;
  const m = std({ map: tex(name + '_c'), normalMap: ntex(name + '_n'), color: new THREE.Color(tint), roughness: 0.95, metalness: 0, vertexColors: true },
    {
      wind: true, porosity: 0.8, uniforms: { uFadeFar: { value: far } }, key: 'bark' + far,
      fragmentPre: 'uniform float uFadeFar;\n' + DITHER,
      afterMap: far ? 'if (uFadeFar > 0.0) { float dd = length(vWPos - cameraPosition); if ((dd - uFadeFar) / 12.0 > bayer4(gl_FragCoord.xy)) discard; }' : '',
    });
  m.customDepthMaterial = depthMat(m, { wind: true });
  return m;
}
export function leafMat(atlas, o = {}) {
  const m = std({ map: tex(atlas), alphaTest: o.alphaTest || 0.42, side: THREE.DoubleSide, roughness: 0.78, metalness: 0, color: new THREE.Color(o.color || 0xffffff) },
    {
      wind: true, noFlip: true, porosity: 0.6, uniforms: { uTransl: { value: o.transl || 0.55 }, uFadeFar: { value: o.far || 0 } }, key: 'leaf' + atlas + (o.far || 0),
      fragmentPre: 'uniform float uTransl; uniform float uFadeFar;\n' + DITHER,
      afterMap: (o.far ? 'if (uFadeFar > 0.0) { float dd = length(vWPos - cameraPosition); if ((dd - uFadeFar) / 12.0 > bayer4(gl_FragCoord.xy)) discard; }\n' : '') + 'diffuseColor.rgb *= 0.88;',
      lightsExtra: TRANSL,
    });
  m.alphaToCoverage = true;
  m.customDepthMaterial = depthMat(m, { wind: true });
  return m;
}

// ---- impostor atlas -------------------------------------------------------
function captureImpostors(renderer, variants) {
  const cellW = 256, cellH = 512;
  const cols = variants.length;
  const W = cellW * cols, H = cellH;
  const opt = { type: THREE.HalfFloatType, depthBuffer: true, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter };
  const rtC = new THREE.WebGLRenderTarget(W, H, opt);
  const rtN = new THREE.WebGLRenderTarget(W, H, opt);
  const scene = new THREE.Scene();
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 200);
  const prevRT = renderer.getRenderTarget();
  const prevClear = renderer.getClearColor(new THREE.Color()), prevA = renderer.getClearAlpha();
  renderer.setClearColor(0x000000, 0);
  const colMat = (map, vc, alpha) => new THREE.ShaderMaterial({
    uniforms: { map: { value: map }, tint: { value: new THREE.Color(1, 1, 1) } },
    vertexShader: 'varying vec2 vUv; varying vec3 vC; attribute vec3 color; void main(){ vUv = uv; vC = color; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `uniform sampler2D map; uniform vec3 tint; varying vec2 vUv; varying vec3 vC; void main(){ vec4 c = texture2D(map, vUv); if (${alpha ? 'c.a < 0.45' : 'false'}) discard; gl_FragColor = vec4(c.rgb * tint * ${vc ? 'vC' : 'vec3(1.0)'}, 1.0); }`,
    side: THREE.DoubleSide,
  });
  const nrmMat = (map, alpha) => new THREE.ShaderMaterial({
    uniforms: { map: { value: map } },
    vertexShader: 'varying vec2 vUv; varying vec3 vN; void main(){ vUv = uv; vN = normalize(normal); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `uniform sampler2D map; varying vec2 vUv; varying vec3 vN; void main(){ vec4 c = texture2D(map, vUv); if (${alpha ? 'c.a < 0.45' : 'false'}) discard; gl_FragColor = vec4(normalize(vN) * 0.5 + 0.5, 1.0); }`,
    side: THREE.DoubleSide,
  });
  const infos = [];
  variants.forEach((v, i) => {
    scene.clear();
    const wood = new THREE.Mesh(v.tree.wood, colMat(v.barkMap, true, false));
    wood.material.uniforms.tint.value.copy(v.barkTint);
    const leaves = v.tree.leaves ? new THREE.Mesh(v.tree.leaves, colMat(v.leafMap, false, true)) : null;
    if (leaves) leaves.material.uniforms.tint.value.setScalar(0.88);
    scene.add(wood); if (leaves) scene.add(leaves);
    const box = new THREE.Box3().setFromObject(scene);
    const hw = Math.max(Math.abs(box.min.x), Math.abs(box.max.x), Math.abs(box.min.z), Math.abs(box.max.z)) * 1.02;
    const h = box.max.y * 1.02;
    const w2 = Math.max(hw, h / 4);
    cam.left = -w2; cam.right = w2; cam.bottom = 0; cam.top = w2 * 4;
    cam.position.set(0, 0, 100); cam.lookAt(0, 0, 0); cam.updateProjectionMatrix();
    infos.push({ w: w2 * 2, h: w2 * 4 });
    for (const [rt, pass] of [[rtC, 0], [rtN, 1]]) {
      if (pass === 1) { wood.material = nrmMat(v.barkMap, false); if (leaves) leaves.material = nrmMat(v.leafMap, true); }
      if (i === 0) {
        rt.viewport.set(0, 0, W, H); rt.scissor.set(0, 0, W, H); rt.scissorTest = false;
        renderer.setRenderTarget(rt);
        renderer.clear();
      }
      rt.viewport.set(i * cellW, 0, cellW, cellH);
      rt.scissor.set(i * cellW, 0, cellW, cellH);
      rt.scissorTest = true;
      renderer.setRenderTarget(rt);
      renderer.render(scene, cam);
      rt.scissorTest = false;
      rt.viewport.set(0, 0, W, H); rt.scissor.set(0, 0, W, H);
    }
  });
  renderer.setRenderTarget(prevRT);
  renderer.setClearColor(prevClear, prevA);
  return { tC: rtC.texture, tN: rtN.texture, infos, cols, rtC, rtN };
}

function impostorMesh(imp, instances) {
  const g = new THREE.InstancedBufferGeometry();
  const base = new THREE.PlaneGeometry(1, 1, 1, 1);
  base.translate(0, 0.5, 0);
  g.index = base.index;
  g.setAttribute('position', base.attributes.position);
  g.setAttribute('uv', base.attributes.uv);
  const n = instances.length;
  const iPos = new Float32Array(n * 3), iSc = new Float32Array(n * 3);
  instances.forEach((t, i) => {
    iPos.set([t.x, t.y, t.z], i * 3);
    const info = imp.infos[t.v];
    iSc.set([info.w * t.s, info.h * t.s, t.v + t.rot / 6.2832 * 0.0 + (t.rot % 6.2832) / 1000.0 * 0.0], i * 3);
    iSc[i * 3 + 2] = t.v;
  });
  g.setAttribute('iPos', new THREE.InstancedBufferAttribute(iPos, 3));
  g.setAttribute('iSc', new THREE.InstancedBufferAttribute(iSc, 3));
  g.instanceCount = n;
  const mat = new THREE.ShaderMaterial({
    uniforms: Object.assign({}, U, { tC: { value: imp.tC }, tN: { value: imp.tN }, uCols: { value: imp.cols }, uNear: { value: 80 } }),
    vertexShader: GLSL_COMMON + /* glsl */`
      attribute vec3 iPos; attribute vec3 iSc;
      uniform float uCols;
      varying vec2 vUv; varying vec3 vW; varying float vAng; varying float vCell;
      void main() {
        vec3 toC = cameraPosition - iPos; toC.y = 0.0;
        vec3 f = normalize(toC + vec3(1e-4));
        vec3 r = vec3(f.z, 0.0, -f.x);
        float sway = sin(uTime * 1.3 + iPos.x * 0.3) * uWind.z * 0.05 * position.y;
        vec3 p = iPos + r * (position.x * iSc.x + sway) + vec3(0.0, position.y * iSc.y, 0.0);
        vW = p;
        vAng = atan(f.x, f.z);
        vCell = iSc.z;
        vUv = vec2((uv.x + iSc.z) / uCols, uv.y);
        gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
      }`,
    fragmentShader: GLSL_COMMON + GLSL_FOG + DITHER + /* glsl */`
      uniform sampler2D tC; uniform sampler2D tN; uniform float uNear;
      varying vec2 vUv; varying vec3 vW; varying float vAng; varying float vCell;
      void main() {
        float dd = length(vW - cameraPosition);
        if ((dd - uNear) / 12.0 < bayer4(gl_FragCoord.xy)) discard;
        vec4 c = texture2D(tC, vUv);
        // coverage thins out in the small mips: lower the cut with distance so far canopies stay full
        if (c.a < mix(0.45, 0.16, smoothstep(120.0, 700.0, dd))) discard;
        vec3 alb = c.rgb / max(c.a, 1e-3);
        vec4 nt = texture2D(tN, vUv); vec3 n = nt.xyz / max(nt.a, 1e-3) * 2.0 - 1.0;
        float ca = cos(vAng), sa = sin(vAng);
        n = normalize(vec3(n.x * ca + n.z * sa, n.y, -n.x * sa + n.z * ca));
        float dif = max(dot(n, uKeyDir), 0.0) * 0.8 + 0.2 * max(uKeyDir.y, 0.0);
        vec3 col = alb * (uAmbCol * (0.8 + 0.4 * n.y) * 1.9 + uKeyCol * dif * 1.0) * (0.75 + 0.3 * vUv.y);
        col += alb * uFlash * 0.4;
        col = applyFog(col, vW);
        gl_FragColor = vec4(col, 1.0);
      }`,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(g, mat);
  mesh.frustumCulled = false;
  mesh.name = 'impostors';
  return mesh;
}

export function buildForest(world) {
  const scene = world.scene;
  const rand = mulberry32(4242);
  const P = {};
  const groundFn = (x, z) => terrainH(x, z);
  // ---------- hero & bank trees (full geometry, world space) --------------------
  const heroMatW = barkMat('ahuehuete');
  const heroMatL = leafMat('f_ahue', { transl: 0.5 });
  const henoMat = leafMat('f_heno', { alphaTest: 0.5, transl: 0.3, color: 0x8a8f80 });
  const cazaW = barkMat('cazahuate'), cazaL = leafMat('f_caza', { transl: 0.7, color: 0xd8d4cc });
  const amateW = barkMat('amate'), amateL = leafMat('f_amate', { transl: 0.45 });
  const oakW = barkMat('encino', 90), oakL = leafMat('f_oak', { transl: 0.4, far: 90 });
  const pineW = barkMat('pino', 90), pineL = leafMat('f_pine', { transl: 0.35, far: 90 });
  const canopies = [];
  world.canopies = canopies;
  const addTree = (kind, u, d, opts = {}) => {
    toWorld(u, d, P);
    const y = terrainH(P.x, P.z, u);
    const f = frame(u);
    let lean = null;
    if (opts.lean) lean = new THREE.Vector3(-Math.sign(d) * f.nx, 0, -Math.sign(d) * f.nz).multiplyScalar(opts.lean);
    const t = generateTree(kind, { seed: opts.seed || Math.floor(rand() * 1e6), origin: new THREE.Vector3(P.x, y - 0.25, P.z), lean, scale: opts.scale || 1, groundFn });
    const mw = kind === 'ahuehuete' ? heroMatW : kind === 'cazahuate' ? cazaW : kind === 'amate' ? amateW : oakW;
    const ml = kind === 'ahuehuete' ? heroMatL : kind === 'cazahuate' ? cazaL : kind === 'amate' ? amateL : oakL;
    const wood = new THREE.Mesh(t.wood, mw); wood.castShadow = true; wood.receiveShadow = true; wood.name = 'tree';
    scene.add(wood);
    if (t.leaves) { const lm = new THREE.Mesh(t.leaves, ml); lm.castShadow = true; lm.receiveShadow = true; lm.name = 'leaves'; scene.add(lm); }
    if (t.heno) { const hm = new THREE.Mesh(t.heno, henoMat); hm.castShadow = true; hm.name = 'heno'; scene.add(hm); }
    canopies.push({ x: t.crown.x, y: t.crown.y, z: t.crown.z, r: t.crownR + 1.0, kind, trunk: { x: P.x, z: P.z, r: t.trunkRad * 1.6 } });
    world.blockers.push({ x: P.x, z: P.z, r: Math.max(2, t.trunkRad * 2.5) });
    if (Math.abs(d) < halfW(u) + 3) world.obstacles.push({ x: P.x, z: P.z, r: t.trunkRad * 1.3, kind: 'trunk', sub: 0.3 });
    return t;
  };
  // instanced variants for the many small riverside trees
  const instKinds = {};
  const mkVar = (kind, n, sc) => { instKinds[kind] = { vars: Array.from({ length: n }, (_, i) => generateTree(kind, { seed: 5000 + i * 77 + kind.length * 13, scale: sc, lod: 0.75 })), list: Array.from({ length: n }, () => []) }; };
  mkVar('cazahuate', 4, 1.0);
  mkVar('encino', 4, 1.0);
  const addInst = (kind, u, d, scale) => {
    toWorld(u, d, P);
    const y = terrainH(P.x, P.z, u);
    const K = instKinds[kind];
    const vi = Math.floor(rand() * K.vars.length);
    const t = K.vars[vi];
    const rot = rand() * 6.28;
    K.list[vi].push({ x: P.x, y: y - 0.2, z: P.z, s: scale, rot });
    const c = t.crown.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), rot).multiplyScalar(scale);
    canopies.push({ x: P.x + c.x, y: y + c.y, z: P.z + c.z, r: t.crownR * scale + 1.0, kind, trunk: { x: P.x, z: P.z, r: t.trunkRad * 1.6 * scale } });
    world.blockers.push({ x: P.x, z: P.z, r: Math.max(2, t.trunkRad * 2.5 * scale) });
    if (Math.abs(d) < halfW(u) + 3) world.obstacles.push({ x: P.x, z: P.z, r: t.trunkRad * 1.3 * scale, kind: 'trunk', sub: 0.3 });
  };
  const heroes = [
    [58, 19.8, 0.45, 1.05], [176, -20.2, 0.5, 1.0], [214, 20.8, 0.2, 0.9], [296, 41, 0, 1.2], [301, -21.5, 0.45, 0.95],
    [396, 17.4, 0.5, 1.0], [520, -16.2, 0.4, 0.9], [612, 15.2, 0.4, 0.85], [760, -12.5, 0.3, 0.8], [905, 10.6, 0.35, 0.75],
  ];
  world.heroTrunks = [];
  for (const [u, d, lean, sc] of heroes) { const t = addTree('ahuehuete', u, d, { lean, scale: sc }); toWorld(u, d, P); world.heroTrunks.push({ x: P.x, z: P.z, u, d, r: t.trunkRad }); }
  // cazahuates in bloom scattered near the river, capilla and panteon
  const cazas = [[118, -40], [140, -27], [96, 27], [150, 24], [205, -31], [255, 27], [320, -30], [352, 28], [440, 38], [466, 78], [486, 50], [560, -28], [590, 24], [640, -24], [700, 18]];
  for (const [u, d] of cazas) addInst('cazahuate', u, d, 0.9 + rand() * 0.4);
  for (let k = 0; k < 40; k++) {
    const u = -100 + rand() * 800, side = rand() < 0.5 ? -1 : 1;
    const d = side * (halfW(u) + 10 + rand() * 60);
    toWorld(u, d, P);
    if (world.isBlocked(P.x, P.z, 4) || fieldAt(u, d)) continue;
    addInst('cazahuate', u, d, 0.8 + rand() * 0.4);
  }
  // amates gripping rocks in the gorge
  for (const [u, d] of [[720, 11.5], [798, -10.5], [856, 9.8], [940, -9.4], [1010, 8.8], [1060, -8.6], [1105, 9.2]]) addTree('amate', u, d, { scale: 0.9, lean: 0.25 });
  // riverside oaks
  for (let u = -120; u < 1100; u += 11) {
    for (const side of [-1, 1]) {
      if (rand() > 0.28) continue;
      const d = side * (halfW(u) + 4 + rand() * 12);
      toWorld(u, d, P);
      if (world.isBlocked(P.x, P.z, 5) || fieldAt(u, d)) continue;
      addInst('encino', u, d, 0.75 + rand() * 0.4);
    }
  }
  {
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sv = new THREE.Vector3(), tv = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    for (const kind of Object.keys(instKinds)) {
      const K = instKinds[kind];
      const mw = kind === 'cazahuate' ? cazaW : barkMat('encino'), ml = kind === 'cazahuate' ? cazaL : leafMat('f_oak', { transl: 0.4 });
      K.vars.forEach((t, vi) => {
        const L2 = K.list[vi];
        if (!L2.length) return;
        const w = new THREE.InstancedMesh(t.wood, mw, L2.length), l = new THREE.InstancedMesh(t.leaves, ml, L2.length);
        L2.forEach((it, k) => { q.setFromAxisAngle(up, it.rot); sv.setScalar(it.s); tv.set(it.x, it.y, it.z); m4.compose(tv, q, sv); w.setMatrixAt(k, m4); l.setMatrixAt(k, m4); });
        for (const m of [w, l]) { m.castShadow = true; m.receiveShadow = true; m.computeBoundingSphere(); m.name = 'trees_' + kind; scene.add(m); }
      });
    }
  }
  // ---------- forest (instanced near + impostor far) -------------------------------
  const variants = [];
  const mk = (kind, seed, sc) => {
    const t = generateTree(kind, { seed, scale: sc, lod: 0.6 });
    variants.push({ kind, tree: t, barkMap: tex(kind === 'pino' ? 'bark_c' : 'barksm_c'), barkTint: new THREE.Color(kind === 'pino' ? 0xf0e4dc : 0xe6e0d8), leafMap: tex(kind === 'pino' ? 'f_pine' : 'f_oak') });
  };
  mk('pino', 11, 1.0); mk('pino', 12, 0.85); mk('pino', 13, 1.1);
  mk('encino', 21, 1.0); mk('encino', 22, 0.9); mk('encino', 23, 1.15);
  const imp = captureImpostors(world.r, variants);
  const inst = [];
  const step = 3.9;
  for (let u = R.U_MIN - 200; u < R.U_MAX + 150; u += step) {
    for (let d = -700; d <= 700; d += step) {
      const uu = u + (rand() - 0.5) * step, dd = d + (rand() - 0.5) * step;
      if (Math.abs(dd) < halfW(uu) + 20) continue;
      toWorld(uu, dd, P);
      const t = Math.min(1, Math.abs(dd) / 700);
      const x = P.x * (1 - t) + (-20 + dd) * t, z = P.z * (1 - t) + (-uu) * t;
      const h = terrainH(x, z);
      const m = forestMask(uu, dd, x, z, h);
      const dens = m * (0.72 + 0.28 * smoothstep(0.0, 0.5, fbm2(x * 0.015, z * 0.015, 3) + 0.35));
      if (rand() > dens) continue;
      if (world.isBlocked(x, z, 3)) continue;
      const pine = h > 85 + fbm2(x * 0.01, z * 0.01, 2) * 40 ? rand() < 0.8 : rand() < 0.14;
      const v = pine ? Math.floor(rand() * 3) : 3 + Math.floor(rand() * 3);
      inst.push({ x, y: h - 0.3, z, s: (pine ? 0.8 : 0.95) + rand() * 0.6, rot: rand() * 6.28, v });
    }
  }
  const impMesh = impostorMesh(imp, inst);
  scene.add(impMesh);
  // near instanced meshes per variant
  const near = variants.map((v, i) => {
    const mw = v.kind === 'pino' ? pineW : oakW, ml = v.kind === 'pino' ? pineL : oakL;
    const cap = 700;
    const w = new THREE.InstancedMesh(v.tree.wood, mw, cap); w.count = 0; w.castShadow = true; w.receiveShadow = true; w.frustumCulled = false; w.name = 'forestW';
    const l = new THREE.InstancedMesh(v.tree.leaves, ml, cap); l.count = 0; l.castShadow = true; l.receiveShadow = true; l.frustumCulled = false; l.name = 'forestL';
    scene.add(w, l);
    return { w, l, cap };
  });
  // spatial buckets
  const B = 60;
  const buckets = new Map();
  inst.forEach((t) => {
    const k = Math.floor(t.x / B) + ',' + Math.floor(t.z / B);
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k).push(t);
  });
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sv = new THREE.Vector3(), tv = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  let timer = 0;
  const lastC = new THREE.Vector3(1e9, 0, 0);
  const refresh = (cp) => {
    const cnt = near.map(() => 0);
    const R2 = 104 * 104;
    const bx = Math.floor(cp.x / B), bz = Math.floor(cp.z / B);
    for (let i = -2; i <= 2; i++) for (let j = -2; j <= 2; j++) {
      const list = buckets.get((bx + i) + ',' + (bz + j));
      if (!list) continue;
      for (const t of list) {
        const dx = t.x - cp.x, dz = t.z - cp.z;
        if (dx * dx + dz * dz > R2) continue;
        const n = near[t.v];
        if (cnt[t.v] >= n.cap) continue;
        q.setFromAxisAngle(up, t.rot); sv.setScalar(t.s); tv.set(t.x, t.y, t.z);
        m4.compose(tv, q, sv);
        n.w.setMatrixAt(cnt[t.v], m4); n.l.setMatrixAt(cnt[t.v], m4);
        cnt[t.v]++;
      }
    }
    near.forEach((n, i) => { n.w.count = cnt[i]; n.l.count = cnt[i]; n.w.instanceMatrix.needsUpdate = true; n.l.instanceMatrix.needsUpdate = true; });
  };
  world.updaters.push((dt) => {
    timer -= dt;
    const cp = world.cam.position;
    if (timer <= 0 || cp.distanceTo(lastC) > 12) { timer = 0.5; lastC.copy(cp); refresh(cp); }
  });
  world.forestInst = inst;
  return { impMesh, variants, imp };
}
