import * as THREE from 'three';
import { U, MAXG } from './materials.js';
import { buildTerrain } from './terrain.js';
import { buildSky } from './sky.js';
import { TimeOfDay } from './timeofday.js';
import { Post } from './post.js';
import { R, toWorld, frame, terrainH, toUD, isWater, PADS, halfW } from './river.js';
import { L, distToPaths, inPad } from './layout.js';
import { Water } from './water.js';
import { buildRocks, buildGroundProps } from './rocks.js';
import { buildUnderstorey, buildPueblo, buildBankWood } from './scanplants.js';
import { buildAlebrijes } from './sculptures.js';
import { buildLirio } from './lirio.js';
import { buildForest } from './forest.js';
import { buildPlants } from './plants.js';
import { buildArchitecture, deckY } from './architecture.js';
import { buildPapel, flowerCards, buildCandles, buildBells, buildLanterns } from './decor.js';
import { Boat } from './boat.js';
import { ChaseCam } from './camera.js';
import { Character, sombrero } from './characters.js';
import { clamp, lerp, smoothstep, mulberry32 } from './noise.js';
import { uvMat } from './matlib.js';
import { std } from './materials.js';
import { buildFar } from './far.js';
import { fallingPetals, FloatingPetals, dustMotes, riverMist, rain, Lightning, fireflies, smoke, Splashes } from './particles.js';
import { monarchs, Animas, CandleRafts, Birds, waterfall } from './life.js';
import { Soundscape } from './audio.js';
import { buildCatrinas } from './catrina.js';
import { buildAhuejotes, extraCandles, mooredTrajineras, decorateHeroBoat, bankVeladoras } from './xochi.js';

export const LAYER = { MAIN: 0, WATER: 1, TRANS: 2, MAINTRANS: 3, NOREFL: 5 };

