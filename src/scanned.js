// Scanned (photogrammetry) meshes: decode the quantized bins embedded at build time
import * as THREE from 'three';
import { MODEL_META, MODEL_BIN } from './assets.gen.js';
import { std, depthMat } from './materials.js';
import { tex, ntex } from './textures.js';

const cache = {};
// bins are either embedded base64 (standalone file) or relative URLs next to the page (hosted build)
export async function loadModelBins() {
  await Promise.all(Object.entries(MODEL_BIN).map(async ([name, v]) => {
    if (v.endsWith('.bin') || v.endsWith('.wasm')) { cache[name] = await fetch(v).then((r) => r.arrayBuffer()); return; }
    const s = atob(v);
    const u = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i);
    cache[name] = u.buffer;
  }));
}
function bytes(name) { return cache[name]; }

// returns [{ lod: [BufferGeometry, BufferGeometry], size: Vector3 }] per part.
// opts.normalize: centre each part on its footprint, base at y = -sink, scale max horizontal half-extent to 1
// opts.center: same centring but keep the real-world (metre) scale
export function scannedParts(name, opts = {}) {
  const meta = MODEL_META[name];
  if (!meta) return [];
  const buf = bytes(name);
  const { bmin, bmax, tmin, tmax } = meta;
  const out = [];
  let whole = null; // opts.whole: centre all parts with one common offset (assemblies such as a bucket and its handle)
  for (let pi = 0; pi < meta.parts.length; pi++) {
    const lods = meta.parts[pi];
    if (opts.only && !opts.only.includes(pi)) continue;
    const geos = lods.map((e) => {
      const qp = new Int16Array(buf, e.p, e.n * 4), qn = new Int8Array(buf, e.nr, e.n * 4), qt = new Uint16Array(buf, e.t, e.n * 2);
      const P = new Float32Array(e.n * 3), N = new Float32Array(e.n * 3), T = new Float32Array(e.n * 2);
      for (let i = 0; i < e.n; i++) {
        for (let k = 0; k < 3; k++) P[i * 3 + k] = bmin[k] + ((qp[i * 4 + k] + 32768) / 65535) * (bmax[k] - bmin[k]);
        for (let k = 0; k < 3; k++) N[i * 3 + k] = qn[i * 4 + k] / 127;
        for (let k = 0; k < 2; k++) T[i * 2 + k] = tmin[k] + (qt[i * 2 + k] / 65535) * (tmax[k] - tmin[k]);
      }
      const I = e.big ? new Uint32Array(buf, e.i, e.ni) : new Uint16Array(buf, e.i, e.ni);
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(P, 3));
      g.setAttribute('normal', new THREE.BufferAttribute(N, 3));
      g.setAttribute('uv', new THREE.BufferAttribute(T, 2));
      g.setIndex(new THREE.BufferAttribute(e.big ? new Uint32Array(I) : new Uint16Array(I), 1));
      return g;
    });
    geos[0].computeBoundingBox();
    const bb = geos[0].boundingBox.clone();
    const size = bb.getSize(new THREE.Vector3());
    if (opts.normalize) {
      const cx = (bb.min.x + bb.max.x) / 2, cz = (bb.min.z + bb.max.z) / 2;
      const half = Math.max(size.x, size.z) / 2 || 1;
      for (const g of geos) {
        g.translate(-cx, -bb.min.y, -cz);
        g.scale(1 / half, 1 / half, 1 / half);
        g.translate(0, -(opts.sink || 0), 0);
        g.computeBoundingSphere();
        g.computeBoundingBox();
      }
      size.multiplyScalar(1 / half);
    } else if (opts.center) {
      const cx = (bb.min.x + bb.max.x) / 2, cz = (bb.min.z + bb.max.z) / 2;
      for (const g of geos) { g.translate(-cx, -bb.min.y - (opts.sink || 0), -cz); g.computeBoundingSphere(); g.computeBoundingBox(); }
    } else for (const g of geos) { g.computeBoundingSphere(); g.computeBoundingBox(); }
    out.push({ lod: geos, size, bb, mat: meta.pmat ? meta.pmat[pi] : 0 });
  }
  if (opts.whole && out.length) {
    whole = out[0].bb.clone();
    for (const p of out) whole.union(p.bb);
    const cx = (whole.min.x + whole.max.x) / 2, cz = (whole.min.z + whole.max.z) / 2;
    const size = whole.getSize(new THREE.Vector3());
    for (const p of out) { for (const g of p.lod) { g.translate(-cx, -whole.min.y - (opts.sink || 0), -cz); g.computeBoundingSphere(); g.computeBoundingBox(); } p.wholeSize = size; }
  }
  return out;
}

// PBR material for a scanned asset (glTF UVs: no flipY); roughness rides in the normal map alpha
export function modelMeta(name) { return MODEL_META[name] || {}; }
export function hasModel(name) { return !!MODEL_META[name] && !!cache[name]; }
export function scannedMat(name, o = {}) {
  const tk = 'm_' + name + (o.mat ? '_m' + o.mat : '');
  const m = std({
    map: tex(tk + '_c', { flipY: false }), normalMap: ntex(tk + '_n', { flipY: false }),
    normalScale: new THREE.Vector2(o.ns || 1, o.ns || 1), color: new THREE.Color(o.color || 0xffffff), roughness: o.roughness || 1.0, metalness: 0,
    side: o.side || THREE.FrontSide, alphaTest: o.alphaTest || 0, vertexColors: false,
  }, { porosity: o.porosity !== undefined ? o.porosity : 0.6, wind: !!o.wind, noFlip: !!o.noFlip, key: 'scan' + name + (o.mat || '') + (o.wind ? 'w' : '') + (o.key || ''), lightsExtra: o.lightsExtra, afterMap: o.afterMap });
  if (o.alphaTest) m.alphaToCoverage = true;
  if (o.wind || o.alphaTest) m.customDepthMaterial = depthMat(m, { wind: !!o.wind });
  return m;
}
