// River layout: centreline, widths, (u,d) frame, terrain height function, flow.
import { simplex2, fbm2, ridged2, clamp, lerp, smoothstep } from './noise.js';

export const R = {
  U_MIN: -420, U_MAX: 1420,
  START_U: 16, FADE_U: 1092, FALL_U: 1152,
  WATER_Y: 0,
};

// ---------- centreline -------------------------------------------------
function cxA(u) {
  const g = smoothstep(700, 900, u);
  return 34 * Math.sin(u / 165 + 0.4) + 18 * Math.sin(u / 88 + 2.1) + g * 7 * Math.sin(u / 52 + 1.3) - 20;
}
function cxdA(u) {
  const g = smoothstep(700, 900, u);
  return 34 / 165 * Math.cos(u / 165 + 0.4) + 18 / 88 * Math.cos(u / 88 + 2.1) + g * 7 / 52 * Math.cos(u / 52 + 1.3);
}
function cxddA(u) {
  const g = smoothstep(700, 900, u);
  return -34 / (165 * 165) * Math.sin(u / 165 + 0.4) - 18 / (88 * 88) * Math.sin(u / 88 + 2.1) - g * 7 / (52 * 52) * Math.sin(u / 52 + 1.3);
}
// lookup tables (the centreline is sampled millions of times while building)
const LUT_U0 = -1600, LUT_STEP = 0.25, LUT_N = Math.ceil((3200 - LUT_U0) / LUT_STEP) + 2;
const LC = new Float64Array(LUT_N), LD = new Float64Array(LUT_N), LDD = new Float64Array(LUT_N);
for (let i = 0; i < LUT_N; i++) { const u = LUT_U0 + i * LUT_STEP; LC[i] = cxA(u); LD[i] = cxdA(u); LDD[i] = cxddA(u); }
function lut(T, A, u) {
  const f = (u - LUT_U0) / LUT_STEP;
  const i = Math.floor(f);
  if (i < 0 || i >= LUT_N - 1) return A(u);
  const t = f - i;
  return T[i] + (T[i + 1] - T[i]) * t;
}
export function cx(u) { return lut(LC, cxA, u); }
export function cxd(u) { return lut(LD, cxdA, u); }
export function cxdd(u) { return lut(LDD, cxddA, u); }
// curvature sign: >0 means river turns toward +d (right) as u increases
export function curv(u) {
  const d1 = cxd(u), d2 = cxdd(u);
  // T=(d1,-1), turning toward N=(1,d1) when T' . N > 0 ; T'=(d2,0)
  return d2 / Math.pow(1 + d1 * d1, 1.5);
}

// Frame at u: point, tangent (upstream), normal (right bank = +d)
export function frame(u, out = {}) {
  const d1 = cxd(u);
  const L = Math.sqrt(1 + d1 * d1);
  out.x = cx(u); out.z = -u;
  out.tx = d1 / L; out.tz = -1 / L;
  out.nx = 1 / L; out.nz = d1 / L;
  return out;
}
const _f = {};
export function toWorld(u, d, out = {}) {
  frame(u, _f);
  out.x = _f.x + _f.nx * d;
  out.z = _f.z + _f.nz * d;
  return out;
}

// World -> (u,d) via Newton projection on the centreline
export function toUD(x, z, out = {}, guess) {
  let u = guess !== undefined ? guess : -z;
  let coarse = 0, cbest = 1e18, hasC = false;
  const off = Math.abs(x - cx(u));
  if ((guess === undefined && off > 60) || off > 170) {
    // far from the river: coarse search for the nearest centreline point first
    for (let k = -40; k <= 40; k++) {
      const uu = u + k * 12;
      const dx = x - cx(uu), dz = z + uu;
      const dd = dx * dx + dz * dz;
      if (dd < cbest) { cbest = dd; coarse = uu; }
    }
    u = coarse; hasC = true;
  }
  const u0 = u;
  for (let i = 0; i < 6; i++) {
    const c = cx(u), c1 = cxd(u), c2 = cxdd(u);
    const h = -(x - c) * c1 + (z + u);
    const hp = c1 * c1 - (x - c) * c2 + 1;
    let du = hp > 0.05 ? h / hp : h;
    du = Math.max(-15, Math.min(15, du));
    u -= du;
    if (Math.abs(du) < 1e-4) break;
  }
  if (hasC) {
    const dx = x - cx(u), dz = z + u;
    if (dx * dx + dz * dz > cbest + 1 || Math.abs(u - u0) > 24) u = coarse;
  }
  const c = cx(u), c1 = cxd(u);
  const L = Math.sqrt(1 + c1 * c1);
  out.u = u;
  out.d = ((x - c) * 1 + (z + u) * c1) / L;
  return out;
}

