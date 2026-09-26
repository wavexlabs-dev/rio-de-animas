// Story layer: small scenes on the banks that play by themselves as the trajinera goes by (the camera turns to
// look for a moment), veladoras the trajinero leaves on the water at night, and the ánimas that gather around
// the trajinera and go up the waterfall at the end of the journey. Nothing to click: the pointer only looks around.
// Act I (afternoon) the living prepare · Act II (night) the dead visit · Act III (dawn → gorge) they go back.
import * as THREE from 'three';
import { U, GLSL_COMMON, std } from './materials.js';
import { tex } from './textures.js';
import { mulberry32, lerp, clamp, smoothstep } from './noise.js';
import { R, toWorld, toUD, halfW, terrainH } from './river.js';
import { L } from './layout.js';
import { Batch, box, cylinder, arcPts, tubeAlong } from './archkit.js';
import { buildCandles, flowerCards } from './decor.js';
import { Character } from './characters.js';
import { wingGeo } from './life.js';

const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const ease = (t) => t * t * (3 - 2 * t);
// turn neck + head toward a world point (after c.reset()); w = 0..1
function lookAt(c, p, w = 1, maxYaw = 1.1) {
  c.group.updateMatrixWorld(true);
  const l = c.group.worldToLocal(p.clone());
  const hy = c.hipY * 1.75;
  const yaw = clamp(Math.atan2(l.x, l.z), -maxYaw, maxYaw) * w;
  const pitch = clamp(Math.atan2(l.y - hy, Math.hypot(l.x, l.z)), -0.6, 0.7) * w;
  c.b.neck.rotateY(yaw * 0.45); c.b.head.rotateY(yaw * 0.55);
  c.b.head.rotateX(-pitch * 0.7);
}

function instGeo(base, attrs, count) {
  const g = new THREE.InstancedBufferGeometry();
  g.index = base.index;
  for (const k of Object.keys(base.attributes)) g.setAttribute(k, base.attributes[k]);
  for (const [k, arr, sz] of attrs) g.setAttribute(k, new THREE.InstancedBufferAttribute(arr, sz));
  g.instanceCount = count;
  return g;
}

// flattest free spot on the bank near (u0, side), a few metres from the water line; +Z of the frame faces the river
function bankSpot(world, u0, side, o = {}) {
  const P = {}, best = { score: 1e9 };
  const clear = o.clear || 1.8;
  for (let du = -(o.du || 7); du <= (o.du || 7); du += 1) {
    for (let e = o.e0 || 0.5; e <= (o.e1 || 2.8); e += 0.3) {
      const u = u0 + du, d = side * (halfW(u) + e);
      toWorld(u, d, P);
      const h = terrainH(P.x, P.z, u);
      if (h < 0.12 || h > 4) continue;
      const s = Math.abs(terrainH(P.x + 1, P.z, u) - terrainH(P.x - 1, P.z, u)) + Math.abs(terrainH(P.x, P.z + 1, u) - terrainH(P.x, P.z - 1, u));
      let block = 0;
      if (world.blockers.hit(P.x, P.z, clear)) block += 1;
      if (world.blockers.hit(P.x, P.z, clear * 0.5)) block += 2;
      // keep out from under tree crowns, and keep the view from the river open
      const Q = toWorld(u, d - side * 4);
      for (const c of world.canopies || []) {
        const dx = c.x - P.x, dz = c.z - P.z;
        if (dx * dx + dz * dz > 900) continue;
        const d1 = Math.hypot(dx, dz), d2 = Math.hypot(c.x - Q.x, c.z - Q.z);
        if (d1 < c.r + 1.5) block += (c.r + 1.5 - d1) * 0.7;
        if (d2 < c.r + 1) block += (c.r + 1 - d2) * 0.5;
      }
      const score = s * 4 + block * 5 + Math.abs(du) * 0.06 + e * 0.15;
      if (score < best.score) Object.assign(best, { score, u, d, x: P.x, z: P.z, y: h });
    }
  }
  if (best.score > 1e8) { toWorld(u0, side * (halfW(u0) + 2), P); Object.assign(best, { u: u0, d: side * (halfW(u0) + 2), x: P.x, z: P.z, y: Math.max(0.2, terrainH(P.x, P.z, u0)) }); }
  const c = toWorld(best.u, 0);
  best.rot = Math.atan2(c.x - best.x, c.z - best.z);
  best.M = new THREE.Matrix4().compose(V3(best.x, best.y, best.z), new THREE.Quaternion().setFromAxisAngle(V3(0, 1, 0), best.rot), V3(1, 1, 1).multiplyScalar(o.scale || 1));
  best.at = (x, y, z) => V3(x, y, z).applyMatrix4(best.M);
  world.blockers.push({ x: best.x, z: best.z, r: o.claim || 2 });
  clearPlants(world, V3(best.x, 0, best.z), (o.claim || 2) + 1.2);
  return best;
}

// clear low vegetation around a scene so it reads from the river (instanced plants and scanned understorey)
const PLANTISH = /fern|shrub|weed|nettle|gazania|grass|moss|flower|reed|agave|organo|plant|bush/i;
function clearPlants(world, p, r) {
  for (const s of world.lodSets || []) {
    if (!PLANTISH.test(s.name)) continue;
    const n0 = s.items.length;
    s.items = s.items.filter((it) => (it.p.x - p.x) ** 2 + (it.p.z - p.z) ** 2 > (r + Math.min(it.r || 0, 1.2)) ** 2);
    if (s.items.length !== n0) { s.timer = 0; s.last.set(1e9, 0, 0); }
  }
  const m = new THREE.Matrix4(), t = V3(), zero = new THREE.Matrix4().makeScale(0, 0, 0);
  world.scene.traverse((o) => {
    if (!o.isInstancedMesh || !/^(plants|reeds|agave|cactus|flowers|weeds|bushes)/i.test(o.name)) return;
    if (o.boundingSphere && o.boundingSphere.center.distanceTo(p) > o.boundingSphere.radius + r) return;
    let hit = false;
    for (let i = 0; i < o.count; i++) {
      o.getMatrixAt(i, m); t.setFromMatrixPosition(m);
      if ((t.x - p.x) ** 2 + (t.z - p.z) ** 2 < r * r) { o.setMatrixAt(i, zero); hit = true; }
    }
    if (hit) o.instanceMatrix.needsUpdate = true;
  });
}

