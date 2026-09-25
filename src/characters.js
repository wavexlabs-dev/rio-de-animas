import * as THREE from 'three';
import { V, smin, smax, sdCapsule, sdCone, sdEll, sdBox, polygonize, autoSkin } from './sdf.js';
import { std, depthMat, U } from './materials.js';
import { tex } from './textures.js';
import { simplex2, clamp, lerp } from './noise.js';
import { fbm3 } from './noise.js';

// rest-pose joints (facing +Z, metres, 1.8 m reference height)
function joints(o = {}) {
  const sh = o.shoulder || 0.19, hipW = o.hipW || 0.095;
  return {
    root: V(0, 0, 0), hips: V(0, 0.96, 0), spine: V(0, 1.1, -0.01), chest: V(0, 1.3, -0.01), neck: V(0, 1.49, 0), head: V(0, 1.58, 0.01), top: V(0, 1.8, 0.02),
    shL: V(sh, 1.44, -0.015), elL: V(sh + 0.1, 1.17, -0.03), wrL: V(sh + 0.16, 0.93, 0.0), haL: V(sh + 0.18, 0.83, 0.02),
    shR: V(-sh, 1.44, -0.015), elR: V(-sh - 0.1, 1.17, -0.03), wrR: V(-sh - 0.16, 0.93, 0.0), haR: V(-sh - 0.18, 0.83, 0.02),
    hipL: V(hipW, 0.93, 0), knL: V(hipW + 0.01, 0.5, 0.025), anL: V(hipW + 0.015, 0.085, -0.01), toL: V(hipW + 0.02, 0.03, 0.15),
    hipR: V(-hipW, 0.93, 0), knR: V(-hipW - 0.01, 0.5, 0.025), anR: V(-hipW - 0.015, 0.085, -0.01), toR: V(-hipW - 0.02, 0.03, 0.15),
  };
}
const BONES = [
  ['root', -1], ['hips', 0], ['spine', 1], ['chest', 2], ['neck', 3], ['head', 4],
  ['shL', 3], ['elL', 6], ['wrL', 7], ['shR', 3], ['elR', 9], ['wrR', 10],
  ['hipL', 1], ['knL', 12], ['anL', 13], ['hipR', 1], ['knR', 15], ['anR', 16],
];
const BI = Object.fromEntries(BONES.map((b, i) => [b[0], i]));

