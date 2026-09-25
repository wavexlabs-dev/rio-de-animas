// Procedural tree generator: branching tubes with bark UVs, leaf cards, hanging moss
import * as THREE from 'three';
import { mulberry32, lerp, clamp, smoothstep, fbm3 } from './noise.js';

export const SPECIES = {
  ahuehuete: {
    trunkLen: [7, 10], trunkRad: [1.0, 1.5], flare: 0.9, flutes: 7, fluteAmt: 0.28, lean: 0.12, twist: 0.1,
    leader: 0.55,
    order: [
      { n: [7, 10], start: 0.32, angle: [0.95, 1.35], len: [7, 11], rad: 0.34, grav: 0.07, wob: 0.22, seg: 0.9 },
      { n: [5, 8], start: 0.25, angle: [0.6, 1.0], len: [2.6, 4.2], rad: 0.45, grav: 0.12, wob: 0.3, seg: 0.7 },
      { n: [3, 5], start: 0.3, angle: [0.5, 0.9], len: [1.0, 1.8], rad: 0.5, grav: 0.18, wob: 0.35, seg: 0.5 },
    ],
    leafOrder: 2, leafSize: [1.6, 2.4], leafPer: 2.2, leafAtlas: 2, heno: 70, henoLen: [1.5, 4.2],
    barkTint: 0xb7a59a, radial: [14, 7, 5, 4],
  },
  cazahuate: {
    trunkLen: [1.4, 2.2], trunkRad: [0.13, 0.2], flare: 0.3, flutes: 0, fluteAmt: 0, lean: 0.12, twist: 0.35,
    leader: 0.4,
    order: [
      { n: [4, 6], start: 0.5, angle: [0.45, 0.85], len: [2.2, 3.4], rad: 0.62, grav: -0.02, wob: 0.45, seg: 0.35 },
      { n: [3, 5], start: 0.35, angle: [0.4, 0.8], len: [0.9, 1.6], rad: 0.55, grav: 0.0, wob: 0.5, seg: 0.25 },
    ],
    leafOrder: 1, leafSize: [0.7, 1.1], leafPer: 3.2, leafAtlas: 2, heno: 0,
    barkTint: 0xd0cdc4, radial: [8, 5, 4],
  },
  encino: {
    trunkLen: [2.5, 3.8], trunkRad: [0.28, 0.42], flare: 0.4, flutes: 0, fluteAmt: 0, lean: 0.05, twist: 0.15,
    leader: 0.45,
    order: [
      { n: [4, 6], start: 0.55, angle: [0.55, 0.9], len: [4.0, 6.0], rad: 0.5, grav: 0.02, wob: 0.28, seg: 0.8 },
      { n: [4, 6], start: 0.3, angle: [0.5, 0.9], len: [1.8, 2.8], rad: 0.45, grav: 0.05, wob: 0.3, seg: 0.6 },
    ],
    leafOrder: 1, leafSize: [1.4, 2.0], leafPer: 2.2, leafAtlas: 2, heno: 0,
    barkTint: 0x8a7b70, radial: [9, 6, 4],
  },
  pino: {
    trunkLen: [15, 21], trunkRad: [0.26, 0.36], flare: 0.25, flutes: 0, fluteAmt: 0, lean: 0.02, twist: 0.02,
    leader: 0.0, whorls: true,
    order: [
      { n: [22, 30], start: 0.35, angle: [1.25, 1.5], len: [2.2, 4.2], rad: 0.28, grav: -0.03, wob: 0.12, seg: 0.8 },
    ],
    leafOrder: 1, leafSize: [1.4, 1.9], leafPer: 2.8, leafAtlas: 2, heno: 0,
    barkTint: 0x7a6a60, radial: [8, 4],
  },
  ahuejote: {
    trunkLen: [12, 16], trunkRad: [0.2, 0.28], flare: 0.35, flutes: 0, fluteAmt: 0, lean: 0.03, twist: 0.04,
    leader: 0.0, whorls: true, columnar: true,
    order: [
      { n: [58, 70], start: 0.16, angle: [0.18, 0.46], len: [1.2, 2.5], rad: 0.3, grav: -0.04, wob: 0.18, seg: 0.6 },
    ],
    leafOrder: 1, leafSize: [1.2, 1.7], leafPer: 3.3, leafAtlas: 2, heno: 0,
    barkTint: 0x9a948a, radial: [7, 4],
  },
  amate: {
    trunkLen: [2.2, 3.2], trunkRad: [0.4, 0.6], flare: 0.8, flutes: 5, fluteAmt: 0.35, lean: 0.1, twist: 0.2,
    leader: 0.3,
    order: [
      { n: [5, 7], start: 0.6, angle: [0.7, 1.1], len: [4.5, 6.5], rad: 0.45, grav: 0.03, wob: 0.3, seg: 0.8 },
      { n: [4, 6], start: 0.3, angle: [0.5, 0.9], len: [1.8, 2.8], rad: 0.45, grav: 0.06, wob: 0.3, seg: 0.6 },
    ],
    leafOrder: 1, leafSize: [1.4, 1.9], leafPer: 1.5, leafAtlas: 2, heno: 0, roots: 7,
    barkTint: 0xd8cc9a, radial: [12, 6, 4],
  },
};

