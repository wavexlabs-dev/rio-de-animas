// Boot the standalone build headless and print any story/console errors.
import { chromium } from 'playwright';
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 480, height: 270 } });
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log(m.type(), m.text().slice(0, 800)); });
page.on('pageerror', (e) => console.log('PAGEERROR', e.message, (e.stack || '').slice(0, 800)));
await page.goto('file://' + process.cwd() + '/dist/index.html?manual&shot&t=0.62');
await page.waitForFunction(() => window.__rio && window.__rio.story && window.__rio.story.ready, null, { timeout: 300000, polling: 1000 });
console.log(await page.evaluate(() => window.__rio.story.hot.length + ' hotspots, ' + window.__rio.story.vign.length + ' scenes'));
await browser.close();