function bodySDF(J, o) {
  const fem = !!o.female;
  const cloth = o.cloth || 0.012;
  return (x, y, z) => {
    let d = sdEll(x, y, z, V(0, 1.31, -0.005), fem ? 0.155 : 0.175, 0.19, fem ? 0.11 : 0.115);
    d = smin(d, sdEll(x, y, z, V(0, 1.1, 0.0), fem ? 0.13 : 0.15, 0.17, 0.105), 0.08);
    d = smin(d, sdEll(x, y, z, V(0, 0.95, -0.005), fem ? 0.17 : 0.158, 0.13, 0.115), 0.08);
    if (fem) { d = smin(d, sdEll(x, y, z, V(0.06, 1.3, 0.07), 0.06, 0.06, 0.05), 0.04); d = smin(d, sdEll(x, y, z, V(-0.06, 1.3, 0.07), 0.06, 0.06, 0.05), 0.04); }
    d = smin(d, sdCapsule(x, y, z, J.neck, V(0, 1.6, 0.01), 0.052), 0.04);
    // head
    let h = sdEll(x, y, z, V(0, 1.69, 0.0), 0.086, 0.112, 0.1);
    h = smin(h, sdEll(x, y, z, V(0, 1.625, 0.035), 0.066, 0.06, 0.07), 0.04);
    h = smin(h, sdEll(x, y, z, V(0, 1.665, 0.1), 0.014, 0.026, 0.022), 0.015);
    h = smin(h, sdEll(x, y, z, V(0.085, 1.67, 0.0), 0.012, 0.03, 0.02), 0.01);
    h = smin(h, sdEll(x, y, z, V(-0.085, 1.67, 0.0), 0.012, 0.03, 0.02), 0.01);
    d = smin(d, h, 0.03);
    // arms
    for (const s of ['L', 'R']) {
      const sh = J['sh' + s], el = J['el' + s], wr = J['wr' + s], ha = J['ha' + s];
      d = smin(d, sdEll(x, y, z, sh, 0.065, 0.06, 0.06), 0.06);
      d = smin(d, sdCone(x, y, z, sh, el, 0.05 + cloth, 0.041 + cloth), 0.03);
      d = smin(d, sdCone(x, y, z, el, wr, 0.04 + cloth * 0.8, 0.029), 0.02);
      const hc = V((wr.x + ha.x) / 2, (wr.y + ha.y) / 2, (wr.z + ha.z) / 2 + 0.005);
      d = smin(d, sdEll(x, y, z, hc, 0.028, 0.055, 0.042), 0.02);
      // legs
      const hp = J['hip' + s], kn = J['kn' + s], an = J['an' + s], to = J['to' + s];
      const pant = o.pants || 0.015;
      d = smin(d, sdCone(x, y, z, hp, kn, 0.078 + pant, 0.05 + pant), 0.04);
      d = smin(d, sdCone(x, y, z, kn, an, 0.048 + pant, 0.034 + pant * (o.widePants ? 2.2 : 1)), 0.02);
      d = smin(d, sdBox(x, y, z, V(to.x, 0.035, (an.z + to.z) / 2 + 0.01), 0.045, 0.035, 0.11, 0.025), 0.03);
    }
    if (o.skirt) {
      const sk = sdCone(x, y, z, V(0, 1.02, 0), V(0, 0.06, 0.02), 0.17, 0.3);
      d = smin(d, sk, 0.05);
    }
    if (o.rebozo) {
      let rb = sdEll(x, y, z, V(0, 1.7, -0.02), 0.11, 0.135, 0.125);
      rb = Math.max(rb, -sdEll(x, y, z, V(0, 1.64, 0.13), 0.075, 0.105, 0.09));
      rb = smin(rb, sdEll(x, y, z, V(0, 1.37, -0.02), 0.25, 0.13, 0.15), 0.06);
      rb = smin(rb, sdCapsule(x, y, z, V(0.1, 1.36, 0.09), V(0.07, 1.0, 0.12), 0.035), 0.04);
      rb = smin(rb, sdCapsule(x, y, z, V(-0.1, 1.36, 0.09), V(-0.05, 1.05, 0.12), 0.035), 0.04);
      d = smin(d, rb, 0.02);
    }
    return d;
  };
}

function colorFn(J, o) {
  const skin = o.skin || [0.46, 0.3, 0.2];
  const shirt = o.shirt || [0.86, 0.83, 0.76];
  const pants = o.pantsCol || [0.84, 0.8, 0.72];
  return (x, y, z) => {
    if (o.rebozo && y > 1.0) {
      const face = z > 0.04 && y < 1.75 && y > 1.55 && Math.abs(x) < 0.075;
      const hand = ['L', 'R'].some((s) => sdCapsule(x, y, z, J['wr' + s], J['ha' + s], 0.07) < 0);
      if (!face && !hand && (y > 1.22 || (Math.abs(x) < 0.14 && z > 0.07))) {
        const sp = (Math.sin(x * 140) * Math.sin(y * 170 + z * 90) > 0.82) ? 1 : 0;
        return sp ? [0.62, 0.62, 0.7] : [0.12, 0.12, 0.2];
      }
    }
    const dHead = Math.min(sdEll(x, y, z, V(0, 1.66, 0.02), 0.1, 0.13, 0.12), sdCapsule(x, y, z, J.neck, V(0, 1.6, 0), 0.06));
    if (dHead < 0.02 && y > 1.47) {
      // hair on back/top of head
      if (o.hair && (z < -0.02 || y > 1.76) && y > 1.6) return o.hair;
      // eyes/brows darker
      if (y > 1.67 && y < 1.7 && z > 0.07 && Math.abs(x) > 0.02 && Math.abs(x) < 0.05) return [0.12, 0.08, 0.06];
      if (o.mustache && y > 1.61 && y < 1.64 && z > 0.07 && Math.abs(x) < 0.035) return o.mustache;
      return skin;
    }
    for (const s of ['L', 'R']) {
      const ha = J['ha' + s], wr = J['wr' + s];
      if (sdCapsule(x, y, z, wr, ha, 0.07) < 0 && y < wr.y + 0.03) return skin;
      const an = J['an' + s], to = J['to' + s];
      if (y < 0.1) return o.feet || [0.32, 0.22, 0.14];
      if (o.sleeves && sdCapsule(x, y, z, J['el' + s], wr, 0.06) < 0 && y < J['el' + s].y - 0.06) return skin;
    }
    if (o.skirt && y < 1.02) return o.skirtCol;
    if (y > 0.97 && y < 1.04 && o.sash) return o.sash;
    if (o.embroid && y > 1.36 && y < 1.44 && Math.abs(x) < 0.16) return ((Math.floor(x * 60) + Math.floor(y * 60)) % 3 === 0) ? [0.75, 0.15, 0.25] : (Math.floor(x * 40) % 2 ? [0.2, 0.45, 0.25] : [0.9, 0.6, 0.15]);
    if (y < 0.98) return pants;
    return shirt;
  };
}

