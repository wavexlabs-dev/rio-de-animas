// Close-up frames of the hero trajinera from several angles (headless): shots/boat/<name>.jpg
// usage: node tools/boatshot.mjs [phase=0.62] [u=40]
import { chromium } from 'playwright';
import fs from 'fs';
const phase = +(process.argv[2] || 0.62), u = +(process.argv[3] || 40);
const W = +(process.env.W || 960), H = +(process.env.H || 540);
fs.mkdirSync('shots/boat', { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] });
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
const logs = [];
page.on('pageerror', (e) => logs.push('PAGEERROR ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') logs.push(m.text().slice(0, 300)); });
await page.goto('file://' + process.cwd() + '/dist/index.html?manual&shot&t=' + phase, { timeout: 180000 });
await page.waitForFunction(() => window.__rio && window.__rio.story && window.__rio.story.ready, null, { timeout: 300000, polling: 1000 });
await page.evaluate(([u, ph]) => {
  const w = window.__rio; w.story.auto = false; w.tod.phase = ph; w.boat.reset(u); w.chase.snap();
  for (let i = 0; i < 40; i++) { w.time += 1 / 30; w.tod.update(1 / 30); w.boat.update(1 / 30, w.input, w.time); w.chase.update(1 / 30, w.time); for (const f of w.updaters) f(1 / 30, w.time); }
  w.envTimer = 0;
}, [u, phase]);
// camera offsets in boat-local space: [name, x, y, z, lookX, lookY, lookZ]  (+z = bow)
const views = [['chase', null], ['frente', [1.2, 1.9, 9.5, 0, 1.3, 1]], ['lado', [7.5, 2.2, 0.5, 0, 1.0, 0.2]], ['tres4', [4.5, 3.2, 6.5, 0, 1.0, 1.5]], ['adentro', [0.3, 1.6, -4.6, 0, 1.0, 1.5]], ['trajinero', [2.6, 1.9, 5.8, 0.4, 1.3, 3.4]]];
for (const [name, v] of views) {
  await page.evaluate((v) => {
    const w = window.__rio, T = w.THREE;
    if (!v) { w.debugCam = false; w.chase.snap(); for (let i = 0; i < 30; i++) w.chase.update(1 / 30, w.time); return; }
    w.debugCam = true;
    const g = w.boat.group;
    g.updateMatrixWorld(true);
    w.cam.position.copy(new T.Vector3(v[0], v[1], v[2]).applyMatrix4(g.matrixWorld));
    const L = new T.Vector3(v[3], v[4], v[5]).applyMatrix4(g.matrixWorld);
    w.cam.lookAt(L); w.shadowTarget = L.clone();
  }, v);
  const url = await page.evaluate(() => { const w = window.__rio; w.renderFrame(1 / 60); return w.r.domElement.toDataURL('image/jpeg', 0.88); });
  fs.writeFileSync(`shots/boat/${name}.jpg`, Buffer.from(url.split(',')[1], 'base64'));
  console.log('shot', name);
}
// the side view through one pole stroke (the pole must stay clear of the roof)
if (process.env.STROKE) for (let k = 0; k < 5; k++) {
  await page.evaluate(() => { const w = window.__rio; w.debugCam = false; for (let i = 0; i < 15; i++) { w.time += 1 / 30; w.tod.update(1 / 30); w.boat.update(1 / 30, w.input, w.time); for (const f of w.updaters) f(1 / 30, w.time); } });
  await page.evaluate(() => { const w = window.__rio, T = w.THREE, g = w.boat.group; w.debugCam = true; g.updateMatrixWorld(true); w.cam.position.copy(new T.Vector3(7.5, 2.4, -1.2).applyMatrix4(g.matrixWorld)); const L = new T.Vector3(0, 1.2, -1.5).applyMatrix4(g.matrixWorld); w.cam.lookAt(L); w.shadowTarget = L.clone(); });
  const url = await page.evaluate(() => { const w = window.__rio; w.renderFrame(1 / 60); return w.r.domElement.toDataURL('image/jpeg', 0.85); });
  fs.writeFileSync(`shots/boat/stroke${k}.jpg`, Buffer.from(url.split(',')[1], 'base64'));
  console.log('stroke', k, await page.evaluate(() => +window.__rio.boat.phase.toFixed(2)));
}
console.log([...new Set(logs)].slice(0, 20).join('\n'));
await browser.close();