// ---------- widths & depths -------------------------------------------
export function halfW(u) {
  let w = 16.5 + 1.6 * Math.sin(u / 57 + 1.0) + 0.8 * Math.sin(u / 23);
  w = lerp(w, 13.5 + Math.sin(u / 40) * 1.2, smoothstep(300, 600, u));
  w = lerp(w, 9.5 + Math.sin(u / 31) * 1.0, smoothstep(600, 860, u));
  w = lerp(w, 7.8 + Math.sin(u / 19) * 0.8, smoothstep(860, 980, u));
  // bridge reach: keep wide & regular
  w = lerp(w, 17.6, Math.exp(-Math.pow((u - 236) / 26, 2)));
  // plunge pool
  w = lerp(w, 15, smoothstep(1100, 1140, u) * (1 - smoothstep(1152, 1160, u)));
  return w;
}
export function bedDepth(u) {
  return lerp(2.3, 3.0, smoothstep(700, 950, u)) + 2.5 * smoothstep(1110, 1145, u) * (1 - smoothstep(1152, 1160, u));
}
export function plainW(u, side) {
  // width of flood plain beyond the bank
  const base = side > 0 ? 70 + 40 * Math.sin(u / 140 + 0.3) : 55 + 35 * Math.sin(u / 120 + 2.2);
  let w = base;
  w = lerp(w, side > 0 ? 18 : 40, smoothstep(360, 470, u) * (side > 0 ? 1 : 0.5));
  w = lerp(w, 16, smoothstep(520, 700, u));
  w = lerp(w, 3.5 + 2 * Math.sin(u / 30 + side), smoothstep(760, 880, u));
  // widen right plain for the pueblo
  if (side > 0) w = lerp(w, 110, Math.exp(-Math.pow((u - 250) / 110, 2)) * (1 - smoothstep(360, 420, u)));
  return w;
}

// ---------- flatten pads (oriented rectangles in a local straight frame) --
export const PADS = [];
export function addPad(u0, d0, halfU, halfD, h, margin = 6, rot = 0, soft = 1) {
  frame(u0, _f);
  const p = toWorld(u0, d0);
  const ca = Math.cos(rot), sa = Math.sin(rot);
  // local axes: a = tangent, b = normal (rotated)
  const ax = _f.tx * ca - _f.nx * sa, az = _f.tz * ca - _f.nz * sa;
  const bx = _f.nx * ca + _f.tx * sa, bz = _f.nz * ca + _f.tz * sa;
  const pad = { x: p.x, z: p.z, ax, az, bx, bz, hu: halfU, hd: halfD, h, m: margin, soft };
  PADS.push(pad);
  return pad;
}
export function padLocal(pad, x, z) {
  const dx = x - pad.x, dz = z - pad.z;
  return [dx * pad.ax + dz * pad.az, dx * pad.bx + dz * pad.bz];
}

// knolls (gaussian bumps with flat tops)
export const KNOLLS = [];
export function addKnoll(u, d, r, h, top = 0) {
  const p = toWorld(u, d);
  KNOLLS.push({ x: p.x, z: p.z, r, h, top });
}

// ---------- terrain height ------------------------------------------------
// 0 = gravel bar (inner bend), 1 = steep earthen bank (outer bend)
export function bankKind(u, side) {
  const outer = clamp(side * -curv(u) * 500 + simplex2(u * 0.012, side * 3.1) * 0.9, -1, 1);
  return smoothstep(-0.35, 0.35, outer);
}
const _ud = {};
export function riverHeight(u, d, x, z) {
  const w = halfW(u);
  const ad = Math.abs(d);
  const side = d >= 0 ? 1 : -1;
  const k = curv(u);
  // thalweg shifts toward outer bank (opposite of turning direction)
  const shift = clamp(-k * 900, -0.35, 0.35) * w;
  const t = Math.abs(d - shift) / w;
  const D = bedDepth(u);
  // riverbed
  let bed = lerp(-D, -0.5, smoothstep(0.28, 0.74, t));
  bed = lerp(bed, -0.04, smoothstep(0.74, 1.0, ad / w));
  bed += simplex2(x * 0.35, z * 0.35) * 0.08 + simplex2(x * 0.08, z * 0.08) * 0.25 * (1 - smoothstep(0.6, 1, t));
  if (ad <= w) return bed;
  const e = ad - w;
  const up = lerp(u, -z, smoothstep(90, 200, ad));
  // outer banks are steep & earthen; inner banks are gravel bars
  const kk = bankKind(u, side);
  const gravel = Math.min(e * 0.075, 0.75) + Math.max(0, e - 10) * 0.012;
  const earth = 1.7 * smoothstep(0.0, 3.2, e) + 0.35 * smoothstep(3, 12, e) + e * 0.01;
  let h = lerp(gravel, earth, kk) - 0.04;
  // flood plain undulation
  const pw = plainW(up, side);
  const pn = fbm2(x * 0.012, z * 0.012, 3) * 0.9 + fbm2(x * 0.05, z * 0.05, 2) * 0.25;
  h += pn * smoothstep(4, 20, e);
  h += smoothstep(10, pw, e) * 1.2;
  // valley walls
  const dd = e - pw;
  if (dd > -10) {
    const gorge = smoothstep(760, 900, up);
    const wallA = lerp(120 + 60 * fbm2(up * 0.004, side * 7, 2), 95, gorge);
    const L = lerp(90, 22, gorge);
    const ddp = Math.max(0, dd);
    let wall = wallA * (1 - Math.exp(-ddp / L)) * smoothstep(-10, 25, dd);
    // cliffs in the gorge
    wall += gorge * (38 * smoothstep(0, 9, ddp) + 14 * ridged2(x * 0.03, z * 0.03, 3) * smoothstep(0, 20, ddp));
    // ridges and spurs
    const rn = ridged2(x * 0.006, z * 0.006, 4);
    wall += (rn - 0.5) * 90 * smoothstep(20, 160, ddp);
    wall += fbm2(x * 0.02, z * 0.02, 3) * 12 * smoothstep(0, 40, ddp);
    // big mountains far away
    wall += Math.max(0, ad - 420) * 0.32 + Math.max(0, ad - 700) * 0.25;
    h += wall;
  }
  return h;
}