function makeSkeleton(J, scale) {
  const bones = [];
  for (const [name, parent] of BONES) {
    const b = new THREE.Bone();
    b.name = name;
    const p = J[name].clone().multiplyScalar(scale);
    if (parent >= 0) p.sub(J[BONES[parent][0]].clone().multiplyScalar(scale));
    b.position.copy(p);
    if (parent >= 0) bones[parent].add(b);
    bones.push(b);
  }
  return bones;
}

function segments(J, scale) {
  const S = (a, b, bone, r = 0) => ({ a: J[a].clone().multiplyScalar(scale), b: J[b].clone().multiplyScalar(scale), bone: BI[bone], r: r * scale });
  return [
    S('hips', 'spine', 'hips', 0.05), S('spine', 'chest', 'spine', 0.04), S('chest', 'neck', 'chest', 0.08), S('neck', 'head', 'neck'), S('head', 'top', 'head', 0.04),
    S('shL', 'elL', 'shL'), S('elL', 'wrL', 'elL'), S('wrL', 'haL', 'wrL'), S('shR', 'elR', 'shR'), S('elR', 'wrR', 'elR'), S('wrR', 'haR', 'wrR'),
    S('hipL', 'knL', 'hipL'), S('knL', 'anL', 'knL'), S('anL', 'toL', 'anL'), S('hipR', 'knR', 'hipR'), S('knR', 'anR', 'knR'), S('anR', 'toR', 'anR'),
  ];
}

const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();

