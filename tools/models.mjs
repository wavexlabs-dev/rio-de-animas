// Scanned Poly Haven models -> compact quantized meshes (+ LOD) and web textures
// usage: node tools/models.mjs
import { NodeIO } from '@gltf-transform/core';
import { weld, simplifyPrimitive } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';
import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';

// asset packs downloaded from Poly Haven (a later pack may add files, e.g. alpha maps, to an earlier model)
const ROOTS = ['ph/rio-de-animas-assets/modelos', 'ph/rio-assets-2/modelos', 'ph/weave'].filter((r) => fs.existsSync(r));
const only = process.argv.slice(2);
const OUT = 'tex/models';
fs.mkdirSync(OUT, { recursive: true });
await MeshoptSimplifier.ready;

// per asset: triangle budget per part for LOD0 / LOD1, texture size
const JOBS = {
  rock_moss_set_01: { lod0: 2400, lod1: 1000, lod2: 300, tex: 1024 },
  rock_moss_set_02: { lod0: 2400, lod1: 1000, lod2: 300, tex: 1024 },
  rock_face_01: { lod0: 6000, lod1: 1200, tex: 1024 },
  rock_face_02: { lod0: 6000, lod1: 1200, tex: 1024 },
  root_cluster_01: { lod0: 5000, lod1: 1000, tex: 512 },
  tree_stump_01: { lod0: 2500, lod1: 600, tex: 512 },
  fern_02: { lod0: 1100, lod1: 340, tex: 512, keep: true },
  shrub_02: { lod0: 1900, lod1: 560, tex: 512, keep: true },
  // pack 2: understorey foliage (alpha cut-outs)
  shrub_01: { lod0: 4200, lod1: 1300, tex: 512, keep: true, split: true },
  shrub_03: { lod0: 1000, lod1: 300, tex: 512, keep: true },
  shrub_04: { lod0: 3000, lod1: 900, tex: 512, keep: true, split: true },
  weed_plant_02: { lod0: 800, lod1: 240, tex: 512, keep: true },
  nettle_plant: { lod0: 900, lod1: 260, tex: 512, keep: true },
  flower_gazania: { lod0: 700, lod1: 200, tex: 512, keep: true },
  grass_medium_02: { lod0: 900, lod1: 300, tex: 512, keep: true },
  moss_01: { lod0: 1500, lod1: 400, tex: 512 },
  // pack 2: pueblo props and bank wood
  planter_pot_clay: { lod0: 1500, lod1: 350, tex: 512 },
  ceramic_pot: { lod0: 1500, lod1: 350, tex: 512 },
  jug_01: { lod0: 1200, lod1: 300, tex: 512 },
  wicker_basket_01: { lod0: 2500, lod1: 600, tex: 512 },
  wooden_bucket_01: { lod0: 1500, lod1: 400, tex: 512 },
  Lantern_01: { lod0: 2000, lod1: 500, tex: 512 },
  painted_wooden_chair_01: { lod0: 1500, lod1: 400, tex: 512 },
  painted_wooden_bench: { lod0: 1500, lod1: 450, tex: 512 },
  wooden_crate_01: { lod0: 900, lod1: 250, tex: 512 },
  modular_wooden_pier: { lod0: 3000, lod1: 800, tex: 1024 },
  dead_tree_trunk: { lod0: 5000, lod1: 1200, tex: 1024 },
  tree_stump_02: { lod0: 2500, lod1: 600, tex: 512 },
  rock_07: { lod0: 2400, lod1: 500, tex: 512 },
  stone_01: { lod0: 2400, lod1: 500, tex: 512 },
  // generated (Weave / Rodin) folk-art sculptures
  catrina_w: { lod0: 24000, lod1: 5000, tex: 1024, mrAO: false, permissive: true },
  catrin_w: { lod0: 24000, lod1: 5000, tex: 1024, mrAO: false, permissive: true },
  alebrije_w: { lod0: 24000, lod1: 5000, tex: 1024, mrAO: false, permissive: true },
  trajinero_w: { lod0: 16000, lod1: 4000, tex: 1024, mrAO: false, permissive: true },
  abuela_w: { lod0: 14000, lod1: 3500, tex: 1024, mrAO: false, permissive: true },
  nina_w: { lod0: 12000, lod1: 3000, tex: 1024, mrAO: false, permissive: true },
};


