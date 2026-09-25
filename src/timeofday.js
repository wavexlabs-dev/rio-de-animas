// Day-night cycle: phase -> solar hour -> sun/moon + art-directed parameters
import * as THREE from 'three';
import { clamp, lerp, smoothstep } from './noise.js';

export const CYCLE = 540; // seconds for a full day

// phase (0..1) -> hour. Night compressed, golden hour stretched.
const PH = [
  [0.000, 4.4], [0.045, 5.55], [0.085, 6.25], [0.13, 7.3], [0.22, 9.6], [0.30, 12.0], [0.38, 14.0],
  [0.47, 15.4], [0.55, 16.25], [0.60, 16.9], [0.665, 17.55], [0.705, 17.95], [0.745, 18.45], [0.785, 19.2],
  [0.90, 24.0], [0.965, 27.2], [1.0, 28.4],
];
export function phaseToHour(p) {
  p = ((p % 1) + 1) % 1;
  for (let i = 0; i < PH.length - 1; i++) {
    const a = PH[i], b = PH[i + 1];
    if (p >= a[0] && p <= b[0]) return lerp(a[1], b[1], (p - a[0]) / (b[0] - a[0])) % 24;
  }
  return 4.4;
}

// storm envelope by phase
export function stormAt(p) {
  p = ((p % 1) + 1) % 1;
  return smoothstep(0.405, 0.455, p) * (1 - smoothstep(0.525, 0.575, p));
}
export function rainAt(p) {
  p = ((p % 1) + 1) % 1;
  return smoothstep(0.43, 0.46, p) * (1 - smoothstep(0.51, 0.545, p));
}

const LAT = 19.0 * Math.PI / 180, DEC = -15.5 * Math.PI / 180, MDEC = 12 * Math.PI / 180;
function celestial(hourAngle, dec, out) {
  const sinEl = Math.sin(LAT) * Math.sin(dec) + Math.cos(LAT) * Math.cos(dec) * Math.cos(hourAngle);
  const el = Math.asin(clamp(sinEl, -1, 1));
  const cosAz = (Math.sin(dec) - Math.sin(el) * Math.sin(LAT)) / (Math.cos(el) * Math.cos(LAT));
  let az = Math.acos(clamp(cosAz, -1, 1));
  if (Math.sin(hourAngle) > 0) az = 2 * Math.PI - az; // afternoon -> west
  // scene: +x north, +z east
  out.set(Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az));
  return el;
}