// Joint layout fitted to an arbitrary humanoid mesh standing in an A-pose, facing +Z, feet at y = 0
// (generated scans): arms are traced as the outer clusters of horizontal slices, the neck as the waist
// of the central column under the hat, everything else follows standard proportions from the neck height.
export function fitJoints(geo) {
  const P = geo.attributes.position, n = P.count;
  const pts = new Array(n);
  let H = 0;
  for (let i = 0; i < n; i++) { pts[i] = [P.getX(i), P.getY(i), P.getZ(i)]; H = Math.max(H, pts[i][1]); }
  pts.sort((a, b) => a[1] - b[1]);
  const slice = (y0, y1, gap) => {
    let lo = 0, hi = pts.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (pts[m][1] < y0) lo = m + 1; else hi = m; }
    const sel = [];
    for (let i = lo; i < pts.length && pts[i][1] < y1; i++) sel.push(pts[i]);
    sel.sort((a, b) => a[0] - b[0]);
    const cl = [];
    for (const p of sel) {
      const c = cl[cl.length - 1];
      if (!c || p[0] - c.max > gap) cl.push({ min: p[0], max: p[0], sx: p[0], sz: p[2], n: 1 });
      else { c.max = p[0]; c.sx += p[0]; c.sz += p[2]; c.n++; }
    }
    return cl.filter((c) => c.n > 3).map((c) => ({ min: c.min, max: c.max, cx: c.sx / c.n, cz: c.sz / c.n, w: c.max - c.min }));
  };
  const central = (y) => { const cl = slice(y - 0.006 * H, y + 0.006 * H, 0.012 * H); return cl.reduce((b, c) => (!b || Math.abs(c.cx) < Math.abs(b.cx) ? c : b), null); };
  // neck: narrowest central section below the hat
  let neckY = 0.83 * H, best = 1e9;
  for (let y = 0.74 * H; y < 0.9 * H; y += 0.005 * H) { const c = central(y); if (c && c.w < best) { best = c.w; neckY = y; } }
  const Hb = neckY / 0.828;
  const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
  const J = {};
  const cz = (y) => { const c = central(y); return c ? c.cz : 0; };
  J.root = V3(0, 0, 0);
  for (const [k, f] of [['hips', 0.533], ['spine', 0.611], ['chest', 0.722], ['neck', 0.828], ['head', 0.878]]) J[k] = V3(0, f * Hb, cz(f * Hb));
  J.top = V3(0, Hb, J.head.z);
  // arms: outermost clusters of slices between the knees and the armpits
  for (const [side, s] of [['L', 1], ['R', -1]]) {
    const arm = [];
    for (let y = 0.36 * Hb; y < 0.78 * Hb; y += 0.012 * Hb) {
      const cl = slice(y, y + 0.012 * Hb, 0.02 * Hb);
      if (cl.length < 2) continue;
      const c = s > 0 ? cl[cl.length - 1] : cl[0];
      const next = s > 0 ? cl[cl.length - 2] : cl[1];
      // an arm is an outer cluster standing clear of the torso / legs
      const gap = s > 0 ? c.min - next.max : next.min - c.max;
      if (c.cx * s > 0.17 * Hb && gap > 0.05 * Hb) arm.push([c.cx, y + 0.006 * Hb, c.cz]);
    }
    let sh, el, wr, ha;
    if (arm.length >= 6) {
      // least squares x(y), z(y)
      let sy = 0, sx = 0, szz = 0, syy = 0, syx = 0, syz = 0;
      for (const [x, y, z] of arm) { sy += y; sx += x; szz += z; syy += y * y; syx += y * x; syz += y * z; }
      const m = arm.length, den = m * syy - sy * sy || 1;
      const ax = (m * syx - sy * sx) / den, bx = (sx - ax * sy) / m, az = (m * syz - sy * szz) / den, bz = (szz - az * sy) / m;
      const at = (y) => V3(ax * y + bx, y, az * y + bz);
      const tipY = Math.min(...arm.map((a) => a[1])) - 0.01 * Hb;
      const shY = 0.8 * Hb;
      sh = at(shY); sh.x = s * Math.max(Math.abs(sh.x) * 0.8, 0.085 * Hb); sh.z = J.chest.z - 0.01 * Hb;
      const tip = at(tipY);
      const dir = sh.clone().sub(tip).normalize();
      wr = tip.clone().addScaledVector(dir, 0.1 * Hb);
      ha = tip.clone().addScaledVector(dir, 0.045 * Hb);
      el = sh.clone().lerp(wr, 0.5); el.z -= 0.015 * Hb;
    } else {
      const k = Hb / 1.8;
      sh = V3(s * 0.19 * k, 1.44 * k, 0); el = V3(s * 0.29 * k, 1.17 * k, -0.03 * k); wr = V3(s * 0.35 * k, 0.93 * k, 0); ha = V3(s * 0.37 * k, 0.83 * k, 0.02 * k);
    }
    J['sh' + side] = sh; J['el' + side] = el; J['wr' + side] = wr; J['ha' + side] = ha;
  }
  // legs: the two clusters closest to the centre at knee and ankle height
  const legs = (y) => { const cl = slice(y - 0.01 * Hb, y + 0.01 * Hb, 0.015 * Hb).sort((a, b) => Math.abs(a.cx) - Math.abs(b.cx)).slice(0, 2).sort((a, b) => b.cx - a.cx); return cl.length === 2 ? cl : null; };
  const kn = legs(0.28 * Hb), an = legs(0.06 * Hb);
  for (const [i, side, s] of [[0, 'L', 1], [1, 'R', -1]]) {
    const kx = kn ? kn[i].cx : s * 0.053 * Hb;
    const ax = an ? an[i].cx : kx;
    J['hip' + side] = V3(kx * 0.92, 0.518 * Hb, 0);
    J['kn' + side] = V3(kx, 0.278 * Hb, kn ? kn[i].cz + 0.01 * Hb : 0.014 * Hb);
    J['an' + side] = V3(ax, 0.047 * Hb, an ? an[i].cz - 0.01 * Hb : 0);
    J['to' + side] = V3(ax, 0.017 * Hb, J['an' + side].z + 0.085 * Hb);
  }
  return { J, Hb, neckY };
}

