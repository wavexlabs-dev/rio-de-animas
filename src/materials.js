// Shared uniforms + shader patching for MeshStandardMaterial (fog, wind, wetness, glow lights)
import * as THREE from 'three';

export const MAXG = 16;
export const U = {
  uTime: { value: 0 },
  uWind: { value: new THREE.Vector4(0.8, -0.6, 0.5, 0) },
  uWet: { value: 0 },
  uRain: { value: 0 },
  uFogCol: { value: new THREE.Color(0.6, 0.7, 0.8) },
  uFogSun: { value: new THREE.Color(1, 0.8, 0.6) },
  uFogDen: { value: 0.0012 },
  uFogHF: { value: 0.01 },
  uSunDir: { value: new THREE.Vector3(0, 1, 0) },
  uKeyDir: { value: new THREE.Vector3(0, 1, 0) },
  uKeyCol: { value: new THREE.Color(1, 1, 1) },
  uAmbCol: { value: new THREE.Color(0.3, 0.35, 0.4) },
  uGlowPos: { value: Array.from({ length: MAXG }, () => new THREE.Vector4(0, -999, 0, 0)) },
  uGlowCol: { value: Array.from({ length: MAXG }, () => new THREE.Vector3()) },
  uFlash: { value: 0 },
  uNight: { value: 0 },
  uMistH: { value: 0 },
  tNoise: { value: null },
};

export const GLSL_COMMON = /* glsl */`
uniform float uTime;
uniform vec4 uWind;
uniform float uWet;
uniform float uRain;
uniform vec3 uFogCol;
uniform vec3 uFogSun;
uniform float uFogDen;
uniform float uFogHF;
uniform vec3 uSunDir;
uniform vec3 uKeyDir;
uniform vec3 uKeyCol;
uniform vec3 uAmbCol;
uniform float uFlash;
uniform float uNight;
uniform float uMistH;
uniform sampler2D tNoise;
`;

export const GLSL_WIND = /* glsl */`
float windGust(vec2 p) {
  vec2 d = uWind.xy;
  float a = dot(p, d);
  return 0.5 + 0.5 * sin(a * 0.045 - uTime * 1.25) * sin(a * 0.011 - uTime * 0.37 + 1.3 + p.x * 0.002);
}
vec3 windOffset(vec3 wp, vec3 root, float flex, float flutter, float phase) {
  vec2 d = uWind.xy;
  vec2 pd = vec2(-d.y, d.x);
  float g = windGust(root.xz);
  float s = uWind.z * (0.3 + 0.9 * g * g) ;
  float t = uTime;
  float sway = s * flex * (0.75 + 0.25 * sin(t * 1.3 + phase));
  vec3 o = vec3(d.x, 0.0, d.y) * sway + vec3(pd.x, 0.0, pd.y) * sin(t * 1.9 + phase * 1.7) * 0.25 * sway;
  o.y -= sway * sway * 0.15;
  float fl = flutter * s * 0.05;
  o += vec3(sin(t * 9.1 + phase + wp.x * 3.1), sin(t * 11.3 + phase * 2.0 + wp.z * 2.7) * 0.6, cos(t * 8.3 + phase + wp.y * 3.3)) * fl;
  return o;
}
`;

export const GLSL_FOG = /* glsl */`
vec3 applyFog(vec3 col, vec3 wpos) {
  vec3 v = wpos - cameraPosition;
  float dist = length(v);
  vec3 dir = v / max(dist, 1e-3);
  float k = uFogHF;
  float h0 = max(cameraPosition.y, -5.0);
  float dy = v.y;
  float hint = abs(dy) > 0.05 ? (exp(-k * h0) - exp(-k * (h0 + dy))) / (k * dy) : exp(-k * h0);
  float fogInt = uFogDen * dist * hint;
  // low river mist band
  float mist = uMistH * dist * 0.012 * exp(-max(wpos.y, 0.0) * 0.35) * exp(-max(h0, 0.0) * 0.08);
  float f = 1.0 - exp(-(fogInt + mist));
  float sunAmt = pow(max(dot(dir, uSunDir), 0.0), 5.0);
  vec3 fc = mix(uFogCol, uFogSun, sunAmt);
  return mix(col, fc, f);
}
`;

export const GLSL_GLOW = /* glsl */`
#define MAXG ${MAXG}
uniform vec4 uGlowPos[MAXG];
uniform vec3 uGlowCol[MAXG];
vec3 glowIrradiance(vec3 wpos, vec3 nW) {
  vec3 acc = vec3(0.0);
  for (int i = 0; i < MAXG; i++) {
    float r = uGlowPos[i].w;
    if (r <= 0.0) continue;
    vec3 L = uGlowPos[i].xyz - wpos;
    float d2 = dot(L, L);
    if (d2 > r * r) continue;
    float d = sqrt(d2);
    L /= max(d, 1e-3);
    float fall = 1.0 - d / r;
    float att = fall * fall / (1.0 + d2 * 0.6);
    acc += uGlowCol[i] * att * (max(dot(nW, L), 0.0) * 0.85 + 0.15);
  }
  return acc;
}
`;

const WIND_PROJECT = /* glsl */`
vec4 wPos4 = vec4(transformed, 1.0);
#ifdef USE_INSTANCING
  wPos4 = instanceMatrix * wPos4;
#endif
wPos4 = modelMatrix * wPos4;
#ifdef USE_WIND
  vec3 wRoot = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  #ifdef USE_INSTANCING
    wRoot = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  #endif
  float wPhase = dot(wRoot.xz, vec2(0.37, 0.61));
  wPos4.xyz += windOffset(wPos4.xyz, wRoot, aWind.x, aWind.y, wPhase + aWind.z * 6.2831);
#endif
vWPos = wPos4.xyz;
vec4 mvPosition = viewMatrix * wPos4;
gl_Position = projectionMatrix * mvPosition;
`;