// ------------------------------------------------------------------ companions: ánimas at night, monarchs by day
class Companions {
  constructor(world) {
    this.w = world;
    this.N = 72;
    this.items = [];
    const r = mulberry32(333);
    for (let i = 0; i < this.N; i++) this.items.push({ p: V3(0, -99, 0), v: V3(), a: 0, mode: 0, t: 0, seed: r() * 100, k: i, from: V3(), orbit: null });
    this.P = new Float32Array(this.N * 4);
    this.S = new Float32Array(this.N);
    this.items.forEach((it, i) => { this.S[i] = it.seed; });
    this.uNight = { value: 0 };
    this.uLift = { value: 0 };
    this.g = instGeo(wingGeo(), [['iP', this.P, 4], ['iS', this.S, 1]], this.N);
    const m = new THREE.ShaderMaterial({
      uniforms: Object.assign({}, U, { tW: { value: tex('f_monarch') }, uN: this.uNight, uL: this.uLift }),
      vertexShader: GLSL_COMMON + /* glsl */`
        attribute vec4 iP; attribute float iS; attribute float aSide; uniform float uN; uniform float uL;
        varying vec2 vUv; varying float vA;
        void main() {
          vec3 toC = normalize(cameraPosition - iP.xyz);
          vec3 rt = normalize(cross(vec3(0.0, 1.0, 0.0), toC)); vec3 up = cross(toC, rt);
          float flap = sin(uTime * (7.0 + fract(iS) * 4.0) + iS * 20.0) * 0.75;
          float sq = cos(flap);
          float s = mix(0.13, 0.4, max(uN, uL));
          vec3 wp = iP.xyz + (rt * position.x * sq + up * position.z * -1.0) * s;
          vUv = vec2(abs(position.x), 0.5 - position.z); vA = iP.w;
          gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
          if (vA < 0.01) gl_Position = vec4(2.0);
        }`,
      fragmentShader: GLSL_COMMON + /* glsl */`
        uniform sampler2D tW; uniform float uN; uniform float uL; varying vec2 vUv; varying float vA;
        void main() {
          vec4 c = texture2D(tW, vUv);
          float m = smoothstep(0.3, 0.6, c.a);
          if (m < 0.05) discard;
          vec3 gold = mix(vec3(1.0, 0.42, 0.08), vec3(1.0, 0.72, 0.3), c.r) * 2.6;
          vec3 day = c.rgb * (uAmbCol * 1.5 + uKeyCol * 0.75) + c.rgb * vec3(1.0, 0.5, 0.15) * 0.35;
          gl_FragColor = vec4(mix(day, gold * (1.0 + uL * 0.8), max(uN, uL * 0.9)), m * vA);
        }`,
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(this.g, m);
    mesh.frustumCulled = false; mesh.layers.set(2); mesh.renderOrder = 10; mesh.name = 'companions';
    world.scene.add(mesh);
    this.hg = instGeo(new THREE.PlaneGeometry(1, 1), [['iP', this.P, 4]], this.N);
    const hm = new THREE.ShaderMaterial({
      uniforms: Object.assign({}, U, { uN: this.uNight, uL: this.uLift }),
      vertexShader: GLSL_COMMON + /* glsl */`
        attribute vec4 iP; uniform float uN; uniform float uL; varying vec2 vUv; varying float vA;
        void main() { vec3 toC = normalize(cameraPosition - iP.xyz); vec3 rt = normalize(cross(vec3(0.0, 1.0, 0.0), toC)); vec3 up = cross(toC, rt);
          float s = mix(0.7, 1.8, uN) + uL * 1.2; vUv = uv; vA = iP.w * mix(0.22, 1.0, max(uN, uL)) * (1.0 + uL * 0.6);
          gl_Position = projectionMatrix * viewMatrix * vec4(iP.xyz + (rt * position.x + up * position.y) * s, 1.0); if (vA < 0.01) gl_Position = vec4(2.0); }`,
      fragmentShader: 'varying vec2 vUv; varying float vA; void main(){ float r = length(vUv - 0.5) * 2.0; float a = exp(-r * r * 4.5) * 0.3 + exp(-r * r * 26.0) * 0.45; gl_FragColor = vec4(vec3(1.0, 0.5, 0.14) * a * vA * 1.6, 1.0); }',
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    const hmesh = new THREE.Mesh(this.hg, hm); hmesh.frustumCulled = false; hmesh.layers.set(2); hmesh.renderOrder = 10; world.scene.add(hmesh);
    this.center = V3(); this.count = 0;
    world.glowSources.push((list, cp) => {
      if (this.count < 1) return;
      const n = this.uNight.value * 0.9 + this.uLift.value * 0.5;
      if (n < 0.03) return;
      const I = Math.min(2.6, 0.55 * Math.sqrt(this.count)) * n;
      list.push({ x: this.center.x, y: this.center.y, z: this.center.z, r: 9, cr: 1.6 * I, cg: 0.9 * I, cb: 0.4 * I, w: 30 });
    });
  }
  // a new companion rises at `from`; `orbit` (optional) = { c, r, t } circles a point before joining the boat
  spawn(from, o = {}) {
    let it = this.items.find((q) => q.mode === 0);
    if (!it) it = this.items.reduce((a, b) => (a.t > b.t ? a : b));
    it.p.copy(from); it.from.copy(from); it.v.set((Math.random() - 0.5) * 0.6, o.vy !== undefined ? o.vy : 1.2, (Math.random() - 0.5) * 0.6);
    it.mode = 1; it.t = 0; it.a = 0; it.orbit = o.orbit || null; it.rise = o.rise || 1.6;
    return it;
  }
  clear() { for (const it of this.items) { it.mode = 0; it.a = 0; it.p.y = -99; } }
  update(dt, time) {
    const w = this.w, b = w.boat;
    const n = smoothstep(0.3, 0.8, w.tod.night);
    this.uNight.value = n;
    const ascend = b.u > R.FADE_U - 52 || w.looping;
    if (ascend && !this.rang && this.items.some((q) => q.mode === 2)) { this.rang = true; if (w.audio) w.audio.chime([392, 494, 587, 784, 988], 0.9, null); }
    if (!ascend) this.rang = false;
    this.uLift.value = lerp(this.uLift.value, ascend ? 1 : 0, 1 - Math.exp(-dt * 0.6));
    const fall = toWorld(R.FALL_U - 6, 0);
    const tmp = V3(), tgt = V3(), acc = V3(), cam = w.cam.position;
    let cnt = 0; this.center.set(0, 0, 0);
    let slot = 0;
    for (const it of this.items) {
      if (it.mode === 0) { this.P[it.k * 4 + 3] = 0; continue; }
      it.t += dt;
      const s = it.seed;
      if (ascend && it.mode !== 3) { it.mode = 3; it.t = 0; it.lift0 = it.p.y; }
      if (it.mode === 1) {
        // rise from where it was born, then drift (or circle someone) before joining the boat
        if (it.orbit && it.t > 0.8 && it.t < it.orbit.t) {
          const a = (it.t - 0.8) * 1.7 + s;
          tgt.set(it.orbit.c.x + Math.cos(a) * it.orbit.r, it.orbit.c.y + 0.3 + Math.sin(it.t * 1.3) * 0.25, it.orbit.c.z + Math.sin(a) * it.orbit.r);
        } else tgt.copy(it.from).add(tmp.set(Math.sin(s) * 0.6, it.rise, Math.cos(s) * 0.6));
        if (it.t > (it.orbit ? it.orbit.t : 1.6)) it.mode = 2;
        it.a = Math.min(1, it.a + dt * 1.2);
      } else if (it.mode === 2) {
        // loose swarm around and behind the trajinera
        const k = slot++;
        const ang = s * 2.4 + Math.sin(time * 0.21 + s) * 0.6;
        const rad = 2.4 + (k % 6) * 0.85;
        const behind = 1.5 + (k % 9) * 0.9;
        tgt.copy(b.pos).addScaledVector(b.fwd, -behind + Math.cos(ang) * rad * 0.6);
        tgt.x += -b.fwd.z * Math.sin(ang) * rad; tgt.z += b.fwd.x * Math.sin(ang) * rad;
        tgt.y = 1.4 + (k % 4) * 0.7 + Math.sin(time * 0.7 + s * 3) * 0.35;
        it.a = Math.min(1, it.a + dt * 0.8);
      } else if (it.mode === 3) {
        // up the waterfall, spiralling, then gone into the light
        const a = time * 0.9 + s * 6.28;
        const h = Math.min(60, it.t * (3 + (s % 1) * 2.5));
        tgt.set(fall.x + Math.cos(a) * (3 + (s % 3)), 6 + h + (it.k % 7), fall.z + Math.sin(a) * (3 + (s % 3)));
        if (h > 34) it.a = Math.max(0, it.a - dt * 0.35);
        if (it.a <= 0 && it.t > 4) { it.mode = 0; this.P[it.k * 4 + 3] = 0; continue; }
      }
      const kSpring = it.mode === 3 ? 0.9 : 0.8;
      acc.copy(tgt).sub(it.p).multiplyScalar(kSpring).addScaledVector(it.v, -1.1);
      // keep out of the lens: a glowing wing right in front of the camera fills the screen (and the GPU)
      tmp.copy(it.p).sub(cam); const dc = tmp.length();
      if (dc < 3.5) acc.addScaledVector(tmp, (3.5 - dc) * 2.5 / Math.max(dc, 0.3));
      it.v.addScaledVector(acc, dt);
      const vmax = it.mode === 3 ? 9 : 7;
      const sp = it.v.length(); if (sp > vmax) it.v.multiplyScalar(vmax / sp);
      it.p.addScaledVector(it.v, dt);
      if (it.p.y < 0.5) it.p.y = 0.5;
      this.P.set([it.p.x, it.p.y, it.p.z, it.a * smoothstep(1.4, 3.2, it.p.distanceTo(cam))], it.k * 4);
      if (it.a > 0.2) { this.center.add(it.p); cnt++; }
    }
    this.count = cnt;
    if (cnt) this.center.multiplyScalar(1 / cnt);
    this.g.attributes.iP.needsUpdate = true;
    this.hg.attributes.iP.needsUpdate = true;
  }
}

// ------------------------------------------------------------------ veladoras the trajinero leaves on the water at night
class Veladoras {
  constructor(world, companions) {
    this.w = world; this.comp = companions;
    this.N = 28;
    this.items = [];
    const tule = new THREE.CylinderGeometry(0.035, 0.035, 0.34, 7); tule.rotateZ(Math.PI / 2);
    const tuleMat = std({ color: 0x9a9a52, roughness: 0.8 }, { key: 'tule' });
    const waxMat = std({ color: 0xf0e6d0, roughness: 0.5, emissive: 0xff9a40, emissiveIntensity: 0.3 }, { key: 'wax2' });
    const flMat = std({ map: tex('f_cempa'), alphaTest: 0.45, side: THREE.DoubleSide }, { key: 'rflower' });
    const fg = new THREE.PlaneGeometry(0.11, 0.11);
    const uv = fg.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 0.5, 0.5 + uv.getY(i) * 0.5);
    const cg = new THREE.CylinderGeometry(0.02, 0.022, 0.09, 8);
    const r = mulberry32(17);
    for (let i = 0; i < this.N; i++) {
      const g = new THREE.Group();
      for (const z of [-0.04, 0.04]) { const t = new THREE.Mesh(tule, tuleMat); t.position.set(0, 0.02, z); g.add(t); }
      const c = new THREE.Mesh(cg, waxMat); c.position.y = 0.09; g.add(c);
      for (let k = 0; k < 4; k++) { const f = new THREE.Mesh(fg, flMat); f.rotation.x = -Math.PI / 2 + (r() - 0.5) * 0.4; f.position.set(-0.12 + k * 0.08, 0.06, (r() - 0.5) * 0.06); g.add(f); }
      g.scale.setScalar(1.6);
      g.visible = false;
      world.scene.add(g);
      this.items.push({ g, u: 0, d: 0, alive: false, on: 0, t: 0, y: 0, born: false });
    }
    this.P = new Float32Array(this.N * 4);
    this.fg = instGeo(new THREE.PlaneGeometry(1, 1), [['iP', this.P, 4]], this.N);
    const fm = new THREE.ShaderMaterial({
      uniforms: Object.assign({}, U),
      vertexShader: GLSL_COMMON + /* glsl */`
        attribute vec4 iP; varying vec2 vUv; varying float vA;
        void main() { vec3 toC = normalize(cameraPosition - iP.xyz); vec3 rt = normalize(cross(vec3(0.0,1.0,0.0), toC));
          float fl = 0.85 + 0.15 * sin(uTime * 11.0 + iP.x * 7.0);
          vec4 mv = viewMatrix * vec4(iP.xyz + rt * position.x * 0.08 + vec3(0.0, (position.y + 0.5) * 0.17 * fl, 0.0), 1.0);
          mv.xy += position.xy * clamp(-mv.z * 0.0025, 0.0, 0.25);
          vUv = uv; vA = iP.w; gl_Position = projectionMatrix * mv; if (vA < 0.01) gl_Position = vec4(2.0); }`,
      fragmentShader: 'varying vec2 vUv; varying float vA; void main(){ vec2 q = vUv - vec2(0.5, 0.35); q.x *= 2.2; float d = length(q); float a = exp(-d*d*28.0) * 6.0 + exp(-d*d*5.0) * 0.8; gl_FragColor = vec4(mix(vec3(1.0,0.45,0.1), vec3(1.0,0.9,0.6), exp(-d*d*40.0)) * a * vA, 1.0); }',
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    const fmesh = new THREE.Mesh(this.fg, fm); fmesh.frustumCulled = false; fmesh.layers.set(2); fmesh.renderOrder = 10; world.scene.add(fmesh);
    world.glowSources.push((list, cp) => {
      for (const it of this.items) if (it.alive && it.on > 0.05) { const p = it.g.position; list.push({ x: p.x, y: p.y + 0.3, z: p.z, r: 5.5, cr: 1.4 * it.on, cg: 0.8 * it.on, cb: 0.32 * it.on, w: 13 / (1 + cp.distanceTo(p) * 0.15) }); }
    });
    this.placed = 0;
  }
  place(p) {
    let it = this.items.find((q) => !q.alive);
    if (!it) it = this.items.reduce((a, b) => (a.t > b.t ? a : b));
    const ud = toUD(p.x, p.z, {}, this.w.boat.u);
    it.u = ud.u; it.d = ud.d; it.alive = true; it.on = 0; it.t = 0; it.y = 0.6; it.born = false;
    it.g.rotation.y = Math.random() * 6.28;
    this.placed++;
    return it;
  }
  clear() { for (const it of this.items) { it.alive = false; it.g.visible = false; } }
  update(dt, time) {
    const w = this.w, b = w.boat, P = {};
    for (let i = 0; i < this.N; i++) {
      const it = this.items[i];
      if (!it.alive) { it.g.visible = false; this.P[i * 4 + 3] = 0; continue; }
      it.t += dt;
      const wd = halfW(it.u);
      const tt = Math.min(1, Math.abs(it.d) / wd);
      it.u -= lerp(0.5, 1.1, smoothstep(650, 950, it.u)) * (1 - tt * tt * 0.9) * dt;
      it.d = clamp(it.d, -wd + 0.5, wd - 0.5);
      toWorld(it.u, it.d, P);
      // falls softly onto the water, then bobs
      it.y = Math.max(0, it.y - dt * 1.6);
      if (it.y <= 0 && !it.splashed) { it.splashed = true; if (w.onPoleSplash) w.onPoleSplash(V3(P.x, 0, P.z), 0.35); if (w.audio) w.audio.plop(V3(P.x, 0, P.z)); }
      if (it.y > 0) it.splashed = false;
      it.g.position.set(P.x, it.y + Math.sin(time * 1.5 + i) * 0.012, P.z);
      it.g.visible = true;
      it.on = Math.min(1, it.on + dt * (it.t > 0.5 ? 1.2 : 0));
      if (!it.born && it.t > 1.4) { it.born = true; this.comp.spawn(V3(P.x, 0.4, P.z), { rise: 1.8 }); if (w.audio) w.audio.chime([659, 988], 0.5, it.g.position); }
      if (it.u < b.u - 130) { it.alive = false; it.g.visible = false; }
      this.P.set([P.x, it.g.position.y + 0.24, P.z, it.on], i * 4);
    }
    this.fg.attributes.iP.needsUpdate = true;
  }
}

// ------------------------------------------------------------------ bursts of coloured sparks (alebrijes)
class Sparks {
  constructor(world) {
    this.N = 240; this.i = 0;
    this.items = Array.from({ length: this.N }, () => ({ p: V3(0, -99, 0), v: V3(), life: 0, c: [1, 1, 1] }));
    this.P = new Float32Array(this.N * 4); this.C = new Float32Array(this.N * 3);
    this.g = instGeo(new THREE.PlaneGeometry(1, 1), [['iP', this.P, 4], ['iC', this.C, 3]], this.N);
    const m = new THREE.ShaderMaterial({
      uniforms: Object.assign({}, U),
      vertexShader: GLSL_COMMON + /* glsl */`
        attribute vec4 iP; attribute vec3 iC; varying vec2 vUv; varying float vA; varying vec3 vC;
        void main() { vec3 toC = normalize(cameraPosition - iP.xyz); vec3 rt = normalize(cross(vec3(0.0,1.0,0.0), toC)); vec3 up = cross(toC, rt);
          vUv = uv; vA = iP.w; vC = iC; gl_Position = projectionMatrix * viewMatrix * vec4(iP.xyz + (rt * position.x + up * position.y) * 0.16, 1.0); if (vA < 0.01) gl_Position = vec4(2.0); }`,
      fragmentShader: 'varying vec2 vUv; varying float vA; varying vec3 vC; void main(){ float r = length(vUv - 0.5) * 2.0; float a = exp(-r*r*10.0); gl_FragColor = vec4(vC * a * vA * 3.0, 1.0); }',
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    const mesh = new THREE.Mesh(this.g, m); mesh.frustumCulled = false; mesh.layers.set(2); mesh.renderOrder = 11; world.scene.add(mesh);
  }
  burst(p, n, pal) {
    for (let k = 0; k < n; k++) {
      const q = this.items[this.i++ % this.N];
      q.p.copy(p).add(V3((Math.random() - 0.5) * 0.8, Math.random() * 0.8, (Math.random() - 0.5) * 0.8));
      const a = Math.random() * 6.28, s = 1 + Math.random() * 2.5;
      q.v.set(Math.cos(a) * s, 1.5 + Math.random() * 3, Math.sin(a) * s);
      q.life = 1; q.c = pal[k % pal.length];
    }
  }
  update(dt) {
    for (let i = 0; i < this.N; i++) {
      const q = this.items[i];
      if (q.life > 0) { q.life -= dt * 0.7; q.v.y -= dt * 2.2; q.v.multiplyScalar(Math.exp(-dt * 1.2)); q.p.addScaledVector(q.v, dt); }
      this.P.set([q.p.x, q.p.y, q.p.z, Math.max(0, q.life)], i * 4);
      this.C.set(q.c, i * 3);
    }
    this.g.attributes.iP.needsUpdate = true; this.g.attributes.iC.needsUpdate = true;
  }
}

// thrown petals: ballistic flight, then they join the floating petals on the river
class ThrownPetals {
  constructor(world) {
    this.w = world; this.N = 160; this.i = 0;
    this.items = Array.from({ length: this.N }, () => ({ p: V3(0, -99, 0), v: V3(), live: false, rot: 0 }));
    this.P = new Float32Array(this.N * 4);
    const base = new THREE.PlaneGeometry(1, 1);
    this.g = instGeo(base, [['iP', this.P, 4]], this.N);
    const m = new THREE.ShaderMaterial({
      uniforms: Object.assign({}, U, { tP: { value: tex('f_petals') } }),
      vertexShader: GLSL_COMMON + /* glsl */`
        attribute vec4 iP; varying vec2 vUv;
        void main() { float r = iP.w * 6.2832 + uTime * 3.0; vec3 toC = normalize(cameraPosition - iP.xyz); vec3 rt = normalize(cross(vec3(0.0,1.0,0.0), toC)); vec3 up = cross(toC, rt);
          vec2 q = vec2(position.x * cos(r) - position.y * sin(r), position.x * sin(r) + position.y * cos(r)) * 0.16;
          vUv = vec2(uv.x / 4.0, uv.y); gl_Position = projectionMatrix * viewMatrix * vec4(iP.xyz + rt * q.x + up * q.y, 1.0); if (iP.y < -50.0) gl_Position = vec4(2.0); }`,
      fragmentShader: GLSL_COMMON + 'uniform sampler2D tP; varying vec2 vUv; void main(){ vec4 c = texture2D(tP, vUv); if (c.a < 0.5) discard; gl_FragColor = vec4(c.rgb * (uAmbCol * 1.4 + uKeyCol * 0.8), 1.0); }',
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(this.g, m); mesh.frustumCulled = false; mesh.layers.set(5); mesh.name = 'thrownPetals'; world.scene.add(mesh);
  }
  throw(p, dir, n) {
    for (let k = 0; k < n; k++) {
      const q = this.items[this.i++ % this.N];
      q.p.copy(p).add(V3((Math.random() - 0.5) * 0.15, (Math.random() - 0.5) * 0.15, (Math.random() - 0.5) * 0.15));
      q.v.copy(dir).multiplyScalar(2.2 + Math.random() * 2.2).add(V3((Math.random() - 0.5) * 1.6, 1.8 + Math.random() * 1.6, (Math.random() - 0.5) * 1.6));
      q.live = true; q.rot = Math.random();
    }
  }
  update(dt) {
    const fp = this.w.floatPetals;
    for (let i = 0; i < this.N; i++) {
      const q = this.items[i];
      if (q.live) {
        q.v.y -= dt * 3.2; q.v.multiplyScalar(Math.exp(-dt * 1.4));
        q.p.addScaledVector(q.v, dt);
        const ground = Math.max(0.01, terrainH(q.p.x, q.p.z));
        if (q.p.y <= ground) {
          q.live = false;
          // hand it over to the river
          if (fp && ground <= 0.02) {
            const j = Math.floor(Math.random() * fp.N);
            const ud = toUD(q.p.x, q.p.z, {}, this.w.boat.u);
            fp.u[j] = ud.u; fp.d[j] = ud.d; fp.kind[j] = 0; fp.rot[j] = q.rot;
          }
          q.p.y = -99;
        }
      }
      this.P.set([q.p.x, q.p.y, q.p.z, q.rot], i * 4);
    }
    this.g.attributes.iP.needsUpdate = true;
  }
}

// ------------------------------------------------------------------ helpers for vignettes
function cloth() { return std({ color: 0xf2eee6, roughness: 0.9 }, { key: 'cloth' }); }
function candleSet(world, pts, group) {
  const list = pts.map((p) => ({ x: p.x, y: p.y, z: p.z, h: p.h || 0.12 + Math.random() * 0.08 }));
  const c = buildCandles(world, list, group);
  c.list = list;
  return c;
}
function flowerArc(world, S, cx, cy, cz, rad, n, width = 0.12) {
  const pts = [], cards = [];
  for (let i = 0; i <= 16; i++) { const a = Math.PI * i / 16; pts.push(S.at(cx + Math.cos(a) * rad, cy + Math.sin(a) * rad, cz)); }
  for (let i = 0; i < n; i++) {
    const a = Math.PI * (i + Math.random() * 0.8) / n;
    const rr = rad + (Math.random() - 0.5) * width;
    const p = S.at(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr, cz + (Math.random() - 0.5) * 0.12);
    const nrm = V3(Math.cos(a), Math.sin(a), 0.6).normalize().applyQuaternion(new THREE.Quaternion().setFromAxisAngle(V3(0, 1, 0), S.rot));
    cards.push({ p, n: nrm, kind: 0 });
  }
  return { tube: tubeAlong(pts, 0.03, 24, 5), cards };
}
function petalsScatter(S, cx, cz, rx, rz, n) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const x = cx + (Math.random() - 0.5) * 2 * rx, z = cz + (Math.random() - 0.5) * 2 * rz;
    const p = S.at(x, 0, z); p.y = Math.max(terrainH(p.x, p.z), S.y - 0.3) + 0.02;
    out.push({ p, n: V3(0, 1, 0), kind: 0 });
  }
  return out;
}

// ------------------------------------------------------------------ the story
export class Story {
  constructor(world) {
    this.w = world;
    this.hot = [];
    this.vign = [];
    this.comp = new Companions(world);
    this.vel = new Veladoras(world, this.comp);
    this.sparks = new Sparks(world);
    this.petals = new ThrownPetals(world);
    this.smokeSrc = null;
    this.slow = 1;
    this.slowT = 0;
    this.velT = 4;
    this.auto = true; // tools that direct the scenes themselves turn this off
    world.onLoop = () => this.reset();
    world.glowSources.push(this.glowSource());
    world.updaters.push((dt, t) => this.update(dt, t));
  }
  // vignettes are built a few per frame after the scene is already running (keeps the first load as it was)
  async build(nextFrame) {
    const steps = [() => this.ofrenda(), () => this.familia(), () => this.campanas(), () => this.alebrijes(), () => this.tumba(), () => this.oyamel()];
    for (const s of steps) { try { s(); } catch (e) { console.warn('story', e); } await nextFrame(); }
    this.ready = true;
  }
  // a scene: p = where it happens, win = [near, far] metres ahead of the trajinera in which it starts,
  // hold = roughly how long it lasts (the trajinera goes slower meanwhile), fn = what happens.
  // The camera never moves by itself: the visitor decides where to look.
  addHot(h) { h.win = h.win || [5, 22]; h.hold = h.hold || 3.4; h.played = false; this.hot.push(h); return h; }
  play(h) {
    h.played = true;
    h.fn();
    this.slowT = Math.max(this.slowT, h.hold + 1.5);
  }

  // Act I — an ofrenda by the water, its candles still unlit
  ofrenda() {
    const w = this.w;
    const S = bankSpot(w, 58, 1, { claim: 2.8, scale: 1.55 });
    const B = new Batch();
    const Mt = S.M;
    const put = (key, g, color, uvs) => B.add(key, g, Mt, { color, uvScale: uvs || 0.6 });
    put('wood', box(1.5, 0.08, 0.8, 0, 0.46, -0.3), [0.7, 0.55, 0.42]);
    for (const x of [-0.68, 0.68]) for (const z of [-0.62, 0.02]) put('wood', box(0.07, 0.46, 0.07, x, 0, z), [0.6, 0.45, 0.34]);
    put('plaster', box(1.56, 0.03, 0.86, 0, 0.54, -0.3), [0.97, 0.95, 0.9], 2);
    put('plaster', box(1.56, 0.36, 0.02, 0, 0.2, 0.13), [0.95, 0.4, 0.62], 2);
    put('plaster', box(1.1, 0.22, 0.4, 0, 0.57, -0.48), [0.96, 0.93, 0.88], 2);
    put('plaster', box(0.72, 0.2, 0.26, 0, 0.79, -0.55), [0.96, 0.93, 0.88], 2);
    // portraits
    for (const [x, y, z, s] of [[-0.45, 0.79, -0.4, 1], [0.0, 0.99, -0.58, 1.2], [0.45, 0.79, -0.4, 0.9]]) {
      put('wood', box(0.2 * s, 0.25 * s, 0.03, x, y, z), [0.35, 0.22, 0.14]);
      put('plaster', box(0.15 * s, 0.19 * s, 0.01, x, y + 0.03 * s, z + 0.02), [0.62, 0.52, 0.4]);
    }
    // pan de muerto, fruit, copal bowl
    for (const x of [-0.5, 0.5]) { put('cantera', cylinder(0.09, 0.07, 0.07, 10, x, 0.58, -0.25), [0.85, 0.55, 0.28]); put('cantera', box(0.14, 0.02, 0.02, x, 0.65, -0.25), [0.8, 0.5, 0.25]); }
    put('cantera', cylinder(0.08, 0.1, 0.09, 10, 0, 0.56, -0.2), [0.6, 0.33, 0.22]);
    const arc = flowerArc(w, S, 0, 0.62, -0.66, 0.78, 46);
    B.add('cane', arc.tube, null, { color: [0.6, 0.5, 0.32] });
    const meshes = B.build(w.scene, w.archMats);
    flowerCards(w, arc.cards, 'f_cempa', 0, 0.34);
    flowerCards(w, petalsScatter(S, 0, 0.65, 0.9, 0.35, 70), 'f_petals', 0, 0.09, 5);
    const cpts = [[-0.62, 0.55, -0.1], [-0.4, 0.55, -0.05], [0.4, 0.55, -0.05], [0.62, 0.55, -0.1], [-0.22, 0.79, -0.32], [0.22, 0.79, -0.32], [-0.28, 0.99, -0.5], [0.28, 0.99, -0.5]].map(([x, y, z]) => S.at(x, y, z));
    const cs = candleSet(w, cpts);
    const censer = S.at(0, 0.66, -0.2);
    const V = { S, lit: 0, t: -1, meshes };
    const c = { v: 0 };
    w.updaters.push(() => { cs.mat.uniforms.uOn.value = c.v; });
    this.addHot({ p: S.at(0, 0.85, -0.3), r: 1.3, u: S.u, hold: 3.8, fn: () => { V.t = 0; if (w.audio) w.audio.chime([523, 659, 784], 0.8, S.at(0, 1, 0)); } });
    V.update = (dt) => {
      if (V.t < 0) { c.v = 0; return; }
      V.t += dt;
      c.v = Math.min(1, V.t / 1.6);
      this.smokeSrc = { x: censer.x, y: censer.y, z: censer.z, w: 0.45 * Math.min(1, V.t / 2) };
    };
    V.reset = () => { V.t = -1; this.smokeSrc = null; };
    V.glow = (list, cp) => { if (V.t > 0) { const I = Math.min(1, V.t / 1.6); const g = S.at(0, 0.9, -0.1); list.push({ x: g.x, y: g.y, z: g.z, r: 7, cr: 1.8 * I, cg: 1.0 * I, cb: 0.4 * I, w: 16 / (1 + cp.distanceTo(g) * 0.08) }); } };
    this.vign.push(V);
  }

  // Act I — a grandmother and a girl who throws cempasúchil petals to mark the way back
  familia() {
    const w = this.w;
    const S = bankSpot(w, 104, 1, { claim: 2.4, e0: 0.6, e1: 2.4 });
    const abuela = new Character({ female: true, skirt: true, rebozo: true, scale: 0.84, res: 0.026, skin: [0.44, 0.29, 0.2], shirt: [0.9, 0.88, 0.84], skirtCol: [0.12, 0.12, 0.2], embroid: true, hair: [0.7, 0.68, 0.66], hipW: 0.088, shoulder: 0.17 });
    const nina = new Character({ female: true, skirt: true, scale: 0.62, res: 0.03, skin: [0.47, 0.31, 0.21], shirt: [0.95, 0.75, 0.2], skirtCol: [0.75, 0.1, 0.4], embroid: true, hair: [0.04, 0.03, 0.03], hipW: 0.08, shoulder: 0.16 });
    const place = (c, x, z, rot) => { const p = S.at(x, 0, z); p.y = terrainH(p.x, p.z) + 0.01; c.group.position.copy(p); c.group.rotation.y = S.rot + rot; w.scene.add(c.group); };
    place(abuela, -0.38, -0.1, 0.25);
    place(nina, 0.32, 0.12, -0.15);
    // basket of flowers on the girl's left arm
    const B = new Batch();
    B.add('cane', cylinder(0.12, 0.15, 0.16, 12), null, { color: [0.75, 0.6, 0.38], uvScale: 0.3 });
    B.add('cane', new THREE.TorusGeometry(0.14, 0.012, 5, 16, Math.PI).rotateY(Math.PI / 2).translate(0, 0.16, 0), null, { color: [0.7, 0.55, 0.35] });
    const basket = new THREE.Group();
    const bm = B.build(basket, w.archMats);
    const fl = [];
    for (let i = 0; i < 14; i++) { const a = Math.random() * 6.28, r = Math.random() * 0.1; fl.push({ p: V3(Math.cos(a) * r, 0.17, Math.sin(a) * r), n: V3((Math.random() - 0.5) * 0.4, 1, (Math.random() - 0.5) * 0.4).normalize(), kind: 0 }); }
    w.scene.add(basket);
    const cards = flowerCards(w, fl, 'f_cempa', 0, 0.12);
    if (cards) cards.forEach((m) => { w.scene.remove(m); basket.add(m); });
    const gc = [];
    for (let k = 0; k < 9; k++) { const a = -1.2 + k * 0.3; gc.push(Object.assign(S.at(Math.sin(a) * 1.25, 0, 0.2 + Math.cos(a) * 0.7), { h: 0.1 + Math.random() * 0.12 })); }
    gc.forEach((p) => { p.y = terrainH(p.x, p.z) + 0.01; });
    const gcs = candleSet(w, gc);
    w.updaters.push(() => { gcs.mat.uniforms.uOn.value = Math.min(1, w.tod.night + w.tod.dusk * 0.9 + 0.25); });
    const V = { S, t: -1, n: 0, pt: -1, left: 0 };
    V.glow = (list, cp) => { const I = Math.min(1, w.tod.night + w.tod.dusk + 0.3) * 0.8; const g = S.at(0, 0.9, 0.35); list.push({ x: g.x, y: g.y, z: g.z, r: 6, cr: 1.6 * I, cg: 0.9 * I, cb: 0.4 * I, w: 12 / (1 + cp.distanceTo(g) * 0.1) }); };
    const hot = this.addHot({ p: S.at(0, 1.0, 0), r: 1.4, u: S.u, win: [4, 20], hold: 4.2, fn: () => { V.t = 0; V.n++; V.left = 2; } });
    const upq = toWorld(S.u + 40, 0), up = V3(upq.x, 6, upq.z);
    const midq = toWorld(S.u, 0), mid = V3(midq.x, 0.5, midq.z);
    V.update = (dt, t) => {
      const b = w.boat;
      if (w.cam.position.distanceTo(S.at(0, 1, 0)) > 130) return;
      const near = smoothstep(55, 30, b.pos.distanceTo(abuela.group.position));
      for (const [c, k] of [[abuela, 0], [nina, 1]]) {
        c.reset();
        c.b.chest.rotation.x = Math.sin(t * 1.4 + k) * 0.02 + (k ? 0.02 : 0.1);
        c.b.spine.rotation.x = k ? 0 : 0.08;
      }
      abuela.group.updateMatrixWorld(true); nina.group.updateMatrixWorld(true);
      const MA = abuela.group.matrixWorld, MN = nina.group.matrixWorld;
      // throw: reach into the basket, swing back, release forward and up
      const nb = nina.b;
      nina.ik2(nb.shL, nb.elL, nb.wrL, V3(0.2, 0.62, 0.16).applyMatrix4(MN), V3(0.5, 0.5, -0.3).applyMatrix4(MN));
      basket.position.copy(nina.worldPos(nb.wrL)).add(V3(0, -0.12, 0)); basket.rotation.y = nina.group.rotation.y;
      const inB = basket.position.clone().add(V3(0, 0.2, 0));
      const back = V3(-0.25, 0.55, -0.2).applyMatrix4(MN), high = V3(-0.1, 1.05, 0.45).applyMatrix4(MN), rest = V3(-0.2, 0.52, 0.06).applyMatrix4(MN);
      let hand = rest;
      if (V.t >= 0) {
        V.t += dt;
        if (V.t > 4.1 && V.left > 0) { V.t = 0; V.n++; V.left--; }
        const a = V.t;
        if (a < 0.35) hand = rest.clone().lerp(inB, ease(a / 0.35));
        else if (a < 0.6) hand = inB.clone().lerp(back, ease((a - 0.35) / 0.25));
        else if (a < 0.85) hand = back.clone().lerp(high, ease((a - 0.6) / 0.25));
        else hand = high.clone().lerp(rest, ease(Math.min(1, (a - 0.85) / 0.75)));
        if (a > 0.72 && V.pt < V.n) {
          V.pt = V.n;
          const tgt = toWorld(S.u + 3, S.d > 0 ? S.d - 6 : S.d + 6);
          const hp = nina.worldPos(nb.wrR);
          this.petals.throw(hp, V3(tgt.x - hp.x, 0, tgt.z - hp.z).normalize(), 70);
          if (w.audio) w.audio.flutter(hp, 0.5);
        }
      }
      nina.ik2(nb.shR, nb.elR, nb.wrR, hand, V3(-0.6, 0.4, -0.4).applyMatrix4(MN));
      // grandmother: left hand on the girl's shoulder; right arm points upriver while the petals fly
      const ab = abuela.b;
      abuela.ik2(ab.shL, ab.elL, ab.wrL, nina.worldPos(nb.shR).add(V3(0, 0.04, 0)), V3(0.6, 0.9, -0.4).applyMatrix4(MA));
      const pointing = V.t >= 0 && V.t < 3.8 ? smoothstep(0.25, 0.9, V.t) * (1 - smoothstep(3.0, 3.8, V.t)) : 0;
      const sh = abuela.worldPos(ab.shR);
      const aimP = sh.clone().addScaledVector(V3().subVectors(up, sh).normalize(), 0.52);
      abuela.ik2(ab.shR, ab.elR, ab.wrR, V3(-0.22, 0.7, 0.12).applyMatrix4(MA).lerp(aimP, pointing), V3(-0.6, 0.6, -0.5).applyMatrix4(MA));
      // both follow the trajinera with their eyes as it goes by; the grandmother looks upriver when she points
      lookAt(abuela, pointing > 0.3 ? up : b.pos.clone().setY(1.5), Math.max(near, pointing));
      lookAt(nina, V.t >= 0 && V.t < 1.4 ? inB.clone().lerp(mid, smoothstep(0.5, 0.9, V.t)) : b.pos.clone().setY(1.5), V.t >= 0 && V.t < 1.4 ? 0.8 : near);
    };
    V.reset = () => { V.t = -1; V.n = 0; V.pt = -1; V.left = 0; };
    this.vign.push(V);
    hot.p.copy(S.at(0.1, 0.9, 0.05));
  }

  // Act II — the bells call, and the dead come out of the church to ride with the trajinera
  campanas() {
    const w = this.w;
    if (!w.bells || !w.bells.length) return;
    const c = V3(); for (const b of w.bells) c.add(b.pos); c.multiplyScalar(1 / w.bells.length);
    const door = w.churchMatrix ? V3(-2.5, 2.2, 0).applyMatrix4(w.churchMatrix) : c.clone();
    const V = { t: -1, first: true };
    this.addHot({ p: door.clone().lerp(c, 0.6), r: 3.2, u: L.church.u, win: [18, 58], hold: 4.8, fn: () => {
      w.bellRingT = 9;
      if (V.first) { V.first = false; V.t = 0; }
    } });
    V.update = (dt) => {
      if (V.t < 0) return;
      const t0 = V.t; V.t += dt;
      for (let k = 0; k < 6; k++) { const tk = 1.2 + k * 0.45; if (t0 < tk && V.t >= tk) this.comp.spawn(door.clone().add(V3((Math.random() - 0.5) * 1.2, 0, (Math.random() - 0.5) * 1.2)), { rise: 2.5, vy: 1.6 }); }
      if (V.t > 5) V.t = -1;
    };
    V.reset = () => { V.t = -1; V.first = true; w.bellRingT = 0; };
    this.vign.push(V);
  }

  // Act II — the alebrijes at the foot of the steps light up
  alebrijes() {
    const w = this.w, A = w.alebrijes;
    if (!A) return;
    const V = { g: 0, t: -1 };
    const pal = [[1, 0.25, 0.55], [0.2, 0.8, 1], [1, 0.8, 0.1], [0.4, 1, 0.3], [0.8, 0.3, 1]];
    const mid = V3(); for (const it of A.list) mid.add(V3(it.x, it.y + 1.1, it.z)); mid.multiplyScalar(1 / A.list.length);
    const light = (it) => {
      V.g = 1;
      this.sparks.burst(V3(it.x, it.y + 1, it.z), 28, pal);
      if (w.audio) w.audio.chime([784, 988, 1175, 1568], 0.6, V3(it.x, it.y, it.z));
    };
    this.addHot({ p: mid, r: 1.4, u: L.steps.u, win: [2, 22], hold: 3.6, fn: () => { V.t = 0; } });
    V.update = (dt, t) => {
      if (V.t >= 0) {
        const t0 = V.t; V.t += dt;
        A.list.forEach((it, i) => { const tk = 0.3 + i * 0.85; if (t0 < tk && V.t >= tk) light(it); });
        if (V.t > 0.3 + A.list.length * 0.85 + 1) V.t = -1;
      }
      V.g = Math.max(0, V.g - dt * 0.35);
      A.mat.emissiveIntensity = V.g * (1.4 + 0.4 * Math.sin(t * 9)) * (0.4 + w.tod.night * 0.6);
    };
    V.reset = () => { V.g = 0; V.t = -1; };
    this.vign.push(V);
  }

  // Act II — a family grave; a woman keeps watch, and her dead comes to see her
  tumba() {
    const w = this.w;
    const S = bankSpot(w, 436, -1, { claim: 3, e0: 1.0, e1: 3.2 });
    const B = new Batch();
    const Mt = S.M;
    const put = (key, g, color, uvs) => B.add(key, g, Mt, { color, uvScale: uvs || 0.8 });
    put('cantera', box(0.95, 0.32, 1.9, 0, -0.08, -0.4), [0.92, 0.9, 0.86]);
    put('cantera', box(0.8, 0.95, 0.16, 0, 0.1, -1.3), [0.92, 0.9, 0.86]);
    put('cantera', box(0.1, 0.55, 0.08, 0, 1.05, -1.3), [0.9, 0.88, 0.84]);
    put('cantera', box(0.36, 0.08, 0.08, 0, 1.33, -1.3), [0.9, 0.88, 0.84]);
    put('wood', box(0.24, 0.3, 0.03, 0, 0.42, -1.2), [0.35, 0.22, 0.14]);
    put('plaster', box(0.18, 0.23, 0.01, 0, 0.45, -1.18), [0.62, 0.52, 0.4]);
    const arc = flowerArc(w, S, 0, 0.35, -1.12, 0.62, 40);
    B.add('cane', arc.tube, null, { color: [0.6, 0.5, 0.32] });
    B.build(w.scene, w.archMats);
    flowerCards(w, arc.cards, 'f_cempa', 0, 0.22);
    flowerCards(w, petalsScatter(S, 0, -0.4, 0.42, 0.9, 60).map((f) => { f.p.y = Math.max(f.p.y, S.y + 0.25); return f; }), 'f_petals', 0, 0.07, 5);
    const cpts = [];
    for (const z of [0.4, 0, -0.4, -0.8]) for (const x of [-0.4, 0.4]) cpts.push(Object.assign(S.at(x, 0.25, z), { h: 0.14 + Math.random() * 0.1 }));
    const cs = candleSet(w, cpts);
    const woman = new Character({ female: true, skirt: true, rebozo: true, scale: 0.86, res: 0.026, skin: [0.45, 0.3, 0.2], shirt: [0.18, 0.16, 0.2], skirtCol: [0.1, 0.1, 0.12], hair: [0.05, 0.04, 0.04], hipW: 0.088, shoulder: 0.17 });
    const wp = S.at(0.95, 0, -0.35); wp.y = terrainH(wp.x, wp.z) + 0.01;
    woman.group.position.copy(wp); woman.group.rotation.y = S.rot - Math.PI / 2 + 0.45;
    w.scene.add(woman.group);
    const V = { S, t: -1, spirit: null, look: 0 };
    const c = { v: 0 };
    w.updaters.push(() => { c.v = Math.min(1, w.tod.night * 0.95 + w.tod.dusk * 0.3 + (V.t >= 0 ? 0.4 : 0)); cs.mat.uniforms.uOn.value = c.v; });
    this.addHot({ p: S.at(0, 0.7, -0.6), r: 1.5, u: S.u, hold: 4.2, fn: () => {
      V.t = 0;
      V.spirit = this.comp.spawn(S.at(0, 0.4, -0.4), { rise: 1.4, vy: 0.6, orbit: { c: woman.worldPos(woman.b.head), r: 1.1, t: 7 } });
      if (w.audio) w.audio.chime([440, 523, 659, 880], 0.9, S.at(0, 1, 0));
    } });
    V.update = (dt) => {
      if (V.t >= 0) V.t += dt;
      if (w.cam.position.distanceTo(wp) > 130) return;
      const c2 = woman; c2.reset();
      c2.group.updateMatrixWorld(true);
      const M = c2.group.matrixWorld;
      // hands together, head bowed; she looks up and follows the ánima when it comes
      V.look = lerp(V.look, V.t >= 0 && V.t < 9 ? 1 : 0, 1 - Math.exp(-dt * 1.5));
      c2.b.neck.rotation.x = lerp(0.45, 0.0, V.look);
      c2.b.chest.rotation.x = lerp(0.12, 0.02, V.look);
      c2.ik2(c2.b.shL, c2.b.elL, c2.b.wrL, V3(0.03, 1.0, 0.24).applyMatrix4(M), V3(0.6, 0.8, -0.3).applyMatrix4(M));
      c2.ik2(c2.b.shR, c2.b.elR, c2.b.wrR, V3(-0.03, 1.0, 0.24).applyMatrix4(M), V3(-0.6, 0.8, -0.3).applyMatrix4(M));
      if (V.spirit && V.spirit.mode !== 0 && V.look > 0.05) lookAt(c2, V.spirit.p, V.look, 1.4);
    };
    V.glow = (list, cp) => { if (V.t >= 0) { const I = Math.min(1, V.t / 1.5) * (0.6 + 0.4 * Math.exp(-V.t * 0.2)); const g = S.at(0, 1.0, -1.0); list.push({ x: g.x, y: g.y, z: g.z, r: 7, cr: 2.2 * I, cg: 1.2 * I, cb: 0.45 * I, w: 18 / (1 + cp.distanceTo(g) * 0.08) }); } };
    V.reset = () => { V.t = -1; V.spirit = null; V.look = 0; };
    this.vign.push(V);
  }

  // Act III — by day, a tree covered in monarchs; as the trajinera passes they take to the air and some ride along
  oyamel() {
    const w = this.w;
    const U0 = 600;
    let best = null, bd = 1e9;
    for (const c of w.canopies || []) {
      const ud = toUD(c.trunk.x, c.trunk.z, {}, U0);
      if (Math.abs(ud.u - U0) > 45) continue;
      const e = Math.abs(ud.d) - halfW(ud.u);
      if (e < 1 || e > 14 || c.r < 2.5) continue;
      const score = e + Math.abs(ud.u - U0) * 0.25;
      if (score < bd) { bd = score; best = c; }
    }
    if (!best) return;
    const N = 260, tr = best.trunk, gy = terrainH(tr.x, tr.z);
    const items = [];
    const r = mulberry32(606);
    for (let i = 0; i < N; i++) {
      let p;
      if (i < 110) { const a = r() * 6.28, y = gy + 0.5 + r() * Math.max(1.5, best.y - best.r * 0.6 - gy); p = V3(tr.x + Math.cos(a) * (tr.r / 1.6 + 0.03), y, tr.z + Math.sin(a) * (tr.r / 1.6 + 0.03)); }
      else { const a = r() * 6.28, e = r() * 0.9 - 0.2; p = V3(best.x + Math.cos(a) * Math.cos(e) * best.r * 0.72, best.y + Math.sin(e) * best.r * 0.6, best.z + Math.sin(a) * Math.cos(e) * best.r * 0.72); }
      items.push({ rest: p, p: p.clone(), v: V3(), s: r() * 100, fly: 0 });
    }
    const P = new Float32Array(N * 4), Sd = new Float32Array(N * 4);
    items.forEach((it, i) => { Sd.set([it.s, r(), r(), 0], i * 4); P.set([it.p.x, it.p.y, it.p.z, 0], i * 4); });
    const g = instGeo(wingGeo(), [['iP', P, 4], ['iD', Sd, 4]], N);
    const m = new THREE.ShaderMaterial({
      uniforms: Object.assign({}, U, { tW: { value: tex('f_monarch') } }),
      vertexShader: GLSL_COMMON + /* glsl */`
        attribute vec4 iP; attribute vec4 iD; attribute float aSide; varying vec2 vUv; varying vec3 vW; varying float vL;
        void main() {
          float fly = iP.w;
          float flap = mix(0.9 + 0.35 * sin(uTime * 0.8 + iD.x), sin(uTime * (11.0 + iD.y * 5.0) + iD.x * 20.0) * 1.1, fly);
          float ang = flap * aSide;
          vec3 f = normalize(vec3(sin(iD.x * 7.0), 0.0, cos(iD.x * 7.0)));
          vec3 rt = normalize(cross(vec3(0.0, 1.0, 0.0), f)); vec3 up = cross(f, rt);
          vec3 lp = vec3(position.x * cos(ang), abs(position.x) * sin(ang) * aSide, position.z);
          vec3 wp = iP.xyz + (rt * lp.x + up * lp.y + f * -lp.z) * 0.12;
          vW = wp; vUv = vec2(uv.x, 1.0 - uv.y); vL = 1.0;
          gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
          if (distance(wp, cameraPosition) > 110.0) gl_Position = vec4(2.0);
        }`,
      fragmentShader: GLSL_COMMON + /* glsl */`
        uniform sampler2D tW; varying vec2 vUv; varying vec3 vW; varying float vL;
        void main() { vec4 c = texture2D(tW, vUv); if (c.a < 0.5) discard; gl_FragColor = vec4(c.rgb * (uAmbCol * 1.4 + uKeyCol * 0.8), 1.0); }`,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(g, m); mesh.frustumCulled = false; mesh.layers.set(5); mesh.name = 'oyamelMonarchs'; w.scene.add(mesh);
    const V = { t: -1 };
    const hotP = V3(best.x, Math.min(best.y, gy + 4), best.z);
    this.addHot({ p: hotP, r: Math.min(3, best.r * 0.6), u: U0, win: [6, 30], hold: 4.2, fn: () => {
      V.t = 0;
      for (const it of items) it.v.set((Math.random() - 0.5) * 2, 1 + Math.random() * 2, (Math.random() - 0.5) * 2);
      if (w.audio) w.audio.flutter(hotP, 1.2);
    } });
    V.update = (dt, t) => {
      const cam = w.cam.position;
      if (cam.distanceTo(hotP) > 140) return;
      for (let i = 0; i < N; i++) {
        const it = items[i];
        if (V.t >= 0) {
          it.fly = Math.min(1, it.fly + dt * 3);
          const a = t * (0.6 + (it.s % 1) * 0.5) + it.s;
          const tgt = V3(hotP.x + Math.cos(a) * (3 + (it.s % 4)), hotP.y + 2 + Math.sin(a * 0.7) * 2 + (i % 5), hotP.z + Math.sin(a) * (3 + (it.s % 4)));
          if (V.t > 9) tgt.lerp(it.rest, smoothstep(9, 16, V.t));
          const acc = tgt.sub(it.p).multiplyScalar(0.9).addScaledVector(it.v, -0.9);
          it.v.addScaledVector(acc, dt);
          it.p.addScaledVector(it.v, dt);
          if (V.t > 16) { it.p.lerp(it.rest, 0.1); it.fly = Math.max(0, it.fly - dt); }
        }
        P.set([it.p.x, it.p.y, it.p.z, it.fly], i * 4);
      }
      if (V.t >= 0) {
        const t0 = V.t; V.t += dt;
        // a handful of them stay with the trajinera
        for (let k = 0; k < 14; k++) { const tk = 0.4 + k * 0.18; if (t0 < tk && V.t >= tk) this.comp.spawn(items[(k * 37) % N].p.clone(), { rise: 1.5 }); }
        if (V.t > 18) V.t = 18;
      }
      g.attributes.iP.needsUpdate = true;
    };
    V.reset = () => { V.t = -1; for (const it of items) { it.p.copy(it.rest); it.fly = 0; } };
    this.vign.push(V);
  }

  reset() {
    for (const v of this.vign) v.reset && v.reset();
    this.comp.clear(); this.vel.clear();
    for (const h of this.hot) h.played = false;
    this.slowT = 0; this.velT = 4;
  }
  // the trajinero leaves a veladora beside the hull, alternating sides; an ánima is born from it
  dropVeladora() {
    const b = this.w.boat;
    const side = this.vel.placed % 2 ? 1 : -1;
    const p = b.pos.clone().addScaledVector(b.fwd, -0.5 + Math.random() * 2.5);
    p.x += -b.fwd.z * side * 1.9; p.z += b.fwd.x * side * 1.9; p.y = 0.03;
    const ud = toUD(p.x, p.z, {}, b.u);
    if (Math.abs(ud.d) > halfW(ud.u) - 0.6 || terrainH(p.x, p.z) > 0.02) return false;
    this.vel.place(p);
    return true;
  }
  update(dt, t) {
    const w = this.w, b = w.boat;
    for (const v of this.vign) v.update && v.update(dt, t);
    this.comp.update(dt, t);
    this.vel.update(dt, t);
    this.sparks.update(dt);
    this.petals.update(dt);
    if (!this.ready || !this.auto) { w.slow = 1; return; }
    // scenes start by themselves when the trajinera reaches them; it goes slower while they happen
    let want = 1;
    for (const h of this.hot) {
      if (h.played) continue;
      const du = h.u - b.u;
      if (du < -40 || du > 90) continue;
      const rx = h.p.x - b.pos.x, rz = h.p.z - b.pos.z;
      const along = rx * b.fwd.x + rz * b.fwd.z;
      if (along >= h.win[0] && along <= h.win[1]) this.play(h);
      else if (along < h.win[0]) h.played = true;
      else if (along < h.win[1] + 14) want = Math.min(want, 0.7);
    }
    this.slowT = Math.max(0, this.slowT - dt);
    if (this.slowT > 0) want = Math.min(want, 0.6);
    this.slow = lerp(this.slow, want, 1 - Math.exp(-dt * 0.8));
    w.slow = this.slow;
    // veladoras through the night
    if (w.tod.night > 0.6 && !w.looping) {
      this.velT -= dt;
      if (this.velT <= 0) this.velT = this.dropVeladora() ? 9 + Math.random() * 5 : 1;
    } else this.velT = Math.min(this.velT, 3);
  }
  glowSource() {
    return (list, cp) => { for (const v of this.vign) if (typeof v.glow === 'function') v.glow(list, cp); };
  }
}
