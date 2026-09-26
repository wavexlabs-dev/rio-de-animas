// Story layer check: boots the standalone build, lets the trajinera reach each bank scene on its own and checks that
// the scene plays by itself (the camera is left alone); then a stretch of night for the veladoras.
// usage: node tools/storytest.mjs [only-scene-name]      (frames written to shots/story/)
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
console.log(JSON.stringify(await page.evaluate(() => window.__rio.story.hot.map((h) => [Math.round(h.u), h.win, h.hold]))));
const shot = async (name) => {
  const url = await page.evaluate(() => window.__rio.r.domElement.toDataURL('image/jpeg', 0.85));
  fs.writeFileSync(`shots/story/${name}.jpg`, Buffer.from(url.split(',')[1], 'base64'));
};
// swiftshader needs ~10-20 s per rendered frame of this scene, so time is advanced without drawing and only the shots render
const frames = (n, dt = 1 / 30) => page.evaluate(([n, dt]) => {
  const w = window.__rio, s = w.story, out = [];
  for (let i = 0; i < n; i++) {
    w.time += dt; w.tod.update(dt, false); w.boat.update(dt, w.input, w.time); w.animateVillagers(dt, w.time); w.animateBells(dt); w.loopCheck(dt);
    if (!w.debugCam) w.chase.update(dt, w.time);
    for (const u of w.updaters) u(dt, w.time);
    if (i % 15 === 0) out.push([+w.time.toFixed(1), Math.round(w.boat.u), +w.slow.toFixed(2), s.hot.filter((h) => h.played).length]);
  }
  return out;
}, [n, dt]);
const draw = () => page.evaluate(() => window.__rio.renderFrame(1 / 60));
const scenes = [
  { name: 'ofrenda', k: 0, t: 0.62 },
  { name: 'familia', k: 1, t: 0.685 },
  { name: 'campanas', k: 2, t: 0.84, back: 100 },
  { name: 'alebrijes', k: 3, t: 0.85 },
  { name: 'tumba', k: 4, t: 0.0 },
  { name: 'oyamel', k: 5, t: 0.18 },
];
for (const sc of scenes) {
  if (only.length && !only.includes(sc.name)) continue;
  await page.evaluate((sc) => {
    const w = window.__rio, s = w.story, h = s.hot[sc.k];
    s.reset(); for (const q of s.hot) q.played = q !== h;
    w.debugCam = false; w.tod.phase = sc.t; w.boat.reset(h.u - (sc.back || 60)); w.chase.snap();
  }, sc);
  let trace = [], playedAt = null;
  for (let chunk = 0; chunk < 40; chunk++) {
    trace = trace.concat(await frames(30));
    const st = await page.evaluate((k) => { const w = window.__rio; return { played: w.story.hot[k].played, u: Math.round(w.boat.u), t: +w.time.toFixed(1) }; }, sc.k);
    if (st.played && !playedAt) playedAt = st;
    if (playedAt && st.t - playedAt.t > 6) break;
  }
  const comp = await page.evaluate(() => window.__rio.story.comp.items.filter((q) => q.mode).length);
  const cam = await page.evaluate(() => { const w = window.__rio; return +w.cam.fov.toFixed(1); });
  console.log(sc.name.padEnd(9), playedAt ? `played at u ${playedAt.u} (scene u ${Math.round(await page.evaluate((k) => window.__rio.story.hot[k].u, sc.k))})` : 'NOT PLAYED', 'min slow', Math.min(...trace.map((r) => r[2])), 'fov', cam, 'companions', comp);
}
// night: the trajinero leaves veladoras and ánimas are born from them
if (!only.length || only.includes('noche')) {
  const p0 = await page.evaluate(() => { const w = window.__rio, s = w.story; s.reset(); for (const q of s.hot) q.played = true; w.debugCam = false; w.tod.phase = 0.86; w.boat.reset(300); w.chase.snap(); return s.vel.placed; });
  await frames(30 * 40);
  const r = await page.evaluate((p0) => { const s = window.__rio.story; return { placed: s.vel.placed - p0, alive: s.vel.items.filter((q) => q.alive).length, comp: s.comp.items.filter((q) => q.mode).length }; }, p0);
  await draw(); await shot('auto_noche');
  console.log('noche 40s', JSON.stringify(r));
}
console.log([...new Set(logs)].slice(0, 25).join('\n'));
await browser.close();
