// Floating water hyacinth (lirio acuatico) drifts along the pueblo canal banks
import * as THREE from 'three';
import { std } from './materials.js';
import { tex, IMG } from './textures.js';
import { mulberry32 } from './noise.js';
import { toWorld, halfW } from './river.js';
import { L } from './layout.js';

export function buildLirio(world) {
  if (!IMG.lirio) return;
  const rand = mulberry32(4242);
  // gently domed disc of leaves: centre rosettes stand a little proud of the water
  const g = new THREE.PlaneGeometry(1, 1, 6, 6);
  g.rotateX(-Math.PI / 2);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) { const x = p.getX(i), z = p.getZ(i); p.setY(i, 0.07 * Math.max(0, 1 - (x * x + z * z) * 3.2)); }
  g.computeVertexNormals();
  const m = std({ map: tex('lirio'), color: new THREE.Color(0xb4c0a6), alphaTest: 0.42, roughness: 0.72, metalness: 0, side: THREE.DoubleSide }, {
    porosity: 0.1, noFlip: true, key: 'lirio',
    // bob on the swell, each clump with its own phase
    vertexBegin: `
      #ifdef USE_INSTANCING
        vec3 lirW = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
      #else
        vec3 lirW = vec3(0.0);
      #endif
      transformed.y += sin(uTime * 1.1 + dot(lirW.xz, vec2(0.37, 0.51))) * 0.012;`,
    lightsExtra: 'reflectedLight.indirectDiffuse += diffuseColor.rgb * uAmbCol * 0.15;',
  });
  const items = [];
  const P = {};
  const q = new THREE.Quaternion(), e = new THREE.Euler(), sv = new THREE.Vector3(), tv = new THREE.Vector3();
  // mats of hyacinth hug the banks: a few big rafts and many small drifting clumps
  for (let u = 100; u < 470; u += 2.5 + rand() * 5) {
    for (const side of [-1, 1]) {
      if (rand() < 0.3) continue;
      if (Math.abs(u - L.bridge.u) < 14) continue;
      const w = halfW(u);
      const big = rand() < 0.25;
      const n = big ? 10 + Math.floor(rand() * 14) : 2 + Math.floor(rand() * 6);
      const spread = big ? 7 : 3;
      const d0 = side * (w - 0.8 - rand() * (big ? 2.5 : 3.5));
      for (let k = 0; k < n; k++) {
        const uu = u + (rand() - 0.5) * spread, dd = d0 + (rand() - 0.5) * spread * 0.35 * side;
        if (Math.abs(dd) > w - 0.3 || Math.abs(dd) < w - 5.2) continue;
        toWorld(uu, dd, P);
        if (world.obstacles.some((o) => Math.hypot(o.x - P.x, o.z - P.z) < o.r + 0.8)) continue;
        const s = 0.7 + rand() * 0.9;
        e.set((rand() - 0.5) * 0.08, rand() * 6.28, (rand() - 0.5) * 0.08); q.setFromEuler(e); sv.set(s, s * (0.8 + rand() * 0.5), s); tv.set(P.x, 0.015, P.z);
        items.push(new THREE.Matrix4().compose(tv, q, sv));
      }
    }
  }
  if (!items.length) return;
  const im = new THREE.InstancedMesh(g, m, items.length);
  items.forEach((mm, i) => im.setMatrixAt(i, mm));
  im.castShadow = false; im.receiveShadow = true;
  im.layers.set(5);
  im.name = 'lirio';
  im.computeBoundingSphere();
  world.scene.add(im);
  world.mark && world.mark('lirio ' + items.length);
}
