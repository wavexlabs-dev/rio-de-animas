// Single frames of each teaser shot (headless), to check framing before recording: shots/teaser/<shot>_<t>.jpg
// usage: node tools/teaserpeek.mjs [shotName@t,...]
import { chromium } from 'playwright';
import fs from 'fs';
const W = +(process.env.W || 960), H = +(process.env.H || 540);
const want = (process.argv[2] || 'apertura@3,lupita@1,lupita@5,ofrenda@3.5,nina@2,nina@5.9,iglesia@1.5,iglesia@5.5,veladoras@3.5,veladoras@6.5,tumba@3,amanecer@2.5,monarcas@3.5,tormenta@2,cascada@3,cascada@7').split(',').map((x) => x.split('@'));
fs.mkdirSync('shots/teaser', { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] });
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
const logs = [];
page.on('pageerror', (e) => logs.push('PAGEERROR ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') logs.push(m.text().slice(0, 300)); });
await page.goto('file://' + process.cwd() + '/dist/index.html?manual&shot&t=0.62', { timeout: 180000 });
await page.waitForFunction(() => window.__rio && window.__rio.story && window.__rio.story.ready, null, { timeout: 300000, polling: 1000 });
await page.evaluate(() => { window.__peek = true; });
console.log(JSON.stringify(await page.evaluate(fs.readFileSync('tools/footage.js', 'utf8'))));
for (const [name, ts] of want) {
  const t = +ts;
  const ok = await page.evaluate(([name, t]) => {
    const w = window.__rio, D = window.__dir, sh = D.shots.find((x) => x.name === name);
    if (!sh) return false;
    sh.setup();
    const dt = 1 / D.FPS; let fired = 0;
    const logic = () => { w.time += dt; w.tod.update(dt, false); w.boat.update(dt, w.input, w.time); w.animateVillagers(dt, w.time); w.animateBells(dt); w.loopCheck(dt); if (!w.debugCam) w.chase.update(dt, w.time); for (const u of w.updaters) u(dt, w.time); };
    for (let i = 0; i < D.PRE; i++) { if (sh.cam) sh.cam(0, sh.dur); logic(); }
    const n = Math.round(t * D.FPS);
    for (let i = 0; i < n; i++) { const tt = i / D.FPS; if (sh.cam) sh.cam(tt, sh.dur); if (sh.ev) while (fired < sh.ev.length && sh.ev[fired][0] <= tt) sh.ev[fired++][1](); logic(); }
    if (sh.cam) sh.cam(t, sh.dur);
    w.fade = 0;
    return true;
  }, [name, t]);
  if (!ok) { console.log('no shot', name); continue; }
  const url = await page.evaluate(() => { const w = window.__rio; w.renderFrame(1 / 60); return w.r.domElement.toDataURL('image/jpeg', 0.85); });
  fs.writeFileSync(`shots/teaser/${name}_${t}.jpg`, Buffer.from(url.split(',')[1], 'base64'));
  console.log('shot', name, t);
}
console.log([...new Set(logs)].slice(0, 20).join('\n'));
await browser.close();