// opts: { wind: bool, porosity: 0..1, fog: bool, glow: bool, extraUniforms, vertexPre, fragmentPre, hooks... }
export function patch(mat, opts = {}) {
  const o = Object.assign({ wind: false, porosity: 0.5, fog: true, glow: true }, opts);
  mat.userData.patch = { wind: !!o.wind }; // keep userData JSON-light (Material.copy serialises it)
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (sh, r) => {
    Object.assign(sh.uniforms, U);
    sh.uniforms.uPorosity = { value: o.porosity };
    if (o.uniforms) Object.assign(sh.uniforms, o.uniforms);
    let vs = sh.vertexShader, fs = sh.fragmentShader;
    const defs = o.wind ? '#define USE_WIND\nattribute vec3 aWind;\n' : '';
    vs = defs + GLSL_COMMON + (o.wind ? GLSL_WIND : '') + 'varying vec3 vWPos;\n' + (o.vertexPre || '') + vs;
    vs = vs.replace('#include <project_vertex>', WIND_PROJECT + (o.vertexPost || ''));
    if (o.vertexBegin) vs = vs.replace('#include <begin_vertex>', '#include <begin_vertex>\n' + o.vertexBegin);
    fs = GLSL_COMMON + GLSL_FOG + GLSL_GLOW + 'uniform float uPorosity;\nvarying vec3 vWPos;\n' + (o.fragmentPre || '') + fs;
    if (o.mapFragment) fs = fs.replace('#include <map_fragment>', o.mapFragment);
    if (o.normalFragment) fs = fs.replace('#include <normal_fragment_maps>', o.normalFragment);
    if (o.noFlip) fs = fs.replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\n  normal = normalize(vNormal); nonPerturbedNormal = normal;');
    if (o.afterMap) fs = fs.replace('#include <map_fragment>', '#include <map_fragment>\n' + o.afterMap);
    fs = fs.replace('#include <lights_physical_fragment>', `
      vec3 nWw = normalize((vec4(normal, 0.0) * viewMatrix).xyz);
      {
        float wetF = uWet * uPorosity * smoothstep(-0.3, 0.7, nWw.y);
        ${o.wetExtra || ''}
        diffuseColor.rgb *= 1.0 - 0.42 * wetF;
        roughnessFactor = mix(roughnessFactor, 0.1, wetF * 0.9);
      }
      #include <lights_physical_fragment>`);
    fs = fs.replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
      ${o.glow ? 'reflectedLight.directDiffuse += glowIrradiance(vWPos, nWw) * BRDF_Lambert(material.diffuseColor);' : ''}
      reflectedLight.indirectDiffuse += uFlash * vec3(0.55, 0.6, 1.0) * material.diffuseColor * (0.35 + 0.65 * max(nWw.y, 0.0));
      ${o.lightsExtra || ''}`);
    if (o.fog) fs = fs.replace('#include <fog_fragment>', 'gl_FragColor.rgb = applyFog(gl_FragColor.rgb, vWPos);');
    if (o.replace) for (const [a, b] of o.replace) fs = fs.replace(a, b);
    // scanned normal maps carry the roughness map in alpha
    if (mat.normalMap && !o.noRoughA) fs = fs.replace('#include <roughnessmap_fragment>', 'float roughnessFactor = clamp(roughness * (0.42 + 0.72 * texture2D(normalMap, vNormalMapUv).a), 0.04, 1.0);');
    if (o.emissiveExtra) fs = fs.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n' + o.emissiveExtra);
    sh.vertexShader = vs;
    sh.fragmentShader = fs;
    if (prev) prev(sh, r);
  };
  const src = [o.wind, o.fog, o.glow, o.noFlip ? 'nf' : '', o.key || '', o.mapFragment, o.normalFragment, o.vertexPre, o.fragmentPre, o.afterMap, o.lightsExtra, o.emissiveExtra, o.vertexBegin, o.vertexPost, o.wetExtra, JSON.stringify(o.replace || [])].join('|');
  let hsh = 5381; for (let i = 0; i < src.length; i++) hsh = ((hsh * 33) ^ src.charCodeAt(i)) >>> 0;
  const key = 'p' + hsh;
  mat.customProgramCacheKey = () => key;
  return mat;
}

// depth material for shadow casting with wind + alpha test
export function depthMat(src, opts = {}) {
  const m = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, alphaTest: src.alphaTest || 0, map: src.alphaTest ? src.map : null, side: src.side });
  const wind = opts.wind !== undefined ? opts.wind : (src.userData.patch && src.userData.patch.wind);
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    let vs = sh.vertexShader;
    const defs = wind ? '#define USE_WIND\nattribute vec3 aWind;\n' : '';
    vs = defs + GLSL_COMMON + (wind ? GLSL_WIND : '') + 'varying vec3 vWPos;\n' + vs;
    vs = vs.replace('#include <project_vertex>', WIND_PROJECT);
    sh.vertexShader = vs;
  };
  m.customProgramCacheKey = () => 'depth' + (wind ? 'w' : '') + (src.alphaTest ? 'a' : '');
  return m;
}

export function std(params, opts) {
  const m = new THREE.MeshStandardMaterial(params);
  return patch(m, opts);
}
