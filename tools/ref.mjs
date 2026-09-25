import { chromium } from 'playwright';
const url = process.argv[2];
const out = process.argv[3] || 'shots/ref';
const browser = await chromium.launch({ args: ['--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist','--enable-webgl'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const logs = [];
page.on('console', m => logs.push(m.type()+': '+m.text()));
page.on('pageerror', e => logs.push('PAGEERROR: '+e.message));
const resp = [];
page.on('response', r => resp.push(r.status()+' '+r.url().slice(0,120)+' '+(r.headers()['content-length']||'')));
await page.goto(url, { waitUntil: 'load', timeout: 120000 });
for (const t of [8, 20, 40]) {
  await page.waitForTimeout(t === 8 ? 8000 : 12000);
  await page.screenshot({ path: `${out}_${t}.png` });
}
const info = await page.evaluate(() => ({
  scripts: [...document.scripts].map(s => ({src: s.src, len: s.textContent.length, type: s.type})),
  htmlLen: document.documentElement.outerHTML.length,
  three: window.THREE ? window.THREE.REVISION : null,
  canvases: document.querySelectorAll('canvas').length,
}));
console.log(JSON.stringify(info, null, 1));
console.log(resp.join('\n'));
console.log(logs.slice(0,40).join('\n'));
await browser.close();
