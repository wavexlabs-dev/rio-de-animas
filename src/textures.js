import * as THREE from 'three';
import A from './assets.gen.js';

export const IMG = {};
export const TEX = {};
let renderer = null;
export function setRenderer(r) { renderer = r; }

export async function loadImages(onProgress) {
  const names = Object.keys(A);
  let done = 0;
  await Promise.all(names.map((n) => new Promise((res) => {
    const im = new Image();
    im.onload = () => { IMG[n] = im; done++; onProgress && onProgress(done / names.length); res(); };
    im.onerror = () => { console.warn('img fail', n); done++; res(); };
    im.src = A[n];
  })));
  return IMG;
}

export function tex(name, o = {}) {
  const key = name + JSON.stringify(o);
  if (TEX[key]) return TEX[key];
  const t = new THREE.Texture(IMG[name]);
  t.colorSpace = o.srgb === false ? THREE.NoColorSpace : THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = o.clamp ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping;
  t.anisotropy = o.aniso !== undefined ? o.aniso : (renderer ? Math.min(8, renderer.capabilities.getMaxAnisotropy()) : 4);
  t.flipY = o.flipY !== undefined ? o.flipY : true;
  if (o.nomip) { t.generateMipmaps = false; t.minFilter = THREE.LinearFilter; }
  if (o.repeat) t.repeat.set(o.repeat, o.repeat);
  t.needsUpdate = true;
  TEX[key] = t;
  return t;
}
export const ntex = (name, o = {}) => tex(name, Object.assign({ srgb: false }, o));

// Pack several images into a DataArrayTexture (no flipY: green channel of normal maps must be negated in shader)
export function arrayTex(names, size, srgb) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  const data = new Uint8Array(size * size * 4 * names.length);
  names.forEach((n, i) => {
    ctx.clearRect(0, 0, size, size);
    ctx.drawImage(IMG[n], 0, 0, size, size);
    data.set(ctx.getImageData(0, 0, size, size).data, i * size * size * 4);
  });
  const t = new THREE.DataArrayTexture(data, size, size, names.length);
  t.format = THREE.RGBAFormat;
  t.type = THREE.UnsignedByteType;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = renderer ? Math.min(8, renderer.capabilities.getMaxAnisotropy()) : 4;
  t.needsUpdate = true;
  return t;
}

// read an image into a Float32 luminance / rgba array (for CPU sampling)
export function imageData(name, size) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(IMG[name], 0, 0, size, size);
  return ctx.getImageData(0, 0, size, size).data;
}
