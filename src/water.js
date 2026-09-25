import * as THREE from 'three';
import { U, GLSL_COMMON, GLSL_FOG, GLSL_GLOW } from './materials.js';
import { R, halfW, frame, toWorld, flowAt, toUD } from './river.js';
import { tex, ntex } from './textures.js';
import { clamp, smoothstep } from './noise.js';

const WAKE_N = 256, WAKE_SIZE = 72;

export class Water {
  constructor(world, obstacles) {
    this.world = world;
    this.obstacles = obstacles;
    this.buildMesh();
    this.buildObstacleMap();
    this.buildWake();
    this.buildMaterial();
    this.mesh = new THREE.Mesh(this.geo, this.mat);
    this.mesh.layers.set(1);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
    this.mesh.name = 'water';
    world.scene.add(this.mesh);
    this.vcam = new THREE.PerspectiveCamera();
    this.texMat = new THREE.Matrix4();
    this.boat = null;
    this.poleImpulse = null;
    this.raindrops = 0;
  }
  buildMesh() {
    const us = [];
    for (let u = R.U_MIN + 20; u <= R.FALL_U + 1.5; u += 1.0) us.push(u);
    const cols = 26;
    const pos = [], flow = [], ud = [];
    const f = {}, fl = {};
    for (const u of us) {
      const w = halfW(u) + 5;
      for (let j = 0; j <= cols; j++) {
        const t = j / cols * 2 - 1;
        const d = Math.sign(t) * Math.pow(Math.abs(t), 0.8) * w;
        const p = toWorld(u, d);
        pos.push(p.x, 0, p.z);
        flowAt(u, Math.min(Math.abs(d), halfW(u)) * Math.sign(d), fl);
        flow.push(fl.x, fl.z, fl.s);
        ud.push(u, d / halfW(u));
      }
    }
    const idx = [];
    const nc = cols + 1;
    for (let i = 0; i < us.length - 1; i++) for (let j = 0; j < cols; j++) {
      const a = i * nc + j, b = a + 1, c = a + nc, d = c + 1;
      idx.push(a, b, c, b, d, c);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('aFlow', new THREE.Float32BufferAttribute(flow, 3));
    g.setAttribute('aUD', new THREE.Float32BufferAttribute(ud, 2));
    g.setIndex(idx);
    g.computeBoundingBox();
    this.geo = g;
    this.bbox = g.boundingBox;
  }
  buildObstacleMap() {
    const bb = this.bbox;
    const res = 0.5;
    const W = Math.ceil((bb.max.x - bb.min.x) / res) + 1;
    const H = Math.ceil((bb.max.z - bb.min.z) / res) + 1;
    const data = new Uint8Array(W * H * 4);
    const fl = {};
    const ud = {};
    for (const o of this.obstacles) {
      toUD(o.x, o.z, ud);
      flowAt(ud.u, ud.d, fl);
      let fx = fl.x, fz = fl.z;
      const fs = Math.hypot(fx, fz) || 1; fx /= fs; fz /= fs;
      const r = o.r;
      const reach = r + 6 + r * 6;
      const x0 = Math.max(0, Math.floor((o.x - reach - bb.min.x) / res)), x1 = Math.min(W - 1, Math.ceil((o.x + reach - bb.min.x) / res));
      const z0 = Math.max(0, Math.floor((o.z - reach - bb.min.z) / res)), z1 = Math.min(H - 1, Math.ceil((o.z + reach - bb.min.z) / res));
      for (let j = z0; j <= z1; j++) for (let i = x0; i <= x1; i++) {
        const px = bb.min.x + i * res, pz = bb.min.z + j * res;
        const dx = px - o.x, dz = pz - o.z;
        const dist = Math.hypot(dx, dz);
        const along = dx * fx + dz * fz, lat = -dx * fz + dz * fx;
        const sub = o.sub !== undefined ? o.sub : 1;
        let foam = Math.exp(-Math.pow((dist - r) / (0.35 + 0.12 * r), 2)) * (0.7 + 0.5 * smoothstep(0, -r, along)) * sub;
        if (along > 0) {
          const wdt = r * (0.75 + along * 0.06);
          foam = Math.max(foam, Math.exp(-Math.pow(lat / wdt, 2)) * Math.exp(-along / (3 + r * 4.5)) * 0.85 * sub * smoothstep(r * 0.5, r * 1.2, along + r));
        }
        const speed = Math.exp(-Math.pow((Math.abs(lat) - r * 1.2) / (r * 0.8), 2)) * smoothstep(-r * 2, 0, along) * Math.exp(-Math.max(0, along) / (r * 6));
        const k = (j * W + i) * 4;
        data[k] = Math.max(data[k], Math.min(255, foam * 255));
        data[k + 1] = Math.max(data[k + 1], Math.min(255, speed * 255));
      }
    }
    const t = new THREE.DataTexture(data, W, H, THREE.RGBAFormat);
    t.minFilter = THREE.LinearFilter; t.magFilter = THREE.LinearFilter; t.generateMipmaps = false;
    t.needsUpdate = true;
    this.obsTex = t;
    this.obsBox = new THREE.Vector4(bb.min.x, bb.min.z, 1 / (W * res), 1 / (H * res));
  }
  buildWake() {
    const opt = { type: THREE.HalfFloatType, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, wrapS: THREE.ClampToEdgeWrapping, wrapT: THREE.ClampToEdgeWrapping };
    this.wakeRT = [new THREE.WebGLRenderTarget(WAKE_N, WAKE_N, opt), new THREE.WebGLRenderTarget(WAKE_N, WAKE_N, opt)];
    this.wakeIdx = 0;
    this.wakeOrigin = new THREE.Vector2(0, 0);
    this.wakeMat = new THREE.ShaderMaterial({
      uniforms: {
        tPrev: { value: null }, uShift: { value: new THREE.Vector2() }, uBoat: { value: new THREE.Vector4() }, uBoatDir: { value: new THREE.Vector2(0, -1) },
        uHull: { value: new THREE.Vector3(4.3, 0.95, 0) }, uAdv: { value: new THREE.Vector2() }, uPole: { value: new THREE.Vector4() },
        uDrop: { value: new THREE.Vector4() }, uTexel: { value: 1 / WAKE_N }, uCell: { value: WAKE_SIZE / WAKE_N }, uDt: { value: 1 / 60 },
      },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: /* glsl */`
        uniform sampler2D tPrev; uniform vec2 uShift; uniform vec4 uBoat; uniform vec2 uBoatDir; uniform vec3 uHull;
        uniform vec2 uAdv; uniform vec4 uPole; uniform vec4 uDrop; uniform float uTexel; uniform float uCell; uniform float uDt;
        varying vec2 vUv;
        vec4 S(vec2 uv) { if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) return vec4(0.0); return texture2D(tPrev, uv); }
        void main() {
          vec2 uv = vUv + uShift - uAdv;
          vec4 c = S(uv);
          float hl = S(uv - vec2(uTexel, 0.0)).r, hr = S(uv + vec2(uTexel, 0.0)).r, hd = S(uv - vec2(0.0, uTexel)).r, hu = S(uv + vec2(0.0, uTexel)).r;
          float lap = hl + hr + hd + hu - 4.0 * c.r;
          float cc = 1.25 * uDt / uCell; // wave speed ~1.25 m/s
          float h = c.r + (c.r - c.g) * 0.992 + cc * cc * lap;
          h *= 0.998;
          // hull pressure (world-space ellipse)
          vec2 wp = (vUv - 0.5) * ${WAKE_SIZE.toFixed(1)} + uBoat.xy;
          vec2 rel = wp - uBoat.zw;
          vec2 f = uBoatDir, s = vec2(-f.y, f.x);
          float a = dot(rel, f), b = dot(rel, s);
          float ell = (a * a) / (uHull.x * uHull.x) + (b * b) / (uHull.y * uHull.y);
          float hullP = smoothstep(1.0, 0.35, ell);
          float spd = uHull.z;
          h = mix(h, -0.10 * hullP * clamp(spd, 0.3, 2.5), hullP * 0.35);
          // bow push
          float bow = exp(-pow((a - uHull.x * 0.92) / 0.6, 2.0) - pow(b / (uHull.y * 0.9), 2.0));
          h += bow * 0.018 * spd;
          // pole plant impulse
          vec2 pr = wp - uPole.xy;
          h += exp(-dot(pr, pr) / 0.35) * uPole.z;
          // rain / drops
          vec2 dr = wp - uDrop.xy;
          h += exp(-dot(dr, dr) / 0.05) * uDrop.z;
          float slope = length(vec2(hr - hl, hu - hd));
          float edge = smoothstep(1.2, 0.8, ell) * smoothstep(0.5, 0.9, ell);
          float foam = max(c.b * 0.985, clamp(slope * 4.0 + edge * 0.12 * spd + bow * 0.25 * spd + exp(-dot(pr, pr) / 0.15) * uPole.w, 0.0, 0.8));
          gl_FragColor = vec4(clamp(h, -0.6, 0.6), c.r, foam, 1.0);
        }`,
      depthTest: false, depthWrite: false,
    });
  }
  buildMaterial() {
    const w = this.world;
    this.uniforms = Object.assign({}, U, {
      tRefl: { value: w.post.rtRefl.texture }, tCopy: { value: w.post.rtCopy.texture },
      tN1: { value: ntex('water_n') }, tN2: { value: ntex('water_n2') }, tFoam: { value: ntex('foam') },
      tObs: { value: this.obsTex }, uObsBox: { value: this.obsBox },
      tWake: { value: this.wakeRT[0].texture }, uWakeBox: { value: new THREE.Vector3(0, 0, 1 / WAKE_SIZE) },
      uTexMat: { value: new THREE.Matrix4() }, uRes: { value: new THREE.Vector2(1, 1) },
      uScat: { value: new THREE.Color(0.015, 0.034, 0.021) }, uAbs: { value: new THREE.Vector3(0.8, 0.4, 0.6) },
      uFallU: { value: R.FALL_U },
    });
    this.mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: /* glsl */`
        attribute vec3 aFlow; attribute vec2 aUD;
        uniform mat4 uTexMat;
        varying vec3 vW; varying vec3 vFlow; varying vec2 vUD; varying vec4 vRefl; varying float vViewZ;
        void main() {
          vec4 w = modelMatrix * vec4(position, 1.0);
          vW = w.xyz; vFlow = aFlow; vUD = aUD;
          vRefl = uTexMat * w;
          vec4 mv = viewMatrix * w;
          vViewZ = -mv.z;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: GLSL_COMMON + GLSL_FOG + GLSL_GLOW + /* glsl */`
        uniform sampler2D tRefl, tCopy, tN1, tN2, tFoam, tObs, tWake;
        uniform vec4 uObsBox; uniform vec3 uWakeBox; uniform vec2 uRes; uniform vec3 uScat; uniform vec3 uAbs; uniform float uFallU;
        varying vec3 vW; varying vec3 vFlow; varying vec2 vUD; varying vec4 vRefl; varying float vViewZ;
        vec3 nmap(sampler2D t, vec2 uv) { return texture2D(t, uv).xyz * 2.0 - 1.0; }
        float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
        vec2 rainRipples(vec2 p, float t) {
          vec2 acc = vec2(0.0);
          for (int k = 0; k < 2; k++) {
            vec2 q = p * (k == 0 ? 1.7 : 2.9) + float(k) * 7.3;
            vec2 id = floor(q), f = fract(q) - 0.5;
            float h = hash12(id + float(k) * 13.1);
            float tt = fract(t * (0.9 + h * 0.6) + h);
            vec2 o = vec2(hash12(id + 3.1), hash12(id + 7.7)) - 0.5;
            vec2 d = f - o * 0.6;
            float r = length(d);
            float ring = sin((r - tt * 0.55) * 60.0) * exp(-pow((r - tt * 0.55) * 14.0, 2.0)) * (1.0 - tt);
            acc += d / max(r, 1e-3) * ring;
          }
          return acc;
        }
        void main() {
          vec3 V = cameraPosition - vW;
          float dist = length(V);
          V /= dist;
          vec2 flow = vFlow.xy;
          float spd = vFlow.z;
          vec2 obsUV = (vW.xz - uObsBox.xy) * uObsBox.zw;
          vec4 obs = texture2D(tObs, obsUV);
          flow *= 1.0 + obs.g * 1.2;
          // flow-mapped normals
          // two phases, each faded out while it wraps back (weight 0 at its reset), with a slow spatial
          // phase offset so the whole river never cross-fades in unison
          float T = 3.2;
          float po = texture2D(tNoise, vW.xz * 0.012).r;
          float ph0 = fract(uTime / T + po), ph1 = fract(uTime / T + po + 0.5);
          float bl = abs(1.0 - 2.0 * ph0);
          vec2 uv = vW.xz / 7.5;
          vec2 o0 = -flow / 7.5 * ph0 * T, o1 = -flow / 7.5 * ph1 * T + 0.37;
          vec3 na = mix(nmap(tN1, uv + o0), nmap(tN1, uv + o1), bl);
          vec2 uv2 = vW.xz / 1.9;
          vec2 p0 = -flow / 1.9 * ph0 * T * 1.2, p1 = -flow / 1.9 * ph1 * T * 1.2 + 0.61;
          vec3 nb = mix(nmap(tN2, uv2 + p0), nmap(tN2, uv2 + p1), bl);
          vec3 nc = nmap(tN2, vW.xz / 0.7 + vec2(uTime * 0.05, -uTime * 0.04));
          float lod = 1.0 - smoothstep(25.0, 180.0, dist);
          float vil = smoothstep(80.0, 125.0, vUD.x) * (1.0 - smoothstep(430.0, 490.0, vUD.x));
          float rough = (0.38 + spd * 0.45) * (1.0 - 0.25 * vil) + obs.r * 0.8;
          vec2 nxy = na.xy * 0.55 * rough + nb.xy * 0.38 * (0.4 + 0.6 * lod) * rough + nc.xy * (0.18 + 0.06 * vil) * lod;
          // wake simulation
          vec2 wuv = (vW.xz - uWakeBox.xy) * uWakeBox.z + 0.5;
          float wfoam = 0.0;
          if (wuv.x > 0.0 && wuv.y > 0.0 && wuv.x < 1.0 && wuv.y < 1.0) {
            float e = 1.0 / ${WAKE_N.toFixed(1)};
            float hl = texture2D(tWake, wuv - vec2(e, 0.0)).r, hr = texture2D(tWake, wuv + vec2(e, 0.0)).r;
            float hd = texture2D(tWake, wuv - vec2(0.0, e)).r, hu = texture2D(tWake, wuv + vec2(0.0, e)).r;
            float edgeF = smoothstep(0.0, 0.12, wuv.x) * smoothstep(1.0, 0.88, wuv.x) * smoothstep(0.0, 0.12, wuv.y) * smoothstep(1.0, 0.88, wuv.y);
            nxy -= vec2(hr - hl, hu - hd) * 6.5 * edgeF;
            wfoam = texture2D(tWake, wuv).b * edgeF;
          }
          if (uRain > 0.01) nxy += rainRipples(vW.xz, uTime) * 0.35 * uRain * lod;
          vec3 N = normalize(vec3(nxy.x, 1.0, nxy.y));
          // screen-space refraction
          vec2 suv = gl_FragCoord.xy / uRes;
          vec4 sc = texture2D(tCopy, suv);
          float thick = max(sc.a - vViewZ, 0.0);
          vec2 ruv = suv + N.xz * 0.045 * clamp(thick * 0.6, 0.0, 1.0) * (0.3 + 0.7 * lod);
          vec4 sc2 = texture2D(tCopy, ruv);
          if (sc2.a < vViewZ) { sc2 = sc; ruv = suv; }
          float path = max(sc2.a - vViewZ, 0.0) * dist / max(vViewZ, 1e-3);
          path = min(path, 60.0);
          // turbidity: the pueblo canals are murky olive water, the mountain river upstream runs clearer
          float murky = clamp(vil + (1.0 - smoothstep(470.0, 640.0, vUD.x)) * 0.55, 0.0, 1.0);
          vec3 absK = uAbs * (1.0 + 1.7 * murky);
          vec3 Tr = exp(-absK * path);
          vec3 lightAmt = uAmbCol + uKeyCol * max(uKeyDir.y, 0.0) * 0.6;
          vec3 scatCol = mix(uScat, vec3(0.030, 0.034, 0.016), murky);
          vec3 refr = (sc2.rgb * Tr + scatCol * lightAmt * (1.0 - Tr) * 2.2) * mix(1.0, 0.45, uNight);
          // reflection: ripples smear the mirror image into vertical streaks, more with distance and chop
          vec2 ruvR = vRefl.xy / vRefl.w + N.xz * 0.03 * (0.4 + 0.6 * lod);
          float smear = (0.004 + rough * 0.016) * clamp(dist / 45.0, 0.25, 1.4);
          vec3 refl = texture2D(tRefl, ruvR).rgb * 0.30
            + (texture2D(tRefl, ruvR + vec2(0.0, smear)).rgb + texture2D(tRefl, ruvR - vec2(0.0, smear)).rgb) * 0.22
            + (texture2D(tRefl, ruvR + vec2(0.0, smear * 2.3)).rgb + texture2D(tRefl, ruvR - vec2(0.0, smear * 2.3)).rgb) * 0.13;
          float cosT = max(dot(N, V), 0.0);
          float F = 0.02 + 0.98 * pow(1.0 - cosT, 5.0);
          float contact = smoothstep(0.0, 0.25, path);
          vec3 col = mix(refr, refl, F * contact);
          // specular key light: tight glints on calm water, a broader sun path on chop
          vec3 Rv = reflect(-V, N);
          float rl = max(dot(Rv, uKeyDir), 0.0);
          float sp = pow(rl, mix(2400.0, 500.0, clamp(rough, 0.0, 1.0))) * 9.0 + pow(rl, 60.0) * 0.16 * (0.4 + rough);
          col += uKeyCol * sp * F * 4.0 * contact * step(0.0, uKeyDir.y);
          // glow lights reflected + light pools
          for (int i = 0; i < MAXG; i++) {
            float r = uGlowPos[i].w;
            if (r <= 0.0) continue;
            vec3 Lv = uGlowPos[i].xyz - vW;
            float d2 = dot(Lv, Lv);
            float d = sqrt(d2);
            vec3 Ld = Lv / d;
            float att = 1.0 / (1.0 + d2 * 0.02);
            float rd = max(dot(Rv, Ld), 0.0);
            col += uGlowCol[i] * ((pow(rd, 260.0) * 1.8 + pow(rd, 36.0) * 0.06) * att + pow(max(1.0 - d / r, 0.0), 2.0) * 0.07) * contact;
          }
          // foam
          float fmask = obs.r + wfoam * 0.6;
          float shore = smoothstep(0.95, 1.0, abs(vUD.y)) * 0.13 * smoothstep(0.02, 0.3, path) * smoothstep(0.35, 0.75, texture2D(tFoam, vW.xz / 17.0).g);
          fmask += shore;
          fmask += smoothstep(uFallU - 26.0, uFallU - 1.0, vUD.x) * 0.9 * (1.0 - smoothstep(0.3, 0.9, abs(vUD.y)));
          fmask += uRain * 0.06;
          vec2 fuv = vW.xz / 3.1;
          float fp = mix(texture2D(tFoam, fuv - flow / 3.1 * ph0 * T).r, texture2D(tFoam, fuv - flow / 3.1 * ph1 * T + 0.5).r, bl);
          float fp2 = texture2D(tFoam, vW.xz / 1.1 - flow * uTime / 1.1 * 0.8).r;
          float foam = smoothstep(1.0 - fmask, 1.0 - fmask + 0.35, fp * 0.7 + fp2 * 0.3) * clamp(fmask * 1.5, 0.0, 1.0);
          foam = clamp(foam, 0.0, 1.0) * contact;
          vec3 foamCol = (uAmbCol * 1.2 + uKeyCol * max(uKeyDir.y, 0.05) * 0.9) * 0.9 + uFlash * 0.4;
          col = mix(col, foamCol, foam * 0.92);
          col = applyFog(col, vW);
          gl_FragColor = vec4(col, 1.0);
        }`,
    });
  }
  setBoat(b) { this.boat = b; }
  pole(x, z, strength, foam) { this.poleImpulse = [x, z, strength, foam]; }
  update(dt) {
    const r = this.world.r;
    const post = this.world.post;
    this.uniforms.uRes.value.set(post.w, post.h);
    // wake sim centred on boat (or camera)
    const b = this.boat;
    const cx = b ? b.pos.x : this.world.cam.position.x;
    const cz = b ? b.pos.z : this.world.cam.position.z;
    const cell = WAKE_SIZE / WAKE_N;
    const ox = Math.round(cx / cell) * cell, oz = Math.round(cz / cell) * cell;
    const m = this.wakeMat;
    const steps = 2;
    const sdt = Math.min(dt, 1 / 30) / steps;
    const fl = {};
    const ud = toUD(cx, cz);
    flowAt(ud.u, ud.d, fl);
    for (let s = 0; s < steps; s++) {
      const src = this.wakeRT[this.wakeIdx], dst = this.wakeRT[1 - this.wakeIdx];
      m.uniforms.tPrev.value = src.texture;
      if (s === 0) m.uniforms.uShift.value.set((ox - this.wakeOrigin.x) / WAKE_SIZE, (oz - this.wakeOrigin.y) / WAKE_SIZE);
      else m.uniforms.uShift.value.set(0, 0);
      m.uniforms.uAdv.value.set(fl.x * sdt / WAKE_SIZE, fl.z * sdt / WAKE_SIZE);
      m.uniforms.uDt.value = Math.max(sdt, 1 / 240);
      m.uniforms.uBoat.value.set(ox, oz, b ? b.pos.x : -9999, b ? b.pos.z : -9999);
      if (b) {
        m.uniforms.uBoatDir.value.set(b.fwd.x, b.fwd.z);
        m.uniforms.uHull.value.set(4.3, 0.98, b.speedRel || 0);
      }
      if (this.poleImpulse && s === 0) {
        const p = this.poleImpulse;
        m.uniforms.uPole.value.set(p[0], p[1], p[2], p[3]);
        this.poleImpulse = null;
      } else m.uniforms.uPole.value.set(0, 0, 0, 0);
      if (U.uRain.value > 0.05 && Math.random() < U.uRain.value) {
        m.uniforms.uDrop.value.set(ox + (Math.random() - 0.5) * 30, oz + (Math.random() - 0.5) * 30, -0.04, 0);
      } else m.uniforms.uDrop.value.set(0, 0, 0, 0);
      this.world.post.pass(m, dst);
      this.wakeIdx = 1 - this.wakeIdx;
      this.wakeOrigin.set(ox, oz);
    }
    this.uniforms.tWake.value = this.wakeRT[this.wakeIdx].texture;
    this.uniforms.uWakeBox.value.set(ox, oz, 1 / WAKE_SIZE);
  }
  renderReflection(world) {
    const cam = world.cam, vc = this.vcam, r = world.r;
    const normal = new THREE.Vector3(0, 1, 0);
    const reflPos = new THREE.Vector3(0, R.WATER_Y, 0);
    const camPos = new THREE.Vector3().setFromMatrixPosition(cam.matrixWorld);
    reflPos.x = camPos.x; reflPos.z = camPos.z;
    const rot = new THREE.Matrix4().extractRotation(cam.matrixWorld);
    const view = new THREE.Vector3().subVectors(reflPos, camPos).reflect(normal).negate().add(reflPos);
    const look = new THREE.Vector3(0, 0, -1).applyMatrix4(rot).add(camPos);
    const target = new THREE.Vector3().subVectors(reflPos, look).reflect(normal).negate().add(reflPos);
    vc.position.copy(view);
    vc.up.set(0, 1, 0).applyMatrix4(rot).reflect(normal);
    vc.lookAt(target);
    vc.far = cam.far; vc.near = cam.near;
    vc.updateMatrixWorld();
    vc.projectionMatrix.copy(cam.projectionMatrix);
    this.texMat.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
    this.texMat.multiply(vc.projectionMatrix);
    this.texMat.multiply(vc.matrixWorldInverse);
    this.uniforms.uTexMat.value.copy(this.texMat);
    // oblique clip plane
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, reflPos);
    plane.applyMatrix4(vc.matrixWorldInverse);
    const clip = new THREE.Vector4(plane.normal.x, plane.normal.y, plane.normal.z, plane.constant);
    const pm = vc.projectionMatrix;
    const q = new THREE.Vector4((Math.sign(clip.x) + pm.elements[8]) / pm.elements[0], (Math.sign(clip.y) + pm.elements[9]) / pm.elements[5], -1.0, (1.0 + pm.elements[10]) / pm.elements[14]);
    clip.multiplyScalar(2.0 / clip.dot(q));
    pm.elements[2] = clip.x; pm.elements[6] = clip.y; pm.elements[10] = clip.z + 1.0 - 0.003; pm.elements[14] = clip.w;
    vc.layers.set(0); vc.layers.enable(2);
    r.setRenderTarget(world.post.rtRefl);
    r.setClearColor(0x000000, 1);
    r.clear(true, true, false);
    world.inReflection = true;
    r.render(world.scene, vc);
    world.inReflection = false;
  }
}
