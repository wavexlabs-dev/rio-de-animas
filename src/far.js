// Distant ranges and the volcanoes (Popocatepetl + Iztaccihuatl)
import * as THREE from 'three';
import { U, GLSL_COMMON, GLSL_FOG } from './materials.js';
import { fbm2, ridged2, mulberry32, smoothstep, clamp, lerp } from './noise.js';

const FAR_FRAG = GLSL_COMMON + /* glsl */`
uniform float uLayer; uniform float uSnowH; uniform float uAlpen; uniform vec3 uHor; uniform vec3 uGlow;
varying vec3 vW; varying vec3 vN; varying float vH;
void main() {
  vec3 N = normalize(vN);
  vec3 V = vW - cameraPosition;
  float dist = length(V);
  vec3 dir = V / dist;
  float dif = max(dot(N, uKeyDir), 0.0);
  vec3 rockC = mix(vec3(0.16, 0.17, 0.16), vec3(0.22, 0.21, 0.18), smoothstep(0.0, 1.0, vH));
  float forest = (1.0 - smoothstep(2600.0, 3600.0, vW.y)) * smoothstep(0.35, 0.8, N.y);
  rockC = mix(rockC, vec3(0.07, 0.1, 0.06), forest * 0.8);
  float snow = smoothstep(uSnowH - 150.0, uSnowH + 250.0, vW.y + (N.y - 0.7) * 400.0) * step(0.0, uSnowH);
  vec3 alb = mix(rockC, vec3(0.9, 0.92, 0.96), snow);
  vec3 col = alb * (uAmbCol * (0.6 + 0.4 * N.y) * 1.4 + uKeyCol * dif * 0.9);
  col += alb * uGlow * uAlpen * snow * dif * 1.8;
  // aerial perspective: strong, layered
  float haze = 1.0 - exp(-dist * (0.00011 + uFogDen * 0.18) * uLayer);
  float sunAmt = pow(max(dot(dir, uSunDir), 0.0), 5.0);
  vec3 hc = mix(mix(uFogCol, uHor, 0.5), uFogSun, sunAmt);
  col = mix(col, hc, clamp(haze, 0.0, 0.93));
  col += uFlash * 0.25 * hc;
  gl_FragColor = vec4(col, 1.0);
}`;
const FAR_VERT = /* glsl */`
attribute float aH;
varying vec3 vW; varying vec3 vN; varying float vH;
void main() { vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; vN = normalize(mat3(modelMatrix) * normal); vH = aH; gl_Position = projectionMatrix * viewMatrix * w; }`;

function farMat(layer, snowH, sky) {
  return new THREE.ShaderMaterial({
    uniforms: Object.assign({}, U, { uLayer: { value: layer }, uSnowH: { value: snowH }, uAlpen: { value: 0 }, uHor: sky.uniforms.uHor, uGlow: sky.uniforms.uGlow }),
    vertexShader: FAR_VERT, fragmentShader: FAR_FRAG,
  });
}