// keep a random subset of connected triangle islands (leaf cards) until the triangle budget is met
function thinIslands(I, n, target, seed) {
  const par = new Int32Array(n); for (let i = 0; i < n; i++) par[i] = i;
  const find = (a) => { while (par[a] !== a) { par[a] = par[par[a]]; a = par[a]; } return a; };
  for (let t = 0; t < I.length; t += 3) { const a = find(I[t]), b = find(I[t + 1]), c = find(I[t + 2]); par[b] = a; par[find(c)] = a; }
  const isl = new Map();
  for (let t = 0; t < I.length; t += 3) { const r = find(I[t]); if (!isl.has(r)) isl.set(r, []); isl.get(r).push(t); }
  const groups = [...isl.values()];
  // the biggest islands are usually stems/trunks: always keep them
  groups.sort((a, b) => b.length - a.length);
  let r = seed >>> 0;
  const rnd = () => { r = (r * 1664525 + 1013904223) >>> 0; return r / 4294967296; };
  const total = I.length / 3;
  let keepBig = 0;
  while (keepBig < Math.min(3, groups.length) && groups[keepBig].length > total * 0.08 && groups[keepBig].length < target * 0.6) keepBig++;
  let budget = target;
  const out = [];
  groups.forEach((g, k) => { if (k < keepBig) { for (const t of g) out.push(I[t], I[t + 1], I[t + 2]); budget -= g.length; } });
  const rest = groups.slice(keepBig);
  const restTris = rest.reduce((a, g) => a + g.length, 0);
  const p = Math.max(0.05, Math.min(1, budget / Math.max(1, restTris)));
  for (const g of rest) if (rnd() < p) for (const t of g) out.push(I[t], I[t + 1], I[t + 2]);
  return out.length ? out : I;
}

function compact(P, N, T, I) {
  const n = P.length / 3;
  const map = new Int32Array(n).fill(-1); let m = 0;
  for (const v of I) if (map[v] < 0) map[v] = m++;
  const P2 = new Float32Array(m * 3), N2 = new Float32Array(m * 3), T2 = new Float32Array(m * 2);
  for (let v = 0; v < n; v++) { const k = map[v]; if (k < 0) continue; P2.set(P.subarray(v * 3, v * 3 + 3), k * 3); N2.set(N.subarray(v * 3, v * 3 + 3), k * 3); T2.set(T.subarray(v * 2, v * 2 + 2), k * 2); }
  return { P: P2, N: N2, T: T2, I: I.map((v) => map[v]) };
}
// a scan that lays several plants side by side along x in one mesh: cut it into one part per plant
function splitRow(lods) {
  const L0 = lods[0];
  const iv = [];
  for (let t = 0; t < L0.I.length; t += 3) {
    let a = 1e9, b = -1e9;
    for (let k = 0; k < 3; k++) { const x = L0.P[L0.I[t + k] * 3]; a = Math.min(a, x); b = Math.max(b, x); }
    iv.push([a, b]);
  }
  iv.sort((p, q) => p[0] - q[0]);
  const cuts = [];
  let hi = iv[0][1];
  for (const [a, b] of iv) { if (a > hi + 0.012) cuts.push((hi + a) / 2); hi = Math.max(hi, b); }
  const bins = cuts.length + 1;
  const which = (x) => { let k = 0; while (k < cuts.length && x > cuts[k]) k++; return k; };
  const out = Array.from({ length: bins }, () => []);
  for (const L of lods) {
    const tri = Array.from({ length: bins }, () => []);
    for (let t = 0; t < L.I.length; t += 3) {
      const cx = (L.P[L.I[t] * 3] + L.P[L.I[t + 1] * 3] + L.P[L.I[t + 2] * 3]) / 3;
      tri[which(cx)].push(L.I[t], L.I[t + 1], L.I[t + 2]);
    }
    tri.forEach((I, k) => out[k].push(I.length ? compact(L.P, L.N, L.T, I) : null));
  }
  // drop slivers; a missing LOD1 falls back to LOD0
  return out.filter((l) => l[0] && l[0].I.length > 150).map((l) => [l[0], l[1] || l[0]]);
}

