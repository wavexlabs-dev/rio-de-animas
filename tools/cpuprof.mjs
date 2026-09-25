import { chromium } from 'playwright';
import fs from 'fs';
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
const cdp = await page.context().newCDPSession(page);
await cdp.send('Profiler.enable');
await cdp.send('Profiler.setSamplingInterval', { interval: 500 });
await cdp.send('Profiler.start');
await page.goto('file://' + process.cwd() + '/dist/index.html?manual&stop9');
await page.waitForTimeout(16000);
const { profile } = await cdp.send('Profiler.stop');
// aggregate self time by function+url line
const byId = new Map(profile.nodes.map(n => [n.id, n]));
const self = new Map();
const dt = profile.timeDeltas; const samples = profile.samples;
for (let i = 0; i < samples.length; i++) { const n = byId.get(samples[i]); const k = n.callFrame.functionName + ':' + n.callFrame.lineNumber; self.set(k, (self.get(k) || 0) + (dt[i] || 0)); }
const arr = [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40);
for (const [k, v] of arr) console.log((v / 1000).toFixed(0).padStart(6), k);
// inclusive time per function
const total = new Map();
const parent = new Map(); for (const n of profile.nodes) for (const c of (n.children || [])) parent.set(c, n.id);
for (let i = 0; i < samples.length; i++) { let id = samples[i]; const seen = new Set(); while (id) { const n = byId.get(id); const k = n.callFrame.functionName + ':' + n.callFrame.lineNumber; if (!seen.has(k)) { total.set(k, (total.get(k) || 0) + (dt[i] || 0)); seen.add(k); } id = parent.get(id); } }
console.log('--- inclusive');
for (const [k, v] of [...total.entries()].sort((a, b) => b[1] - a[1]).slice(0, 60)) console.log((v / 1000).toFixed(0).padStart(6), k);
await browser.close();
