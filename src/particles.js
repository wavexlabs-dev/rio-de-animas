import * as THREE from 'three';
import { U, GLSL_COMMON, GLSL_FOG, GLSL_GLOW } from './materials.js';
import { tex } from './textures.js';
import { mulberry32, lerp, clamp, smoothstep, simplex2 } from './noise.js';
import { R, toWorld, toUD, halfW, frame, flowAt, terrainH } from './river.js';
import { CX_GLSL } from './plants.js';
import { L } from './layout.js';

const HALFW_GLSL = /* glsl */`
float halfWG(float u) {
  float w = 16.5 + 1.6 * sin(u / 57.0 + 1.0) + 0.8 * sin(u / 23.0);
  w = mix(w, 13.5 + sin(u / 40.0) * 1.2, gss(300.0, 600.0, u));
  w = mix(w, 9.5 + sin(u / 31.0) * 1.0, gss(600.0, 860.0, u));
  w = mix(w, 7.8 + sin(u / 19.0) * 0.8, gss(860.0, 980.0, u));
  w = mix(w, 17.6, exp(-pow((u - 236.0) / 26.0, 2.0)));
  return w;
}`;

function instGeo(base, attrs, count) {
  const g = new THREE.InstancedBufferGeometry();
  g.index = base.index;
  for (const k of Object.keys(base.attributes)) g.setAttribute(k, base.attributes[k]);
  for (const [k, arr, sz] of attrs) g.setAttribute(k, new THREE.InstancedBufferAttribute(arr, sz));
  g.instanceCount = count;
  return g;
}
function addMesh(world, g, m, layer, name, order = 0) {
  const mesh = new THREE.Mesh(g, m);
  mesh.frustumCulled = false;
  mesh.layers.set(layer);
  mesh.renderOrder = order;
  mesh.name = name;
  world.scene.add(mesh);
  return mesh;
}

// ------------------------------------------------------------------ falling petals
export function fallingPetals(world) {
  const emit = [];
  for (const c of world.canopies) {
    const kind = c.kind === 'cazahuate' ? 2 : c.kind === 'ahuehuete' ? 3 : c.kind === 'amate' ? 3 : 3;
    const n = c.kind === 'cazahuate' ? 28 : 10;
    for (let i = 0; i < n; i++) emit.push([c.x, c.y, c.z, c.r, kind, terrainH(c.x, c.z)]);
  }
  for (const f of (world.arcoFlowers || []).filter((_, i) => i % 12 === 0)) emit.push([f.p.x, f.p.y, f.p.z, 0.4, 0, f.p.y - 6]);
  const N = emit.length + 500;
  const E = new Float32Array(N * 4), K = new Float32Array(N * 4);
  const rnd = mulberry32(5);
  emit.forEach((e, i) => { E.set([e[0], e[1], e[2], e[3]], i * 4); K.set([e[4], e[5], rnd() * 100, rnd()], i * 4); });
  for (let i = emit.length; i < N; i++) { E.set([0, 0, 0, -1], i * 4); K.set([rnd() < 0.6 ? 0 : 1, 0, rnd() * 100, rnd()], i * 4); }
  const base = new THREE.PlaneGeometry(1, 1);
  const g = instGeo(base, [['iE', E, 4], ['iK', K, 4]], N);
  const m = new THREE.ShaderMaterial({
    uniforms: Object.assign({}, U, { tP: { value: tex('f_petals') }, uCam: { value: new THREE.Vector3() } }),
    vertexShader: GLSL_COMMON + /* glsl */`
      attribute vec4 iE; attribute vec4 iK;
      varying vec2 vUv; varying vec3 vW; varying float vA; varying vec3 vN;
      mat3 rot(vec3 a) { float cx = cos(a.x), sx = sin(a.x), cy = cos(a.y), sy = sin(a.y), cz = cos(a.z), sz = sin(a.z);
        return mat3(cy * cz, cy * sz, -sy, sx * sy * cz - cx * sz, sx * sy * sz + cx * cz, sx * cy, cx * sy * cz + sx * sz, cx * sy * sz - sx * cz, cx * cy); }
      void main() {
        float life = 9.0 + iK.w * 6.0;
        float t = mod(uTime + iK.z, life);
        float cyc = floor((uTime + iK.z) / life);
        float h1 = fract(sin(cyc * 12.9898 + iK.z * 78.233) * 43758.5453);
        float h2 = fract(sin(cyc * 39.346 + iK.z * 11.135) * 24634.6345);
        float h3 = fract(sin(cyc * 73.156 + iK.z * 52.235) * 15431.2123);
        vec3 start; float ground;
        if (iE.w < 0.0) {
          // ambient petals around camera
          start = cameraPosition + vec3((h1 - 0.5) * 60.0, 6.0 + h2 * 10.0, (h3 - 0.5) * 60.0);
          ground = start.y - 18.0;
        } else {
          start = iE.xyz + vec3((h1 - 0.5) * 2.0, (h2 - 0.3), (h3 - 0.5) * 2.0) * iE.w * 0.8;
          ground = iK.y;
        }
        float vf = 0.55 + h2 * 0.5;
        vec3 wind = vec3(uWind.x, 0.0, uWind.y) * (0.6 + uWind.z * 1.4);
        vec3 p = start + wind * t + vec3(sin(t * 1.7 + h1 * 6.0), 0.0, cos(t * 1.3 + h2 * 6.0)) * 0.6;
        p.y = max(start.y - vf * t, ground + 0.03);
        float landed = step(p.y, ground + 0.031);
        vA = smoothstep(0.0, 0.8, t) * (1.0 - smoothstep(life - 1.5, life, t));
        float dc = distance(p, cameraPosition);
        vA *= 1.0 - smoothstep(70.0, 110.0, dc);
        vec3 ang = vec3(t * (2.0 + h1 * 3.0), t * (1.5 + h2 * 2.0), t * 2.2) * (1.0 - landed);
        mat3 R = rot(ang);
        float s = iK.x < 0.5 ? 0.05 : iK.x < 1.5 ? 0.055 : iK.x < 2.5 ? 0.07 : 0.05;
        vec3 lp = R * vec3(position.x * s, position.y * s, 0.0);
        vN = R * vec3(0.0, 0.0, 1.0);
        vW = p + lp;
        vUv = vec2((uv.x + iK.x) / 4.0, uv.y);
        gl_Position = projectionMatrix * viewMatrix * vec4(vW, 1.0);
        if (vA <= 0.001) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      }`,
    fragmentShader: GLSL_COMMON + GLSL_FOG + /* glsl */`
      uniform sampler2D tP;
      varying vec2 vUv; varying vec3 vW; varying float vA; varying vec3 vN;
      void main() {
        vec4 c = texture2D(tP, vUv);
        if (c.a < 0.5) discard;
        vec3 V = normalize(cameraPosition - vW);
        vec3 N = normalize(vN); if (dot(N, V) < 0.0) N = -N;
        float dif = abs(dot(N, uKeyDir)) * 0.8 + 0.2;
        float back = pow(max(dot(-V, uKeyDir), 0.0), 3.0);
        vec3 col = c.rgb * (uAmbCol * 1.4 + uKeyCol * dif * 0.8 + uKeyCol * back * 0.8) + c.rgb * uFlash * 0.3;
        col = applyFog(col, vW);
        gl_FragColor = vec4(col, 1.0);
      }`,
    side: THREE.DoubleSide,
  });
  return addMesh(world, g, m, 5, 'fallPetals');
}

