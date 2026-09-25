// Signed-distance modelling + surface nets polygoniser + automatic skinning
import * as THREE from 'three';

export const V = (x, y, z) => new THREE.Vector3(x, y, z);
export function smin(a, b, k) { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.min(a, b) - h * h * k * 0.25; }
export function smax(a, b, k) { return -smin(-a, -b, k); }
export function sdCapsule(px, py, pz, a, b, r) {
  const bax = b.x - a.x, bay = b.y - a.y, baz = b.z - a.z;
  const pax = px - a.x, pay = py - a.y, paz = pz - a.z;
  const h = Math.max(0, Math.min(1, (pax * bax + pay * bay + paz * baz) / (bax * bax + bay * bay + baz * baz)));
  const dx = pax - bax * h, dy = pay - bay * h, dz = paz - baz * h;
  return Math.sqrt(dx * dx + dy * dy + dz * dz) - r;
}
// capsule with radius varying along its length
export function sdCone(px, py, pz, a, b, ra, rb) {
  const bax = b.x - a.x, bay = b.y - a.y, baz = b.z - a.z;
  const pax = px - a.x, pay = py - a.y, paz = pz - a.z;
  const h = Math.max(0, Math.min(1, (pax * bax + pay * bay + paz * baz) / (bax * bax + bay * bay + baz * baz)));
  const dx = pax - bax * h, dy = pay - bay * h, dz = paz - baz * h;
  return Math.sqrt(dx * dx + dy * dy + dz * dz) - (ra + (rb - ra) * h);
}
export function sdEll(px, py, pz, c, rx, ry, rz) {
  const x = (px - c.x) / rx, y = (py - c.y) / ry, z = (pz - c.z) / rz;
  const k0 = Math.sqrt(x * x + y * y + z * z);
  const k1 = Math.sqrt(x * x / (rx * rx) + y * y / (ry * ry) + z * z / (rz * rz));
  return k1 > 0 ? k0 * (k0 - 1) / k1 : -Math.min(rx, ry, rz);
}
export function sdBox(px, py, pz, c, hx, hy, hz, r = 0) {
  const qx = Math.abs(px - c.x) - hx + r, qy = Math.abs(py - c.y) - hy + r, qz = Math.abs(pz - c.z) - hz + r;
  const ox = Math.max(qx, 0), oy = Math.max(qy, 0), oz = Math.max(qz, 0);
  return Math.sqrt(ox * ox + oy * oy + oz * oz) + Math.min(Math.max(qx, qy, qz), 0) - r;
}

