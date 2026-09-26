import * as THREE from 'three';
import { U } from './materials.js';
import { loadImages, setRenderer, tex } from './textures.js';
import { loadModelBins } from './scanned.js';
import { initLayout, L } from './layout.js';
import { initFields, buildTerrain } from './terrain.js';
import { buildSky } from './sky.js';
import { TimeOfDay } from './timeofday.js';
import { Post } from './post.js';
import { R, toWorld, frame, terrainH } from './river.js';
import { World } from './world.js';
import { Story } from './story.js';

const Q = new URLSearchParams(location.search);
// hash tokens (artifact viewers only pass a plain #anchor): e.g. #t0.62-dbg
for (const tok of (location.hash || '').replace('#', '').split('-')) {
  const m = tok.match(/^t(\d*\.?\d+)$/);
  if (m) Q.set('t', m[1]);
  if (tok === 'dbg') Q.set('dbg', '1');
  if (tok === 'bench') { Q.set('bench', '1'); Q.set('dbg', '1'); }
  if (tok === 'bench2') { Q.set('bench2', '1'); Q.set('dbg', '1'); }
  const st = tok.match(/^stop(\d+)$/);
  if (st) Q.set('stop', st[1]);
  const b = tok.match(/^b(\d+)$/);
  if (b) Q.set('bu', b[1]);
}
const DEBUG = Q.has('debug');
// diagnostics channel for the hosted viewer (#dbg): posts status to the embedding page
const T0 = performance.now();
const HIST = [];
export function diag(kind, data) {
  if (!Q.has('dbg')) return;
  const msg = { rio: 1, kind, t: Math.round(performance.now() - T0), mem: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1e6) : -1, data };
  if (kind !== 'hb' && kind !== 'history' && !(data && data.img)) HIST.push(msg);
  try { top.postMessage(msg, '*'); } catch (e) {}
}
window.__diag = diag;
if (Q.has('dbg')) {
  addEventListener('error', (e) => diag('error', String(e.message) + ' @' + (e.lineno || 0)));
  addEventListener('unhandledrejection', (e) => diag('reject', String(e.reason && (e.reason.stack || e.reason.message) || e.reason).slice(0, 400)));
  setInterval(() => diag('hb'), 1000);
  addEventListener('message', (e) => { if (e.data && e.data.rioGet) diag('history', HIST); });
}

const loaderEl = document.getElementById('ld');
function setProgress(p) {
  if (!loaderEl) return;
  loaderEl.style.setProperty('--p', p.toFixed(3));
}
// resolves on the next animation frame, or after a short timeout when the tab is hidden (rAF paused)
const nextFrame = () => new Promise((r) => { let done = false; const f = () => { if (!done) { done = true; r(); } }; requestAnimationFrame(f); setTimeout(f, 60); });

