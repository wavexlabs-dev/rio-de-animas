import * as THREE from 'three';
import { U, GLSL_COMMON, GLSL_FOG, std } from './materials.js';
import { tex } from './textures.js';
import { mulberry32, lerp, clamp, smoothstep, simplex2 } from './noise.js';
import { R, toWorld, toUD, halfW, frame, flowAt, terrainH } from './river.js';
import { L } from './layout.js';

function instGeo(base, attrs, count) {
  const g = new THREE.InstancedBufferGeometry();
  g.index = base.index;
  for (const k of Object.keys(base.attributes)) g.setAttribute(k, base.attributes[k]);
  for (const [k, arr, sz] of attrs) g.setAttribute(k, new THREE.InstancedBufferAttribute(arr, sz));
  g.instanceCount = count;
  return g;
}

function wingGeo() {
  // two wings hinged on the local Z axis; attribute side = -1 / +1
  const pos = [], uv = [], side = [], idx = [];
  for (const s of [1, -1]) {
    const b = pos.length / 3;
    pos.push(0, 0, -0.5, s * 1, 0, -0.5, 0, 0, 0.5, s * 1, 0, 0.5);
    uv.push(0, 0, 1, 0, 0, 1, 1, 1);
    side.push(s, s, s, s);
    idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('aSide', new THREE.Float32BufferAttribute(side, 1));
  g.setIndex(idx);
  return g;
}

// ------------------------------------------------------------------ monarchs (GPU)
export function monarchs(world) {
  const N = 110;
  const A = new Float32Array(N * 4), S = new Float32Array(N * 4);
  const r = mulberry32(61);
  const P = {};
  for (let i = 0; i < N; i++) {
    const u = 20 + r() * 700, side = r() < 0.5 ? -1 : 1;
    const d = side * (halfW(u) * (r() < 0.25 ? r() : 1) + r() * 25);
    toWorld(u, d, P);
    const h = Math.max(0, terrainH(P.x, P.z));
    A.set([P.x, h + 1.2 + r() * 2.5, P.z, 2 + r() * 7], i * 4);
    S.set([r(), r(), r(), r()], i * 4);
  }
  const g = instGeo(wingGeo(), [['iA', A, 4], ['iS', S, 4]], N);
  const m = new THREE.ShaderMaterial({
    uniforms: Object.assign({}, U, { tW: { value: tex('f_monarch') }, uAmt: { value: 1 } }),
    vertexShader: GLSL_COMMON + /* glsl */`
      attribute vec4 iA; attribute vec4 iS; attribute float aSide; uniform float uAmt;
      varying vec2 vUv; varying vec3 vW; varying vec3 vN; varying float vA;
      vec3 path(float t) {
        return iA.xyz + vec3(sin(t * 0.31 + iS.x * 6.0) * iA.w + sin(t * 0.83 + iS.y * 4.0) * 1.2, sin(t * 0.47 + iS.z * 5.0) * 0.8 + sin(t * 1.3) * 0.25, cos(t * 0.27 + iS.y * 6.0) * iA.w + cos(t * 0.71 + iS.x * 3.0) * 1.2) + vec3(uWind.x, 0.0, uWind.y) * sin(t * 0.1) * 2.0;
      }
      void main() {
        float t = uTime * (0.8 + iS.w * 0.5) + iS.x * 100.0;
        vec3 p = path(t);
        vec3 v = normalize(path(t + 0.05) - p + vec3(1e-4));
        vec3 f = normalize(vec3(v.x, v.y * 0.3, v.z));
        vec3 rt = normalize(cross(vec3(0.0, 1.0, 0.0), f));
        vec3 up = cross(f, rt);
        float flap = sin(uTime * (11.0 + iS.z * 5.0) + iS.y * 20.0);
        float glide = smoothstep(0.6, 0.9, sin(uTime * 0.7 + iS.x * 30.0));
        float ang = mix(flap * 1.1, 0.25, glide) * aSide;
        float ca = cos(ang), sa = sin(ang);
        vec3 lp = vec3(position.x * ca, abs(position.x) * sa * aSide, position.z);
        float sz = 0.09;
        vec3 wp = p + (rt * lp.x + up * lp.y + f * -lp.z) * sz;
        vN = normalize(up * ca - rt * sa * aSide);
        vW = wp;
        vUv = vec2(uv.x, 1.0 - uv.y);
        float dc = distance(p, cameraPosition);
        vA = uAmt * (1.0 - smoothstep(60.0, 90.0, dc));
        gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
        if (vA < 0.01) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      }`,
    fragmentShader: GLSL_COMMON + GLSL_FOG + /* glsl */`
      uniform sampler2D tW; varying vec2 vUv; varying vec3 vW; varying vec3 vN; varying float vA;
      void main() {
        vec4 c = texture2D(tW, vUv);
        if (c.a < 0.5) discard;
        vec3 V = normalize(cameraPosition - vW);
        float dif = abs(dot(normalize(vN), uKeyDir)) * 0.7 + 0.3;
        float back = pow(max(dot(-V, uKeyDir), 0.0), 3.0);
        vec3 col = c.rgb * (uAmbCol * 1.3 + uKeyCol * dif * 0.8 + uKeyCol * back * 1.2);
        gl_FragColor = vec4(applyFog(col, vW), 1.0);
      }`,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(g, m);
  mesh.frustumCulled = false;
  mesh.layers.set(5);
  mesh.name = 'monarchs';
  world.scene.add(mesh);
  world.updaters.push(() => { m.uniforms.uAmt.value = (1 - world.tod.night) * (1 - world.tod.rain); });
}

// ------------------------------------------------------------------ animas (CPU, night)
export class Animas {
  constructor(world) {
    this.w = world;
    this.N = 18;
    this.TR = 30;
    this.hist = [];
    this.histT = 0;
    this.items = [];
    const r = this.r = mulberry32(71);
    for (let i = 0; i < this.N; i++) {
      this.items.push({ p: new THREE.Vector3(0, -99, 0), v: new THREE.Vector3(), trail: [], seed: r() * 100, idx: 2 + Math.floor(r() * 12), off: new THREE.Vector3(r() - 0.5, r(), r() - 0.5), a: 0, t: 0 });
    }
    // sprite geometry: monarch wings + halo; trails: ribbon
    this.P = new Float32Array(this.N * 4);
    this.g = instGeo(wingGeo(), [['iP', this.P, 4]], this.N);
    this.mat = new THREE.ShaderMaterial({
      uniforms: Object.assign({}, U, { tW: { value: tex('f_monarch') } }),
      vertexShader: GLSL_COMMON + /* glsl */`
        attribute vec4 iP; attribute float aSide; varying vec2 vUv; varying float vA;
        void main() {
          vec3 toC = normalize(cameraPosition - iP.xyz);
          vec3 rt = normalize(cross(vec3(0.0, 1.0, 0.0), toC)); vec3 up = cross(toC, rt);
          float flap = sin(uTime * 7.0 + iP.x * 3.0) * 0.7;
          float sq = cos(flap);
          vec3 wp = iP.xyz + (rt * position.x * sq + up * position.z * -1.0) * 0.42;
          vUv = vec2(abs(position.x), 0.5 - position.z); vA = iP.w;
          gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
          if (vA < 0.01) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
        }`,
      fragmentShader: /* glsl */`
        uniform sampler2D tW; varying vec2 vUv; varying float vA;
        void main() {
          vec4 c = texture2D(tW, vUv);
          float m = smoothstep(0.3, 0.6, c.a);
          vec3 gold = mix(vec3(1.0, 0.42, 0.08), vec3(1.0, 0.72, 0.3), c.r);
          gl_FragColor = vec4(gold * (m * 2.6) * vA, 1.0);
        }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(this.g, this.mat);
    mesh.frustumCulled = false; mesh.layers.set(2); mesh.name = 'animas'; mesh.renderOrder = 10;
    world.scene.add(mesh);
    // halos
    this.hg = instGeo(new THREE.PlaneGeometry(1, 1), [['iP', this.P, 4]], this.N);
    const hm = new THREE.ShaderMaterial({
      uniforms: Object.assign({}, U),
      vertexShader: GLSL_COMMON + /* glsl */`
        attribute vec4 iP; varying vec2 vUv; varying float vA;
        void main() { vec3 toC = normalize(cameraPosition - iP.xyz); vec3 rt = normalize(cross(vec3(0.0,1.0,0.0), toC)); vec3 up = cross(toC, rt);
          vec3 wp = iP.xyz + (rt * position.x + up * position.y) * 1.8; vUv = uv; vA = iP.w; gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0); if (vA < 0.01) gl_Position = vec4(2.0); }`,
      fragmentShader: `varying vec2 vUv; varying float vA; void main(){ float r = length(vUv - 0.5) * 2.0; float a = exp(-r * r * 4.5) * 0.3 + exp(-r * r * 26.0) * 0.45; gl_FragColor = vec4(vec3(1.0, 0.5, 0.14) * a * vA * 1.6, 1.0); }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    const hmesh = new THREE.Mesh(this.hg, hm); hmesh.frustumCulled = false; hmesh.layers.set(2); hmesh.renderOrder = 10; world.scene.add(hmesh);
    // trails
    const tpos = new Float32Array(this.N * this.TR * 2 * 3), talpha = new Float32Array(this.N * this.TR * 2);
    const tidx = [];
    for (let i = 0; i < this.N; i++) for (let k = 0; k < this.TR - 1; k++) {
      const a = (i * this.TR + k) * 2;
      tidx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    this.tg = new THREE.BufferGeometry();
    this.tg.setAttribute('position', new THREE.BufferAttribute(tpos, 3));
    this.tg.setAttribute('aA', new THREE.BufferAttribute(talpha, 1));
    this.tg.setIndex(tidx);
    const tm = new THREE.ShaderMaterial({
      vertexShader: 'attribute float aA; varying float vA; void main(){ vA = aA; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: 'varying float vA; void main(){ gl_FragColor = vec4(vec3(1.0, 0.6, 0.22) * vA * 2.4, 1.0); }',
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    });
    const tmesh = new THREE.Mesh(this.tg, tm); tmesh.frustumCulled = false; tmesh.layers.set(2); tmesh.renderOrder = 9; world.scene.add(tmesh);
    world.glowSources.push((list, cp) => {
      for (const it of this.items) if (it.a > 0.05) list.push({ x: it.p.x, y: it.p.y, z: it.p.z, r: 8, cr: 1.6 * it.a, cg: 0.95 * it.a, cb: 0.4 * it.a, w: 20 / (1 + cp.distanceTo(it.p) * 0.1) });
    });
    this.graves = world.graves || [];
  }
  update(dt, time) {
    const w = this.w, b = w.boat;
    this.histT += dt;
    if (this.histT > 0.6 || !this.hist.length) { this.histT = 0; this.hist.unshift(b.world_(new THREE.Vector3(0, 0, -5))); if (this.hist.length > 120) this.hist.pop(); }
    const night = smoothstep(0.55, 0.85, w.tod.night) * (1 - w.tod.rain);
    const cam = w.cam.position;
    const toC = new THREE.Vector3();
    for (let i = 0; i < this.N; i++) {
      const it = this.items[i];
      const on = night > 0.01;
      if (on && it.p.y < -50) {
        // born at the panteon, or near the river if the panteon is far
        const g = this.graves[Math.floor(this.r() * this.graves.length)];
        if (g && g.pos.distanceTo(b.pos) < 260) it.p.copy(g.pos).add(new THREE.Vector3(0, 0.5, 0));
        else it.p.copy(b.pos).add(new THREE.Vector3((this.r() - 0.5) * 40, 3 + this.r() * 4, (this.r() - 0.5) * 40));
        it.v.set(0, 0, 0); it.trail.length = 0; it.t = 0;
      }
      if (!on) { it.a = Math.max(0, it.a - dt * 0.4); if (it.a <= 0) it.p.y = -99; }
      else it.a = Math.min(night, it.a + dt * 0.25);
      if (it.p.y < -50) continue;
      it.t += dt;
      const h = i % 2 === 0 ? b.world_(new THREE.Vector3(Math.sin(it.seed) * 3.5, 0, 4 + (it.seed % 1) * 16 + Math.sin(time * 0.05 + it.seed) * 4)) : (this.hist[Math.min(this.hist.length - 1, it.idx)] || b.pos);
      const s = it.seed;
      const tgt = h.clone().add(new THREE.Vector3(Math.sin(time * 0.37 + s) * 2.5 + it.off.x * 3, 1.3 + it.off.y * 2.2 + Math.sin(time * 0.6 + s * 2) * 0.5, Math.cos(time * 0.29 + s) * 2.5 + it.off.z * 3));
      const acc = tgt.sub(it.p).multiplyScalar(0.6).addScaledVector(it.v, -0.9);
      it.v.addScaledVector(acc, dt);
      const sp = it.v.length();
      if (sp > 5) it.v.multiplyScalar(5 / sp);
      it.p.addScaledVector(it.v, dt);
      if (it.p.y < 0.6) it.p.y = 0.6;
      it.trail.unshift(it.p.clone());
      if (it.trail.length > this.TR) it.trail.pop();
      if (this.r() < dt * 0.02) it.idx = 2 + Math.floor(this.r() * 14);
    }
    const P = this.P;
    const tp = this.tg.attributes.position.array, ta = this.tg.attributes.aA.array;
    for (let i = 0; i < this.N; i++) {
      const it = this.items[i];
      P.set([it.p.x, it.p.y, it.p.z, it.a], i * 4);
      for (let k = 0; k < this.TR; k++) {
        const q = it.trail[Math.min(k, it.trail.length - 1)] || it.p;
        const q2 = it.trail[Math.min(k + 1, it.trail.length - 1)] || q;
        toC.subVectors(cam, q).normalize();
        const dir = new THREE.Vector3().subVectors(q2, q);
        const side = new THREE.Vector3().crossVectors(dir.lengthSq() > 1e-8 ? dir.normalize() : new THREE.Vector3(1, 0, 0), toC).normalize().multiplyScalar(0.05 * (1 - k / this.TR));
        const o = (i * this.TR + k) * 2;
        tp[o * 3] = q.x + side.x; tp[o * 3 + 1] = q.y + side.y; tp[o * 3 + 2] = q.z + side.z;
        tp[o * 3 + 3] = q.x - side.x; tp[o * 3 + 4] = q.y - side.y; tp[o * 3 + 5] = q.z - side.z;
        const al = it.a * Math.pow(1 - k / this.TR, 1.5) * (it.trail.length > k ? 1 : 0);
        ta[o] = al; ta[o + 1] = al;
      }
    }
    this.g.attributes.iP.needsUpdate = true;
    this.hg.attributes.iP.needsUpdate = true;
    this.tg.attributes.position.needsUpdate = true;
    this.tg.attributes.aA.needsUpdate = true;
  }
}

// ------------------------------------------------------------------ floating candle rafts
export class CandleRafts {
  constructor(world) {
    this.w = world;
    this.N = 28;
    const r = this.r = mulberry32(81);
    const raftG = [];
    const tule = new THREE.CylinderGeometry(0.035, 0.035, 0.34, 7);
    tule.rotateZ(Math.PI / 2);
    this.items = [];
    const tuleMat = std({ color: 0x9a9a52, roughness: 0.8 }, { key: 'tule' });
    const waxMat = std({ color: 0xf0e6d0, roughness: 0.5, emissive: 0xff9a40, emissiveIntensity: 0.3 }, { key: 'wax2' });
    const flMat = world.flowerMat || std({ map: tex('f_cempa'), alphaTest: 0.45, side: THREE.DoubleSide }, { key: 'rflower' });
    const fg = new THREE.PlaneGeometry(0.11, 0.11);
    const uv = fg.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 0.5, 0.5 + uv.getY(i) * 0.5);
    for (let i = 0; i < this.N; i++) {
      const g = new THREE.Group();
      for (const z of [-0.04, 0.04]) { const t = new THREE.Mesh(tule, tuleMat); t.position.set(0, 0.02, z); g.add(t); }
      const c = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.022, 0.09, 8), waxMat); c.position.y = 0.09; g.add(c);
      for (let k = 0; k < 4; k++) { const f = new THREE.Mesh(fg, flMat); f.rotation.x = -Math.PI / 2 + (r() - 0.5) * 0.4; f.position.set(-0.12 + k * 0.08, 0.06, (r() - 0.5) * 0.06); g.add(f); }
      g.visible = false;
      world.scene.add(g);
      this.items.push({ g, u: 0, d: 0, alive: false, lat: 0 });
    }
    // flames sprites
    this.P = new Float32Array(this.N * 4);
    this.fg = instGeo(new THREE.PlaneGeometry(1, 1), [['iP', this.P, 4]], this.N);
    const fm = new THREE.ShaderMaterial({
      uniforms: Object.assign({}, U),
      vertexShader: GLSL_COMMON + /* glsl */`
        attribute vec4 iP; varying vec2 vUv; varying float vA;
        void main() { vec3 toC = normalize(cameraPosition - iP.xyz); vec3 rt = normalize(cross(vec3(0.0,1.0,0.0), toC));
          float fl = 0.85 + 0.15 * sin(uTime * 11.0 + iP.x * 7.0);
          vec4 mv = viewMatrix * vec4(iP.xyz + rt * position.x * 0.05 + vec3(0.0, (position.y + 0.5) * 0.11 * fl, 0.0), 1.0);
          mv.xy += position.xy * clamp(-mv.z * 0.002, 0.0, 0.2);
          vUv = uv; vA = iP.w; gl_Position = projectionMatrix * mv; if (vA < 0.01) gl_Position = vec4(2.0); }`,
      fragmentShader: `varying vec2 vUv; varying float vA; void main(){ vec2 q = vUv - vec2(0.5, 0.35); q.x *= 2.2; float d = length(q); float a = exp(-d*d*28.0) * 6.0 + exp(-d*d*5.0) * 0.8; gl_FragColor = vec4(mix(vec3(1.0,0.45,0.1), vec3(1.0,0.9,0.6), exp(-d*d*40.0)) * a * vA, 1.0); }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    const fmesh = new THREE.Mesh(this.fg, fm); fmesh.frustumCulled = false; fmesh.layers.set(2); fmesh.renderOrder = 10; world.scene.add(fmesh);
    world.glowSources.push((list, cp) => {
      for (const it of this.items) if (it.alive && it.on > 0.05) { const p = it.g.position; list.push({ x: p.x, y: p.y + 0.25, z: p.z, r: 5, cr: 1.3 * it.on, cg: 0.75 * it.on, cb: 0.3 * it.on, w: 12 / (1 + cp.distanceTo(p) * 0.15) }); }
    });
  }
  update(dt, time) {
    const w = this.w, b = w.boat;
    const night = smoothstep(0.5, 0.8, w.tod.night) * (1 - w.tod.rain);
    const fl = {}, P = {};
    const tmp = {};
    for (let i = 0; i < this.N; i++) {
      const it = this.items[i];
      if (!it.alive) {
        if (night > 0.05 && this.r() < dt * 0.5) {
          it.u = b.u + 30 + this.r() * 170;
          it.d = (this.r() - 0.5) * 1.3 * halfW(it.u);
          it.alive = true; it.on = 0; it.lat = 0;
          it.g.rotation.y = this.r() * 6.28;
        } else { it.g.visible = false; this.P[i * 4 + 3] = 0; continue; }
      }
      const wd = halfW(it.u);
      const t = Math.min(1, Math.abs(it.d) / wd);
      const vmax = lerp(0.85, 1.5, smoothstep(650, 950, it.u));
      it.u -= vmax * (1 - t * t * 0.9) * dt;
      // part around the boat
      toWorld(it.u, it.d, P);
      const rx = P.x - b.pos.x, rz = P.z - b.pos.z;
      const a = rx * b.fwd.x + rz * b.fwd.z;
      const lat = -rx * b.fwd.z + rz * b.fwd.x;
      if (Math.abs(a) < 8 && Math.abs(lat) < 2.4) {
        const push = (2.4 - Math.abs(lat)) * Math.sign(lat || 1) * (1 - Math.abs(a) / 8);
        it.lat += push * dt * 2.2;
      }
      it.lat *= Math.exp(-dt * 0.8);
      it.d += it.lat * dt * 3;
      it.d = clamp(it.d, -wd + 0.5, wd - 0.5);
      toWorld(it.u, it.d, P);
      it.g.position.set(P.x, 0.0 + Math.sin(time * 1.5 + i) * 0.01, P.z);
      it.g.rotation.y += dt * 0.1;
      it.g.visible = true;
      it.on = Math.min(night, (it.on || 0) + dt * 0.3);
      if (night < 0.02) it.on = Math.max(0, it.on - dt);
      if (it.u < b.u - 70 || (night < 0.02 && it.on <= 0)) { it.alive = false; it.g.visible = false; }
      this.P.set([P.x, 0.14, P.z, it.on], i * 4);
    }
    this.fg.attributes.iP.needsUpdate = true;
  }
}

// ------------------------------------------------------------------ birds
function birdGeo(span, bodyL, neck) {
  const pos = [], side = [], col = [];
  const tri = (a, b, c, s) => { pos.push(...a, ...b, ...c); side.push(s, s, s); };
  // body (diamond)
  const L = bodyL, W = bodyL * 0.18;
  tri([0, 0, L * 0.6], [W, 0, 0], [0, W, 0], 0); tri([0, 0, L * 0.6], [0, W, 0], [-W, 0, 0], 0);
  tri([0, 0, -L * 0.5], [0, W, 0], [W, 0, 0], 0); tri([0, 0, -L * 0.5], [-W, 0, 0], [0, W, 0], 0);
  tri([0, 0, L * 0.6], [0, -W, 0], [W, 0, 0], 0); tri([0, 0, L * 0.6], [-W, 0, 0], [0, -W, 0], 0);
  if (neck) { tri([0, W * 0.5, L * 0.5], [0, W * 2.2, L * 0.9], [W * 0.5, W * 0.5, L * 0.6], 0); tri([0, W * 2.2, L * 0.9], [0, W * 1.9, L * 1.35], [W * 0.3, W * 2.0, L * 1.0], 0); }
  // tail
  tri([0, 0, -L * 0.45], [W * 1.6, 0, -L * 0.85], [-W * 1.6, 0, -L * 0.85], 0);
  // wings
  for (const s of [1, -1]) {
    tri([0, 0, L * 0.2], [s * span * 0.5, 0, -L * 0.05], [0, 0, -L * 0.2], s);
    tri([s * span * 0.5, 0, -L * 0.05], [s * span * 0.46, 0, -L * 0.25], [0, 0, -L * 0.2], s);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aSide', new THREE.Float32BufferAttribute(side, 1));
  g.computeVertexNormals();
  return g;
}

export class Birds {
  constructor(world) {
    this.w = world;
    const r = this.r = mulberry32(91);
    this.groups = [];
    const mk = (n, span, bodyL, neck, color, flapHz, name) => {
      const P = new Float32Array(n * 4), D = new Float32Array(n * 4);
      const g = instGeo(birdGeo(span, bodyL, neck), [['iP', P, 4], ['iD', D, 4]], n);
      const m = new THREE.ShaderMaterial({
        uniforms: Object.assign({}, U, { uCol: { value: new THREE.Color(color) }, uHz: { value: flapHz } }),
        vertexShader: GLSL_COMMON + /* glsl */`
          attribute vec4 iP; attribute vec4 iD; attribute float aSide; uniform float uHz;
          varying vec3 vN; varying vec3 vW;
          void main() {
            vec3 f = normalize(iD.xyz + vec3(0.0, 0.0, 1e-4));
            vec3 rt = normalize(cross(vec3(0.0, 1.0, 0.0), f)); vec3 up = cross(f, rt);
            float flap = sin(uTime * uHz * 6.2832 + iP.w * 10.0) * iD.w;
            vec3 lp = position;
            float a = flap * 0.9;
            if (abs(aSide) > 0.5) { float ax = abs(lp.x); lp.y += ax * sin(a); lp.x = sign(lp.x) * ax * cos(a); }
            vec3 wp = iP.xyz - rt * lp.x + up * lp.y + f * lp.z;
            vN = up; vW = wp;
            gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
          }`,
        fragmentShader: GLSL_COMMON + GLSL_FOG + /* glsl */`
          uniform vec3 uCol; varying vec3 vN; varying vec3 vW;
          void main() { float dif = abs(dot(normalize(vN), uKeyDir)) * 0.7 + 0.3; vec3 c = uCol * (uAmbCol * 1.2 + uKeyCol * dif * 0.8); gl_FragColor = vec4(applyFog(c, vW), 1.0); }`,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(g, m); mesh.frustumCulled = false; mesh.name = name;
      world.scene.add(mesh);
      const grp = { n, P, D, g, items: [] };
      for (let i = 0; i < n; i++) grp.items.push({ p: new THREE.Vector3(), v: new THREE.Vector3(r() - 0.5, 0, r() - 0.5), seed: r() * 100, off: new THREE.Vector3(r() - 0.5, r() - 0.5, r() - 0.5) });
      this.groups.push(grp);
      return grp;
    };
    this.zanates = mk(34, 0.42, 0.3, false, 0x0c0c12, 5.5, 'zanates');
    this.zopi = mk(6, 1.7, 0.6, false, 0x14110f, 0.6, 'zopilotes');
    this.egrets = mk(2, 1.45, 0.7, true, 0xf2f0ea, 2.2, 'egrets');
    this.egretT = 20;
    this.egretActive = false;
    this.flockC = new THREE.Vector3();
  }
  update(dt, time) {
    const w = this.w, b = w.boat;
    const day = 1 - w.tod.night;
    // zanates flock
    const Z = this.zanates;
    const c = b.pos.clone().addScaledVector(b.fwd, 45 + Math.sin(time * 0.05) * 25);
    c.x += Math.sin(time * 0.11) * 35; c.z += Math.cos(time * 0.09) * 35;
    c.y = 14 + Math.sin(time * 0.3) * 5;
    this.flockC.lerp(c, 1 - Math.exp(-dt * 0.5));
    Z.items.forEach((it, i) => {
      const tgt = this.flockC.clone().add(new THREE.Vector3(Math.sin(time * 0.7 + it.seed) * 9 + it.off.x * 10, Math.sin(time * 1.1 + it.seed * 2) * 3 + it.off.y * 4, Math.cos(time * 0.6 + it.seed) * 9 + it.off.z * 10));
      if (it.p.lengthSq() === 0) it.p.copy(tgt);
      const acc = tgt.sub(it.p).multiplyScalar(1.2).addScaledVector(it.v, -0.6);
      it.v.addScaledVector(acc, dt);
      const sp = it.v.length(); if (sp > 11) it.v.multiplyScalar(11 / sp); if (sp < 5) it.v.multiplyScalar(5 / Math.max(sp, 0.1));
      it.p.addScaledVector(it.v, dt);
      Z.P.set([it.p.x, it.p.y, it.p.z, it.seed], i * 4);
      const glide = Math.sin(time * 0.8 + it.seed) > 0.6 ? 0.15 : 1;
      Z.D.set([it.v.x, it.v.y * 0.3, it.v.z, day > 0.3 && w.tod.rain < 0.5 ? glide : 0.0], i * 4);
      if (day < 0.3 || w.tod.rain > 0.5) Z.P[i * 4 + 1] = -500;
    });
    // zopilotes soaring
    const ZP = this.zopi;
    const cc = b.pos.clone().addScaledVector(b.fwd, 140);
    ZP.items.forEach((it, i) => {
      const a = time * (0.12 + i * 0.013) + i * 1.05;
      const rad = 60 + i * 12;
      const p = new THREE.Vector3(cc.x + Math.cos(a) * rad, 80 + i * 9 + Math.sin(time * 0.2 + i) * 6, cc.z + Math.sin(a) * rad);
      if (it.p.lengthSq() === 0) it.p.copy(p);
      it.p.lerp(p, 1 - Math.exp(-dt * 0.3));
      ZP.P.set([it.p.x, day > 0.3 && w.tod.storm < 0.5 ? it.p.y : -500, it.p.z, it.seed], i * 4);
      ZP.D.set([-Math.sin(a), 0.0, Math.cos(a), 0.12], i * 4);
    });
    // egrets crossing ahead of the boat
    const E = this.egrets;
    this.egretT -= dt;
    if (!this.egretActive && this.egretT <= 0 && day > 0.4 && w.tod.rain < 0.3) {
      this.egretActive = true;
      const u = b.u + 45 + this.r() * 30;
      const side = this.r() < 0.5 ? -1 : 1;
      const f = frame(u);
      const w0 = halfW(u) + 20;
      this.eFrom = toWorld(u, side * w0); this.eTo = toWorld(u + 12, -side * w0);
      this.eFrom = new THREE.Vector3(this.eFrom.x, 7, this.eFrom.z); this.eTo = new THREE.Vector3(this.eTo.x, 9, this.eTo.z);
      this.eT = 0;
    }
    if (this.egretActive) {
      this.eT += dt;
      const dur = this.eFrom.distanceTo(this.eTo) / 6.5;
      const t = this.eT / dur;
      const dir = this.eTo.clone().sub(this.eFrom).normalize();
      E.items.forEach((it, i) => {
        const tt = clamp(t - i * 0.06, 0, 1);
        const p = this.eFrom.clone().lerp(this.eTo, tt);
        p.y += Math.sin(tt * Math.PI) * 3 + i * 0.8;
        const side = new THREE.Vector3(-dir.z, 0, dir.x).multiplyScalar(i * 2.2);
        p.add(side);
        E.P.set([p.x, p.y, p.z, i * 3.1], i * 4);
        E.D.set([dir.x, 0, dir.z, 1.0], i * 4);
      });
      if (t > 1.2) { this.egretActive = false; this.egretT = 45 + this.r() * 45; }
    } else E.items.forEach((it, i) => E.P.set([0, -500, 0, 0], i * 4));
    for (const g of this.groups) { g.g.attributes.iP.needsUpdate = true; g.g.attributes.iD.needsUpdate = true; }
  }
}

// ------------------------------------------------------------------ waterfall
export function waterfall(world) {
  const lipU = R.FALL_U + 6.2, drop = 38.5, wdt = 4.2;
  const nS = 18, nT = 30;
  const pos = [], uv = [], idx = [];
  for (let i = 0; i <= nT; i++) {
    const t = i / nT;
    const out = 4.2 * Math.sqrt(t) + t * 0.5;
    const u = lipU - out;
    const y = 37.6 - drop * t;
    for (let j = 0; j <= nS; j++) {
      const s = (j / nS - 0.5) * 2;
      const d = s * wdt * (1 + t * 0.35) + Math.sin(t * 6 + j) * 0.15;
      const p = toWorld(u, d);
      pos.push(p.x, y, p.z);
      uv.push(j / nS, t);
    }
  }
  for (let i = 0; i < nT; i++) for (let j = 0; j < nS; j++) { const a = i * (nS + 1) + j, b = a + 1, c = a + nS + 1, d = c + 1; idx.push(a, b, c, b, d, c); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  const m = new THREE.ShaderMaterial({
    uniforms: Object.assign({}, U),
    vertexShader: 'varying vec2 vUv; varying vec3 vW; varying vec3 vN; void main(){ vUv = uv; vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; vN = normal; gl_Position = projectionMatrix * viewMatrix * w; }',
    fragmentShader: GLSL_COMMON + GLSL_FOG + /* glsl */`
      varying vec2 vUv; varying vec3 vW; varying vec3 vN;
      void main() {
        float s1 = texture2D(tNoise, vec2(vUv.x * 3.0, vUv.y * 1.2 - uTime * 1.3)).r;
        float s2 = texture2D(tNoise, vec2(vUv.x * 7.0 + 0.3, vUv.y * 2.5 - uTime * 2.1)).g;
        float streak = s1 * 0.6 + s2 * 0.4;
        float edge = smoothstep(0.0, 0.12, vUv.x) * smoothstep(1.0, 0.88, vUv.x);
        float a = clamp(0.55 + streak * 0.6, 0.0, 1.0) * edge * (0.8 + 0.2 * vUv.y);
        vec3 base = mix(vec3(0.3, 0.5, 0.48), vec3(0.95), smoothstep(0.35, 0.8, streak));
        vec3 col = base * (uAmbCol * 1.6 + uKeyCol * (0.4 + 0.4 * max(uKeyDir.y, 0.0))) + uFlash * 0.4;
        gl_FragColor = vec4(applyFog(col, vW), a);
      }`,
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(g, m);
  mesh.layers.set(2); mesh.renderOrder = 3; mesh.name = 'waterfall';
  world.scene.add(mesh);
  return mesh;
}
