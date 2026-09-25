import { chromium } from 'playwright';
import fs from 'fs';
// usage: node tools/shot.mjs name "query" [frames] [w] [h] [evalJS]
const [name, query = '', frames = '3', w = '960', h = '540', evalJs = ''] = process.argv.slice(2);
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] });
const page = await browser.newPage({ viewport: { width: +w, height: +h }, deviceScaleFactor: 1 });
const logs = [];
page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') logs.push(m.type() + ': ' + m.text().slice(0, 600)); });
page.on('pageerror', e => logs.push('PAGEERROR: ' + e.message + ' ' + (e.stack || '').slice(0, 400)));
page.on('request', r => { if (!r.url().startsWith('file:') && !r.url().startsWith('data:')) logs.push('REQUEST: ' + r.url().slice(0, 100)); });
const t0 = Date.now();
await page.goto('file://' + process.cwd() + '/dist/index.html?manual&shot&' + query, { timeout: 180000 });
try { await page.waitForFunction(() => window.__rio, null, { timeout: 300000, polling: 1000 }); }
catch (e) { console.log('BOOT FAIL'); console.log(logs.join('\n')); await browser.close(); process.exit(1); }
const tb = Date.now();
if (evalJs) await page.evaluate(evalJs);
const n = +frames;
const ft = await page.evaluate((n) => { const t = performance.now(); for (let i = 0; i < n; i++) window.__rio.renderFrame(1 / 30); window.__rio.r.getContext().finish(); return (performance.now() - t) / n; }, n);
const url = await page.evaluate(() => window.__rio.r.domElement.toDataURL('image/png'));
fs.writeFileSync(`shots/${name}.png`, Buffer.from(url.split(',')[1], 'base64'));
console.log(`boot ${(tb - t0) / 1000}s frame ${ft.toFixed(0)}ms`);
console.log(logs.slice(0, 30).join('\n'));
await browser.close();
