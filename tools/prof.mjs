import { chromium } from 'playwright';
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
page.on('console', m => { const t = m.text(); if (t.startsWith('BUILD')) console.log(t); });
page.on('pageerror', e => console.log('PAGEERROR: ' + e.message));
const t0 = Date.now();
await page.goto('file://' + process.cwd() + '/dist/index.html?manual&prof');
await page.waitForFunction(() => window.__rio, null, { timeout: 300000, polling: 500 });
console.log('total', (Date.now() - t0) / 1000);
// long tasks
await browser.close();