class Buf {
  constructor() { this.p = []; this.n = []; this.uv = []; this.c = []; this.w = []; this.i = []; this.vc = 0; }
  geo() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.setAttribute('aWind', new THREE.Float32BufferAttribute(this.w, 3));
    g.setIndex(this.i);
    g.computeBoundingSphere();
    return g;
  }
}

const _v = new THREE.Vector3(), _a = new THREE.Vector3(), _b = new THREE.Vector3();
function perp(d, out) {
  if (Math.abs(d.y) < 0.9) out.set(0, 1, 0); else out.set(1, 0, 0);
  return out.cross(d).normalize();
}

function tube(buf, pts, rads, flex, radial, opts) {
  // parallel transport frames
  const n = pts.length;
  const T = [], N = [], B = [];
  for (let i = 0; i < n; i++) {
    const t = new THREE.Vector3();
    if (i === 0) t.subVectors(pts[1], pts[0]); else if (i === n - 1) t.subVectors(pts[n - 1], pts[n - 2]); else t.subVectors(pts[i + 1], pts[i - 1]);
    T.push(t.normalize());
  }
  N.push(perp(T[0], new THREE.Vector3()));
  B.push(new THREE.Vector3().crossVectors(T[0], N[0]));
  for (let i = 1; i < n; i++) {
    const nn = N[i - 1].clone();
    const axis = new THREE.Vector3().crossVectors(T[i - 1], T[i]);
    const s = axis.length();
    if (s > 1e-6) { axis.divideScalar(s); const ang = Math.acos(clamp(T[i - 1].dot(T[i]), -1, 1)); nn.applyAxisAngle(axis, ang); }
    N.push(nn);
    B.push(new THREE.Vector3().crossVectors(T[i], nn));
  }
  const base = buf.vc;
  const rep = Math.max(1, Math.round(2 * Math.PI * rads[0] / 1.3));
  let s = 0;
  for (let i = 0; i < n; i++) {
    if (i > 0) s += pts[i].distanceTo(pts[i - 1]);
    for (let k = 0; k <= radial; k++) {
      const th = k / radial * Math.PI * 2;
      let r = rads[i];
      if (opts.fluteFn) r *= opts.fluteFn(th, s, i / (n - 1));
      const cx = Math.cos(th), sy = Math.sin(th);
      _v.copy(N[i]).multiplyScalar(cx).addScaledVector(B[i], sy);
      buf.p.push(pts[i].x + _v.x * r, pts[i].y + _v.y * r, pts[i].z + _v.z * r);
      buf.n.push(_v.x, _v.y, _v.z);
      buf.uv.push(k / radial * rep, s / 1.3);
      const ao = opts.aoFn ? opts.aoFn(pts[i], i / (n - 1)) : 1;
      buf.c.push(ao, ao, ao);
      buf.w.push(flex[i], 0, opts.phase || 0);
    }
  }
  for (let i = 0; i < n - 1; i++) {
    for (let k = 0; k < radial; k++) {
      const a = base + i * (radial + 1) + k, b = a + 1, c = a + radial + 1, d = c + 1;
      buf.i.push(a, c, b, b, c, d);
    }
  }
  buf.vc += n * (radial + 1);
}

