import * as THREE from 'three';
import { terrainH, toUD, halfW, frame } from './river.js';
import { deckY } from './architecture.js';
import { clamp, lerp } from './noise.js';

export class ChaseCam {
  constructor(world) {
    this.w = world;
    this.cam = world.cam;
    this.yaw = 0; this.pitch = 0.26; this.dist = 11.5;
    this.userYaw = 0; this.userPitch = 0; this.userDist = 0;
    this.lastDrag = -99;
    this.pos = new THREE.Vector3();
    this.tgt = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.first = true;
    const el = world.r.domElement;
    let dragging = false, lx = 0, ly = 0;
    el.addEventListener('pointerdown', (e) => { dragging = true; lx = e.clientX; ly = e.clientY; el.setPointerCapture(e.pointerId); world.userGesture && world.userGesture(); });
    el.addEventListener('pointerup', (e) => { dragging = false; try { el.releasePointerCapture(e.pointerId); } catch (_) {} });
    el.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const dx = e.clientX - lx, dy = e.clientY - ly; lx = e.clientX; ly = e.clientY;
      this.userYaw -= dx * 0.0055;
      this.userPitch = clamp(this.userPitch + dy * 0.004, -0.2, 0.9);
      this.lastDrag = world.time;
    });
    el.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.userDist = clamp(this.userDist + e.deltaY * 0.01, -7, 22);
      this.lastDrag = world.time;
    }, { passive: false });
  }
  snap() { this.first = true; }
  update(dt, time) {
    const boat = this.w.boat;
    const idle = time - this.lastDrag;
    // cinematic drift
    const dYaw = 0.2 * Math.sin(time * 0.043) + 0.09 * Math.sin(time * 0.11 + 1.2);
    const dPitch = 0.1 + 0.04 * Math.sin(time * 0.061 + 0.4);
    const dDist = 10.5 + 2.0 * Math.sin(time * 0.037 + 2.0);
    if (idle > 9) {
      const k = 1 - Math.exp(-dt * 0.35);
      this.userYaw = lerp(this.userYaw, 0, k); this.userPitch = lerp(this.userPitch, 0, k); this.userDist = lerp(this.userDist, 0, k);
    }
    const yaw = dYaw + this.userYaw, pitch = clamp(dPitch + this.userPitch, 0.04, 1.2), dist = clamp(dDist + this.userDist, 4.5, 34);
    const tgt = new THREE.Vector3().copy(boat.pos).addScaledVector(boat.fwd, 1.2);
    tgt.y = 1.9;
    // story scenes can pull the gaze a little (not while the visitor is steering the view)
    const at = this.w.attn;
    if (at && at.k > 0.001) tgt.lerp(at.p, at.k * clamp((idle - 2) / 3, 0, 1));
    const back = boat.fwd.clone().negate().applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    const P = tgt.clone().addScaledVector(back, dist * Math.cos(pitch));
    P.y = tgt.y + dist * Math.sin(pitch) + 0.9;
    this.constrain(P, tgt);
    if (this.first) { this.pos.copy(P); this.tgt.copy(tgt); this.first = false; }
    // critically damped spring
    const om = 2.6;
    const x = this.pos.clone().sub(P);
    const a = x.clone().multiplyScalar(-om * om).addScaledVector(this.vel, -2 * om);
    this.vel.addScaledVector(a, dt);
    this.pos.addScaledVector(this.vel, dt);
    this.tgt.lerp(tgt, 1 - Math.exp(-dt * 6));
    // hard constraints after smoothing
    this.constrain(this.pos, this.tgt, true);
    this.cam.position.copy(this.pos);
    this.cam.lookAt(this.tgt);
    this.w.shadowTarget = tgt.clone().addScaledVector(boat.fwd, 22);
  }
  constrain(P, tgt, hard) {
    // ground & banks
    const g0 = Math.max(terrainH(P.x, P.z), 0);
    const f = frame(toUD(P.x, P.z).u);
    const bl = terrainH(P.x + f.nx * 5, P.z + f.nz * 5), br = terrainH(P.x - f.nx * 5, P.z - f.nz * 5);
    const minY = Math.max(g0 + 1.6, 2.6, Math.min(Math.max(bl, br), g0 + 6) + 1.1);
    if (P.y < minY) P.y = minY;
    // occlusion along the view line
    for (let i = 1; i < 8; i++) {
      const t = i / 8;
      const x = lerp(tgt.x, P.x, t), z = lerp(tgt.z, P.z, t), y = lerp(tgt.y, P.y, t);
      const h = terrainH(x, z) + 0.6;
      if (h > y) P.y += (h - y) / t;
    }
    // tree canopies
    for (const c of this.w.canopies || []) {
      const dx = P.x - c.x, dy = P.y - c.y, dz = P.z - c.z;
      const d2 = dx * dx + dy * dy + dz * dz;
      const r = c.r + 0.8;
      if (d2 < r * r) {
        const d = Math.sqrt(d2) || 1;
        // push out mostly downward/outward (stay below canopy if under it)
        const k = (r - d) / d;
        P.x += dx * k; P.z += dz * k; P.y += dy * k;
      }
      // trunks
      const tx = P.x - c.trunk.x, tz = P.z - c.trunk.z;
      const tr = c.trunk.r + 1.2;
      if (tx * tx + tz * tz < tr * tr && P.y < c.y) { const d = Math.hypot(tx, tz) || 1; P.x = c.trunk.x + tx / d * tr; P.z = c.trunk.z + tz / d * tr; }
    }
    // bridge
    const Mb = this.w.bridgeMatrixInv;
    if (Mb) {
      const l = P.clone().applyMatrix4(Mb);
      if (Math.abs(l.z) < 4.2 && Math.abs(l.x) < 23) {
        const deck = deckY(l.x);
        if (P.y < deck + 1.2) {
          l.x = clamp(l.x, -3.6, 3.6);
          const intr = 1.0 + Math.sqrt(Math.max(0, 4.8 * 4.8 - l.x * l.x)) - 0.7;
          l.y = Math.min(l.y, intr);
          P.copy(l.applyMatrix4(this.w.bridgeMatrix));
        }
      }
    }
  }
}
