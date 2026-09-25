import * as esbuild from 'esbuild';
import fs from 'fs';
import path from 'path';
const dir = 'tex/final';
const mdir = 'tex/models';
const files = fs.readdirSync(dir).filter(f => f.endsWith('.webp')).sort();
const mfiles = fs.existsSync(mdir) ? fs.readdirSync(mdir).sort() : [];
// mode 'embed': data URIs inside the bundle (standalone file); mode 'files': relative asset URLs (hosted artifact)
function genAssets(mode) {
  const out = [];
  const img = (key, file) => {
    if (mode === 'files') { out.push([file, 'assets/' + key + '.webp']); return `"assets/${key}.webp"`; }
    return `"data:image/webp;base64,${fs.readFileSync(file).toString('base64')}"`;
  };
  let js = 'export default {\n';
  for (const f of files) js += `  ${JSON.stringify(f.replace('.webp', ''))}: ${img(f.replace('.webp', ''), path.join(dir, f))},\n`;
  for (const f of mfiles.filter((f) => f.endsWith('.webp'))) js += `  ${JSON.stringify('m_' + f.replace('.webp', ''))}: ${img('m_' + f.replace('.webp', ''), path.join(mdir, f))},\n`;
  js += '};\n';
  js += 'export const MODEL_META = ' + (fs.existsSync(mdir + '/index.json') ? fs.readFileSync(mdir + '/index.json', 'utf8') : '{}') + ';\n';
  js += 'export const MODEL_BIN = {\n';
  for (const f of mfiles.filter((f) => f.endsWith('.bin'))) {
    const key = f.replace('.bin', '');
    // hosted build: binary mesh data travels with a served extension (.wasm is only fetched, never compiled)
    if (mode === 'files') { out.push([path.join(mdir, f), 'assets/' + key + '.mesh.wasm']); js += `  ${JSON.stringify(key)}: "assets/${key}.mesh.wasm",\n`; }
    else js += `  ${JSON.stringify(key)}: "${fs.readFileSync(path.join(mdir, f)).toString('base64')}",\n`;
  }
  js += '};\n';
  fs.writeFileSync('src/assets.gen.js', js);
  return out;
}
async function bundle() {
const res = await esbuild.build({ entryPoints: ['src/main.js'], bundle: true, minify: !process.argv.includes('--dev'), format: 'iife', write: false, target: 'es2020', legalComments: 'none', logLevel: 'warning' });
let code = res.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
  return code;
}
const petals = Array.from({length: 12}, (_, i) => `<path style="--i:${i}" transform="rotate(${i*30} 50 50)" d="M50 50 C44 38 44 22 50 9 C56 22 56 38 50 50Z"/>`).join('');
const htmlFor = (code) => `<!DOCTYPE html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>&#8203;</title>
<style>
html,body{margin:0;height:100%;overflow:hidden;background:#07081a}
canvas{display:block;width:100vw;height:100vh;cursor:grab;touch-action:none}
canvas:active{cursor:grabbing}
#ld{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:radial-gradient(circle at 50% 50%,#1a1433 0%,#07081a 70%);transition:opacity 1.4s ease;z-index:5;--p:0}
#ld.done{opacity:0;pointer-events:none}
#ld svg{width:min(22vmin,160px);height:min(22vmin,160px);filter:drop-shadow(0 0 18px rgba(255,140,30,.45));animation:sp 9s linear infinite}
#ld path{fill:#ff8a1a;opacity:clamp(.12,calc((var(--p) * 12 - var(--i)) * 1),1);transition:opacity .4s}
#ld circle{fill:#ffc23a;opacity:calc(.3 + var(--p) * .7)}
@keyframes sp{to{transform:rotate(360deg)}}
</style></head>
<body><canvas id="c"></canvas><div id="ld"><svg viewBox="0 0 100 100">${petals}<circle cx="50" cy="50" r="7"/></svg></div>
<script>${code}</script></body></html>`;
const artFor = (code) => `<title>Río de Ánimas</title>
<style>
:root{--ground:#07081a;--petal:#ff8a1a;--core:#ffc23a;color-scheme:dark}
html,body{height:100%;margin:0;overflow:hidden;background:var(--ground)}
canvas{position:fixed;inset:0;display:block;width:100vw;height:100vh;cursor:grab;touch-action:none}
canvas:active{cursor:grabbing}
#ld{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:radial-gradient(circle at 50% 50%,#1a1433 0%,var(--ground) 70%);transition:opacity 1.4s ease;z-index:5;--p:0}
#ld.done{opacity:0;pointer-events:none}
#ld svg{width:min(22vmin,160px);height:min(22vmin,160px);filter:drop-shadow(0 0 18px rgba(255,140,30,.45));animation:sp 9s linear infinite}
#ld path{fill:var(--petal);opacity:clamp(.12,calc((var(--p) * 12 - var(--i)) * 1),1);transition:opacity .4s}
#ld circle{fill:var(--core);opacity:calc(.3 + var(--p) * .7)}
@keyframes sp{to{transform:rotate(360deg)}}
@media (prefers-reduced-motion:reduce){#ld svg{animation:none}}
</style>
<canvas id="c"></canvas><div id="ld"><svg viewBox="0 0 100 100">${petals}<circle cx="50" cy="50" r="7"/></svg></div>
<script>${code}</script>`;