function card(buf, c, dir, up, w, h, cell, flex, phase, normalDir, bend = 0.15) {
  // quad centered at c, facing dir; 2x2 atlas cell
  const right = new THREE.Vector3().crossVectors(up, dir).normalize();
  const u2 = new THREE.Vector3().crossVectors(dir, right).normalize();
  const base = buf.vc;
  const cu = (cell % 2) * 0.5, cv = cell < 2 ? 0.5 : 0.0;
  const corners = [[-0.5, -0.5], [0.5, -0.5], [-0.5, 0.5], [0.5, 0.5]];
  for (const [x, y] of corners) {
    const px = c.x + right.x * x * w + u2.x * y * h + dir.x * (x * x) * bend * w;
    const py = c.y + right.y * x * w + u2.y * y * h + dir.y * (x * x) * bend * w;
    const pz = c.z + right.z * x * w + u2.z * y * h + dir.z * (x * x) * bend * w;
    buf.p.push(px, py, pz);
    buf.n.push(normalDir.x, normalDir.y, normalDir.z);
    buf.uv.push(cu + (x + 0.5) * 0.5, cv + (y + 0.5) * 0.5);
    buf.c.push(1, 1, 1);
    buf.w.push(flex + 0.25, 1, phase);
  }
  buf.i.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
  buf.vc += 4;
}

function strand(buf, top, len, wdt, ang, flex, phase) {
  const base = buf.vc;
  const dx = Math.cos(ang), dz = Math.sin(ang);
  const seg = 4;
  for (let i = 0; i <= seg; i++) {
    const t = i / seg;
    for (const s of [-0.5, 0.5]) {
      buf.p.push(top.x + dx * s * wdt * (1 - t * 0.4), top.y - len * t, top.z + dz * s * wdt * (1 - t * 0.4));
      buf.n.push(-dz, 0.25, dx);
      buf.uv.push(s + 0.5, 1 - t * Math.min(1, len / 3.2));
      buf.c.push(1, 1, 1);
      buf.w.push(flex + t * len * 0.45, 0.6, phase);
    }
  }
  for (let i = 0; i < seg; i++) {
    const a = base + i * 2;
    buf.i.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
  }
  buf.vc += (seg + 1) * 2;
}