// Surface nets. f(x,y,z) -> distance. Returns BufferGeometry with position+normal.
export function polygonize(f, min, max, res) {
  const nx = Math.ceil((max.x - min.x) / res) + 1, ny = Math.ceil((max.y - min.y) / res) + 1, nz = Math.ceil((max.z - min.z) / res) + 1;
  const vals = new Float32Array(nx * ny * nz);
  const id = (i, j, k) => i + nx * (j + ny * k);
  // narrow band: probe 4x4x4 blocks at their centre, only evaluate every point near the surface
  const B = 4, thr = 1.5 * res * Math.sqrt(3) * 1.9;
  for (let k0 = 0; k0 < nz; k0 += B) for (let j0 = 0; j0 < ny; j0 += B) for (let i0 = 0; i0 < nx; i0 += B) {
    const i1 = Math.min(nx, i0 + B), j1 = Math.min(ny, j0 + B), k1 = Math.min(nz, k0 + B);
    const c = f(min.x + (i0 + (i1 - i0 - 1) / 2) * res, min.y + (j0 + (j1 - j0 - 1) / 2) * res, min.z + (k0 + (k1 - k0 - 1) / 2) * res);
    const far = Math.abs(c) > thr;
    for (let k = k0; k < k1; k++) for (let j = j0; j < j1; j++) for (let i = i0; i < i1; i++) {
      vals[id(i, j, k)] = far ? c : f(min.x + i * res, min.y + j * res, min.z + k * res);
    }
  }
  const cellIdx = new Int32Array((nx - 1) * (ny - 1) * (nz - 1)).fill(-1);
  const cid = (i, j, k) => i + (nx - 1) * (j + (ny - 1) * k);
  const pos = [];
  const corners = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]];
  const edges = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
  const cv = new Float32Array(8);
  for (let k = 0; k < nz - 1; k++) for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
    let mask = 0;
    for (let c = 0; c < 8; c++) { const [a, b, d] = corners[c]; cv[c] = vals[id(i + a, j + b, k + d)]; if (cv[c] < 0) mask |= 1 << c; }
    if (mask === 0 || mask === 255) continue;
    let sx = 0, sy = 0, sz = 0, n = 0;
    for (const [e0, e1] of edges) {
      const a = cv[e0], b = cv[e1];
      if ((a < 0) === (b < 0)) continue;
      const t = a / (a - b);
      const c0 = corners[e0], c1 = corners[e1];
      sx += c0[0] + (c1[0] - c0[0]) * t; sy += c0[1] + (c1[1] - c0[1]) * t; sz += c0[2] + (c1[2] - c0[2]) * t; n++;
    }
    cellIdx[cid(i, j, k)] = pos.length / 3;
    pos.push(min.x + (i + sx / n) * res, min.y + (j + sy / n) * res, min.z + (k + sz / n) * res);
  }
  const idx = [];
  const quad = (a, b, c, d, flip) => { if (a < 0 || b < 0 || c < 0 || d < 0) return; if (flip) idx.push(a, b, c, a, c, d); else idx.push(a, c, b, a, d, c); };
  for (let k = 1; k < nz - 1; k++) for (let j = 1; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
    const a = vals[id(i, j, k)] < 0, b = vals[id(i + 1, j, k)] < 0;
    if (a === b) continue;
    quad(cellIdx[cid(i, j - 1, k - 1)], cellIdx[cid(i, j, k - 1)], cellIdx[cid(i, j, k)], cellIdx[cid(i, j - 1, k)], a);
  }
  for (let k = 1; k < nz - 1; k++) for (let j = 0; j < ny - 1; j++) for (let i = 1; i < nx - 1; i++) {
    const a = vals[id(i, j, k)] < 0, b = vals[id(i, j + 1, k)] < 0;
    if (a === b) continue;
    quad(cellIdx[cid(i - 1, j, k - 1)], cellIdx[cid(i - 1, j, k)], cellIdx[cid(i, j, k)], cellIdx[cid(i, j, k - 1)], a);
  }
  for (let k = 0; k < nz - 1; k++) for (let j = 1; j < ny - 1; j++) for (let i = 1; i < nx - 1; i++) {
    const a = vals[id(i, j, k)] < 0, b = vals[id(i, j, k + 1)] < 0;
    if (a === b) continue;
    quad(cellIdx[cid(i - 1, j - 1, k)], cellIdx[cid(i, j - 1, k)], cellIdx[cid(i, j, k)], cellIdx[cid(i - 1, j, k)], a);
  }
  // normals from gradient
  const nrm = new Float32Array(pos.length);
  const e = res * 0.5;
  for (let v = 0; v < pos.length; v += 3) {
    const x = pos[v], y = pos[v + 1], z = pos[v + 2];
    let gx = f(x + e, y, z) - f(x - e, y, z), gy = f(x, y + e, z) - f(x, y - e, z), gz = f(x, y, z + e) - f(x, y, z - e);
    const l = Math.hypot(gx, gy, gz) || 1;
    nrm[v] = gx / l; nrm[v + 1] = gy / l; nrm[v + 2] = gz / l;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  g.setIndex(idx);
  // fix winding against normals
  const ia = g.index.array, P = g.attributes.position.array;
  const A = new THREE.Vector3(), Bv = new THREE.Vector3(), Cv = new THREE.Vector3(), Nf = new THREE.Vector3(), Nv = new THREE.Vector3();
  for (let t = 0; t < ia.length; t += 3) {
    A.fromArray(P, ia[t] * 3); Bv.fromArray(P, ia[t + 1] * 3); Cv.fromArray(P, ia[t + 2] * 3);
    Nf.subVectors(Bv, A).cross(Cv.sub(A));
    Nv.fromArray(nrm, ia[t] * 3);
    if (Nf.dot(Nv) < 0) { const tmp = ia[t + 1]; ia[t + 1] = ia[t + 2]; ia[t + 2] = tmp; }
  }
  return g;
}

// Auto skin weights by distance to bone segments. segs: [{a:Vector3,b:Vector3,bone:int,r?:number}]
export function autoSkin(geo, segs, sigma = 0.06) {
  const p = geo.attributes.position;
  const n = p.count;
  const si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
  const tmp = [];
  for (let v = 0; v < n; v++) {
    const x = p.getX(v), y = p.getY(v), z = p.getZ(v);
    tmp.length = 0;
    for (const s of segs) {
      const d = Math.max(0, sdCapsule(x, y, z, s.a, s.b, 0) - (s.r || 0));
      tmp.push([s.bone, d]);
    }
    tmp.sort((a, b) => a[1] - b[1]);
    const best = tmp[0][1];
    let tot = 0;
    const w = [];
    for (let k = 0; k < 4 && k < tmp.length; k++) {
      const ww = Math.exp(-Math.pow((tmp[k][1] - best) / sigma, 2));
      w.push([tmp[k][0], ww]); tot += ww;
    }
    // merge duplicates of the same bone
    const m = new Map();
    for (const [b, ww] of w) m.set(b, (m.get(b) || 0) + ww / tot);
    let k = 0;
    for (const [b, ww] of m) { si[v * 4 + k] = b; sw[v * 4 + k] = ww; k++; }
  }
  geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
  geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
  return geo;
}