export class Character {
  constructor(opts) {
    this.o = opts;
    if (opts.geo) { this.fromMesh(opts); return; }
    const scale = opts.scale || 0.92;
    this.scale = scale;
    const J = joints(opts);
    this.J = J;
    this.hipY = J.hips.y * scale;
    const f0 = bodySDF(J, opts);
    const f = (x, y, z) => f0(x / scale, y / scale, z / scale) * scale;
    const res = (opts.res || 0.018) * scale;
    const geo = polygonize(f, V(-0.5, -0.02, -0.3).multiplyScalar(scale), V(0.5, 1.86, 0.35).multiplyScalar(scale), res);
    const cf = colorFn(J, opts);
    const p = geo.attributes.position;
    const col = new Float32Array(p.count * 3);
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i) / scale, y = p.getY(i) / scale, z = p.getZ(i) / scale;
      const c = cf(x, y, z);
      const n = 0.92 + 0.12 * fbm3(x * 40, y * 40, z * 40, 2);
      col[i * 3] = c[0] * n; col[i * 3 + 1] = c[1] * n; col[i * 3 + 2] = c[2] * n;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    autoSkin(geo, segments(J, scale), 0.035 * scale);
    const mat = std({ vertexColors: true, roughness: 0.82, metalness: 0, map: tex('cloth_c'), normalMap: tex('cloth_n', { srgb: false }), normalScale: new THREE.Vector2(0.5, 0.5) }, { porosity: 0.5, key: 'char' });
    // simple planar uv for cloth texture
    const uv = new Float32Array(p.count * 2);
    for (let i = 0; i < p.count; i++) { uv[i * 2] = (p.getX(i) + p.getZ(i)) * 6; uv[i * 2 + 1] = p.getY(i) * 6; }
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    this.bones = makeSkeleton(J, scale);
    this.skeleton = new THREE.Skeleton(this.bones);
    this.mesh = new THREE.SkinnedMesh(geo, mat);
    this.mesh.add(this.bones[0]);
    this.mesh.updateMatrixWorld(true);
    this.mesh.bind(this.skeleton);
    this.mesh.castShadow = true; this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;
    this.mesh.name = 'character';
    this.mesh.customDepthMaterial = depthMat(mat, { wind: false });
    this.group = new THREE.Group();
    this.group.add(this.mesh);
    this.b = Object.fromEntries(this.bones.map((b) => [b.name, b]));
    this.rest = this.bones.map((b) => b.quaternion.clone());
    this.restPos = this.bones.map((b) => b.position.clone());
  }
  // skinned character from a generated mesh (already in metres, A-pose, facing +Z, feet at 0)
  fromMesh(opts) {
    const geo = opts.geo;
    const { J, neckY } = opts.fit || fitJoints(geo);
    this.J = J; this.scale = 1; this.hipY = J.hips.y;
    autoSkin(geo, segments(J, 1), 0.035);
    // hat and head move rigidly with the head bone
    const p = geo.attributes.position, si = geo.attributes.skinIndex, sw = geo.attributes.skinWeight;
    for (let i = 0; i < p.count; i++) if (p.getY(i) > neckY + 0.045) { si.setXYZW(i, BI.head, 0, 0, 0); sw.setXYZW(i, 1, 0, 0, 0); }
    this.bones = makeSkeleton(J, 1);
    this.skeleton = new THREE.Skeleton(this.bones);
    this.mesh = new THREE.SkinnedMesh(geo, opts.mat);
    this.mesh.add(this.bones[0]);
    this.mesh.updateMatrixWorld(true);
    this.mesh.bind(this.skeleton);
    this.mesh.castShadow = true; this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;
    this.mesh.name = 'character';
    this.mesh.customDepthMaterial = depthMat(opts.mat, { wind: false });
    this.group = new THREE.Group();
    this.group.add(this.mesh);
    this.b = Object.fromEntries(this.bones.map((b) => [b.name, b]));
    this.rest = this.bones.map((b) => b.quaternion.clone());
    this.restPos = this.bones.map((b) => b.position.clone());
  }
  reset() { this.bones.forEach((b, i) => { b.quaternion.copy(this.rest[i]); b.position.copy(this.restPos[i]); }); }
  // Rotate bone so that the direction toward its child (in world) points at dir
  aim(bone, child, worldDir, weight = 1) {
    bone.updateWorldMatrix(true, false);
    const bp = _v1.setFromMatrixPosition(bone.matrixWorld);
    child.updateWorldMatrix(false, false);
    const cp = _v2.setFromMatrixPosition(child.matrixWorld);
    const cur = cp.sub(bp).normalize();
    const tgt = _v3.copy(worldDir).normalize();
    _q.setFromUnitVectors(cur, tgt);
    if (weight < 1) _q.slerp(new THREE.Quaternion(), 1 - weight);
    const wq = bone.getWorldQuaternion(new THREE.Quaternion());
    const pq = bone.parent.getWorldQuaternion(new THREE.Quaternion());
    const nq = _q.multiply(wq);
    bone.quaternion.copy(pq.invert().multiply(nq));
    bone.updateWorldMatrix(false, true);
  }
  // Two-bone IK: a (root bone), b (mid), c (end). target world pos, pole world pos
  ik2(a, b, c, target, pole) {
    a.updateWorldMatrix(true, true);
    const A = new THREE.Vector3().setFromMatrixPosition(a.matrixWorld);
    const Bp = new THREE.Vector3().setFromMatrixPosition(b.matrixWorld);
    const Cp = new THREE.Vector3().setFromMatrixPosition(c.matrixWorld);
    const l1 = A.distanceTo(Bp), l2 = Bp.distanceTo(Cp);
    const T = target.clone();
    let d = A.distanceTo(T);
    d = clamp(d, Math.abs(l1 - l2) + 1e-3, l1 + l2 - 1e-3);
    const dir = T.clone().sub(A).normalize();
    const cosA = clamp((l1 * l1 + d * d - l2 * l2) / (2 * l1 * d), -1, 1);
    const pv = pole.clone().sub(A);
    pv.sub(dir.clone().multiplyScalar(pv.dot(dir))).normalize();
    const elbow = A.clone().addScaledVector(dir, Math.cos(Math.acos(cosA)) * l1).addScaledVector(pv, Math.sin(Math.acos(cosA)) * l1);
    this.aim(a, b, elbow.clone().sub(A));
    b.updateWorldMatrix(true, false);
    const B2 = new THREE.Vector3().setFromMatrixPosition(b.matrixWorld);
    this.aim(b, c, A.clone().addScaledVector(dir, d).sub(B2));
  }
  worldPos(bone) { bone.updateWorldMatrix(true, false); return new THREE.Vector3().setFromMatrixPosition(bone.matrixWorld); }
}