// --web: only the static site in public/ (what Netlify builds); default: also the standalone file and the artifact build in dist/
const WEB = process.argv.includes('--web');
let html = '';
if (!WEB) {
  fs.mkdirSync('dist', { recursive: true });
  genAssets('embed');
  html = htmlFor(await bundle());
  fs.writeFileSync('dist/index.html', html);
}
const list = genAssets('files');
const codeFiles = await bundle();
let bytes = 0;
for (const [src] of list) bytes += fs.statSync(src).size;
if (!WEB) {
  fs.writeFileSync('dist/artifact.html', artFor(codeFiles));
  fs.rmSync('dist/assets', { recursive: true, force: true });
  fs.mkdirSync('dist/assets', { recursive: true });
  for (const [src, dst] of list) fs.copyFileSync(src, path.join('dist', dst));
  fs.writeFileSync('dist/assets.json', JSON.stringify(Object.fromEntries(list.map(([src, dst]) => [dst, 'dist/' + dst]))));
}
// public web build (Vercel, Netlify or any static host): full HTML document + the same asset files next to it
// the host's production URL at build time (Vercel or Netlify); social cards need an absolute image URL
const SITE = (process.env.VERCEL_PROJECT_PRODUCTION_URL ? 'https://' + process.env.VERCEL_PROJECT_PRODUCTION_URL : process.env.URL || '').replace(/\/$/, '');
const META = `<title>Río de Ánimas</title>
<meta name="description" content="Un río de Día de Muertos en 3D: una trajinera remonta el valle entre catrinas, veladoras y cempasúchil, del amanecer a la noche.">
<meta name="theme-color" content="#07081a">
<meta property="og:title" content="Río de Ánimas">
<meta property="og:description" content="Un río de Día de Muertos en 3D, en tiempo real en el navegador.">
<meta property="og:type" content="website">
<meta property="og:image" content="${SITE ? SITE + '/' : ''}og.jpg">${SITE ? `\n<meta property="og:url" content="${SITE}/">` : ''}
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="data:image/svg+xml,${encodeURIComponent('<svg xmlns=\'http://www.w3.org/2000/svg\' viewBox=\'0 0 100 100\'>' + petals.replace(/style="--i:\d+" /g, 'fill="#ff8a1a" ') + '<circle cx=\'50\' cy=\'50\' r=\'9\' fill=\'#ffc23a\'/></svg>')}">`;
fs.rmSync('public', { recursive: true, force: true });
fs.mkdirSync('public/assets', { recursive: true });
for (const [src, dst] of list) fs.copyFileSync(src, path.join('public', dst));
fs.writeFileSync('public/index.html', htmlFor(codeFiles).replace('<title>&#8203;</title>', META));
if (fs.existsSync('tex/og.jpg')) fs.copyFileSync('tex/og.jpg', 'public/og.jpg');
if (!WEB) genAssets('embed');
console.log('built', WEB ? 'public/' : (html.length / 1e6).toFixed(2) + ' MB standalone + public/;', list.length, 'assets', (bytes / 1e6).toFixed(2), 'MB');