// headwall & upper terrain beyond the waterfall
function headwall(u, d, x, z, h) {
  const hw = smoothstep(R.FALL_U + 2, R.FALL_U + 7, u);
  if (hw <= 0) return h;
  const top = 38 + fbm2(x * 0.05, z * 0.05, 2) * 3 + Math.max(0, u - R.FALL_U - 7) * 0.08;
  const notch = Math.exp(-Math.pow(d / 5.5, 2)) * 1.6; // fall lip notch
  return Math.max(h, lerp(h, top - notch, hw));
}

export function terrainH(x, z, uguess) {
  toUD(x, z, _ud, uguess);
  const u = _ud.u, d = _ud.d;
  let h = riverHeight(u, d, x, z);
  h = headwall(u, d, x, z, h);
  // knolls
  for (let i = 0; i < KNOLLS.length; i++) {
    const k = KNOLLS[i];
    const r2 = ((x - k.x) ** 2 + (z - k.z) ** 2) / (k.r * k.r);
    if (r2 < 9) {
      let bump = k.h * Math.exp(-r2 * 1.2) * (1 + 0.15 * simplex2(x * 0.1, z * 0.1));
      if (k.top) bump = Math.min(bump, k.h * 0.92) ;
      h = Math.max(h, h * 0.3 + bump);
    }
  }
  // pads
  for (let i = 0; i < PADS.length; i++) {
    const p = PADS[i];
    const [a, b] = padLocal(p, x, z);
    const ea = Math.abs(a) - p.hu, eb = Math.abs(b) - p.hd;
    if (p.mb) {
      // per-side margins: along (mu) and across (negative / positive b side)
      const mb = b < 0 ? p.mb[0] : p.mb[1];
      if (ea > p.mu || eb > mb) continue;
      const t = Math.min(ea <= 0 ? 1 : 1 - smoothstep(0, p.mu, ea), eb <= 0 ? 1 : 1 - smoothstep(0, mb, eb));
      h = lerp(h, p.h, t);
      continue;
    }
    const e = Math.max(ea, eb);
    if (e < p.m) {
      const t = e <= 0 ? 1 : 1 - smoothstep(0, p.m, e);
      h = lerp(h, p.h, p.soft >= 1 ? t : Math.min(1, t * p.soft));
    }
  }
  return h;
}

// ---------- water flow --------------------------------------------------
// velocity of the water surface (world xz) at (u,d): downstream = -tangent
export function flowAt(u, d, out = {}) {
  frame(u, _f);
  const w = halfW(u);
  const t = clamp(Math.abs(d) / w, 0, 1);
  // calm canal through the pueblo (near-still, Xochimilco-like), livelier current in the gorge
  const vmax = lerp(0.14, 1.05, smoothstep(520, 920, u)) + 0.45 * smoothstep(1060, 1140, u);
  const sp = vmax * (1 - t * t * 0.9);
  out.x = -_f.tx * sp; out.z = -_f.tz * sp; out.s = sp;
  return out;
}

export function isWater(x, z) {
  toUD(x, z, _ud);
  return Math.abs(_ud.d) < halfW(_ud.u) && _ud.u < R.FALL_U + 3;
}