// ---------- accessories ------------------------------------------------------
export function sombrero(brim = 0.27, crownH = 0.13) {
  const pts = [];
  pts.push(new THREE.Vector2(0.0, crownH + 0.02));
  pts.push(new THREE.Vector2(0.05, crownH + 0.015));
  pts.push(new THREE.Vector2(0.085, crownH - 0.01));
  pts.push(new THREE.Vector2(0.095, 0.03));
  pts.push(new THREE.Vector2(0.1, 0.005));
  pts.push(new THREE.Vector2(brim * 0.6, -0.005));
  pts.push(new THREE.Vector2(brim, -0.03));
  pts.push(new THREE.Vector2(brim + 0.01, -0.038));
  pts.push(new THREE.Vector2(brim - 0.01, -0.035));
  pts.push(new THREE.Vector2(brim * 0.6, -0.012));
  pts.push(new THREE.Vector2(0.098, -0.005));
  const g = new THREE.LatheGeometry(pts, 28);
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 6, uv.getY(i) * 3);
  const m = std({ map: tex('petate_c'), normalMap: tex('petate_n', { srgb: false }), color: 0xe8d8b0, roughness: 0.85, side: THREE.DoubleSide }, { porosity: 0.6, key: 'hat' });
  const mesh = new THREE.Mesh(g, m);
  mesh.castShadow = true; mesh.receiveShadow = true;
  mesh.customDepthMaterial = depthMat(m, { wind: false });
  return mesh;
}