const C = (h) => new THREE.Color(h);
// keyframes by hour
const K = [
  { h: 4.4, zen: '#080d22', hor: '#1f2a4c', glow: '#303a62', sun: '#ff8a4a', hemiS: '#384c84', hemiG: '#1a1c26', hemiI: 0.6, fog: '#1e2646', fogS: '#2a3050', fogD: 0.0016, exp: 1.35, sat: 0.8, con: 1.0, lift: [0.02, 0.025, 0.05], gain: [0.92, 0.98, 1.12], bloom: 0.9, rays: 0.0, mist: 1.0, stars: 1, alpen: 0.0, cloudLit: '#39426a', cloudDark: '#0e1224' },
  { h: 5.55, zen: '#16204a', hor: '#5a4f78', glow: '#b06a70', sun: '#ff7a3a', hemiS: '#4a5890', hemiG: '#2a2630', hemiI: 0.6, fog: '#4a4a6c', fogS: '#a8687a', fogD: 0.0017, exp: 1.45, sat: 0.85, con: 1.0, lift: [0.02, 0.02, 0.045], gain: [1.0, 0.96, 1.08], bloom: 0.8, rays: 0.1, mist: 1.0, stars: 0.4, alpen: 0.5, cloudLit: '#c07a8a', cloudDark: '#2c2a48' },
  { h: 6.25, zen: '#3a5a9a', hor: '#e7a07a', glow: '#ffb070', sun: '#ff9a55', hemiS: '#7a8cc0', hemiG: '#4a3a30', hemiI: 0.65, fog: '#b9a09a', fogS: '#ffb486', fogD: 0.0015, exp: 1.3, sat: 1.0, con: 1.02, lift: [0.02, 0.015, 0.03], gain: [1.06, 0.98, 0.94], bloom: 0.7, rays: 0.8, mist: 0.9, stars: 0, alpen: 1.0, cloudLit: '#ffc196', cloudDark: '#6c6078' },
  { h: 7.3, zen: '#4f78bd', hor: '#e8c7a8', glow: '#ffd09a', sun: '#ffc88e', hemiS: '#90a8d8', hemiG: '#5a4a38', hemiI: 0.6, fog: '#c4c0b4', fogS: '#ffd9a8', fogD: 0.0009, exp: 1.08, sat: 1.1, con: 1.06, lift: [0.012, 0.01, 0.018], gain: [1.05, 1.0, 0.94], bloom: 0.55, rays: 0.7, mist: 0.45, stars: 0, alpen: 0.3, cloudLit: '#ffe6c8', cloudDark: '#8a8aa0' },
  { h: 9.6, zen: '#3f6fbf', hor: '#bcd0e0', glow: '#fff0d8', sun: '#fff0dc', hemiS: '#9ab8e8', hemiG: '#5c5040', hemiI: 0.55, fog: '#b4c4d2', fogS: '#f2eadc', fogD: 0.0007, exp: 1.0, sat: 1.1, con: 1.06, lift: [0.01, 0.012, 0.018], gain: [1.0, 1.0, 1.0], bloom: 0.4, rays: 0.25, mist: 0.2, stars: 0, alpen: 0, cloudLit: '#ffffff', cloudDark: '#9aa6bc' },
  { h: 12.0, zen: '#3568ba', hor: '#b8cde0', glow: '#fff6e8', sun: '#fff6ea', hemiS: '#a0bce8', hemiG: '#5e5444', hemiI: 0.55, fog: '#b2c4d6', fogS: '#f6f0e4', fogD: 0.00065, exp: 0.95, sat: 1.1, con: 1.07, lift: [0.01, 0.012, 0.02], gain: [1.0, 1.0, 1.0], bloom: 0.35, rays: 0.12, mist: 0.1, stars: 0, alpen: 0, cloudLit: '#ffffff', cloudDark: '#a2acc0' },
  { h: 14.0, zen: '#3a6ab6', hor: '#c0cedc', glow: '#fff0da', sun: '#fff0dc', hemiS: '#a0b8e0', hemiG: '#5e5242', hemiI: 0.55, fog: '#b8c6d4', fogS: '#f6ead8', fogD: 0.0007, exp: 0.97, sat: 1.1, con: 1.07, lift: [0.01, 0.012, 0.02], gain: [1.0, 1.0, 0.99], bloom: 0.35, rays: 0.2, mist: 0.1, stars: 0, alpen: 0, cloudLit: '#fffaf0', cloudDark: '#9ea6b8' },
  { h: 16.25, zen: '#4a6fae', hor: '#dcc6a4', glow: '#ffd8a0', sun: '#ffd6a0', hemiS: '#9aaed4', hemiG: '#6a5438', hemiI: 0.55, fog: '#cdbfa6', fogS: '#ffd49a', fogD: 0.0011, exp: 1.02, sat: 1.06, con: 1.05, lift: [0.015, 0.012, 0.015], gain: [1.05, 1.0, 0.93], bloom: 0.5, rays: 0.6, mist: 0.2, stars: 0, alpen: 0.1, cloudLit: '#ffe8c0', cloudDark: '#8e8698' },
  { h: 17.2, zen: '#4a5f98', hor: '#f0b070', glow: '#ffb45a', sun: '#ffac5c', hemiS: '#8c98c4', hemiG: '#6e4a30', hemiI: 0.55, fog: '#d8a878', fogS: '#ffb060', fogD: 0.00105, exp: 1.0, sat: 1.12, con: 1.08, lift: [0.018, 0.01, 0.012], gain: [1.1, 0.98, 0.86], bloom: 0.7, rays: 1.2, mist: 0.3, stars: 0, alpen: 0.6, cloudLit: '#ffc07a', cloudDark: '#7a6078' },
  { h: 17.95, zen: '#34447e', hor: '#f08a58', glow: '#ff7a3a', sun: '#ff7a40', hemiS: '#6c74a8', hemiG: '#5a3828', hemiI: 0.55, fog: '#b07868', fogS: '#ff8a4a', fogD: 0.0011, exp: 1.2, sat: 1.1, con: 1.05, lift: [0.025, 0.012, 0.02], gain: [1.1, 0.94, 0.9], bloom: 0.9, rays: 1.0, mist: 0.4, stars: 0, alpen: 1.0, cloudLit: '#ff9a6a', cloudDark: '#4a3a5a' },
  { h: 18.45, zen: '#1e2a5e', hor: '#7a6a9a', glow: '#c07080', sun: '#ff6a40', hemiS: '#4c5a94', hemiG: '#2c2430', hemiI: 0.6, fog: '#4c5078', fogS: '#8a6a86', fogD: 0.0017, exp: 1.4, sat: 0.98, con: 1.02, lift: [0.02, 0.02, 0.045], gain: [0.98, 0.96, 1.1], bloom: 0.95, rays: 0.2, mist: 0.8, stars: 0.35, alpen: 0.4, cloudLit: '#9a7aa0', cloudDark: '#1e2240' },
  { h: 19.2, zen: '#0a1232', hor: '#2a3662', glow: '#3e4270', sun: '#ff6a40', hemiS: '#3c5090', hemiG: '#1a1a26', hemiI: 0.65, fog: '#202a4e', fogS: '#30385e', fogD: 0.0015, exp: 1.35, sat: 0.86, con: 1.0, lift: [0.02, 0.025, 0.055], gain: [0.94, 0.98, 1.12], bloom: 1.0, rays: 0.0, mist: 0.95, stars: 1, alpen: 0, cloudLit: '#3e4a78', cloudDark: '#0c1024' },
  { h: 24.0, zen: '#070c22', hor: '#22305a', glow: '#34406e', sun: '#ff6a40', hemiS: '#3e5494', hemiG: '#181a24', hemiI: 0.66, fog: '#1c2648', fogS: '#2c3656', fogD: 0.0015, exp: 1.38, sat: 0.82, con: 1.0, lift: [0.02, 0.025, 0.055], gain: [0.92, 0.98, 1.12], bloom: 1.0, rays: 0.0, mist: 1.0, stars: 1, alpen: 0, cloudLit: '#46557e', cloudDark: '#0a0e20' },
  { h: 28.4, zen: '#080d22', hor: '#1f2a4c', glow: '#303a62', sun: '#ff8a4a', hemiS: '#384c84', hemiG: '#1a1c26', hemiI: 0.6, fog: '#1e2646', fogS: '#2a3050', fogD: 0.0016, exp: 1.35, sat: 0.8, con: 1.0, lift: [0.02, 0.025, 0.05], gain: [0.92, 0.98, 1.12], bloom: 0.9, rays: 0.0, mist: 1.0, stars: 1, alpen: 0.0, cloudLit: '#39426a', cloudDark: '#0e1224' },
];
const COLK = ['zen', 'hor', 'glow', 'sun', 'hemiS', 'hemiG', 'fog', 'fogS', 'cloudLit', 'cloudDark'];
const NUMK = ['hemiI', 'fogD', 'exp', 'sat', 'con', 'bloom', 'rays', 'mist', 'stars', 'alpen'];
for (const k of K) { for (const c of COLK) k[c] = C(k[c]); }

