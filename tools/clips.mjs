// Short video clips of the story scenes (headless, frame by frame) -> shots/clips/<name>.mp4
// usage: node tools/clips.mjs [names,comma,separated]   env: W, H, FPS
import { chromium } from 'playwright';
import fs from 'fs';
import { execFileSync } from 'child_process';
const only = (process.argv[2] || '').split(',').filter(Boolean);
const W = +(process.env.W || 480), H = +(process.env.H || 270), FPS = +(process.env.FPS || 10);
fs.mkdirSync('shots/clips', { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] });
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
await page.goto('file://' + process.cwd() + '/dist/index.html?manual&shot&t=0.62', { timeout: 180000 });
await page.waitForFunction(() => window.__rio && window.__rio.story && window.__rio.story.ready, null, { timeout: 300000, polling: 1000 });
console.log('booted');
// camera on the river side of a bank scene, looking at it
const frameScene = `(k, dist, up, side) => {
  const w = window.__rio, s = w.story, h = s.hot[k], T = w.THREE;
  const dir = w.boat.pos.clone().sub(h.p); dir.y = 0; dir.normalize();
  const lat = new T.Vector3(-dir.z, 0, dir.x).multiplyScalar(side || 0);
  w.debugCam = true;
  w.cam.position.copy(h.p).addScaledVector(dir, dist).add(lat); w.cam.position.y = h.p.y + up;
  w.cam.lookAt(h.p.x, h.p.y + 0.2, h.p.z); w.shadowTarget = h.p.clone();
}`;
const clips = [
  { name: 'tumba', t: 0.012, hot: 5, du: -8, dist: 7, up: 1.2, side: 2, n: 46, taps: [4] },
  { name: 'veladoras', t: 0.86, bu: 300, chase: true, n: 26, water: [[1, 9, -3.5], [5, 12, 4], [9, 8, 3], [13, 14, -5]] },
  { name: 'nina', t: 0.69, hot: 1, du: -8, dist: 5.5, up: 0.6, side: 1.5, n: 18, taps: [2] },
  { name: 'ofrenda', t: 0.645, hot: 0, du: -8, dist: 6.5, up: 0.9, side: 1.5, n: 20, taps: [3] },
  { name: 'alebrije', t: 0.84, hot: 3, du: -6, dist: 8, up: 1.4, side: -2, n: 16, taps: [2] },
  { name: 'monarcas', t: 0.19, hot: 6, du: -12, dist: 13, up: 2, side: 2, n: 20, taps: [3] },
];
for (const c of clips) {
  if (only.length && !only.includes(c.name)) continue;
  const dir = `shots/clips/${c.name}`;
  fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
  await page.evaluate((c) => {
    const w = window.__rio, s = w.story;
    s.reset();
    w.debugCam = false; w.tod.phase = c.t;
    w.boat.reset(c.bu !== undefined ? c.bu : s.hot[c.hot].u + c.du); w.chase.snap();
    for (let i = 0; i < 10; i++) { w.tod.update(1 / 30); w.boat.update(1 / 30, w.input, w.time += 1 / 30); w.chase.update(1 / 30, w.time); }
    w.cam.updateMatrixWorld();
    w.envTimer = 0;
  }, c);
  if (!c.chase) await page.evaluate(`(${frameScene})(${c.hot}, ${c.dist}, ${c.up}, ${c.side})`);
  const t0 = Date.now();
  for (let f = 0; f < c.n; f++) {
    if (c.taps && c.taps.includes(f)) await page.evaluate((k) => { const s = window.__rio.story; s.hot[k].fn(); s.hot[k].touched = true; }, c.hot);
    for (const [fw, ax, dd] of c.water || []) if (fw === f) await page.evaluate(([ax, dd]) => {
      const w = window.__rio, T = w.THREE;
      const p = w.boat.pos.clone().addScaledVector(w.boat.fwd, ax); p.x += -w.boat.fwd.z * dd; p.z += w.boat.fwd.x * dd; p.y = 0.03;
      w.story.vel.place(p);
    }, [ax, dd]);
    const url = await page.evaluate((dt) => { const w = window.__rio; w.renderFrame(dt); return w.r.domElement.toDataURL('image/jpeg', 0.9); }, 1 / FPS);
    fs.writeFileSync(`${dir}/${String(f).padStart(3, '0')}.jpg`, Buffer.from(url.split(',')[1], 'base64'));
    if (f === 0) console.log(c.name, 'first frame', ((Date.now() - t0) / 1000).toFixed(1), 's');
  }
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(FPS), '-i', `${dir}/%03d.jpg`, '-vf', `minterpolate=fps=30:mi_mode=blend,scale=${W * 2}:${H * 2}:flags=lanczos,format=yuv420p`, '-c:v', 'libx264', '-crf', '20', '-movflags', '+faststart', `shots/clips/${c.name}.mp4`]);
  console.log(c.name, 'done', ((Date.now() - t0) / 1000).toFixed(0), 's');
}
await browser.close();
