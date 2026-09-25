import * as THREE from 'three';
import { U } from './materials.js';
import { tex } from './textures.js';

export const SKY_GLSL = /* glsl */`
uniform vec3 uZen, uHor, uGlow, uSunDisk, uCloudLit, uCloudDark, uMoonDir, uFlashDir;
uniform float uSunVis, uStars, uCover, uMoonI, uStarRot, uAlpen, uStorm;
float hash13(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
vec3 rotPole(vec3 d, float a) {
  // rotate around celestial pole axis (north at latitude 19deg; +x north)
  vec3 ax = normalize(vec3(0.9455, 0.3256, 0.0));
  float c = cos(a), s = sin(a);
  return d * c + cross(ax, d) * s + ax * dot(ax, d) * (1.0 - c);
}
float stars(vec3 d, float sc, float thr) {
  vec3 p = d * sc;
  vec3 c = floor(p);
  float h = hash13(c);
  if (h < thr) return 0.0;
  vec3 j = vec3(hash13(c + 1.7), hash13(c + 5.3), hash13(c + 9.1)) * 0.6 + 0.2;
  float dd = length(p - c - j);
  float b = pow((h - thr) / (1.0 - thr), 2.5);
  return b * smoothstep(0.09, 0.0, dd) * (0.7 + 0.3 * sin(uTime * (2.0 + h * 5.0) + h * 40.0));
}
float cloudDensity(vec2 uv) {
  float n = texture(tNoise, uv).r * 0.58 + texture(tNoise, uv * 2.37 + 0.3).g * 0.28 + texture(tNoise, uv * 5.3 - 0.7).a * 0.14;
  float c = smoothstep(1.0 - uCover * 0.95, 1.0 - uCover * 0.95 + 0.28, n);
  return c;
}
vec3 skyColor(vec3 d, bool withSun) {
  float y = d.y;
  float hy = max(y, 0.0);
  vec3 col = mix(uHor, uZen, pow(hy, 0.5));
  col = mix(col, uHor * 0.75, smoothstep(0.0, -0.3, y));
  float cs = dot(d, uSunDir);
  float mie = pow(max(cs, 0.0), 6.0) * 0.35 + pow(max(cs, 0.0), 48.0) * 0.9;
  float hg = exp(-abs(y) * 5.0) * pow(cs * 0.5 + 0.5, 2.5);
  col += uGlow * (mie + hg * 0.75) * uSunVis;
  // night sky
  if (uStars > 0.01) {
    vec3 sd = rotPole(d, uStarRot);
    float st = stars(sd, 170.0, 0.965) + stars(sd, 380.0, 0.975) * 0.6;
    vec3 mwn = normalize(vec3(0.25, 0.42, 0.87));
    float band = exp(-pow(dot(sd, mwn) / 0.2, 2.0));
    float dust = texture(tNoise, sd.xz * 1.1 + sd.y * 0.7).g;
    float mw = band * (0.35 + 0.65 * dust) * (1.0 - 0.6 * smoothstep(0.55, 0.8, texture(tNoise, sd.xz * 2.0).r));
    float hz = smoothstep(-0.02, 0.25, y);
    col += (vec3(st) * 1.6 + vec3(0.18, 0.2, 0.3) * mw * 0.55) * uStars * hz * (1.0 - uCover * 0.9);
  }
  // moon glow
  float cm = dot(d, uMoonDir);
  col += vec3(0.55, 0.62, 0.8) * (pow(max(cm, 0.0), 300.0) * 1.5 + pow(max(cm, 0.0), 24.0) * 0.12) * uMoonI;
  // sun disk
  if (withSun) col += uSunDisk * smoothstep(0.99975, 0.99988, cs) * 60.0 * uSunVis;
  // clouds: high layer
  if (y > 0.0) {
    vec2 uv = d.xz / (y + 0.09) * 0.11 + vec2(uTime * 0.0016, uTime * 0.0006);
    float c = cloudDensity(uv);
    vec2 so = normalize(uSunDir.xz + 1e-4) * 0.035;
    float c2 = cloudDensity(uv + so);
    float lit = clamp(1.0 - (c2 - c) * 2.2 - c2 * 0.35, 0.0, 1.0);
    vec3 cc = mix(uCloudDark, uCloudLit, lit);
    float edge = c * (1.0 - c) * 4.0;
    cc += uGlow * edge * pow(max(cs, 0.0), 3.0) * 1.6 * uSunVis;
    cc += vec3(0.6, 0.65, 0.8) * edge * pow(max(cm, 0.0), 6.0) * uMoonI * 0.6;
    float fade = smoothstep(0.0, 0.12, y);
    col = mix(col, cc, c * fade * 0.95);
  }
  // towering cumulus bank on the horizon (azimuth-elevation noise)
  {
    vec2 hzd = normalize(d.xz + 1e-5);
    float top = 0.05 + 0.16 * texture(tNoise, hzd * 0.33 + 0.13).r + 0.1 * texture(tNoise, hzd * 0.9 + 0.61).g;
    top *= 0.55 + 0.9 * uCover;
    float el = asin(clamp(y, -1.0, 1.0));
    float puff = texture(tNoise, hzd * 1.9 + vec2(el * 3.5, el * 2.1) + vec2(uTime * 0.0008, 0.0)).b * 0.5 + texture(tNoise, hzd * 4.3 + vec2(el * 7.0, -el * 5.0)).a * 0.5;
    float dens = smoothstep(top, top - 0.05, el + (puff - 0.5) * 0.06) * smoothstep(-0.06, 0.02, el);
    float lit = smoothstep(-0.02, top, el) * (0.55 + 0.45 * puff);
    vec2 hz = normalize(d.xz + 1e-4), sz = normalize(uSunDir.xz + 1e-4);
    float sside = dot(hz, sz) * 0.5 + 0.5;
    vec3 cc = mix(uCloudDark, uCloudLit, lit * (0.6 + 0.4 * sside));
    float rim = smoothstep(top - 0.03, top, el + (puff - 0.5) * 0.06) * dens;
    cc += uGlow * rim * pow(sside, 3.0) * 1.2 * uSunVis;
    cc += uGlow * uAlpen * 0.25 * lit;
    col = mix(col, cc, dens * 0.92);
  }
  // lightning illumination
  col += vec3(0.75, 0.8, 1.0) * uFlash * (0.25 + 2.5 * pow(max(dot(d, uFlashDir), 0.0), 6.0)) * (0.3 + uCover);
  // horizon haze toward fog colour
  float hz2 = exp(-max(y + 0.02, 0.0) * 14.0);
  vec3 fc = mix(uFogCol, uFogSun, pow(max(cs, 0.0), 5.0));
  col = mix(col, fc, hz2 * 0.55);
  return col;
}
`;

