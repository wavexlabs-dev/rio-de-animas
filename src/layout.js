// Landmark placement in river coordinates (u along river upstream, d lateral, +d = right/north bank)
import { addPad, addKnoll, toWorld, frame, halfW, PADS, padLocal } from './river.js';

export const L = {
  bridge: { u: 236, piers: [-5.9, 5.9], deckY: 6.4, width: 4.6 },
  arco: { u: 236, d: 22.5 },
  atrium: { u: 277, d: 58, hu: 25, hd: 26, y: 7.4 },   // terrace pad
  church: { u: 279, d: 66, len: 34, wid: 12.5 },       // facade at d = 52 (faces river)
  steps: { u: 262, d0: 25.5, d1: 32.2 },
  capilla: { u: 128, d: -33 },
  pyramid: { u: 338, d: -80, r: 34, h: 24 },
  panteon: { u: 452, d: 58 },
  landing: { u: 414 },
  woman: { u: 238.1, d: 9.5 },
  sweeper: { u: 268, d: 43 },
};

export const PATHS = []; // polylines in world xz with width
function path(ptsUD, width) {
  const pts = ptsUD.map(([u, d]) => { const p = toWorld(u, d); return [p.x, p.z]; });
  PATHS.push({ pts, width });
}

export function initLayout() {
  PADS.length = 0;
  const a = L.atrium;
  // atrium terrace (hard edges, retaining walls built on its river side)
  L.atriumPad = addPad(a.u, a.d, a.hu + 0.6, a.hd + 0.6, a.y, 1.2);
  // bridge abutment ramps (road level ~ deck ends)
  L.rampR = addPad(L.bridge.u, 23.5, 2.8, 4.2, 3.3, 7); L.rampR.mb = [0.4, 7]; L.rampR.mu = 7;
  L.rampL = addPad(L.bridge.u, -23.0, 2.8, 4.0, 3.3, 7); L.rampL.mb = [7, 0.4]; L.rampL.mu = 7;
  // stone quays either side of the bridge (vertical river walls are built in architecture.js)
  L.quays = [];
  for (const s of [-1, 1]) {
    const hw = halfW(L.bridge.u) + 0.3, hd = 5;
    const pad = addPad(L.bridge.u, s * (hw + hd), 12, hd, 3.3, 6);
    pad.mu = 9; pad.mb = s > 0 ? [0.4, 6] : [6, 0.4];
    L.quays.push({ s, hd, hu: 12, pad });
  }
  // path landing below steps
  L.stepPad = addPad(L.steps.u, 23.5, 5, 2.2, 2.3, 4);
  // capilla clearing
  L.capPad = addPad(L.capilla.u, L.capilla.d, 5, 5, 1.55, 7);
  // pyramid knoll + platform
  addKnoll(L.pyramid.u, L.pyramid.d, L.pyramid.r, L.pyramid.h, 1);
  L.pyrPad = addPad(L.pyramid.u, L.pyramid.d, 12, 12, L.pyramid.h * 0.92 + 0.2, 6);
  // panteon terraces
  L.pant = [];
  L.pant.push(addPad(L.panteon.u - 6, 44, 14, 6, 9.0, 4));
  L.pant.push(addPad(L.panteon.u, 57, 17, 6, 13.2, 4));
  L.pant.push(addPad(L.panteon.u + 4, 70, 15, 6, 17.4, 4));
  // landing at the river for the panteon path
  L.landPad = addPad(L.landing.u, halfW(L.landing.u) + 3.0, 3, 2.5, 1.2, 3);

  PATHS.length = 0;
  path([[L.bridge.u - 20, 24], [L.bridge.u - 6, 23], [L.bridge.u, 23], [L.steps.u - 4, 24], [L.steps.u, 24.5], [L.steps.u + 12, 24.8], [L.steps.u + 40, 27], [L.steps.u + 80, 30]], 2.4);
  path([[L.bridge.u, -22.5], [L.bridge.u - 20, -25], [L.bridge.u - 60, -28], [L.capilla.u + 20, -30], [L.capilla.u, -32]], 2.0);
  path([[L.landing.u, halfW(L.landing.u) + 3], [L.landing.u + 8, 24], [L.landing.u + 18, 31], [L.panteon.u - 20, 38], [L.panteon.u - 10, 44], [L.panteon.u, 51], [L.panteon.u + 4, 57]], 1.8);
  path([[L.pyramid.u - 60, -24], [L.pyramid.u - 30, -40], [L.pyramid.u - 14, -62], [L.pyramid.u - 8, -70]], 1.4);
}

export function distToPaths(x, z) {
  let best = 1e9, w = 0;
  for (const p of PATHS) {
    const pts = p.pts;
    for (let i = 0; i < pts.length - 1; i++) {
      const ax = pts[i][0], az = pts[i][1], bx = pts[i + 1][0], bz = pts[i + 1][1];
      const vx = bx - ax, vz = bz - az;
      const t = Math.max(0, Math.min(1, ((x - ax) * vx + (z - az) * vz) / (vx * vx + vz * vz)));
      const dx = ax + vx * t - x, dz = az + vz * t - z;
      const dd = Math.sqrt(dx * dx + dz * dz) - p.width * 0.5;
      if (dd < best) { best = dd; w = p.width; }
    }
  }
  return best;
}

export function inPad(pad, x, z, grow = 0) {
  const [a, b] = padLocal(pad, x, z);
  return Math.abs(a) < pad.hu + grow && Math.abs(b) < pad.hd + grow;
}