export function buildFar(world) {
  const scene = world.scene;
  const cx = -20, cz = -520;
  const rings = [[2600, 260, 520, 0.9, 11], [4200, 420, 900, 0.75, 23], [7000, 700, 1400, 0.6, 37], [11500, 1000, 1900, 0.5, 51]];
  const mats = [];
  for (const [rad, h0, h1, layer, seed] of rings) {
    const na = 360, nr = 10;
    const pos = [], aH = [], idx = [];
    for (let i = 0; i <= na; i++) {
      const a = i / na * Math.PI * 2;
      for (let j = 0; j <= nr; j++) {
        const t = j / nr;
        const r = rad + (t - 0.5) * rad * 0.35;
        const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
        const ridge = ridged2(Math.cos(a) * 3 + seed, Math.sin(a) * 3 + t * 0.8, 4);
        const pk = h0 + (h1 - h0) * (0.35 + 0.65 * ridge) * Math.sin(Math.PI * Math.min(1, t * 1.15));
        const y = t === 0 || t === 1 ? -50 : pk * (0.75 + 0.25 * fbm2(x * 0.001, z * 0.001, 3));
        pos.push(x, y, z);
        aH.push(ridge);
      }
    }
    for (let i = 0; i < na; i++) for (let j = 0; j < nr; j++) { const a = i * (nr + 1) + j, b = a + 1, c = a + nr + 1, d = c + 1; idx.push(a, c, b, b, c, d); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('aH', new THREE.Float32BufferAttribute(aH, 1));
    g.setIndex(idx);
    g.computeVertexNormals();
    const m = farMat(layer, -1, world.sky);
    m.side = THREE.DoubleSide;
    mats.push(m);
    const mesh = new THREE.Mesh(g, m);
    mesh.frustumCulled = false; mesh.name = 'range';
    scene.add(mesh);
  }
  // volcanoes
  const volcano = (az, dist, H, R, seed, ridgeLen = 0) => {
    const dx = Math.cos(az), dz = Math.sin(az);
    const X = cx + dx * dist, Z = cz + dz * dist;
    const nr = 70, na = 140;
    const pos = [], aH = [], idx = [];
    for (let j = 0; j <= nr; j++) {
      const t = j / nr;
      for (let i = 0; i <= na; i++) {
        const a = i / na * Math.PI * 2;
        let r = t * R;
        const gully = ridged2(Math.cos(a) * 6 + seed, Math.sin(a) * 6 + t * 3, 3);
        let h;
        if (ridgeLen) {
          // long reclining massif
          const ex = Math.cos(a) * r * 1.0, ez = Math.sin(a) * r * 0.42;
          const along = ex / R;
          const prof = Math.max(0, 1 - Math.pow(Math.abs(ez) / (R * 0.42), 1.5)) * (0.75 + 0.2 * Math.exp(-Math.pow((along + 0.35) / 0.18, 2)) + 0.25 * Math.exp(-Math.pow((along - 0.05) / 0.22, 2)) + 0.15 * Math.exp(-Math.pow((along - 0.45) / 0.15, 2)));
          h = H * prof * (1 - Math.pow(Math.abs(along), 3)) * (0.92 + 0.08 * gully);
          const rot = az + Math.PI / 2 + 0.3;
          const lx = ex * Math.cos(rot) - ez * Math.sin(rot), lz = ex * Math.sin(rot) + ez * Math.cos(rot);
          pos.push(X + lx, h - 300, Z + lz);
        } else {
          h = H * Math.pow(1 - t, 1.55) * (0.93 + 0.07 * gully) - (t < 0.06 ? (0.06 - t) * H * 1.5 : 0);
          pos.push(X + Math.cos(a) * r, h - 300, Z + Math.sin(a) * r);
        }
        aH.push(gully);
      }
    }
    for (let j = 0; j < nr; j++) for (let i = 0; i < na; i++) { const a = j * (na + 1) + i, b = a + 1, c = a + na + 1, d = c + 1; idx.push(a, c, b, b, c, d); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('aH', new THREE.Float32BufferAttribute(aH, 1));
    g.setIndex(idx);
    g.computeVertexNormals();
    const m = farMat(0.42, H * 0.6 - 300, world.sky);
    m.side = THREE.DoubleSide;
    mats.push(m);
    const mesh = new THREE.Mesh(g, m);
    mesh.frustumCulled = false; mesh.name = 'volcano';
    scene.add(mesh);
    return new THREE.Vector3(X, H - 300 - H * 0.02, Z);
  };
  const deg = Math.PI / 180;
  const popoTop = volcano(300 * deg, 24000, 4300, 13000, 3);
  volcano(327 * deg, 31000, 3500, 11000, 7, 1);
  // fumarole plume
  const pg = new THREE.PlaneGeometry(1, 1, 1, 1);
  const pm = new THREE.ShaderMaterial({
    uniforms: Object.assign({}, U, { uHor: world.sky.uniforms.uHor }),
    vertexShader: GLSL_COMMON + /* glsl */`
      uniform vec3 uTop; varying vec2 vUv; varying vec3 vW;
      void main() { vUv = uv; vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: GLSL_COMMON + /* glsl */`
      uniform vec3 uHor; varying vec2 vUv; varying vec3 vW;
      void main() {
        vec2 q = vUv;
        float bend = q.y * q.y * 0.6;
        float x = (q.x - 0.15 - bend) / (0.08 + q.y * 0.35);
        float n = texture2D(tNoise, vec2(q.x * 1.5 - uTime * 0.01, q.y * 2.0 - uTime * 0.02)).r;
        float a = exp(-x * x * 2.0) * smoothstep(0.0, 0.08, q.y) * (1.0 - smoothstep(0.6, 1.0, q.y)) * smoothstep(0.3, 0.7, n) * 0.5;
        vec3 c = mix(uHor, vec3(0.85, 0.85, 0.88) * (uAmbCol * 1.5 + uKeyCol * 0.5), 0.55);
        gl_FragColor = vec4(c, a);
      }`,
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
  });
  const plume = new THREE.Mesh(pg, pm);
  plume.scale.set(5000, 3500, 1);
  plume.position.copy(popoTop).add(new THREE.Vector3(0, 1600, 0));
  plume.frustumCulled = false;
  plume.onBeforeRender = (r, s, cam) => { plume.lookAt(cam.position.x, plume.position.y, cam.position.z); plume.updateMatrixWorld(); };
  plume.name = 'plume';
  scene.add(plume);
  world.updaters.push(() => { for (const m of mats) m.uniforms.uAlpen.value = world.tod.s.alpen; });
}
