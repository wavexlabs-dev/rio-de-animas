import { chromium } from 'playwright';
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
await page.goto('file://' + process.cwd() + '/dist/index.html?manual&shot&t=0.3&u=30&h=4');
await page.waitForFunction(() => window.__rio, null, { timeout: 240000 });
const names = await page.evaluate(() => window.__rio.scene.children.map((c, i) => i + ':' + c.type + ':' + c.name));
console.log(names.join(' | '));
for (const hide of ['sky', 'moon', 'terrainFar']) {
  await page.evaluate((h) => { const w = window.__rio; w.scene.traverse(o => { o.visible = !(o.name === h) && o.visible !== false ? true : !(o.name === h); }); w.renderFrame(0.03); }, hide);
  await page.screenshot({ path: `shots/probe_${hide}.png`, clip: { x: 560, y: 0, width: 200, height: 200 } });
  await page.evaluate(() => { window.__rio.scene.traverse(o => { o.visible = true; }); });
}
await browser.close();