const io = new NodeIO();
const index = {};
const old = fs.existsSync(path.join(OUT, 'index.json')) ? JSON.parse(fs.readFileSync(path.join(OUT, 'index.json'))) : {};
for (const [name, job] of Object.entries(JOBS)) {
  if (only.length && !only.includes(name)) { if (old[name]) index[name] = old[name]; continue; }
  const dirs = ROOTS.map((r) => path.join(r, name)).filter((d) => fs.existsSync(d));
  const dir = dirs.find((d) => fs.readdirSync(d).some((f) => f.endsWith('.gltf') || f.endsWith('.glb')));
  if (!dir) { console.log('missing', name); if (old[name]) index[name] = old[name]; continue; }
  const file = fs.readdirSync(dir).filter((f) => f.endsWith('.gltf') || f.endsWith('.glb')).sort()[0];
  const doc = await io.read(path.join(dir, file));
  await doc.transform(weld({ tolerance: 0.0001 }));
  const parts = [], pmat = [];
  const mats = [];
  for (const node of doc.getRoot().listNodes()) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    const M = node.getWorldMatrix();
    for (const prim of mesh.listPrimitives()) {
      const mat = prim.getMaterial();
      let mi = mats.indexOf(mat);
      if (mi < 0) { mats.push(mat); mi = mats.length - 1; }
      if (job.mats && !job.mats.includes(mi)) continue;
      const lods = [];
      for (const [li, target] of [[0, job.lod0], [1, job.lod1]].concat(job.lod2 ? [[2, job.lod2]] : [])) {
        const p = prim.clone();
        const tri = p.getIndices().getCount() / 3;
        const ratio = Math.min(1, target / tri);
        if (ratio < 1 && !job.permissive) simplifyPrimitive(p, { simplifier: MeshoptSimplifier, ratio, error: job.keep ? 0.02 : 0.08, lockBorder: !!job.keep });
        const pos = p.getAttribute('POSITION'), nrm = p.getAttribute('NORMAL'), uv = p.getAttribute('TEXCOORD_0'), idx = p.getIndices();
        const n = pos.getCount();
        const P = new Float32Array(n * 3), N = new Float32Array(n * 3), T = new Float32Array(n * 2);
        const v = [0, 0, 0], w = [0, 0, 0];
        for (let i = 0; i < n; i++) {
          pos.getElement(i, v);
          // bake node transform
          const x = M[0] * v[0] + M[4] * v[1] + M[8] * v[2] + M[12], y = M[1] * v[0] + M[5] * v[1] + M[9] * v[2] + M[13], z = M[2] * v[0] + M[6] * v[1] + M[10] * v[2] + M[14];
          P.set([x, y, z], i * 3);
          nrm.getElement(i, w);
          const nx = M[0] * w[0] + M[4] * w[1] + M[8] * w[2], ny = M[1] * w[0] + M[5] * w[1] + M[9] * w[2], nz = M[2] * w[0] + M[6] * w[1] + M[10] * w[2];
          const l = Math.hypot(nx, ny, nz) || 1;
          N.set([nx / l, ny / l, nz / l], i * 3);
          const t = uv.getElement(i, [0, 0]);
          T.set([t[0], t[1]], i * 2);
        }
        let I = Array.from(idx.getArray());
        // generated meshes carry fragmented UV atlases: every seam is a border, so collapse across seams
        if (job.permissive && I.length / 3 > target) {
          const [out] = MeshoptSimplifier.simplify(new Uint32Array(I), P, 3, Math.floor(target) * 3, 0.05, ['Permissive']);
          I = Array.from(out);
        }
        // foliage made of separate leaf cards cannot be simplified with locked borders: thin out whole islands
        if (job.keep && I.length / 3 > target * 1.25) I = thinIslands(I, n, target, name.length * 31 + li * 7);
        lods.push(compact(P, N, T, I)); // drop vertices no longer referenced
        p.dispose();
      }
      if (job.split) for (const sub of splitRow(lods)) { parts.push(sub); pmat.push(mi); }
      else { parts.push(lods); pmat.push(mi); }
    }
  }
  // bounds over all parts (LOD0)
  let mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9], tmn = [1e9, 1e9], tmx = [-1e9, -1e9];
  for (const lods of parts) for (const L of lods) {
    for (let i = 0; i < L.P.length; i += 3) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], L.P[i + k]); mx[k] = Math.max(mx[k], L.P[i + k]); }
    for (let i = 0; i < L.T.length; i += 2) for (let k = 0; k < 2; k++) { tmn[k] = Math.min(tmn[k], L.T[i + k]); tmx[k] = Math.max(tmx[k], L.T[i + k]); }
  }
  // binary: per part per lod: [nVerts u32][nIdx u32] pos int16x3, nrm int8x3(+pad), uv uint16x2, idx u16|u32
  const chunks = [];
  const meta = { parts: [], pmat, bmin: mn, bmax: mx, tmin: tmn, tmax: tmx };
  let off = 0;
  const push = (buf) => { chunks.push(Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength)); const o = off; off += buf.byteLength; return o; };
  const align4 = () => { const pad = (4 - (off % 4)) % 4; if (pad) { chunks.push(Buffer.alloc(pad)); off += pad; } };
  for (const lods of parts) {
    const pm = [];
    for (const L of lods) {
      const n = L.P.length / 3;
      const qp = new Int16Array(n * 4), qn = new Int8Array(n * 4), qt = new Uint16Array(n * 2);
      for (let i = 0; i < n; i++) {
        for (let k = 0; k < 3; k++) qp[i * 4 + k] = Math.round(((L.P[i * 3 + k] - mn[k]) / Math.max(mx[k] - mn[k], 1e-6)) * 65535 - 32768);
        for (let k = 0; k < 3; k++) qn[i * 4 + k] = Math.round(L.N[i * 3 + k] * 127);
        for (let k = 0; k < 2; k++) qt[i * 2 + k] = Math.round(((L.T[i * 2 + k] - tmn[k]) / Math.max(tmx[k] - tmn[k], 1e-6)) * 65535);
      }
      const big = n > 65535;
      const qi = big ? new Uint32Array(L.I) : new Uint16Array(L.I);
      align4();
      const e = { n, ni: L.I.length, big, p: push(qp), nr: push(qn), t: push(qt) };
      align4();
      e.i = push(qi);
      pm.push(e);
    }
    meta.parts.push(pm);
  }
  fs.writeFileSync(path.join(OUT, name + '.bin'), Buffer.concat(chunks));
  // textures per material: diffuse (+AO, + alpha from the separate Poly Haven alpha map), normal (+roughness in alpha)
  const tdirs = dirs.map((d) => path.join(d, 'textures')).filter((d) => fs.existsSync(d));
  const locate = (f) => { for (const d of tdirs) if (fs.existsSync(path.join(d, f))) return path.join(d, f); return null; };
  const any = (k, stem) => { for (const d of tdirs) { const f = fs.readdirSync(d).find((x) => x.includes(stem) && x.includes('_' + k + '_')); if (f) return path.join(d, f); } return null; };
  const py = `
import sys
from PIL import Image, ImageFilter
import numpy as np
s, out = int(sys.argv[1]), sys.argv[2]
diff, nor, arm, rough, alph = sys.argv[3:8]
mr_ao = sys.argv[8] == '1'
def L(f, mode): return np.asarray(Image.open(f).convert(mode).resize((s, s), Image.LANCZOS)).astype(np.float32) / 255
c = L(diff, 'RGB')
if arm != '-':
    a = L(arm, 'RGB'); ao = a[..., 0] if mr_ao else np.ones(c.shape[:2], np.float32); r = a[..., 1]
elif rough != '-':
    ao = np.ones(c.shape[:2], np.float32); r = L(rough, 'L')
else:
    ao = np.ones(c.shape[:2], np.float32); r = np.full(c.shape[:2], 0.8, np.float32)
c *= (0.45 + 0.55 * ao)[..., None]
if alph != '-':
    al = L(alph, 'L')
    # bleed leaf colour into the cut-out area so mip levels do not pick up dark fringes
    m = (al > 0.5).astype(np.float32)
    fill = c.copy(); have = m.copy()
    for rad in (2, 6, 18, 48):
        num = np.stack([np.asarray(Image.fromarray((c[..., k] * m * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(rad))).astype(np.float32) / 255 for k in range(3)], -1)
        den = np.asarray(Image.fromarray((m * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(rad))).astype(np.float32) / 255
        ok = (den > 0.02) & (have < 0.5)
        fill[ok] = num[ok] / den[ok][..., None]
        have[ok] = 1
    c = np.where(m[..., None] > 0.5, c, fill)
    rgb = (np.clip(c, 0, 1) * 255 + 0.5).astype(np.uint8)
    Image.fromarray(np.dstack([rgb, (al * 255 + 0.5).astype(np.uint8)]), 'RGBA').save(out + '_c.webp', quality=82, alpha_quality=90, method=6)
else:
    rgb = (np.clip(c, 0, 1) * 255 + 0.5).astype(np.uint8)
    Image.fromarray(rgb, 'RGB').save(out + '_c.webp', quality=80, method=6)
n = (L(nor, 'RGB') * 255 + 0.5).astype(np.uint8) if nor != '-' else np.dstack([np.full((s, s), 128, np.uint8), np.full((s, s), 128, np.uint8), np.full((s, s), 255, np.uint8)])
Image.fromarray(np.dstack([n, (r * 255 + 0.5).astype(np.uint8)]), 'RGBA').save(out + '_n.webp', quality=82, alpha_quality=60, method=6)
print('alpha' if alph != '-' else 'opaque')
`;
  const used = [...new Set(pmat)];
  const remap = {};
  const res = [];
  used.forEach((mi, k) => {
    remap[mi] = k;
    const m = mats[mi];
    // embedded (GLB) textures are written out next to the output so the converter can read them
    const emb = (t, tag) => {
      if (!t || t.getURI() || !t.getImage()) return null;
      const ext = (t.getMimeType() || 'image/png').split('/')[1].replace('jpeg', 'jpg');
      const f = path.join(OUT, '_tmp_' + name + '_' + k + '_' + tag + '.' + ext);
      fs.writeFileSync(f, Buffer.from(t.getImage()));
      return f;
    };
    const uri = (t) => (t && t.getURI() ? path.basename(t.getURI()) : null);
    const bt = m && m.getBaseColorTexture(), nt = m && m.getNormalTexture(), mt = m && m.getMetallicRoughnessTexture();
    const dF = uri(bt), nF = uri(nt), aF = uri(mt);
    const diff = emb(bt, 'c') || (dF && locate(dF)) || any('diff', name);
    const nor = emb(nt, 'n') || (nF && locate(nF.replace('_nor_dx_', '_nor_gl_'))) || (nF && locate(nF)) || any('nor_gl', name) || '-';
    const arm = emb(mt, 'mr') || (aF && locate(aF)) || any('arm', name);
    const stem = path.basename(diff).replace(/_diff(use)?_.*$/, '');
    const alpha = job.alpha === false ? null : any('alpha', stem);
    const outp = path.join(OUT, name + (k ? '_m' + k : ''));
    res.push(execFileSync('python3', ['-c', py, String(job.tex), outp, diff, nor, arm || '-', '-', alpha || '-', job.mrAO === false ? '0' : '1']).toString().trim());
    for (const f of fs.readdirSync(OUT)) if (f.startsWith('_tmp_' + name + '_')) fs.unlinkSync(path.join(OUT, f));
  });
  meta.pmat = pmat.map((mi) => remap[mi]);
  meta.nmat = used.length;
  const resStr = res.join(',');
  meta.alpha = res.includes('alpha');
  index[name] = meta;
  const kb = (f) => Math.round(fs.statSync(path.join(OUT, f)).size / 1024);
  console.log(name, 'parts', parts.length, 'tris L0', parts.reduce((a, l) => a + l[0].I.length / 3, 0), 'L1', parts.reduce((a, l) => a + l[1].I.length / 3, 0), 'bin', kb(name + '.bin') + 'k', 'tex', kb(name + '_c.webp') + 'k+' + kb(name + '_n.webp') + 'k', 'mats', used.length, resStr);
}
fs.writeFileSync(path.join(OUT, 'index.json'), JSON.stringify(index));
