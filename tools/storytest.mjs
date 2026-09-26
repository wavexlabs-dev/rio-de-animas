// Story layer check: boots the standalone build, visits each bank scene, touches it and grabs before/after frames.
// usage: node tools/storytest.mjs [only-scene-name]
import { chromium } from 'playwright';
import fs from 'fs';
const only = (process.argv[2] || '').split(',').filter(Boolean);
const W = +(process.env.W || 640), H = +(process.env.H || 360);
fs.mkdirSync('shots/story', { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] });
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
const logs = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push(m.type() + ': ' + m.text().slice(0, 300)); });
page.on('pageerror', (e) => logs.push('PAGEERROR: ' + e.message + ' ' + (e.stack || '').slice(0, 300)));
const t0 = Date.now();
await page.goto('file://' + process.cwd() + '/dist/index.html?manual&shot&t=0.62', { timeout: 180000 });
await page.waitForFunction(() => window.__rio && window.__rio.story && window.__rio.story.ready, null, { timeout: 300000, polling: 1000 });
console.log('boot', (Date.now() - t0) / 1000, 's');
const info = await page.evaluate(() => {
  const s = window.__rio.story;
  return { hot: s.hot.map((h) => [Math.round(h.u), h.p.x.toFixed(1), h.p.y.toFixed(1), h.p.z.toFixed(1), !!h.repeat]), vign: s.vign.length };
});
console.log(JSON.stringify(info));
const shot = async (name) => {
  const url = await page.evaluate(() => window.__rio.r.domElement.toDataURL('image/jpeg', 0.85));
  fs.writeFileSync(`shots/story/${name}.jpg`, Buffer.from(url.split(',')[1], 'base64'));
};
// swiftshader needs ~10-20 s per rendered frame of this scene, so time is advanced without drawing and only the shots render
const frames = (n, dt = 1 / 30) => page.evaluate(([n, dt]) => {
  const w = window.__rio;
  for (let i = 0; i < n; i++) {
    w.time += dt; w.tod.update(dt, false); w.boat.update(dt, w.input, w.time); w.animateVillagers(dt, w.time); w.animateBells(dt); w.loopCheck(dt);
    if (!w.debugCam) w.chase.update(dt, w.time);
    for (const u of w.updaters) u(dt, w.time);
  }
}, [n, dt]);
const draw = (n = 1) => page.evaluate((n) => { for (let i = 0; i < n; i++) window.__rio.renderFrame(1 / 60); }, n);
// view: boat a little before the scene, camera from the boat looking at the hotspot
const scenes = [
  { name: 'ofrenda', hot: 0, t: 0.645, du: -16, frames: 50 },
  { name: 'familia', hot: 1, t: 0.69, du: -14, frames: 34 },
  { name: 'campanas', hot: 2, t: 0.855, du: -8, frames: 60 },
  { name: 'alebrije', hot: 3, t: 0.84, du: -8, frames: 24 },
  { name: 'tumba', hot: 5, t: 0.012, du: -12, frames: 70 },
  { name: 'oyamel', hot: 6, t: 0.19, du: -18, frames: 50 },
];
for (const sc of scenes) {
  if (only.length && !only.includes(sc.name)) continue;
  const ok = await page.evaluate((sc) => {
    const w = window.__rio, s = w.story, h = s.hot[sc.hot];
    if (!h) return false;
    w.debugCam = false; w.tod.phase = sc.t; w.boat.reset(h.u + sc.du); w.chase.snap();
    return true;
  }, sc);
  if (!ok) { console.log(sc.name, 'missing'); continue; }
  await frames(8);
  // look at the scene from the trajinera
  await page.evaluate((sc) => {
    const w = window.__rio, s = w.story, h = s.hot[sc.hot], T = w.THREE;
    w.debugCam = true;
    const eye = w.boat.pos.clone().add(new T.Vector3(0, 3.2, 0));
    const dir = h.p.clone().sub(eye); const d = dir.length();
    w.cam.position.copy(eye).addScaledVector(dir.normalize(), Math.max(0, d - 16));
    w.cam.lookAt(h.p); w.shadowTarget = h.p.clone();
  }, sc);
  await frames(3);
  await draw(1);
  await shot(sc.name + '_a');
  const tap = await page.evaluate((sc) => {
    const w = window.__rio, s = w.story, h = s.hot[sc.hot];
    const v = h.p.clone().project(w.cam);
    const r = w.r.domElement.getBoundingClientRect();
    const x = r.left + (v.x * 0.5 + 0.5) * r.width, y = r.top + (-v.y * 0.5 + 0.5) * r.height;
    const before = s.comp.items.filter((q) => q.mode).length;
    const picked = s.pick(x, y) === h;
    s.tap(x, y);
    return { x: Math.round(x), y: Math.round(y), picked, before };
  }, sc);
  await frames(sc.frames);
  await draw(1);
  const after = await page.evaluate(() => window.__rio.story.comp.items.filter((q) => q.mode).length);
  await shot(sc.name + '_b');
  console.log(sc.name, JSON.stringify(tap), 'companions', tap.before, '->', after);
}
// veladoras on the water + the climb up the waterfall
if (!only.length || only.includes('agua')) {
  const r = await page.evaluate(() => {
    const w = window.__rio, s = w.story, T = w.THREE;
    w.debugCam = false; w.tod.phase = 0.86; w.boat.reset(300); w.chase.snap();
    for (let i = 0; i < 6; i++) { w.tod.update(1 / 30); w.boat.update(1 / 30, w.input, w.time += 1 / 30); w.chase.update(1 / 30, w.time); }
    w.cam.updateMatrixWorld();
    const cam = w.cam, el = w.r.domElement.getBoundingClientRect();
    const out = [];
    for (const [ax, dd] of [[8, -3], [11, 3.5], [14, -5], [6, 4.5]]) {
      const p = w.boat.pos.clone().addScaledVector(w.boat.fwd, ax); p.x += -w.boat.fwd.z * dd; p.z += w.boat.fwd.x * dd; p.y = 0.03;
      const v = p.project(cam);
      s.tap(el.left + (v.x * 0.5 + 0.5) * el.width, el.top + (-v.y * 0.5 + 0.5) * el.height);
      out.push(s.vel.placed);
    }
    return out;
  });
  await frames(75);
  await draw(1);
  await shot('agua_veladoras');
  const c = await page.evaluate(() => window.__rio.story.comp.items.filter((q) => q.mode).length);
  console.log('veladoras placed', JSON.stringify(r), 'companions', c);
  await page.evaluate(() => { const w = window.__rio; w.tod.phase = 0.55; w.boat.reset(1046); w.chase.snap(); });
  await frames(60, 1 / 15);
  await draw(1);
  await shot('cascada_1');
  await frames(60, 1 / 15);
  await draw(1);
  await shot('cascada_2');
  const c2 = await page.evaluate(() => window.__rio.story.comp.items.filter((q) => q.mode).map((q) => q.mode + ':' + q.p.y.toFixed(0)).slice(0, 10));
  console.log('ascending', JSON.stringify(c2));
}
console.log([...new Set(logs)].slice(0, 25).join('\n'));
await browser.close();