// ------------------------------------------------------------------ floating petals (CPU)
export class FloatingPetals {
  constructor(world) {
    this.w = world;
    this.N = 3200;
    const rnd = this.rnd = mulberry32(99);
    this.u = new Float32Array(this.N); this.d = new Float32Array(this.N); this.kind = new Uint8Array(this.N); this.rot = new Float32Array(this.N); this.age = new Float32Array(this.N);
    for (let i = 0; i < this.N; i++) this.spawnBank(i, R.START_U - 40 + rnd() * 260);
    const base = new THREE.PlaneGeometry(1, 1);
    base.rotateX(-Math.PI / 2);
    this.P = new Float32Array(this.N * 4);
    this.g = instGeo(base, [['iP', this.P, 4]], this.N);
    const m = new THREE.ShaderMaterial({
      uniforms: Object.assign({}, U, { tP: { value: tex('f_petals') } }),
      vertexShader: GLSL_COMMON + /* glsl */`
        attribute vec4 iP; varying vec2 vUv; varying vec3 vW;
        void main() {
          float k = floor(iP.w); float r = fract(iP.w) * 6.2832;
          float s = k < 0.5 ? 0.075 : k < 1.5 ? 0.08 : k < 2.5 ? 0.1 : 0.07;
          vec2 q = vec2(position.x * cos(r) - position.z * sin(r), position.x * sin(r) + position.z * cos(r)) * s;
          vW = vec3(iP.x + q.x, 0.012 + sin(uTime * 1.3 + iP.x) * 0.004, iP.z + q.y);
          vUv = vec2((uv.x + k) / 4.0, uv.y);
          gl_Position = projectionMatrix * viewMatrix * vec4(vW, 1.0);
        }`,
      fragmentShader: GLSL_COMMON + GLSL_FOG + /* glsl */`
        uniform sampler2D tP; varying vec2 vUv; varying vec3 vW;
        void main() {
          vec4 c = texture2D(tP, vUv);
          if (c.a < 0.5) discard;
          vec3 col = c.rgb * 0.85 * (uAmbCol * 1.3 + uKeyCol * max(uKeyDir.y, 0.0) * 0.9) + c.rgb * uFlash * 0.3;
          gl_FragColor = vec4(applyFog(col, vW), 1.0);
        }`,
    });
    this.mesh = addMesh(world, this.g, m, 2, 'floatPetals', 2);
    this.trailTimer = 0;
  }
  spawnBank(i, u) {
    const r = this.rnd;
    const w = halfW(u);
    const side = r() < 0.5 ? -1 : 1;
    // rafts: clustered in slack water near banks
    const cl = Math.floor(u / 9);
    const off = Math.sin(cl * 12.3) * 0.5 + 0.5;
    this.u[i] = u + (r() - 0.5) * 3;
    this.d[i] = side * (w - 0.4 - Math.pow(r(), 2.2) * (2.5 + off * 3));
    const kr = r();
    this.kind[i] = kr < 0.62 ? 0 : kr < 0.87 ? 1 : 2;
    this.rot[i] = r();
    this.age[i] = 0;
  }
  update(dt) {
    const w = this.w, b = w.boat;
    const cu = b.u;
    const fl = {};
    const P = this.P;
    const bx = b.pos.x, bz = b.pos.z, fx = b.fwd.x, fz = b.fwd.z;
    const tmp = {};
    // petals shed by the boat into its wake
    this.trailTimer += dt;
    let shed = 0;
    while (this.trailTimer > 0.09) { this.trailTimer -= 0.09; shed++; }
    for (let i = 0; i < this.N; i++) {
      let u = this.u[i], d = this.d[i];
      if (shed > 0 && (u < cu - 90 || u > cu + 200) && this.rnd() < 0.5) {
        // respawn at stern
        const sp = b.world_(new THREE.Vector3((this.rnd() - 0.5) * 1.4, 0, -4.3 - this.rnd() * 0.5));
        toUD(sp.x, sp.z, tmp, cu);
        u = tmp.u; d = tmp.d; this.kind[i] = 0; this.rot[i] = this.rnd(); shed--;
      } else if (u < cu - 110 || u > cu + 230) {
        this.spawnBank(i, cu + 40 + this.rnd() * 180); u = this.u[i]; d = this.d[i];
      }
      const wd = halfW(u);
      const t = Math.min(1, Math.abs(d) / wd);
      const vmax = lerp(0.85, 1.5, smoothstep(650, 950, u));
      const sp = vmax * (1 - t * t * 0.95);
      u -= sp * dt;
      d += (Math.sin(u * 0.3 + i) * 0.05 + (Math.abs(d) > wd - 0.3 ? -Math.sign(d) * 0.2 : 0)) * dt;
      this.u[i] = u; this.d[i] = d;
      toWorld(u, d, fl);
      // boat pushes petals aside
      let x = fl.x, z = fl.z;
      const rx = x - bx, rz = z - bz;
      const a = rx * fx + rz * fz;
      if (Math.abs(a) < 5 && rx * rx + rz * rz < 30) {
        const lat = -rx * fz + rz * fx;
        const need = 1.15 * Math.sqrt(Math.max(0, 1 - (a * a) / 21));
        if (Math.abs(lat) < need) {
          const push = (need - Math.abs(lat)) * Math.sign(lat || 1);
          x += -fz * push; z += fx * push;
          toUD(x, z, tmp, u); this.u[i] = tmp.u; this.d[i] = tmp.d;
        }
      }
      P[i * 4] = x; P[i * 4 + 1] = 0; P[i * 4 + 2] = z; P[i * 4 + 3] = this.kind[i] + this.rot[i] * 0.999;
    }
    this.g.attributes.iP.needsUpdate = true;
  }
}

