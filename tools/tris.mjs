// Per-pass and per-object triangle / draw-call breakdown at a boat position.
// usage: node tools/tris.mjs "bu=220&t=0.3"
import { chromium } from 'playwright';
const q = process.argv[2] || 'bu=220&t=0.3';
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
page.on('pageerror', e => console.log('PAGEERROR: ' + e.message));
await page.goto('file://' + process.cwd() + '/dist/index.html?manual&shot&' + q);
await page.waitForFunction(() => window.__rio, null, { timeout: 300000, polling: 500 });
const out = await page.evaluate(() => {
  const w = window.__rio, r = w.r;
  if (w.chase && w.chase.snap) w.chase.snap();
  for (let i = 0; i < 3; i++) w.renderFrame(1 / 30);
  // per render() call
  const passes = [];
  const orig = r.render.bind(r);
  r.render = (scene, cam) => { const c0 = r.info.render.calls, t0 = r.info.render.triangles; orig(scene, cam); passes.push({ cam: (cam.name || cam.type) + (r.getRenderTarget() ? ':rt' : ''), calls: r.info.render.calls - c0, tris: r.info.render.triangles - t0 }); };
  // per object in the main camera frustum
  const THREE = w.THREE;
  const cam = w.cam;
  cam.updateMatrixWorld();
  const fr = new w.THREE.Frustum().setFromProjectionMatrix(new w.THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
  w.renderFrame(1 / 30);
  r.render = orig;
  const breakdown = (cam, mask) => {
  const fr = new w.THREE.Frustum().setFromProjectionMatrix(new w.THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
  const by = {};
  const sph = new w.THREE.Sphere();
  w.scene.traverse((o) => {
    if (mask !== undefined && !(o.layers.mask & mask)) return;
    if (!o.isMesh || !o.visible) return;
    let vis = true; let p = o; while (p) { if (!p.visible) vis = false; p = p.parent; }
    if (!vis || !o.geometry) return;
    const g = o.geometry;
    const tri = (g.index ? g.index.count : g.attributes.position.count) / 3;
    const n = o.isInstancedMesh ? o.count : 1;
    if (!n) return;
    if (!g.boundingSphere) g.computeBoundingSphere();
    if (o.frustumCulled !== false) { sph.copy(o.isInstancedMesh && o.boundingSphere ? o.boundingSphere : g.boundingSphere).applyMatrix4(o.matrixWorld); if (!fr.intersectsSphere(sph)) return; }
    const k = (o.name || o.material.type || '?').replace(/[0-9]+$/, '') + (o.castShadow ? '*' : '');
    by[k] = by[k] || { tris: 0, calls: 0 };
    by[k].tris += tri * n; by[k].calls++;
  });
  return Object.entries(by).sort((a, b) => b[1].tris - a[1].tris).slice(0, 25).map(([k, v]) => k + ' ' + Math.round(v.tris / 1000) + 'k/' + v.calls);
  };
  const top = breakdown(cam, 1 | 32);
  const vc = w.water.vcam;
  const topR = breakdown(vc, 1 | 4);
  return { passes, top, topR };
});
let tc = 0, tt = 0;
for (const p of out.passes) { tc += p.calls; tt += p.tris; console.log('pass', p.cam, p.calls, Math.round(p.tris / 1000) + 'k'); }
console.log('TOTAL', tc, Math.round(tt / 1000) + 'k');
console.log('--- main\n' + out.top.join('\n'));
console.log('--- reflection\n' + out.topR.join('\n'));
await browser.close();