export class TimeOfDay {
  constructor() {
    this.phase = 0.60;
    this.speed = 1;
    this.sunDir = new THREE.Vector3();
    this.moonDir = new THREE.Vector3();
    this.keyDir = new THREE.Vector3();
    this.keyCol = new THREE.Color();
    const s = {};
    for (const c of COLK) s[c] = new THREE.Color();
    s.lift = [0, 0, 0]; s.gain = [1, 1, 1];
    this.s = s;
  }
  update(dt, fast) {
    this.phase = (this.phase + dt * (fast ? 22 : 1) / CYCLE) % 1;
    this.compute();
  }
  compute() {
    const p = this.phase;
    let h = phaseToHour(p);
    this.hour = h;
    const H = (h - 12) * 15 * Math.PI / 180;
    this.sunEl = celestial(H, DEC, this.sunDir);
    this.moonEl = celestial(H + Math.PI + 0.25, MDEC, this.moonDir);
    // keyframe interpolation (hour continuous across midnight)
    let hh = h < 4.4 ? h + 24 : h;
    let i = 0;
    while (i < K.length - 2 && hh > K[i + 1].h) i++;
    const a = K[i], b = K[i + 1];
    let t = clamp((hh - a.h) / (b.h - a.h), 0, 1);
    t = t * t * (3 - 2 * t);
    const s = this.s;
    for (const c of COLK) s[c].copy(a[c]).lerp(b[c], t);
    for (const n of NUMK) s[n] = lerp(a[n], b[n], t);
    for (let j = 0; j < 3; j++) { s.lift[j] = lerp(a.lift[j], b.lift[j], t); s.gain[j] = lerp(a.gain[j], b.gain[j], t); }
    // storm
    const st = stormAt(p);
    this.storm = st;
    this.rain = rainAt(p);
    // light intensities
    const sunUp = smoothstep(-0.035, 0.12, Math.sin(this.sunEl));
    const moonUp = smoothstep(-0.02, 0.2, Math.sin(this.moonEl)) * (1 - smoothstep(-0.12, 0.02, Math.sin(this.sunEl)));
    this.sunI = sunUp * lerp(3.2, 0.25, st) * (0.6 + 0.4 * smoothstep(0.0, 0.5, Math.sin(this.sunEl)));
    this.moonI = moonUp * 0.5 * (1 - st * 0.8);
    this.night = 1 - smoothstep(-0.16, 0.02, Math.sin(this.sunEl));
    this.dusk = smoothstep(-0.1, 0.04, Math.sin(this.sunEl)) * (1 - smoothstep(0.04, 0.2, Math.sin(this.sunEl)));
    if (this.sunI > this.moonI * 1.2 || this.sunEl > -0.05) {
      this.keyDir.copy(this.sunDir);
      this.keyCol.copy(s.sun).multiplyScalar(this.sunI);
      this.keyIsSun = true;
    } else {
      this.keyDir.copy(this.moonDir);
      this.keyCol.setRGB(0.62, 0.72, 1.0).multiplyScalar(this.moonI);
      this.keyIsSun = false;
    }
    // prevent shadows from grazing below horizon
    if (this.keyDir.y < 0.06) { const f = smoothstep(-0.02, 0.06, this.keyDir.y); this.keyCol.multiplyScalar(f); }
    // storm grading
    if (st > 0) {
      const g = new THREE.Color(0.36, 0.4, 0.45);
      const gz = new THREE.Color(0.18, 0.21, 0.26);
      s.zen.lerp(gz, st * 0.85); s.hor.lerp(g, st * 0.85); s.fog.lerp(new THREE.Color(0.34, 0.38, 0.42), st * 0.8);
      s.fogS.lerp(new THREE.Color(0.42, 0.44, 0.46), st * 0.8);
      s.glow.lerp(g, st * 0.9);
      s.hemiS.lerp(new THREE.Color(0.42, 0.47, 0.54), st * 0.7);
      s.cloudLit.lerp(new THREE.Color(0.42, 0.45, 0.5), st * 0.85);
      s.cloudDark.lerp(new THREE.Color(0.09, 0.1, 0.12), st * 0.85);
      s.fogD *= 1 + st * 0.9;
      s.sat = lerp(s.sat, 0.72, st);
      s.exp = lerp(s.exp, 1.45, st);
      s.rays *= 1 - st;
      s.mist = lerp(s.mist, 0.45, st);
      s.bloom = lerp(s.bloom, 0.6, st);
      s.alpen *= 1 - st;
    }
    this.cloudCover = lerp(0.5, 0.97, st);
  }
}
