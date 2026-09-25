// Material library: triplanar world-mapped materials, box-UV helper
import * as THREE from 'three';
import { std } from './materials.js';
import { tex, ntex } from './textures.js';

// world-space triplanar with optional moss on top + wet line near water
export function triMat(name, o = {}) {
  const scale = o.scale || 3;
  const uniforms = {
    tTriC: { value: tex(name + '_c') }, tTriN: { value: ntex(name + '_n') },
    uTriS: { value: 1 / scale }, uTint: { value: new THREE.Color(o.tint || 0xffffff) },
    uMoss: { value: o.moss !== undefined ? o.moss : 0.5 }, uMossCol: { value: new THREE.Color(o.mossCol || 0x3a4a1c) },
  };
  const pre = /* glsl */`
    uniform sampler2D tTriC; uniform sampler2D tTriN; uniform float uTriS; uniform vec3 uTint; uniform float uMoss; uniform vec3 uMossCol;
    varying vec3 vNW;
  `;
  const m = std({ color: 0xffffff, roughness: o.roughness !== undefined ? o.roughness : 0.85, metalness: 0, vertexColors: !!o.vertexColors, side: o.side || THREE.FrontSide }, {
    porosity: o.porosity !== undefined ? o.porosity : 0.6,
    uniforms,
    vertexPre: 'varying vec3 vNW;\n',
    vertexBegin: `
      #ifdef USE_INSTANCING
        vNW = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * normal);
      #else
        vNW = normalize(mat3(modelMatrix) * normal);
      #endif`,
    fragmentPre: pre,
    mapFragment: /* glsl */`
      vec3 Nt = normalize(vNW);
      vec3 tw = pow(abs(Nt), vec3(4.0)); tw /= dot(tw, vec3(1.0));
      vec3 Pt = vWPos * uTriS;
      vec3 cT = texture2D(tTriC, Pt.zy).rgb * tw.x + texture2D(tTriC, Pt.xz).rgb * tw.y + texture2D(tTriC, Pt.xy).rgb * tw.z;
      cT *= uTint;
      float mossN = texture2D(tNoise, vWPos.xz * 0.21).g;
      float moss = smoothstep(0.45, 0.85, Nt.y + (mossN - 0.5) * 0.5) * uMoss;
      cT = mix(cT, uMossCol * (0.7 + 0.6 * mossN), moss);
      float wetL = smoothstep(0.55, 0.0, vWPos.y) * smoothstep(-1.5, 0.0, vWPos.y);
      cT *= mix(1.0, 0.55, wetL);
      cT *= mix(1.0, 0.72, smoothstep(0.0, -0.8, vWPos.y));
      diffuseColor.rgb *= cT;
      float nA = texture2D(tTriN, Pt.zy).a * tw.x + texture2D(tTriN, Pt.xz).a * tw.y + texture2D(tTriN, Pt.xy).a * tw.z;
      float triRough = mix(clamp(${(o.roughness || 0.85).toFixed(2)} * (0.42 + 0.72 * nA), 0.05, 1.0), 0.25, wetL);
    `,
    normalFragment: /* glsl */`
      {
        vec3 nx = texture2D(tTriN, Pt.zy).xyz * 2.0 - 1.0;
        vec3 ny = texture2D(tTriN, Pt.xz).xyz * 2.0 - 1.0;
        vec3 nz = texture2D(tTriN, Pt.xy).xyz * 2.0 - 1.0;
        nx = vec3(nx.xy + Nt.zy, abs(nx.z) * Nt.x);
        ny = vec3(ny.xy + Nt.xz, abs(ny.z) * Nt.y);
        nz = vec3(nz.xy + Nt.xy, abs(nz.z) * Nt.z);
        vec3 nW = normalize(nx.zyx * tw.x + ny.xzy * tw.y + nz.xyz * tw.z);
        nW = normalize(mix(nW, Nt, moss * 0.5));
        normal = normalize((viewMatrix * vec4(nW, 0.0)).xyz);
      }
    `,
    replace: [['#include <roughnessmap_fragment>', 'float roughnessFactor = triRough;']],
    key: 'tri' + name,
  });
  return m;
}

// UV-mapped standard material with albedo + normal maps and repeat
export function uvMat(name, o = {}) {
  const rp = o.uvMul ? { repeat: o.uvMul } : {};
  const map = tex(name + '_c', rp);
  const nm = ntex(name + '_n', rp);
  const m = std({
    map, normalMap: nm, normalScale: new THREE.Vector2(o.ns || 1, o.ns || 1), color: new THREE.Color(o.color || 0xffffff),
    roughness: o.roughness !== undefined ? o.roughness : 0.85, metalness: 0, side: o.side || THREE.FrontSide,
    vertexColors: !!o.vertexColors, alphaTest: o.alphaTest || 0, transparent: false,
  }, { porosity: o.porosity !== undefined ? o.porosity : 0.5, wind: !!o.wind, key: 'uv' + name + (o.wind ? 'w' : ''), afterMap: o.afterMap, fragmentPre: o.fragmentPre });
  return m;
}

// Assign world-aligned box UVs to a (non-indexed or indexed) geometry already in its final local frame
export function boxUV(geo, scale = 1, offset = [0, 0, 0]) {
  const p = geo.attributes.position, n = geo.attributes.normal;
  if (!n) geo.computeVertexNormals();
  const nn = geo.attributes.normal;
  const uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i) + offset[0], y = p.getY(i) + offset[1], z = p.getZ(i) + offset[2];
    const ax = Math.abs(nn.getX(i)), ay = Math.abs(nn.getY(i)), az = Math.abs(nn.getZ(i));
    let u, v;
    if (ay >= ax && ay >= az) { u = x; v = z; }
    else if (ax >= az) { u = z; v = y; }
    else { u = x; v = y; }
    uv[i * 2] = u / scale; uv[i * 2 + 1] = v / scale;
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return geo;
}