// Generate a tree. opts: { seed, lean: Vector3 dir, scale, groundFn(x,z)->y (world), origin: Vector3 (world offset) }
export function generateTree(kind, opts = {}) {
  const sp = SPECIES[kind];
  const rand = mulberry32(opts.seed || 1);
  const R = (a) => lerp(a[0], a[1], rand());
  const origin = opts.origin || new THREE.Vector3();
  const wood = new Buf(), leaves = new Buf(), heno = new Buf();
  const leafPts = [];
  const henoPts = [];
  const scale = opts.scale || 1;
  const trunkLen = R(sp.trunkLen) * scale;
  const trunkRad = R(sp.trunkRad) * scale;
  const phase = rand();
  const lean = new THREE.Vector3((rand() - 0.5) * sp.lean * 2, 1, (rand() - 0.5) * sp.lean * 2);
  if (opts.lean) lean.addScaledVector(opts.lean, 1);
  lean.normalize();
  const flutesPh = rand() * 6.28;
  const ns = rand() * 100;
  function branch(start, dir, len, rad, order, flex0, depthOrd) {
    const isTrunk = order < 0;
    const conf = isTrunk ? null : sp.order[order];
    const lod = opts.lod || 1;
    const segLen = (isTrunk ? 0.6 : conf.seg * scale) / lod;
    const nseg = Math.max(3, Math.round(len / segLen));
    const pts = [start.clone()], rads = [rad], flex = [flex0];
    const d = dir.clone();
    const p = start.clone();
    const wob = isTrunk ? sp.twist * 0.25 : conf.wob;
    const grav = isTrunk ? 0 : conf.grav;
    const endRad = isTrunk ? rad * (sp.whorls ? 0.08 : 0.35) : rad * 0.22;
    for (let i = 1; i <= nseg; i++) {
      const t = i / nseg;
      d.x += (rand() - 0.5) * wob; d.z += (rand() - 0.5) * wob; d.y += (rand() - 0.5) * wob * 0.5;
      d.y -= grav * (0.5 + t);
      if (isTrunk && sp.whorls) d.lerp(new THREE.Vector3(0, 1, 0), 0.25);
      d.normalize();
      p.addScaledVector(d, len / nseg);
      pts.push(p.clone());
      rads.push(lerp(rad, endRad, Math.pow(t, isTrunk ? 0.8 : 0.9)));
      flex.push(flex0 + (isTrunk ? 0.008 : 0.05 + order * 0.04) * (len * t));
    }
    const radial = Math.max(3, Math.round(sp.radial[Math.min(sp.radial.length - 1, order + 1)] * lod));
    const fluteFn = isTrunk && sp.flutes ? (th, s) => {
      const k = Math.exp(-s / (1.8 * scale));
      return 1 + k * sp.flare * 0.9 + k * sp.fluteAmt * Math.abs(Math.sin(th * sp.flutes * 0.5 + flutesPh)) * 1.6 - k * 0.1 + 0.06 * fbm3(Math.cos(th) * 2 + ns, s * 0.8, Math.sin(th) * 2, 2);
    } : (isTrunk ? (th, s) => 1 + Math.exp(-s / (0.8 * scale)) * sp.flare : null);
    tube(wood, pts, rads, flex, radial, {
      fluteFn, phase,
      aoFn: (pt, t) => isTrunk ? lerp(0.55, 1, smoothstep(0, 2.5 * scale, pt.y - origin.y)) : lerp(0.75, 1, t),
    });
    // children
    const kids = isTrunk ? sp.order[0] : sp.order[order + 1];
    if (kids) {
      const n = Math.round(R(kids.n) * (isTrunk ? 1 : 1));
      let az = rand() * 6.28;
      for (let k = 0; k < n; k++) {
        let t = lerp(kids.start, 0.97, sp.whorls && isTrunk ? (k / n) : rand());
        if (sp.whorls && isTrunk) t = lerp(kids.start, 0.97, Math.pow(k / n, 0.85));
        const idx = Math.min(pts.length - 2, Math.floor(t * (pts.length - 1)));
        const bp = pts[idx];
        const parentDir = new THREE.Vector3().subVectors(pts[idx + 1], pts[idx]).normalize();
        az += 2.39996 + (rand() - 0.5) * 0.6;
        const ang = R(kids.angle);
        const side = perp(parentDir, new THREE.Vector3());
        side.applyAxisAngle(parentDir, az);
        const cd = parentDir.clone().multiplyScalar(Math.cos(ang)).addScaledVector(side, Math.sin(ang)).normalize();
        let cl = R(kids.len) * scale * (isTrunk ? lerp(1, 0.55, sp.whorls ? t * t : t * 0.6) : lerp(1, 0.6, t));
        if (sp.whorls && isTrunk) { const tt = (t - kids.start) / (1 - kids.start); cl *= sp.columnar ? 0.55 + 0.45 * Math.sin(Math.PI * Math.min(1, tt * 1.1 + 0.08)) : lerp(1.1, 0.25, Math.pow(tt, 1.2)); }
        const cr = Math.max(0.02 * scale, rads[idx] * kids.rad * (isTrunk ? 1 : 1));
        const ord = isTrunk ? 0 : order + 1;
        branch(bp, cd, cl, cr, ord, flex[idx], depthOrd + 1);
      }
    }
    // leader continuation for broadleaf crowns
    if (isTrunk && sp.leader > 0) {
      const end = pts[pts.length - 1];
      const ld = dir.clone().lerp(new THREE.Vector3(0, 1, 0), 0.4).normalize();
      branch(end, ld, trunkLen * sp.leader, rads[rads.length - 1], 0, flex[flex.length - 1], 1);
    }
    // leaves
    const leafy = !isTrunk && order >= Math.min(sp.leafOrder, sp.order.length - 1);
    if (leafy) {
      const count = Math.max(1, Math.round(len * sp.leafPer));
      for (let k = 0; k < count; k++) {
        const t = lerp(0.25, 1, rand());
        const idx = Math.min(pts.length - 1, Math.round(t * (pts.length - 1)));
        leafPts.push({ p: pts[idx].clone(), flex: flex[idx], dir: dir.clone() });
      }
    }
    if (sp.heno && !isTrunk && order <= 1) {
      for (let k = 0; k < 6; k++) {
        const idx = Math.floor(lerp(0.2, 1, rand()) * (pts.length - 1));
        henoPts.push({ p: pts[idx].clone(), flex: flex[idx] });
      }
    }
  }
  branch(origin.clone(), lean, trunkLen, trunkRad, -1, 0, 0);
  // exposed roots
  const nroots = sp.roots || (kind === 'ahuehuete' ? 9 : 0);
  if (nroots && opts.groundFn) {
    for (let k = 0; k < nroots; k++) {
      const a = k / nroots * 6.28 + rand() * 0.5;
      const len = (kind === 'amate' ? 3.5 : 2.6) * scale * (0.7 + rand() * 0.7);
      const pts = [], rads = [], flex = [];
      const r0 = trunkRad * (kind === 'amate' ? 0.55 : 0.4);
      for (let i = 0; i <= 10; i++) {
        const t = i / 10;
        const rr = trunkRad * 0.6 + len * t;
        const x = origin.x + Math.cos(a + Math.sin(t * 3 + k) * 0.25) * rr;
        const z = origin.z + Math.sin(a + Math.sin(t * 3 + k) * 0.25) * rr;
        const gy = opts.groundFn(x, z);
        const y = lerp(origin.y + 0.9 * scale, gy + r0 * (1 - t) * 0.5, smoothstep(0, 0.45, t)) - t * 0.25;
        pts.push(new THREE.Vector3(x, y, z));
        rads.push(lerp(r0, r0 * 0.15, t));
        flex.push(0);
      }
      tube(wood, pts, rads, flex, 6, { phase, aoFn: () => 0.7 });
    }
  }
  // crown centre for spherical normals
  const cc = new THREE.Vector3();
  for (const l of leafPts) cc.add(l.p);
  cc.divideScalar(Math.max(1, leafPts.length));
  let crownR = 0;
  for (const l of leafPts) crownR = Math.max(crownR, l.p.distanceTo(cc));
  const up = new THREE.Vector3();
  for (const l of leafPts) {
    const out = new THREE.Vector3().subVectors(l.p, cc);
    if (sp.columnar) { out.y = (l.p.y - cc.y) / Math.max(crownR, 1) * 0.6; }
    const dist = out.length();
    out.normalize();
    const jitter = new THREE.Vector3(rand() - 0.5, rand() - 0.5, rand() - 0.5).multiplyScalar(0.9);
    const facing = out.clone().add(jitter).normalize();
    up.set(rand() - 0.5, 1.5, rand() - 0.5).normalize();
    const sz = R(sp.leafSize) * scale;
    const pos = l.p.clone().addScaledVector(out, sz * 0.25);
    const nrm = out.clone().multiplyScalar(0.8).addScaledVector(facing, 0.2).normalize();
    nrm.y = nrm.y * 0.7 + 0.3;
    card(leaves, pos, facing, up, sz, sz, Math.floor(rand() * 4), l.flex, rand(), nrm.normalize());
  }
  if (sp.heno) {
    const nh = Math.min(henoPts.length, sp.heno);
    for (let k = 0; k < nh; k++) {
      const h = henoPts[Math.floor(rand() * henoPts.length)];
      strand(heno, h.p, R(sp.henoLen) * scale, 0.5 + rand() * 0.5, rand() * 6.28, h.flex, rand());
    }
  }
  const box = new THREE.Box3();
  for (let i = 0; i < wood.p.length; i += 3) box.expandByPoint(_a.set(wood.p[i], wood.p[i + 1], wood.p[i + 2]));
  return {
    wood: wood.geo(), leaves: leaves.vc ? leaves.geo() : null, heno: heno.vc ? heno.geo() : null,
    crown: cc, crownR, height: box.max.y - origin.y, trunkRad,
  };
}