async function boot() {
  const canvas = document.getElementById('c');
  canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); console.warn('context lost'); diag('ctxlost'); }, false);
  canvas.addEventListener('webglcontextrestored', () => diag('ctxrestored'), false);
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, stencil: false, powerPreference: 'high-performance', preserveDrawingBuffer: Q.has('shot') });
  renderer.setPixelRatio(1);
  renderer.info.autoReset = false;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.shadowMap.autoUpdate = false;
  renderer.toneMapping = THREE.NoToneMapping;
  setRenderer(renderer);
  diag('renderer', { gl2: renderer.capabilities.isWebGL2, maxTex: renderer.capabilities.maxTextureSize, dpr: devicePixelRatio, w: innerWidth, h: innerHeight, vendor: (() => { try { const g = renderer.getContext(); const e = g.getExtension('WEBGL_debug_renderer_info'); return e ? g.getParameter(e.UNMASKED_RENDERER_WEBGL) : '?'; } catch (e) { return '!'; } })() });
  setProgress(0.02);
  await Promise.all([loadImages((p) => setProgress(0.02 + p * 0.38)), loadModelBins()]);
  diag('images');
  U.tNoise.value = tex('noise', { srgb: false });
  await nextFrame();

  initLayout();
  initFields();
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(52, innerWidth / innerHeight, 0.25, 40000);
  const world = new World(renderer, scene, camera, Q);
  await world.build((p) => setProgress(0.4 + p * 0.58), (label) => diag('step', label));
  diag('built');
  setProgress(1);
  window.__rio = world; world.THREE = THREE;

  const dpr = Math.min(devicePixelRatio || 1, 2);
  const px = innerWidth * innerHeight * dpr * dpr;
  world.renderScale = Math.min(1, Math.sqrt(2.4e6 / px));
  world.post.setSamples(world.renderScale > 0.95 ? 4 : 2);
  // compile every material off the main thread before the first frame (keeps the page responsive)
  renderer.debug.checkShaderErrors = Q.has('shot') || Q.has('prof');
  const tc = performance.now();
  diag('compiling');
  try {
    world.cam.layers.enableAll();
    const pc = renderer.compileAsync(scene, camera);
    diag('compileSync', Math.round(performance.now() - tc));
    await pc;
    world.cam.layers.set(0);
  } catch (e) { console.warn(e); }
  if (Q.has('prof')) console.warn('BUILD compileAsync', Math.round(performance.now() - tc));
  diag('compiled', Math.round(performance.now() - tc));
  await nextFrame();
  // warm up programs
  const tw = performance.now();
  world.renderFrame(0.016);
  if (Q.has('prof')) console.warn('BUILD firstFrame', Math.round(performance.now() - tw));
  diag('firstFrame', { ms: Math.round(performance.now() - tw), scale: world.renderScale });
  await nextFrame();
  if (loaderEl) { if (Q.has('shot')) loaderEl.remove(); else { loaderEl.classList.add('done'); setTimeout(() => loaderEl.remove(), 1600); } }
  // story layer (bank scenes, veladoras, ánimas): built a few pieces per frame once the river is already on screen
  world.story = new Story(world);
  const storyBuilt = world.story.build(nextFrame);
  if (Q.has('manual')) await storyBuilt;
  let last = performance.now();
  // adaptive resolution: judged on the median frame of each 1.2 s window (one hitch doesn't cost quality),
  // and it climbs back once frames are steady again, so a heavy moment doesn't leave the image soft for good
  let ema = 16, acc = 0, slow = 0;
  const S0 = world.renderScale, M0 = world.post.samples;
  let win = [], good = 0, cap = S0, capUntil = 0, lastUp = -1e9;
  let bar = null;
  if (Q.has('dbg')) {
    bar = document.createElement('div');
    bar.style.cssText = 'position:fixed;left:8px;bottom:8px;height:6px;background:#3f3;z-index:9;pointer-events:none';
    const bar2 = document.createElement('div');
    bar2.style.cssText = 'position:fixed;left:8px;bottom:18px;height:6px;background:#39f;z-index:9;pointer-events:none';
    document.body.append(bar, bar2);
    bar.bar2 = bar2;
  }
  function loop(now) {
    const raw = (now - last) / 1000;
    const dt = Math.min(0.05, raw);
    last = now;
    ema = ema * 0.92 + raw * 1000 * 0.08;
    acc += raw;
    if (raw < 0.5) win.push(raw * 1000);
    if (acc > 1.2) {
      acc = 0;
      win.sort((a, b) => a - b);
      const med = win.length ? win[win.length >> 1] : 16, p80 = win.length ? win[Math.floor(win.length * 0.8)] : 16;
      win = [];
      if (now > capUntil) cap = S0;
      // quality ladder once resolution is already at its floor
      if (world.renderScale <= 0.52 && med > 24) slow++; else if (med < 15) slow = Math.max(0, slow - 1);
      if (slow >= 3 && (world.quality || 0) < 2) { world.quality = (world.quality || 0) + 1; slow = 0; if (world.quality >= 1 && world.grassFar) world.grassFar.visible = false; diag('quality', world.quality); }
      diag('fps', { ms: Math.round(med * 10) / 10, scale: Math.round(world.renderScale * 100) / 100, msaa: world.post.samples, calls: world.r.info.render.calls, tris: world.r.info.render.triangles });
      // slow: shed resolution down to ~0.64, then MSAA (4 -> 2 -> FXAA), then the rest of the resolution
      if (med > 21) {
        good = 0;
        // dropped right after climbing: that step is too much for this machine for a while
        if (now - lastUp < 8000) { cap = Math.max(0.5, world.renderScale - 0.04); capUntil = now + 45000; }
        if (world.renderScale > 0.64) world.renderScale = Math.max(0.5, world.renderScale - 0.07);
        else if (world.post.samples > 0) { world.post.setSamples(world.post.samples > 2 ? 2 : 0); diag('msaa', world.post.samples); }
        else if (world.renderScale > 0.5) world.renderScale = Math.max(0.5, world.renderScale - 0.07);
      } else if (med < 18.5 && p80 < 22) {
        // steady (60 fps displays sit at ~16.7 ms): win back what was shed, MSAA first
        if (++good >= 3) {
          good = 1;
          if (world.post.samples < M0 && world.renderScale >= Math.min(0.64, S0)) { world.post.setSamples(world.post.samples === 0 ? 2 : M0); lastUp = now; diag('msaa', world.post.samples); }
          else if (world.renderScale < Math.min(cap, S0) - 0.001) { world.renderScale = Math.min(cap, S0, world.renderScale + 0.04); lastUp = now; }
        }
      } else good = 0;
    }
    if (bar) { bar.style.width = Math.round(1000 / ema * 4) + 'px'; bar.style.background = ema < 18 ? '#3f3' : ema < 30 ? '#fc3' : '#f33'; bar.bar2.style.width = Math.round(world.renderScale * 240) + 'px'; }
    renderer.info.reset();
    world.renderFrame(dt);
    requestAnimationFrame(loop);
  }
  if (Q.has('bench')) { await bench(world, renderer); return; }
  if (Q.has('bench2')) { await bench2(world, renderer); return; }
  if (!Q.has('manual')) requestAnimationFrame(loop);
}