export class World {
  constructor(renderer, scene, camera, Q) {
    this.r = renderer; this.scene = scene; this.cam = camera; this.Q = Q;
    this.tod = new TimeOfDay();
    if (Q.has('t')) this.tod.phase = parseFloat(Q.get('t'));
    this.time = 0;
    this.post = new Post(renderer);
    this.renderScale = 1;
    this.updaters = [];
    this.glowSources = [];
    this.fade = 0;
    this.obstacles = [];
    // spatial hash of circular blockers (trees, props) for fast placement queries
    const cells = new Map(), CS = 8;
    let maxR = 0;
    this.blockers = {
      list: [],
      push(b) { this.list.push(b); maxR = Math.max(maxR, b.r); const k = Math.floor(b.x / CS) * 73856093 ^ Math.floor(b.z / CS) * 19349663; let c = cells.get(k); if (!c) { c = []; cells.set(k, c); } c.push(b); },
      hit(x, z, r) {
        const R = r + maxR;
        const i0 = Math.floor((x - R) / CS), i1 = Math.floor((x + R) / CS), j0 = Math.floor((z - R) / CS), j1 = Math.floor((z + R) / CS);
        for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
          const c = cells.get(i * 73856093 ^ j * 19349663);
          if (!c) continue;
          for (const b of c) { const dx = x - b.x, dz = z - b.z; if (dx * dx + dz * dz < (b.r + r) * (b.r + r)) return true; }
        }
        return false;
      },
    };
    this.canopies = [];
    this.input = { up: false, down: false, left: false, right: false, any: false };
    this.wet = 0;
  }
  isBlocked(x, z, r = 0, strict = false) {
    for (const p of PADS) if (inPad(p, x, z, r + 0.5)) return true;
    if (distToPaths(x, z) < r + 0.6) return true;
    if (this.blockers.hit(x, z, r)) return true;
    if (!strict && isWater(x, z)) return true;
    return false;
  }
  async build(progress, onStep) {
    const scene = this.scene;
    let tm = performance.now();
    const mark = (label) => { const n = performance.now(); if (window.__diag) window.__diag('mark', label + ' ' + Math.round(n - tm)); if (this.Q.has('prof')) console.warn('BUILD  .' + label, Math.round(n - tm)); tm = n; };
    this.mark = mark;
    let tPrev = performance.now();
    let stepN = 0;
    const stopAt = this.Q.has('stop') ? parseInt(this.Q.get('stop')) : 99;
    const step = async (p, label) => {
      if (++stepN >= stopAt) { progress(1); await new Promise(() => {}); } const n = performance.now(); if (this.Q.has('prof')) console.warn('BUILD', label || p, Math.round(n - tPrev)); progress(p); if (onStep) onStep(label); await new Promise((r) => setTimeout(r, 0)); tPrev = performance.now(); };
    this.sky = buildSky(scene);
    this.envScene = new THREE.Scene();
    const envSky = new THREE.Mesh(this.sky.sky.geometry, this.sky.mat);
    envSky.scale.setScalar(100);
    this.envScene.add(envSky);
    this.pmrem = new THREE.PMREMGenerator(this.r);
    this.envTimer = 0;
    await step(0.04, 'sky');
    this.terrain = buildTerrain(scene); mark('terrain');
    await step(0.25, 'terrain');
    this.key = new THREE.DirectionalLight(0xffffff, 1);
    this.key.castShadow = true;
    this.key.shadow.mapSize.set(2048, 2048);
    const sc = this.key.shadow.camera;
    sc.left = -70; sc.right = 70; sc.top = 70; sc.bottom = -70; sc.near = 1; sc.far = 900;
    this.key.shadow.bias = -0.0005;
    this.key.shadow.normalBias = 0.04;
    this.key.shadow.radius = 3;
    scene.add(this.key, this.key.target);
    this.hemi = new THREE.HemisphereLight(0x8899aa, 0x443322, 0.3);
    scene.add(this.hemi);
    buildArchitecture(this); mark('arch');
    this.bridgeMatrixInv = this.bridgeMatrix.clone().invert();
    await step(0.35, 'arch');
    buildCatrinas(this); mark('catrinas');
    buildRocks(this); mark('rocks');
    await step(0.42, 'rocks+catrinas');
    buildForest(this); mark('forest');
    buildAhuejotes(this); mark('ahuejotes');
    buildGroundProps(this); mark('groundProps');
    buildBankWood(this); buildUnderstorey(this);
    await step(0.62, 'forest+ahuejotes');
    buildPlants(this, this.terrain); mark('plants');
    await step(0.78, 'plants');
    buildPapel(this); mark('papel');
    flowerCards(this, this.arcoFlowers, 'f_cempa', 0, 0.26);
    const pet = (list) => list.map((p) => ({ p: new THREE.Vector3(p.x, p.y, p.z), n: new THREE.Vector3(0, 1, 0), kind: 0 }));
    flowerCards(this, pet(this.deckPetals).concat(pet(this.stepPetals)), 'f_petals', 0, 0.06, 5); mark('flowers');
    mooredTrajineras(this); mark('moored');
    buildPueblo(this);
    buildAlebrijes(this);
    buildLirio(this);
    extraCandles(this);
    buildCandles(this);
    bankVeladoras(this); mark('candles');
    buildBells(this);
    buildLanterns(this); mark('bells+lanterns');
    this.water = new Water(this, this.obstacles); mark('water');
    this.updaters.push((dt) => this.water.update(dt));
    await step(0.86, 'decor+water');
    this.boat = new Boat(this); mark('boat');
    decorateHeroBoat(this);
    this.buildVillagers(); mark('villagers');
    await step(0.94, 'boat+villagers');
    this.chase = new ChaseCam(this);
    this.debugCam = (this.Q.has('u') && !this.Q.has('follow')) || this.Q.has('bcam');
    if (this.Q.has('bu')) this.boat.reset(parseFloat(this.Q.get('bu')));
    this.setupInput();
    this.setupGlows();
    if (this.debugCam) this.placeDebugCam(parseFloat(this.Q.get('u')));
    buildFar(this);
    fallingPetals(this);
    this.floatPetals = new FloatingPetals(this);
    this.updaters.push((dt) => this.floatPetals.update(dt));
    dustMotes(this);
    riverMist(this);
    rain(this);
    this.lightning = new Lightning(this);
    this.updaters.push((dt) => this.lightning.update(dt));
    fireflies(this);
    const fallBase = toWorld(R.FALL_U - 1.5, 0);
    smoke(this, [() => this.censerPos ? { x: this.censerPos.x, y: this.censerPos.y, z: this.censerPos.z, w: 0.5 } : null, () => this.brazier ? { x: this.brazier.x, y: this.brazier.y, z: this.brazier.z, w: 1.0 } : null,
      () => ({ x: fallBase.x, y: 0.3, z: fallBase.z, w: 3.2 }), () => ({ x: fallBase.x + 2, y: 0.3, z: fallBase.z + 1.5, w: 2.6 })]);
    this.splashes = new Splashes(this);
    this.updaters.push((dt) => this.splashes.update(dt));
    monarchs(this);
    this.animas = new Animas(this);
    this.updaters.push((dt, t) => this.animas.update(dt, t));
    this.rafts = new CandleRafts(this);
    this.updaters.push((dt, t) => this.rafts.update(dt, t));
    this.birds = new Birds(this);
    this.updaters.push((dt, t) => this.birds.update(dt, t));
    waterfall(this);
    this.audio = new Soundscape(this);
    this.userGesture = () => this.audio.start();
    const ps = this.onPoleSplash;
    this.onPoleSplash = (p, st) => { ps(p, st); this.audio.splash(st); };
    this.updaters.push((dt) => this.audio.update(dt));
    await step(1, 'particles+life');
  }
  buildVillagers() {
    const Mb = this.bridgeMatrix;
    const X = 9.5, Z = 4.6 / 2 - 0.62;
    const woman = new Character({ female: true, skirt: true, rebozo: true, scale: 0.88, skin: [0.46, 0.3, 0.21], shirt: [0.92, 0.9, 0.86], skirtCol: [0.42, 0.08, 0.12], embroid: true, hair: [0.04, 0.03, 0.03], hipW: 0.085, shoulder: 0.17 });
    const p = new THREE.Vector3(X, deckY(X) + 0.02, Z).applyMatrix4(Mb);
    woman.group.position.copy(p);
    const q = new THREE.Quaternion().setFromRotationMatrix(Mb);
    woman.group.quaternion.copy(q);
    this.scene.add(woman.group);
    const cens = new THREE.Group();
    const cm = std({ color: 0xb06a44, roughness: 0.9 }, { key: 'censer' });
    const bowl = new THREE.Mesh(new THREE.LatheGeometry([[0, 0], [0.06, 0.005], [0.09, 0.05], [0.095, 0.08], [0.08, 0.085]].map(([a, b]) => new THREE.Vector2(a, b)), 14), cm);
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.045, 0.12, 10), cm);
    stem.position.y = -0.06;
    cens.add(bowl, stem);
    cens.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    this.scene.add(cens);
    this.woman = { c: woman, cens, base: p.clone(), q };
    const Mt = this.atriumMatrix;
    const man = new Character({ scale: 0.86, skin: [0.42, 0.27, 0.18], shirt: [0.84, 0.8, 0.72], pantsCol: [0.8, 0.76, 0.68], sash: [0.3, 0.3, 0.5], widePants: true, pants: 0.02, hair: [0.75, 0.74, 0.72], mustache: [0.8, 0.8, 0.78] });
    const mp = new THREE.Vector3(-L.atrium.hd + 11, L.atrium.y, 3.5).applyMatrix4(Mt);
    man.group.position.copy(mp);
    man.group.quaternion.setFromRotationMatrix(Mt);
    man.group.rotateY(-1.1);
    this.scene.add(man.group);
    const hat = sombrero(0.24, 0.12);
    man.b.head.add(hat);
    hat.position.set(0, 0.15, -0.01);
    const broom = new THREE.Group();
    const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 1.3, 6), uvMat('planks', { color: 0xb09070 }));
    stick.position.y = 0.65;
    const bristles = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.55, 12, 1, true), std({ color: 0xa08850, roughness: 0.9, side: THREE.DoubleSide }, { key: 'broom' }));
    bristles.position.y = -0.2;
    bristles.rotation.z = Math.PI;
    broom.add(stick, bristles);
    broom.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    this.scene.add(broom);
    this.sweeper = { c: man, broom, base: mp.clone() };
  }
  animateVillagers(dt, t) {
    const w = this.woman;
    if (w) {
      const c = w.c, b = c.b;
      c.reset();
      const br = Math.sin(t * 1.5) * 0.02;
      b.chest.rotation.x = br * 0.5 + 0.05;
      b.spine.rotation.x = 0.06;
      const bp = this.boat.pos;
      const toB = new THREE.Vector3().subVectors(bp, w.base);
      const d = toB.length();
      const local = toB.clone().applyQuaternion(w.q.clone().invert());
      let yaw = Math.atan2(local.x, local.z);
      yaw = clamp(yaw, -1.2, 1.2) * smoothstep(90, 30, d);
      b.neck.rotation.set(0.15 * smoothstep(40, 5, d) + 0.05, yaw * 0.5, 0);
      b.head.rotation.set(0.1 * smoothstep(40, 5, d), yaw * 0.5, Math.sin(t * 0.4) * 0.03);
      b.hips.rotation.y = Math.sin(t * 0.3) * 0.03;
      c.group.updateMatrixWorld(true);
      const hc = new THREE.Vector3(0, 0.9 * c.scale + 0.02, 0.26).applyMatrix4(c.group.matrixWorld);
      const s = Math.sin(t * 0.9) * 0.03;
      const cen = hc.clone().add(new THREE.Vector3(s, Math.sin(t * 0.7) * 0.015, 0).applyQuaternion(w.q));
      w.cens.position.copy(cen);
      c.ik2(b.shL, b.elL, b.wrL, cen.clone().add(new THREE.Vector3(0.08, -0.03, -0.03).applyQuaternion(w.q)), new THREE.Vector3(0.6, 0.9, -0.3).applyMatrix4(c.group.matrixWorld));
      c.ik2(b.shR, b.elR, b.wrR, cen.clone().add(new THREE.Vector3(-0.08, -0.03, -0.03).applyQuaternion(w.q)), new THREE.Vector3(-0.6, 0.9, -0.3).applyMatrix4(c.group.matrixWorld));
      this.censerPos = cen.clone().add(new THREE.Vector3(0, 0.1, 0));
    }
    const sw = this.sweeper;
    if (sw) {
      const c = sw.c, b = c.b;
      c.reset();
      const ph = t * 1.35;
      const sway = Math.sin(ph);
      b.hips.rotation.set(0.15, sway * 0.18, 0);
      b.spine.rotation.set(0.3, sway * 0.12, 0);
      b.chest.rotation.set(0.25, sway * 0.15, 0);
      b.neck.rotation.set(-0.2, 0, 0);
      b.hips.position.y = 0.96 * c.scale - 0.05;
      c.group.updateMatrixWorld(true);
      const M = c.group.matrixWorld;
      const tip = new THREE.Vector3(sway * 0.55, 0.02, 0.75 + Math.cos(ph) * 0.06).applyMatrix4(M);
      const top = new THREE.Vector3(sway * 0.15 - 0.1, 1.05, 0.25).applyMatrix4(M);
      const dir = top.clone().sub(tip).normalize();
      sw.broom.position.copy(tip).addScaledVector(dir, 0.35);
      sw.broom.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
      const h1 = tip.clone().addScaledVector(dir, 1.35), h2 = tip.clone().addScaledVector(dir, 0.95);
      c.ik2(b.shR, b.elR, b.wrR, h1, new THREE.Vector3(-0.6, 1.0, -0.4).applyMatrix4(M));
      c.ik2(b.shL, b.elL, b.wrL, h2, new THREE.Vector3(0.6, 0.8, 0.3).applyMatrix4(M));
      const footL = new THREE.Vector3(0.12, 0.07, 0.08).applyMatrix4(M), footR = new THREE.Vector3(-0.12, 0.07, -0.05).applyMatrix4(M);
      c.ik2(b.hipL, b.knL, b.anL, footL, new THREE.Vector3(0.1, 0.5, 1).applyMatrix4(M));
      c.ik2(b.hipR, b.knR, b.anR, footR, new THREE.Vector3(-0.1, 0.5, 1).applyMatrix4(M));
    }
  }
  setupInput() {
    const map = { KeyW: 'up', ArrowUp: 'up', KeyS: 'down', ArrowDown: 'down', KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right' };
    addEventListener('keydown', (e) => {
      if (map[e.code]) { this.input[map[e.code]] = true; e.preventDefault(); }
      if (e.code === 'Space') { this.fastForward = true; e.preventDefault(); }
      if (e.code === 'KeyM' && !e.repeat && this.audio) this.audio.toggle();
      if (this.userGesture) this.userGesture();
    });
    addEventListener('keyup', (e) => {
      if (map[e.code]) this.input[map[e.code]] = false;
      if (e.code === 'Space') this.fastForward = false;
    });
    addEventListener('blur', () => { for (const k of ['up', 'down', 'left', 'right']) this.input[k] = false; this.fastForward = false; });
  }
  setupGlows() {
    const warm = [1.0, 0.62, 0.28];
    const tmp = new THREE.Vector3();
    this.glowSources.push((list, cp) => {
      const n = this.tod.night * 0.95 + this.tod.dusk * 0.4;
      if (n < 0.02) return;
      for (const l of this.lanterns) {
        const d = cp.distanceTo(tmp.set(l.x, l.y, l.z));
        list.push({ x: l.x, y: l.y + 0.1, z: l.z, r: 9, cr: warm[0] * 1.6 * n, cg: warm[1] * 1.6 * n, cb: warm[2] * 1.6 * n, w: 10 / (1 + d * 0.1) });
      }
      const ci = this.churchInterior;
      const dc = cp.distanceTo(ci);
      list.push({ x: ci.x, y: ci.y, z: ci.z, r: 22, cr: 3.0 * n, cg: 1.7 * n, cb: 0.7 * n, w: 6 / (1 + dc * 0.012) });
      // warm wash on the church facade (the fortress church is the landmark of the night stretch)
      if (this.churchMatrix) {
        const fp = this._facadeLight || (this._facadeLight = new THREE.Vector3(-7, 4.5, 0).applyMatrix4(this.churchMatrix));
        list.push({ x: fp.x, y: fp.y, z: fp.z, r: 24, cr: 2.4 * n, cg: 1.45 * n, cb: 0.7 * n, w: 7 / (1 + cp.distanceTo(fp) * 0.012) });
      }
      if (this.capillaPos) { const c = this.capillaPos; list.push({ x: c.x, y: c.y, z: c.z, r: 7, cr: 1.2 * n, cg: 0.7 * n, cb: 0.3 * n, w: 3 / (1 + cp.distanceTo(c) * 0.02) }); }
      for (const pad of L.pant) list.push({ x: pad.x, y: pad.h + 1.2, z: pad.z, r: 18, cr: 2.4 * n, cg: 1.3 * n, cb: 0.5 * n, w: 4 / (1 + tmp.set(pad.x, pad.h, pad.z).distanceTo(cp) * 0.012) });
      const bl = this.boat.lanternWorld();
      list.push({ x: bl.x, y: bl.y, z: bl.z, r: 14, cr: 2.2 * n, cg: 1.3 * n, cb: 0.55 * n, w: 100 });
    });
    // candle / veladora clusters -> a handful of warm point lights near the camera
    const cells = new Map();
    for (const c of this.candles.concat(this.veladoras || [])) {
      const k = Math.floor(c.x / 7) + ',' + Math.floor(c.z / 7);
      let e = cells.get(k); if (!e) { e = { x: 0, y: 0, z: 0, n: 0 }; cells.set(k, e); }
      e.x += c.x; e.y += c.y; e.z += c.z; e.n++;
    }
    const clusters = [...cells.values()].filter((e) => e.n >= 2).map((e) => ({ x: e.x / e.n, y: e.y / e.n + 0.45, z: e.z / e.n, n: e.n }));
    for (const p of this.ofrendaGlow || []) clusters.push({ x: p.x, y: p.y, z: p.z, n: 14 });
    this.candleClusters = clusters;
    this.glowSources.push((list, cp) => {
      const n = this.tod.night * 0.95 + this.tod.dusk * 0.3;
      if (n < 0.02) return;
      const t = this.time;
      for (const c of clusters) {
        const dx = c.x - cp.x, dz = c.z - cp.z;
        const d2 = dx * dx + dz * dz;
        if (d2 > 90 * 90) continue;
        const d = Math.sqrt(d2);
        const I = Math.min(0.35 * Math.pow(c.n, 0.6), 2.4) * n * (0.92 + 0.08 * Math.sin(t * 11 + c.x));
        list.push({ x: c.x, y: c.y, z: c.z, r: 4.5 + Math.min(c.n, 24) * 0.22, cr: 1.0 * I, cg: 0.55 * I, cb: 0.22 * I, w: Math.sqrt(c.n) * 3 / (1 + d * 0.12) });
      }
    });
    this.glowSources.push((list) => {
      if (!this.brazier) return;
      const n = 0.25 + this.tod.night * 0.9;
      const f = 0.85 + 0.15 * Math.sin(this.time * 9) * Math.sin(this.time * 5.3);
      list.push({ x: this.brazier.x, y: this.brazier.y + 0.2, z: this.brazier.z, r: 10, cr: 2.2 * n * f, cg: 0.9 * n * f, cb: 0.3 * n * f, w: 2 });
    });
  }
  placeDebugCam(u) {
    const h = this.Q.has('h') ? parseFloat(this.Q.get('h')) : 4.5;
    const dd = this.Q.has('d') ? parseFloat(this.Q.get('d')) : 0;
    const la = this.Q.has('la') ? parseFloat(this.Q.get('la')) : 60;
    const ld = this.Q.has('ld') ? parseFloat(this.Q.get('ld')) : 0;
    const lh = this.Q.has('lh') ? parseFloat(this.Q.get('lh')) : h * 0.5;
    const t = toWorld(u + la, ld);
    const p2 = toWorld(u, dd);
    this.cam.position.set(p2.x, h, p2.z);
    this.cam.lookAt(t.x, lh, t.z);
    this.shadowTarget = new THREE.Vector3(t.x, 0, t.z).lerp(this.cam.position, 0.6);
  }
  updateLighting(dt) {
    const tod = this.tod, s = tod.s;
    U.uSunDir.value.copy(tod.sunDir);
    U.uKeyDir.value.copy(tod.keyDir);
    U.uKeyCol.value.copy(tod.keyCol);
    U.uFogCol.value.copy(s.fog);
    U.uFogSun.value.copy(s.fogS);
    U.uFogDen.value = s.fogD;
    U.uNight.value = tod.night;
    U.uMistH.value = s.mist;
    U.uAmbCol.value.copy(s.hemiS).multiplyScalar(s.hemiI * 0.9).lerp(s.hor, 0.25);
    U.uRain.value = tod.rain;
    if (tod.rain > 0.05) this.wet = Math.min(1, this.wet + dt * 0.08 * tod.rain * (this.fastForward ? 22 : 1));
    else this.wet = Math.max(0, this.wet - dt * 0.0045 * (this.fastForward ? 22 : 1));
    if (this.Q.has('wet')) this.wet = parseFloat(this.Q.get('wet'));
    U.uWet.value = this.wet;
    const gust = 0.45 + 0.25 * Math.sin(this.time * 0.13) + tod.storm * 0.9;
    U.uWind.value.set(0.78, -0.62, gust, 0);
    this.windGust = gust;
    this.key.color.copy(tod.keyCol);
    this.key.intensity = 1;
    const target = this.shadowTarget || this.cam.position;
    const kd = tod.keyDir;
    this.key.target.position.copy(target);
    this.key.position.copy(target).addScaledVector(kd, 400);
    this.key.target.updateMatrixWorld();
    this.key.updateMatrixWorld();
    this.hemi.color.copy(s.hemiS);
    this.hemi.groundColor.copy(s.hemiG);
    this.hemi.intensity = s.hemiI * 0.35;
    this.sky.update(tod);
    this.envTimer -= dt * (this.fastForward ? 8 : 1);
    if (this.envTimer <= 0) {
      this.envTimer = 1.5;
      if (this.envRT) this.envRT.dispose();
      this.envRT = this.pmrem.fromScene(this.envScene, 0, 1, 1000, { size: 64 });
      this.scene.environment = this.envRT.texture;
    }
    this.scene.environmentIntensity = lerp(2.1, 1.6, tod.night) * (1 - tod.storm * 0.25);
  }
  collectGlow() {
    const cp = this.cam.position;
    const list = [];
    for (const g of this.glowSources) g(list, cp);
    list.sort((a, b) => b.w - a.w);
    const P = U.uGlowPos.value, C = U.uGlowCol.value;
    for (let i = 0; i < MAXG; i++) {
      if (i < list.length) { const g = list[i]; P[i].set(g.x, g.y, g.z, g.r); C[i].set(g.cr, g.cg, g.cb); }
      else P[i].set(0, -999, 0, 0);
    }
  }
  animateBells(dt) {
    const p = this.tod.phase;
    const ring = (p > 0.083 && p < 0.1) || (p > 0.705 && p < 0.725) ? 1 : 0;
    const q = new THREE.Quaternion().setFromRotationMatrix(this.churchMatrix);
    for (const b of this.bellMeshes || []) {
      b.amp = lerp(b.amp, ring ? 1.1 : 0.04 + U.uWind.value.z * 0.03, 1 - Math.exp(-dt * (ring ? 0.8 : 0.4)));
      b.phase += dt * b.speed;
      const a = Math.sin(b.phase) * b.amp;
      b.piv.quaternion.copy(q);
      b.piv.rotateZ(a);
      const side = Math.sign(Math.sin(b.phase));
      if (ring && side !== b.lastSide && b.amp > 0.6 && this.audio) this.audio.bell(b);
      b.lastSide = side;
    }
  }
  loopCheck(dt) {
    const b = this.boat;
    if (!this.looping && (b.u > R.FADE_U || b.u < -60)) { this.looping = true; this.loopT = 0; }
    if (this.looping) {
      this.loopT += dt;
      if (this.loopT < 2.4) this.fade = smoothstep(0, 2.4, this.loopT);
      else if (!this.didReset) { b.reset(R.START_U); this.chase.snap(); this.didReset = true; if (this.onLoop) this.onLoop(); }
      else { this.fade = 1 - smoothstep(2.6, 5.0, this.loopT); if (this.loopT > 5) { this.looping = false; this.didReset = false; this.fade = 0; } }
    }
  }
  renderFrame(dt) {
    const r = this.r;
    this.time += dt;
    U.uTime.value = this.time;
    this.tod.update(dt, this.fastForward);
    const W = innerWidth, H = innerHeight;
    const dpr = Math.min(devicePixelRatio || 1, this.maxDpr || 2);
    if (r.domElement.width !== Math.round(W * dpr) || r.domElement.height !== Math.round(H * dpr)) { r.setPixelRatio(dpr); r.setSize(W, H, true); }
    this.cam.aspect = W / H; this.cam.updateProjectionMatrix();
    this.post.setSize(W * dpr * this.renderScale, H * dpr * this.renderScale);
    this.input.any = this.input.up || this.input.down || this.input.left || this.input.right;
    this.boat.update(dt, this.input, this.time);
    this.animateVillagers(dt, this.time);
    this.animateBells(dt);
    this.loopCheck(dt);
    if (this.Q.has('bcam')) {
      const v = this.Q.get('bcam').split(',').map(Number);
      const p = this.boat.world_(new THREE.Vector3(v[0], v[1], v[2])), t = this.boat.world_(new THREE.Vector3(v[3], v[4], v[5]));
      this.cam.position.copy(p); this.cam.lookAt(t); this.shadowTarget = t;
    } else if (!this.debugCam) this.chase.update(dt, this.time);
    const SP = this.stageProf;
    const gl = r.getContext(), px = this._px || (this._px = new Uint8Array(4));
    const mark = SP ? (k) => { gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); const n = performance.now(); SP[k] = (SP[k] || 0) + n - SP._t; SP._t = n; } : null;
    if (SP) {
      mark('pre');
      this.updaters.forEach((u, i) => { const t0 = performance.now(); u(dt, this.time); const k = 'u' + i; SP.up = SP.up || {}; SP.up[k] = (SP.up[k] || 0) + performance.now() - t0; });
    } else for (const u of this.updaters) u(dt, this.time);
    this.updateLighting(dt);
    this.collectGlow();
    this.cam.updateMatrixWorld();
    if (SP) mark('cpu');
    const pf = this.perf || {};
    this.frameN = (this.frameN || 0) + 1;
    // shadows refresh every other frame (shadow.matrix only changes when the map is re-rendered)
    const qe = this.quality >= 2 ? 3 : 2;
    this._shadowWas = false;
    if (!pf.noShadow && (this.frameN % qe === 1 || this.Q.has('shot'))) { r.shadowMap.needsUpdate = true; this._shadowWas = true; }
    // planar reflection refreshes on the frames the shadow map does not (texMat stays paired with its texture)
    if (!pf.noRefl && (this.frameN % qe === 0 || this.Q.has('shot') || !this.reflOnce)) { this.water.renderReflection(this); this.reflOnce = true; }
    if (SP) mark('refl');
    this.cam.layers.set(LAYER.MAIN); this.cam.layers.enable(LAYER.NOREFL);
    r.setRenderTarget(this.post.rtMain);
    r.setClearColor(0x000000, 1);
    r.clear(true, true, false);
    r.render(this.scene, this.cam);
    if (SP) mark(r.shadowMap.needsUpdate === false && this._shadowWas ? 'main+shadow' : 'main');
    this.post.copy(this.cam);
    const sp = new THREE.Vector3().copy(this.cam.position).addScaledVector(this.tod.sunDir, 10000).project(this.cam);
    const sunScreen = new THREE.Vector2(sp.x * 0.5 + 0.5, sp.y * 0.5 + 0.5);
    const inFront = sp.z < 1 && Math.abs(sp.x) < 1.8 && Math.abs(sp.y) < 1.8;
    this.raysTex = this.post.rays(sunScreen, inFront);
    this.cam.layers.set(LAYER.WATER); this.cam.layers.enable(LAYER.TRANS); this.cam.layers.enable(LAYER.MAINTRANS);
    if (SP) mark('rays');
    r.autoClear = false;
    r.setRenderTarget(this.post.rtMain);
    r.render(this.scene, this.cam);
    r.autoClear = true;
    if (SP) mark('trans');
    this.cam.layers.set(LAYER.MAIN);
    const s = this.tod.s;
    const bloomTex = this.post.bloom(1.3);
    if (SP) { mark('bloom'); SP.size = this.post.w + 'x' + this.post.h + ' canvas ' + r.domElement.width + 'x' + r.domElement.height; }
    const sunFacing = inFront ? Math.max(0, 1 - Math.hypot(sp.x, sp.y) * 0.5) : 0;
    this.post.composite({
      exposure: s.exp, bloom: s.bloom * 0.3, rays: s.rays * 0.6 * sunFacing * (this.tod.sunDir.y > -0.02 ? 1 : 0), sat: s.sat, con: s.con,
      lift: s.lift, gain: s.gain, raysCol: s.sun, fade: this.fade, fadeCol: s.fog, time: this.time, flash: U.uFlash.value,
    }, this.raysTex, bloomTex);
    if (SP) mark('post');
  }
}