// ------------------------------------------------------------------ dust motes (in sun shafts)
export function dustMotes(world) {
  const N = 2200;
  const S = new Float32Array(N * 4);
  const r = mulberry32(7);
  for (let i = 0; i < N; i++) S.set([r(), r(), r(), r()], i * 4);
  const g = instGeo(new THREE.PlaneGeometry(1, 1), [['iS', S, 4]], N);
  const m = new THREE.ShaderMaterial({
    uniforms: Object.assign({}, U, { tRays: { value: null }, uRes: { value: new THREE.Vector2(1, 1) }, uAmt: { value: 1 } }),
    vertexShader: GLSL_COMMON + /* glsl */`
      attribute vec4 iS; varying vec2 vUv; varying float vB; varying vec3 vW;
      void main() {
        vec3 box = vec3(34.0, 14.0, 34.0);
        vec3 p = iS.xyz * box + vec3(sin(uTime * 0.2 + iS.w * 6.0), sin(uTime * 0.13 + iS.x * 9.0) * 0.6, cos(uTime * 0.17 + iS.y * 7.0)) * 0.8 + vec3(uWind.x, 0.0, uWind.y) * uTime * 0.25;
        p = mod(p - cameraPosition + box * 0.5, box) + cameraPosition - box * 0.5;
        p.y = max(p.y, 0.4);
        vec3 toC = cameraPosition - p;
        float d = length(toC);
        vec3 f = toC / d;
        vec3 rr = normalize(cross(vec3(0.0, 1.0, 0.0), f)); vec3 uu = cross(f, rr);
        float s = 0.012 + iS.w * 0.012;
        vW = p;
        vec3 wp = p + (rr * position.x + uu * position.y) * s * (1.0 + d * 0.05);
        vUv = uv;
        vB = pow(max(dot(-f, uSunDir), 0.0), 3.0) * 0.8 + 0.2;
        gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
      }`,
    fragmentShader: GLSL_COMMON + /* glsl */`
      uniform sampler2D tRays; uniform vec2 uRes; uniform float uAmt;
      varying vec2 vUv; varying float vB; varying vec3 vW;
      void main() {
        float r = length(vUv - 0.5) * 2.0;
        float a = exp(-r * r * 4.0);
        float shaft = texture2D(tRays, gl_FragCoord.xy / uRes).r;
        float lit = smoothstep(0.05, 0.6, shaft);
        vec3 c = uKeyCol * a * lit * vB * 0.35 * uAmt;
        gl_FragColor = vec4(c, 1.0);
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const mesh = addMesh(world, g, m, 3, 'motes', 5);
  world.updaters.push(() => {
    m.uniforms.tRays.value = world.raysTex;
    m.uniforms.uRes.value.set(world.post.w, world.post.h);
    m.uniforms.uAmt.value = world.tod.keyIsSun ? (1 - world.tod.storm) : 0;
  });
  return mesh;
}

// ------------------------------------------------------------------ river mist
export function riverMist(world) {
  const N = 90;
  const S = new Float32Array(N * 4);
  const r = mulberry32(17);
  for (let i = 0; i < N; i++) S.set([r(), r(), r(), r()], i * 4);
  const g = instGeo(new THREE.PlaneGeometry(1, 1), [['iS', S, 4]], N);
  const m = new THREE.ShaderMaterial({
    uniforms: Object.assign({}, U, { tCopy: { value: world.post.rtCopy.texture }, uRes: { value: new THREE.Vector2(1, 1) }, uCamU: { value: 0 }, uDens: { value: 0.5 }, uFall: { value: R.FALL_U } }),
    vertexShader: GLSL_COMMON + CX_GLSL + HALFW_GLSL + /* glsl */`
      attribute vec4 iS; uniform float uCamU; uniform float uDens; uniform float uFall;
      varying vec2 vUv; varying vec3 vW; varying float vA; varying float vViewZ; varying float vSeed;
      void main() {
        float span = 320.0;
        float u = uCamU - 60.0 + mod(iS.x * span - uTime * 0.7, span);
        float w = halfWG(u);
        float d = (iS.y - 0.5) * 2.0 * (w + 6.0);
        vec2 xz = udToXZ(vec2(u, d));
        float fallNear = smoothstep(uFall - 60.0, uFall, u);
        float sz = mix(9.0, 20.0, iS.z) * (1.0 + fallNear);
        vec3 c = vec3(xz.x, sz * 0.13 + 0.1, xz.y);
        vec3 toC = cameraPosition - c; toC.y = 0.0;
        vec3 f = normalize(toC + vec3(1e-4));
        vec3 rr = vec3(f.z, 0.0, -f.x);
        vec3 p = c + rr * position.x * sz + vec3(0.0, position.y * sz * 0.28, 0.0);
        vW = p; vUv = uv; vSeed = iS.w;
        vA = (uDens * (0.35 + 0.65 * iS.w) + fallNear * 0.8) * smoothstep(-60.0, -30.0, u - uCamU) * (1.0 - smoothstep(200.0, 260.0, u - uCamU));
        vec4 mv = viewMatrix * vec4(p, 1.0);
        vViewZ = -mv.z;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: GLSL_COMMON + GLSL_FOG + GLSL_GLOW + /* glsl */`
      uniform sampler2D tCopy; uniform vec2 uRes;
      varying vec2 vUv; varying vec3 vW; varying float vA; varying float vViewZ; varying float vSeed;
      void main() {
        vec2 q = vUv - 0.5;
        float edge = smoothstep(0.5, 0.1, length(q * vec2(1.0, 1.6)));
        float n = texture2D(tNoise, vUv * 0.7 + vec2(uTime * 0.01 + vSeed, uTime * 0.004)).r * 0.6 + texture2D(tNoise, vUv * 1.9 - vec2(uTime * 0.013, 0.0) + vSeed).g * 0.4;
        float a = edge * smoothstep(0.35, 0.8, n) * vA;
        float sceneZ = texture2D(tCopy, gl_FragCoord.xy / uRes).a;
        a *= smoothstep(0.0, 3.0, sceneZ - vViewZ) * smoothstep(1.0, 5.0, vViewZ);
        if (a < 0.003) discard;
        vec3 V = normalize(vW - cameraPosition);
        float fwd = pow(max(dot(V, uKeyDir), 0.0), 6.0);
        vec3 col = uFogCol * 0.9 + uAmbCol * 0.5 + uKeyCol * (0.12 + fwd * 0.9);
        col += glowIrradiance(vW, vec3(0.0, 1.0, 0.0)) * 0.9 + uFlash * 0.5;
        gl_FragColor = vec4(col, a * 0.38);
      }`,
    transparent: true, depthWrite: false,
  });
  const mesh = addMesh(world, g, m, 3, 'mist', 6);
  world.updaters.push(() => {
    m.uniforms.uRes.value.set(world.post.w, world.post.h);
    m.uniforms.uCamU.value = world.boat.u;
    m.uniforms.uDens.value = world.tod.s.mist * 0.9 + world.tod.rain * 0.3;
  });
  return mesh;
}

// ------------------------------------------------------------------ rain + splashes
export function rain(world) {
  const N = 6500;
  const S = new Float32Array(N * 4);
  const r = mulberry32(23);
  for (let i = 0; i < N; i++) S.set([r(), r(), r(), r()], i * 4);
  const g = instGeo(new THREE.PlaneGeometry(1, 1), [['iS', S, 4]], N);
  const m = new THREE.ShaderMaterial({
    uniforms: Object.assign({}, U, { uAmt: { value: 0 } }),
    vertexShader: GLSL_COMMON + /* glsl */`
      attribute vec4 iS; uniform float uAmt; varying float vA; varying vec2 vUv;
      void main() {
        vec3 box = vec3(46.0, 26.0, 46.0);
        float fall = 11.0 + iS.w * 3.0;
        vec3 wind = vec3(uWind.x, 0.0, uWind.y) * (1.5 + uWind.z * 2.0);
        vec3 p = iS.xyz * box - vec3(0.0, uTime * fall, 0.0) + wind * uTime;
        p = mod(p - cameraPosition + box * 0.5, box) + cameraPosition - box * 0.5;
        vec3 vel = normalize(vec3(wind.x, -fall, wind.z));
        vec3 toC = normalize(cameraPosition - p);
        vec3 side = normalize(cross(vel, toC));
        float len = 0.45 + iS.w * 0.3;
        vec3 wp = p + side * position.x * 0.006 + vel * position.y * len;
        vA = step(iS.w, uAmt) * (0.5 + 0.5 * iS.x);
        vUv = uv;
        gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
        if (vA < 0.01 || p.y < -0.2) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      }`,
    fragmentShader: GLSL_COMMON + /* glsl */`
      varying float vA; varying vec2 vUv;
      void main() {
        float a = (1.0 - abs(vUv.x - 0.5) * 2.0) * smoothstep(0.0, 0.3, vUv.y) * smoothstep(1.0, 0.7, vUv.y) * vA;
        vec3 c = (uAmbCol * 0.9 + uFogCol * 0.4 + uFlash * vec3(0.8, 0.85, 1.0) * 2.0);
        gl_FragColor = vec4(c, a * 0.13);
      }`,
    transparent: true, depthWrite: false,
  });
  addMesh(world, g, m, 3, 'rain', 7);
  // splash crowns on water
  const NS = 700;
  const S2 = new Float32Array(NS * 4);
  for (let i = 0; i < NS; i++) S2.set([r(), r(), r(), r()], i * 4);
  const crown = new THREE.CylinderGeometry(0.5, 0.2, 1, 8, 1, true);
  crown.translate(0, 0.5, 0);
  const g2 = instGeo(crown, [['iS', S2, 4]], NS);
  const m2 = new THREE.ShaderMaterial({
    uniforms: Object.assign({}, U, { uAmt: { value: 0 }, uCamU: { value: 0 } }),
    vertexShader: GLSL_COMMON + CX_GLSL + HALFW_GLSL + /* glsl */`
      attribute vec4 iS; uniform float uAmt; uniform float uCamU; varying float vT; varying float vA;
      void main() {
        float per = 0.45 + iS.w * 0.3;
        float t = mod(uTime + iS.z * 10.0, per) / per;
        float cyc = floor((uTime + iS.z * 10.0) / per);
        float h1 = fract(sin(cyc * 12.9898 + iS.x * 78.233) * 43758.5453), h2 = fract(sin(cyc * 39.34 + iS.y * 11.13) * 24634.63);
        float u = uCamU - 5.0 + h1 * 45.0;
        float d = (h2 - 0.5) * 2.0 * (halfWG(u) - 0.5);
        vec2 xz = udToXZ(vec2(u, d));
        float s = 0.05 + 0.05 * iS.x;
        vec3 p = vec3(xz.x, 0.0, xz.y) + vec3(position.x * s * (0.6 + t), position.y * s * 1.6 * sin(t * 3.1416), position.z * s * (0.6 + t));
        vT = t; vA = step(iS.w, uAmt);
        gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
        if (vA < 0.5) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      }`,
    fragmentShader: GLSL_COMMON + /* glsl */`
      varying float vT; varying float vA;
      void main() { gl_FragColor = vec4((uAmbCol * 1.2 + uFogCol * 0.4 + uFlash), (1.0 - vT) * 0.3); }`,
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
  });
  addMesh(world, g2, m2, 3, 'splash', 7);
  world.updaters.push(() => {
    const a = world.tod.rain;
    m.uniforms.uAmt.value = a; m2.uniforms.uAmt.value = a;
    m2.uniforms.uCamU.value = toUD(world.cam.position.x, world.cam.position.z).u;
  });
}

// ------------------------------------------------------------------ lightning
export class Lightning {
  constructor(world) {
    this.w = world;
    this.timer = 4;
    this.flash = 0;
    this.bolts = [];
    this.mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(6, 6.5, 9), transparent: true, opacity: 1, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
    this.mesh = null;
    this.env = [];
  }
  strike() {
    const w = this.w;
    const cam = w.cam.position;
    const ang = (Math.random() - 0.5) * 2.2 + Math.atan2(w.boat.fwd.x, w.boat.fwd.z);
    const dist = 500 + Math.random() * 1800;
    const gx = cam.x + Math.sin(ang) * dist, gz = cam.z + Math.cos(ang) * dist;
    const gy = terrainH(gx, gz);
    const top = new THREE.Vector3(gx + (Math.random() - 0.5) * 300, 900, gz + (Math.random() - 0.5) * 300);
    const bottom = new THREE.Vector3(gx, gy, gz);
    const segs = [];
    const branch = (a, b, depth, width) => {
      const pts = [a.clone()];
      const n = 14;
      for (let i = 1; i < n; i++) {
        const p = a.clone().lerp(b, i / n);
        const j = a.distanceTo(b) / n * 0.8;
        p.x += (Math.random() - 0.5) * j; p.z += (Math.random() - 0.5) * j; p.y += (Math.random() - 0.5) * j * 0.3;
        pts.push(p);
      }
      pts.push(b.clone());
      for (let i = 0; i < pts.length - 1; i++) segs.push([pts[i], pts[i + 1], width]);
      if (depth < 2) for (let k = 0; k < 3; k++) {
        const i = 2 + Math.floor(Math.random() * (pts.length - 4));
        const from = pts[i];
        const to = from.clone().add(new THREE.Vector3((Math.random() - 0.5) * 300, -150 - Math.random() * 250, (Math.random() - 0.5) * 300));
        branch(from, to, depth + 1, width * 0.5);
      }
    };
    branch(top, bottom, 0, 3.5);
    const pos = [];
    const up = new THREE.Vector3();
    for (const [a, b, wdt] of segs) {
      const dir = b.clone().sub(a).normalize();
      const toC = cam.clone().sub(a).normalize();
      const side = new THREE.Vector3().crossVectors(dir, toC).normalize().multiplyScalar(wdt);
      const a1 = a.clone().add(side), a2 = a.clone().sub(side), b1 = b.clone().add(side), b2 = b.clone().sub(side);
      pos.push(...a1.toArray(), ...a2.toArray(), ...b1.toArray(), ...a2.toArray(), ...b2.toArray(), ...b1.toArray());
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    if (this.mesh) { w.scene.remove(this.mesh); this.mesh.geometry.dispose(); }
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.layers.set(2);
    w.scene.add(this.mesh);
    this.t = 0;
    this.pattern = [0, 0.07, 0.14, 0.26].map((t) => t + Math.random() * 0.03);
    U.uFlashDir = U.uFlashDir || { value: new THREE.Vector3() };
    if (w.sky) w.sky.uniforms.uFlashDir.value.copy(top.clone().sub(cam).normalize());
    const delay = cam.distanceTo(bottom) / 343;
    if (w.audio) w.audio.thunder(delay, dist);
  }
  update(dt) {
    const w = this.w;
    const storm = w.tod.rain;
    if (storm > 0.5) {
      this.timer -= dt * (w.fastForward ? 3 : 1);
      if (this.timer <= 0) { this.strike(); this.timer = 5 + Math.random() * 11; }
    }
    let f = 0;
    if (this.mesh) {
      this.t += dt;
      for (const p of this.pattern) { const x = this.t - p; if (x > 0) f = Math.max(f, Math.exp(-x * 22) * (x < 0.04 ? 1 : 0.8)); }
      this.mat.opacity = Math.min(1, f * 1.4);
      this.mesh.visible = f > 0.02;
      if (this.t > 1.2) { w.scene.remove(this.mesh); this.mesh = null; }
    }
    U.uFlash.value = f * 1.6;
  }
}

// ------------------------------------------------------------------ fireflies
export function fireflies(world) {
  const N = 420;
  const S = new Float32Array(N * 4);
  const r = mulberry32(31);
  for (let i = 0; i < N; i++) S.set([r(), r(), r(), r()], i * 4);
  const g = instGeo(new THREE.PlaneGeometry(1, 1), [['iS', S, 4]], N);
  const m = new THREE.ShaderMaterial({
    uniforms: Object.assign({}, U, { uAmt: { value: 0 }, tUD: { value: world.udt.tex }, uUDBox: { value: world.udt.box } }),
    vertexShader: GLSL_COMMON + CX_GLSL + HALFW_GLSL + /* glsl */`
      attribute vec4 iS; uniform float uAmt; uniform sampler2D tUD; uniform vec4 uUDBox;
      varying vec2 vUv; varying float vB;
      void main() {
        vec2 camUD = vec2(-cameraPosition.z, 0.0);
        float u = camUD.x - 20.0 + iS.x * 110.0;
        float side = iS.y < 0.5 ? -1.0 : 1.0;
        float d = side * (halfWG(u) - 1.0 + fract(iS.y * 2.0) * 22.0);
        vec2 xz = udToXZ(vec2(u, d));
        vec2 tuv = vec2((d - uUDBox.y) * uUDBox.w, (u - uUDBox.x) * uUDBox.z);
        float h = texture(tUD, tuv).r;
        vec3 p = vec3(xz.x, max(h, 0.0) + 0.4 + iS.z * 1.6, xz.y);
        p += vec3(sin(uTime * 0.4 + iS.w * 20.0), sin(uTime * 0.7 + iS.x * 30.0) * 0.4, cos(uTime * 0.35 + iS.z * 20.0)) * 0.9;
        float blink = pow(max(sin(uTime * (0.6 + iS.w) + iS.x * 40.0), 0.0), 8.0);
        vB = blink * step(iS.w, uAmt);
        vec3 toC = normalize(cameraPosition - p);
        vec3 rr = normalize(cross(vec3(0.0, 1.0, 0.0), toC)); vec3 uu = cross(toC, rr);
        float dd = distance(cameraPosition, p);
        vec3 wp = p + (rr * position.x + uu * position.y) * (0.05 + dd * 0.004);
        vUv = uv;
        gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
        if (vB < 0.01) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      }`,
    fragmentShader: /* glsl */`
      varying vec2 vUv; varying float vB;
      void main() { float r = length(vUv - 0.5) * 2.0; float a = exp(-r * r * 6.0); gl_FragColor = vec4(vec3(0.75, 1.0, 0.35) * a * vB * 6.0, 1.0); }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  addMesh(world, g, m, 2, 'fireflies', 8);
  world.updaters.push(() => { const t = world.tod; m.uniforms.uAmt.value = clamp(t.dusk * 1.5 + t.night * 0.6, 0, 1) * (1 - t.rain); });
}

// ------------------------------------------------------------------ copal smoke
export function smoke(world, sources) {
  const perSrc = 70;
  const N = perSrc * sources.length;
  const S = new Float32Array(N * 4), O = new Float32Array(N * 4);
  const r = mulberry32(41);
  for (let i = 0; i < N; i++) { S.set([r(), r(), r(), r()], i * 4); O.set([0, 0, 0, Math.floor(i / perSrc)], i * 4); }
  const g = instGeo(new THREE.PlaneGeometry(1, 1), [['iS', S, 4], ['iO', O, 4]], N);
  const srcU = { value: sources.map(() => new THREE.Vector4()) };
  const m = new THREE.ShaderMaterial({
    uniforms: Object.assign({}, U, { uSrc: srcU, tCopy: { value: world.post.rtCopy.texture }, uRes: { value: new THREE.Vector2(1, 1) } }),
    vertexShader: GLSL_COMMON + /* glsl */`
      attribute vec4 iS; attribute vec4 iO; uniform vec4 uSrc[${sources.length}];
      varying vec2 vUv; varying float vA; varying vec3 vW; varying float vViewZ;
      void main() {
        vec4 src = uSrc[int(iO.w)];
        float life = 5.0 + iS.w * 3.0;
        float t = mod(uTime + iS.x * life, life);
        float k = t / life;
        vec3 wind = vec3(uWind.x, 0.0, uWind.y) * (0.35 + uWind.z * 0.6);
        vec3 p = src.xyz + vec3(0.0, t * (0.35 + iS.y * 0.2), 0.0) + wind * t * t * 0.18 + vec3(sin(t * 1.1 + iS.z * 9.0), 0.0, cos(t * 0.9 + iS.y * 7.0)) * 0.12 * t;
        float s = (0.12 + k * 1.3) * src.w;
        vec3 toC = normalize(cameraPosition - p);
        vec3 rr = normalize(cross(vec3(0.0, 1.0, 0.0), toC)); vec3 uu = cross(toC, rr);
        float a = iS.z * 6.28 + t * 0.3;
        vec2 q = vec2(position.x * cos(a) - position.y * sin(a), position.x * sin(a) + position.y * cos(a));
        vec3 wp = p + (rr * q.x + uu * q.y) * s;
        vW = wp; vUv = uv;
        vA = smoothstep(0.0, 0.08, k) * (1.0 - k) * src.w;
        vec4 mv = viewMatrix * vec4(wp, 1.0); vViewZ = -mv.z;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: GLSL_COMMON + GLSL_FOG + /* glsl */`
      uniform sampler2D tCopy; uniform vec2 uRes;
      varying vec2 vUv; varying float vA; varying vec3 vW; varying float vViewZ;
      void main() {
        float r = length(vUv - 0.5) * 2.0;
        float n = texture2D(tNoise, vUv * 0.8 + vW.xz * 0.05).r;
        float a = smoothstep(1.0, 0.2, r) * smoothstep(0.3, 0.7, n) * vA * 0.35;
        float sceneZ = texture2D(tCopy, gl_FragCoord.xy / uRes).a;
        a *= smoothstep(0.0, 0.5, sceneZ - vViewZ);
        if (a < 0.003) discard;
        vec3 V = normalize(vW - cameraPosition);
        float fwd = pow(max(dot(V, uKeyDir), 0.0), 5.0);
        vec3 col = vec3(0.8, 0.8, 0.82) * (uAmbCol * 1.5 + uKeyCol * (0.35 + fwd * 2.5));
        gl_FragColor = vec4(applyFog(col, vW), a);
      }`,
    transparent: true, depthWrite: false,
  });
  addMesh(world, g, m, 3, 'smoke', 9);
  world.updaters.push(() => {
    m.uniforms.uRes.value.set(world.post.w, world.post.h);
    sources.forEach((s, i) => { const p = s(); if (p) srcU.value[i].set(p.x, p.y, p.z, p.w !== undefined ? p.w : 1); else srcU.value[i].set(0, -999, 0, 0); });
  });
}

// ------------------------------------------------------------------ splash droplets (pole)
export class Splashes {
  constructor(world) {
    this.w = world;
    this.N = 160;
    this.p = []; for (let i = 0; i < this.N; i++) this.p.push({ x: 0, y: -99, z: 0, vx: 0, vy: 0, vz: 0, life: 0 });
    this.i = 0;
    this.P = new Float32Array(this.N * 4);
    const g = instGeo(new THREE.PlaneGeometry(1, 1), [['iP', this.P, 4]], this.N);
    this.g = g;
    const m = new THREE.ShaderMaterial({
      uniforms: Object.assign({}, U),
      vertexShader: GLSL_COMMON + /* glsl */`
        attribute vec4 iP; varying vec2 vUv; varying float vA;
        void main() {
          vec3 toC = normalize(cameraPosition - iP.xyz);
          vec3 rr = normalize(cross(vec3(0.0, 1.0, 0.0), toC)); vec3 uu = cross(toC, rr);
          vec3 wp = iP.xyz + (rr * position.x + uu * position.y) * 0.025;
          vUv = uv; vA = iP.w;
          gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
        }`,
      fragmentShader: GLSL_COMMON + /* glsl */`
        varying vec2 vUv; varying float vA;
        void main() { float r = length(vUv - 0.5) * 2.0; if (r > 1.0) discard; gl_FragColor = vec4((uAmbCol * 2.0 + uKeyCol * 0.6) , vA * (1.0 - r)); }`,
      transparent: true, depthWrite: false,
    });
    addMesh(world, g, m, 3, 'droplets', 9);
    world.onPoleSplash = (p, s) => this.burst(p, s);
  }
  burst(p, s) {
    for (let k = 0; k < 18 * s; k++) {
      const q = this.p[this.i++ % this.N];
      q.x = p.x; q.y = Math.max(p.y, 0) + 0.02; q.z = p.z;
      if (p.y < 0) q.y = 0.02;
      const a = Math.random() * 6.28, sp = 0.4 + Math.random() * 1.2;
      q.vx = Math.cos(a) * sp * 0.6; q.vz = Math.sin(a) * sp * 0.6; q.vy = 1 + Math.random() * 1.6 * s;
      q.life = 1;
    }
  }
  drip(p) {
    const q = this.p[this.i++ % this.N];
    q.x = p.x + (Math.random() - 0.5) * 0.04; q.y = p.y; q.z = p.z + (Math.random() - 0.5) * 0.04; q.vx = 0; q.vz = 0; q.vy = 0; q.life = 1;
  }
  update(dt) {
    const b = this.w.boat;
    // drips from the pole tip while it is out of the water
    if (b.poleTipW && b.poleTipW.y > 0.05 && Math.random() < 0.6) this.drip(b.poleTipW);
    for (let i = 0; i < this.N; i++) {
      const q = this.p[i];
      if (q.life > 0) {
        q.vy -= 9.8 * dt; q.x += q.vx * dt; q.y += q.vy * dt; q.z += q.vz * dt;
        if (q.y < 0) { q.life = 0; if (Math.random() < 0.1) this.w.water.pole(q.x, q.z, -0.01, 0.02); }
        q.life -= dt * 0.8;
      }
      this.P[i * 4] = q.x; this.P[i * 4 + 1] = q.life > 0 ? q.y : -99; this.P[i * 4 + 2] = q.z; this.P[i * 4 + 3] = Math.max(0, q.life);
    }
    this.g.attributes.iP.needsUpdate = true;
  }
}