// one change at a time against the same view: where does the frame time go?
async function bench2(world, renderer) {
  const gl = renderer.getContext(); const px = new Uint8Array(4);
  const sync = () => gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
  const run = (n) => { for (let i = 0; i < 3; i++) world.renderFrame(1 / 60); sync(); const t0 = performance.now(); for (let i = 0; i < n; i++) world.renderFrame(1 / 60); sync(); return Math.round((performance.now() - t0) / n * 10) / 10; };
  const l5 = [], fol = [];
  world.scene.traverse((o) => { if (o.layers && o.layers.mask === 32) l5.push(o); if (o.isInstancedMesh && /fern|shrub|nettle|weed|grass_|gazania|reeds|agave|organo/.test(o.name)) fol.push(o); });
  const s0 = world.renderScale;
  const smp0 = world.post.samples;
  const samples = (n) => world.post.setSamples(n);
  const cfgs = [
    ['base', () => {}, () => {}],
    ['msaa0', () => samples(0), () => samples(smp0)],
    ['msaa4', () => samples(4), () => samples(smp0)],
    ['scale0.5', () => { world.renderScale = 0.5; }, () => { world.renderScale = s0; }],
    ['canvas1x', () => { world.maxDpr = 1; world.renderScale = s0 * 2; }, () => { world.maxDpr = 2; world.renderScale = s0; }],
    ['noRefl', () => { world.perf = { noRefl: 1 }; }, () => { world.perf = {}; }],
    ['noShadow', () => { world.perf = { noShadow: 1 }; }, () => { world.perf = {}; }],
    ['noFoliage', () => fol.forEach((o) => { o.visible = false; }), () => fol.forEach((o) => { o.visible = true; })],
    ['noLayer5', () => l5.forEach((o) => { o.visible = false; }), () => l5.forEach((o) => { o.visible = true; })],
    ['base2', () => {}, () => {}],
  ];
  for (const [t, u] of [[0.3, 170], [0.64, 240]]) {
    world.tod.phase = t; world.boat.reset(u); world.chase.snap();
    for (const [, on, off] of cfgs) { on(); run(2); off(); }
    const res = {};
    for (const [k, on, off] of cfgs) { on(); res[k] = run(10); off(); await new Promise((r) => setTimeout(r, 20)); }
    diag('bench2', { t, u, s0, res });
  }
  diag('benchdone');
}