// palm-leaf rain cape (suyacal): fringe cards around back & shoulders
export function suyacal(scale = 0.92) {
  const pos = [], uv = [], nrm = [], wind = [], idx = [];
  let vc = 0;
  const layers = [[1.45, 0.16, 1.12, 0.3], [1.34, 0.22, 0.95, 0.36], [1.2, 0.27, 0.8, 0.4]];
  for (const [y0, r0, y1, r1] of layers) {
    const n = 16;
    for (let k = 0; k < n; k++) {
      const a0 = lerp(-2.2, 2.2, k / n), a1 = lerp(-2.2, 2.2, (k + 1) / n);
      const pts = [[a0, y0, r0], [a1, y0, r0], [a0, y1, r1], [a1, y1, r1]];
      for (const [a, y, r] of pts) {
        const ang = a + Math.PI; // centred on the back (-Z)
        pos.push(Math.sin(ang) * r * scale, y * scale, Math.cos(ang) * r * 0.85 * scale);
        nrm.push(Math.sin(ang), 0.3, Math.cos(ang));
        uv.push((a - a0) / (a1 - a0) * 0.5 + (k % 2) * 0.5, y === y0 ? 1 : 0);
        wind.push(y === y0 ? 0 : (y0 - y1) * 0.8, 0.6, k / n);
      }
      idx.push(vc, vc + 2, vc + 1, vc + 1, vc + 2, vc + 3);
      vc += 4;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('aWind', new THREE.Float32BufferAttribute(wind, 3));
  g.setIndex(idx);
  const m = std({ map: tex('f_palm'), alphaTest: 0.4, side: THREE.DoubleSide, roughness: 0.85, color: 0xd8c8a0 }, {
    wind: true, porosity: 0.7, key: 'cape',
    uniforms: { uStroke: { value: 0 } },
    vertexPre: 'uniform float uStroke;\n',
    vertexPost: '',
  });
  m.alphaToCoverage = true;
  const mesh = new THREE.Mesh(g, m);
  mesh.castShadow = true;
  mesh.customDepthMaterial = depthMat(m, { wind: true });
  return mesh;
}

// ---------- the xolo (sleeping) ---------------------------------------------
export function xolo() {
  const f = (x, y, z) => {
    // curled body along an arc in xz plane
    let d = 1e9;
    for (let i = 0; i < 7; i++) {
      const a = -1.2 + i * 0.45;
      const c = V(Math.cos(a) * 0.2, 0.13, Math.sin(a) * 0.2);
      d = smin(d, sdEll(x, y, z, c, 0.11, 0.1 - Math.abs(i - 3) * 0.008, 0.11), 0.07);
    }
    // head resting near tail end
    d = smin(d, sdEll(x, y, z, V(0.2, 0.12, 0.15), 0.07, 0.06, 0.08), 0.04);
    d = smin(d, sdEll(x, y, z, V(0.25, 0.1, 0.24), 0.035, 0.03, 0.06), 0.03);
    // ears
    d = smin(d, sdCone(x, y, z, V(0.2, 0.17, 0.12), V(0.19, 0.27, 0.09), 0.025, 0.004), 0.01);
    d = smin(d, sdCone(x, y, z, V(0.15, 0.16, 0.15), V(0.12, 0.25, 0.13), 0.025, 0.004), 0.01);
    // front legs tucked
    d = smin(d, sdCapsule(x, y, z, V(0.12, 0.05, 0.2), V(0.26, 0.04, 0.3), 0.025), 0.03);
    d = smin(d, sdCapsule(x, y, z, V(0.1, 0.05, 0.24), V(0.22, 0.04, 0.34), 0.025), 0.03);
    // tail
    d = smin(d, sdCone(x, y, z, V(-0.1, 0.12, -0.2), V(0.12, 0.05, -0.28), 0.03, 0.01), 0.02);
    return Math.max(d, -y + 0.005);
  };
  const g = polygonize(f, V(-0.4, 0, -0.45), V(0.45, 0.35, 0.45), 0.016);
  const p = g.attributes.position;
  const col = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const n = 0.85 + 0.2 * fbm3(p.getX(i) * 30, p.getY(i) * 30, p.getZ(i) * 30, 2);
    const belly = p.getY(i) < 0.06 ? 0.35 : 0;
    col[i * 3] = (0.2 + belly * 0.5) * n; col[i * 3 + 1] = (0.18 + belly * 0.3) * n; col[i * 3 + 2] = (0.17 + belly * 0.28) * n;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const m = std({ vertexColors: true, roughness: 0.55, metalness: 0 }, { porosity: 0.2, key: 'xolo' });
  const mesh = new THREE.Mesh(g, m);
  mesh.castShadow = true; mesh.receiveShadow = true;
  return mesh;
}