export function buildSky(scene) {
  const uniforms = Object.assign({}, U, {
    uZen: { value: new THREE.Color() }, uHor: { value: new THREE.Color() }, uGlow: { value: new THREE.Color() },
    uSunDisk: { value: new THREE.Color(1, 0.9, 0.7) }, uCloudLit: { value: new THREE.Color() }, uCloudDark: { value: new THREE.Color() },
    uMoonDir: { value: new THREE.Vector3() }, uFlashDir: { value: new THREE.Vector3(0, 1, 0) },
    uSunVis: { value: 1 }, uStars: { value: 0 }, uCover: { value: 0.4 }, uMoonI: { value: 0 }, uStarRot: { value: 0 }, uAlpen: { value: 0 }, uStorm: { value: 0 },
  });
  const mat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: /* glsl */`
      varying vec3 vDir;
      void main() {
        vDir = position;
        vec4 p = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * p;
        gl_Position.z = gl_Position.w * 0.99999;
      }`,
    fragmentShader: /* glsl */`
      uniform float uTime; uniform vec3 uSunDir; uniform sampler2D tNoise; uniform float uFlash;
      uniform vec3 uFogCol; uniform vec3 uFogSun;
      ${SKY_GLSL}
      varying vec3 vDir;
      void main() { gl_FragColor = vec4(skyColor(normalize(vDir), true), 1.0); }`,
    side: THREE.BackSide, depthWrite: false, depthTest: true,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), mat);
  sky.scale.setScalar(20000);
  sky.frustumCulled = false;
  sky.renderOrder = -10;
  sky.onBeforeRender = (r, s, cam) => { sky.position.copy(cam.position); sky.updateMatrixWorld(); };
  sky.name = 'sky';
  scene.add(sky);

  // moon sprite
  const moonMat = new THREE.ShaderMaterial({
    uniforms: { tMoon: { value: tex('moon', { clamp: true }) }, uSunDir: U.uSunDir, uMoonI: uniforms.uMoonI, uCover: uniforms.uCover, uHor: uniforms.uHor },
    vertexShader: /* glsl */`
      varying vec2 vUv; varying vec3 vW;
      void main() { vUv = uv; vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; gl_Position.z = gl_Position.w * 0.99998; }`,
    fragmentShader: /* glsl */`
      uniform sampler2D tMoon; uniform vec3 uSunDir; uniform float uMoonI; uniform float uCover; uniform vec3 uHor;
      varying vec2 vUv;
      void main() {
        vec4 t = texture2D(tMoon, vUv);
        vec2 q = vUv * 2.0 - 1.0;
        float r2 = dot(q, q);
        vec3 n = vec3(q, sqrt(max(0.0, 1.0 - r2)));
        float phase = clamp(dot(n, normalize(vec3(-0.35, 0.1, 1.0))) * 1.2 + 0.2, 0.0, 1.0);
        vec3 col = t.rgb * vec3(1.0, 0.97, 0.9) * (0.25 + 1.6 * phase);
        float a = t.a * clamp(uMoonI * 2.5, 0.0, 1.0) * (1.0 - uCover * 0.6);
        gl_FragColor = vec4(col * 2.2, a);
      }`,
    transparent: true, depthWrite: false,
  });
  const moon = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), moonMat);
  moon.frustumCulled = false;
  moon.renderOrder = -9;
  moon.name = 'moon';
  moon.onBeforeRender = (r, s, cam) => {
    const d = uniforms.uMoonDir.value;
    moon.position.copy(cam.position).addScaledVector(d, 15000);
    moon.lookAt(cam.position);
    moon.scale.setScalar(15000 * 0.042);
    moon.updateMatrixWorld();
  };
  scene.add(moon);

  function update(tod) {
    const s = tod.s;
    uniforms.uZen.value.copy(s.zen);
    uniforms.uHor.value.copy(s.hor);
    uniforms.uGlow.value.copy(s.glow);
    uniforms.uCloudLit.value.copy(s.cloudLit);
    uniforms.uCloudDark.value.copy(s.cloudDark);
    uniforms.uMoonDir.value.copy(tod.moonDir);
    uniforms.uSunVis.value = THREE.MathUtils.smoothstep(tod.sunDir.y, -0.25, 0.05) * (1 - tod.storm * 0.85);
    uniforms.uSunDisk.value.copy(s.sun).multiplyScalar(1.0);
    uniforms.uStars.value = s.stars;
    uniforms.uCover.value = tod.cloudCover;
    uniforms.uMoonI.value = tod.moonI * 2.0 + tod.night * 0.3;
    uniforms.uStarRot.value = tod.hour / 24 * Math.PI * 2;
    uniforms.uAlpen.value = s.alpen;
    uniforms.uStorm.value = tod.storm;
    moon.visible = tod.moonDir.y > -0.05;
  }
  return { sky, moon, uniforms, update, mat };
}