async function bench(world, renderer) {
  const gl = renderer.getContext();
  const px = new Uint8Array(4);
  const sync = () => gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
  const grass = []; world.scene.traverse((o) => { if (o.name === 'grass') grass.push(o); });
  const cfgs = [['base', {}], ['noRefl', { noRefl: 1 }], ['noShadow', { noShadow: 1 }], ['noGrass', { grass: 0 }], ['s0.6', { scale: 0.6 }], ['min', { noRefl: 1, noShadow: 1, grass: 0, scale: 0.6 }]];
  const s0 = world.renderScale;
  for (const [t, u] of [[0.3, 170], [0.64, 226]]) {
    world.tod.phase = t; world.boat.reset(u); world.chase.snap();
    const res = {};
    for (const [name, c] of cfgs) {
      world.perf = c; grass.forEach((g) => { g.visible = c.grass !== 0; }); world.renderScale = c.scale || s0;
      for (let i = 0; i < 3; i++) world.renderFrame(1 / 60);
      sync();
      const t0 = performance.now();
      for (let i = 0; i < 6; i++) world.renderFrame(1 / 60);
      sync();
      res[name] = Math.round((performance.now() - t0) / 6 * 10) / 10;
      await new Promise((r) => setTimeout(r, 10));
    }
    world.perf = {}; grass.forEach((g) => { g.visible = true; }); world.renderScale = s0;
    diag('cfg', { t, u, res });
  }
  const views = [[0.13, 120], [0.3, 170], [0.49, 200], [0.64, 226], [0.86, 262], [0.84, 330]];
  for (const [t, u] of views) {
    world.tod.phase = t; world.boat.reset(u); world.chase.snap();
    for (let i = 0; i < 3; i++) { world.renderFrame(1 / 60); }
    sync();
    const t0 = performance.now();
    let calls = 0, tris = 0;
    for (let i = 0; i < 8; i++) { renderer.info.reset(); world.renderFrame(1 / 60); calls = renderer.info.render.calls; tris = renderer.info.render.triangles; }
    sync();
    const ms = (performance.now() - t0) / 8;
    // small preview of the frame (drawn right after render, same task)
    world.renderFrame(1 / 60);
    const cv = document.createElement('canvas'); cv.width = 480; cv.height = Math.round(480 * innerHeight / innerWidth);
    cv.getContext('2d').drawImage(renderer.domElement, 0, 0, cv.width, cv.height);
    diag('bench', { t, u, ms: Math.round(ms * 10) / 10, calls, tris, scale: world.renderScale, img: cv.toDataURL('image/jpeg', 0.7) });
    await new Promise((r) => setTimeout(r, 30));
  }
  // stage breakdown (GPU synced after every stage) at two views
  for (const [t, u] of [[0.3, 170], [0.86, 262]]) {
    world.tod.phase = t; world.boat.reset(u); world.chase.snap();
    for (let i = 0; i < 3; i++) world.renderFrame(1 / 60);
    sync();
    world.stageProf = { _t: performance.now() };
    for (let i = 0; i < 8; i++) world.renderFrame(1 / 60);
    const SP = world.stageProf; world.stageProf = null;
    const st = {}; for (const k in SP) if (k !== '_t' && k !== 'up') st[k] = typeof SP[k] === 'number' ? Math.round(SP[k] / 8 * 10) / 10 : SP[k];
    const up = Object.entries(SP.up || {}).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, v]) => k + ':' + Math.round(v / 8 * 10) / 10 + ':' + String(world.updaters[+k.slice(1)]).replace(/\s+/g, ' ').slice(0, 70));
    diag('stages', { t, u, st, up });
    await new Promise((r) => setTimeout(r, 30));
  }
  diag('benchdone');
}

boot().catch((e) => { console.error(e); diag('bootfail', String(e && (e.stack || e.message) || e).slice(0, 500)); });
