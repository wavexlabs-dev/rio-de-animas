import { chromium } from 'playwright';
import fs from 'fs';
// usage: node tools/multi.mjs "baseQuery" name1 "js1" name2 "js2" ...   (js runs before rendering frames)
const args = process.argv.slice(2);
const base = args.shift();
const W = +(process.env.W || 960), H = +(process.env.H || 540), FR = +(process.env.FR || 3);
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] });
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
const logs = [];
page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') logs.push(m.type() + ': ' + m.text().slice(0, 300)); });
page.on('pageerror', e => logs.push('PAGEERROR: ' + e.message));
page.on('request', r => { if (!r.url().startsWith('file:') && !r.url().startsWith('data:')) logs.push('REQUEST: ' + r.url().slice(0, 100)); });
const t0 = Date.now();
await page.goto('file://' + process.cwd() + '/dist/index.html?manual&shot&' + base, { timeout: 180000 });
await page.waitForFunction(() => window.__rio, null, { timeout: 300000, polling: 1000 });
console.log('boot', (Date.now() - t0) / 1000);
for (let i = 0; i < args.length; i += 2) {
  const name = args[i], js = args[i + 1];
  const t = Date.now();
  await page.evaluate(`(() => { const w = window.__rio; ${js} })()`);
  await page.evaluate((n) => { for (let k = 0; k < n; k++) window.__rio.renderFrame(1 / 30); }, FR);
  const url = await page.evaluate(() => window.__rio.r.domElement.toDataURL('image/png'));
  fs.writeFileSync(`shots/${name}.png`, Buffer.from(url.split(',')[1], 'base64'));
  console.log(name, ((Date.now() - t) / 1000).toFixed(1) + 's');
}
const u = [...new Set(logs)];
console.log(u.slice(0, 20).join('\n'));
await browser.close();
