import sys, math
import numpy as np
from lib import *

N = 1024
rng0 = np.random.default_rng(7)


def pebbles(n=N, seed=11, name='pebbles'):
    sand = fbm(n, 1.1, seed) * 0.6 + fbm(n, 2.6, seed + 1) * 0.4
    H = sand * 0.08
    sandcol = lerp(hexc('#6f675c'), hexc('#8d8373'), sand)
    C = sandcol.copy()
    AOm = np.ones((n, n))
    grain = fbm(n, 0.6, seed + 9)
    for li, (count, hs, sd) in enumerate([(70, 1.0, 3), (220, 0.62, 5), (620, 0.38, 8), (1600, 0.22, 13)]):
        F1, F2, idx, pts = voronoi(n, count, seed + sd, grid=True, jitter=0.95)
        wn = fbm(n, 2.2, seed + sd + 50)
        wn2 = fbm(n, 2.2, seed + sd + 51)
        cell = n / math.sqrt(count)
        r = np.random.default_rng(seed + sd)
        rad = cell * (0.38 + 0.2 * r.random(idx.max() + 1))[idx]
        dist = F1 + (wn - 0.5) * cell * 0.35
        edge = (F2 - F1) * 0.5
        t = np.clip(1 - (dist / rad) ** 2, 0, 1)
        dome = np.sqrt(t) * smooth(0, cell * 0.06, edge)
        flat = 0.7 + 0.6 * r.random(idx.max() + 1)[idx]
        height = np.minimum(dome * flat, 1.0) * hs * (0.75 + 0.25 * r.random(idx.max() + 1)[idx])
        col = palette_pick(idx, ['#8f8a84', '#77726c', '#a8a094', '#5c5854', '#a18b76', '#bdb5aa', '#7f6c5d', '#4a4541', '#98785f', '#c9c2b6', '#6b6e6c'], seed + sd)
        spk = fbm(n, 0.3, seed + sd + 70)
        veins = np.abs(fbm(n, 1.8, seed + sd + 80) - 0.5) < 0.012
        col = col * (0.86 + 0.28 * spk[..., None])
        col = np.where(veins[..., None] & (r.random(idx.max() + 1)[idx] > 0.7)[..., None], col * 0.6 + 0.4 * hexc('#e8e2d8'), col)
        col = col * (0.72 + 0.28 * np.sqrt(np.clip(dome, 0, 1)))[..., None]
        m = height > H
        H = np.where(m, height, H)
        C = np.where(m[..., None], col, C)
    ao = ao_from_height(H, 5)
    C = C * (0.55 + 0.45 * ao)[..., None]
    C = C * (0.94 + 0.12 * grain[..., None])
    save_rgb(name + '_c', srgb_dither(C))
    save_rgb(name + '_n', normal_map(blur_wrap(H, 0.7), 26.0))


def rock(n=N, seed=21, name='rock'):
    w1 = fbm(n, 2.4, seed + 1)
    w2 = fbm(n, 2.4, seed + 2)
    base = warp(fbm(n, 2.0, seed), w1, w2, 120)
    ridged = 1 - np.abs(2 * warp(fbm(n, 1.7, seed + 3), w2, w1, 60) - 1)
    yy = np.mgrid[0:n, 0:n][0] / n
    strata = np.sin((yy * 18 + base * 3.0) * math.pi * 2) * 0.5 + 0.5
    F1, F2, idx, _ = voronoi(n, 40, seed + 4)
    F1b, F2b, _, _ = voronoi(n, 160, seed + 5)
    crack = np.exp(-((F2 - F1) / 3.0) ** 2) * 0.9 + np.exp(-((F2b - F1b) / 1.8) ** 2) * 0.35
    crack = warp(crack, w1, w2, 24)
    fine = fbm(n, 0.9, seed + 6)
    H = base * 0.5 + ridged * 0.3 + strata * 0.08 + fine * 0.12 - crack * 0.35
    H = norm01(H)
    c1, c2, c3 = hexc('#5f5a54'), hexc('#8a8378'), hexc('#a59c8e')
    C = lerp(c1, c2, smooth(0.2, 0.7, H))
    C = lerp(C, c3, smooth(0.65, 0.95, ridged * 0.6 + fine * 0.4) * 0.6)
    tint = fbm(n, 2.2, seed + 7)
    C = C * lerp(hexc('#b0a090') / 0.62, hexc('#9aa0a0') / 0.62, tint)[...] * 0.62
    lich = fbm(n, 1.4, seed + 8)
    lich2 = fbm(n, 0.8, seed + 9)
    lm = smooth(0.62, 0.72, lich) * smooth(0.35, 0.6, lich2)
    C = lerp(C, hexc('#a7a57a') * (0.8 + 0.3 * lich2[..., None]), lm * 0.85)
    om = smooth(0.8, 0.86, fbm(n, 0.7, seed + 10)) * smooth(0.5, 0.7, lich)
    C = lerp(C, hexc('#b8783c'), om * 0.8)
    wm = smooth(0.78, 0.84, fbm(n, 1.2, seed + 11))
    C = lerp(C, hexc('#d6d2c6'), wm * 0.5)
    C = C * (1 - crack * 0.55)[..., None]
    ao = ao_from_height(H, 8)
    C = C * (0.6 + 0.4 * ao)[..., None]
    save_rgb(name + '_c', srgb_dither(C))
    save_rgb(name + '_n', normal_map(H, 14.0))


def soil(n=N, seed=31, name='soil'):
    streak = fbm(n, 1.8, seed, ax=1.0, ay=0.18)
    base = fbm(n, 2.0, seed + 1)
    fine = fbm(n, 0.8, seed + 2)
    H = base * 0.4 + streak * 0.35 + fine * 0.25
    C = lerp(hexc('#553a2b'), hexc('#83603f'), smooth(0.2, 0.8, base * 0.6 + streak * 0.4))
    C = lerp(C, hexc('#9a7a58'), smooth(0.7, 0.9, fine) * 0.4)
    F1, F2, idx, _ = voronoi(n, 900, seed + 3)
    rr = np.random.default_rng(seed)
    keep = (rr.random(idx.max() + 1) > 0.55)[idx]
    rad = (2 + 5 * rr.random(idx.max() + 1))[idx]
    peb = np.sqrt(np.clip(1 - (F1 / rad) ** 2, 0, 1)) * keep
    pc = palette_pick(idx, ['#8a847c', '#6d6760', '#a09484', '#5a524a'], seed + 4)
    H = np.maximum(H, peb * 0.9 + H * 0.2)
    C = lerp(C, pc * (0.7 + 0.3 * peb[..., None]), (peb > 0.05) * 1.0)
    im = Image.fromarray((np.clip(C, 0, 1) * 255).astype(np.uint8))
    d = ImageDraw.Draw(im)
    hm = Image.fromarray((H * 255).astype(np.uint8))
    dh = ImageDraw.Draw(hm)
    for i in range(70):
        x, y = rr.random() * n, rr.random() * n
        ang = rr.random() * math.pi * 2
        pts = []
        L = 40 + rr.random() * 200
        w = 1 + rr.random() * 3
        for k in range(24):
            ang += (rr.random() - 0.5) * 0.5
            x += math.cos(ang) * L / 24
            y += math.sin(ang) * L / 24
            pts.append((x, y))
        for ox in (-n, 0, n):
            for oy in (-n, 0, n):
                p2 = [(a + ox, b + oy) for a, b in pts]
                d.line(p2, fill=(58, 40, 28), width=int(w))
                dh.line(p2, fill=200, width=int(w))
    C = np.asarray(im).astype(np.float32) / 255
    H = np.asarray(hm).astype(np.float32) / 255
    ao = ao_from_height(H, 6)
    C = C * (0.65 + 0.35 * ao)[..., None]
    save_rgb(name + '_c', srgb_dither(C))
    save_rgb(name + '_n', normal_map(blur_wrap(H, 0.8), 10.0))


def strokes_layer(n, count, colors, lmin, lmax, wmin, wmax, seed, angle_bias=None, bg=None, hbg=None, curved=0.3, jit=0.9):
    rr = np.random.default_rng(seed)
    im = Image.fromarray((np.clip(bg, 0, 1) * 255).astype(np.uint8)) if bg is not None else Image.new('RGB', (n, n))
    hm = Image.fromarray((np.clip(hbg, 0, 1) * 255).astype(np.uint8)) if hbg is not None else Image.new('L', (n, n))
    d = ImageDraw.Draw(im)
    dh = ImageDraw.Draw(hm)
    cols = [hexc(c) for c in colors]
    for i in range(count):
        x, y = rr.random() * n, rr.random() * n
        ang = rr.random() * math.pi * 2 if angle_bias is None else angle_bias + (rr.random() - 0.5) * jit
        L = lmin + rr.random() * (lmax - lmin)
        w = wmin + rr.random() * (wmax - wmin)
        c = cols[rr.integers(len(cols))] * (0.8 + rr.random() * 0.4)
        bend = (rr.random() - 0.5) * curved
        pts = []
        px, py = x, y
        for k in range(5):
            pts.append((px, py))
            px += math.cos(ang) * L / 4
            py += math.sin(ang) * L / 4
            ang += bend
        hv = int(120 + rr.random() * 135)
        colt = tuple(int(v * 255) for v in np.clip(c, 0, 1))
        near = x < lmax or y < lmax or x > n - lmax or y > n - lmax
        offs = [(-n, -n), (-n, 0), (-n, n), (0, -n), (0, 0), (0, n), (n, -n), (n, 0), (n, n)] if near else [(0, 0)]
        for ox, oy in offs:
            p2 = [(a + ox, b + oy) for a, b in pts]
            d.line(p2, fill=colt, width=max(1, int(round(w))))
            dh.line(p2, fill=hv, width=max(1, int(round(w))))
    return np.asarray(im).astype(np.float32) / 255, np.asarray(hm).astype(np.float32) / 255


def ground(n=N, seed=41, name='ground'):
    base = fbm(n, 2.0, seed)
    soilc = lerp(hexc('#4d3b2a'), hexc('#6b5238'), base)
    patch = fbm(n, 2.2, seed + 5)
    C, H = strokes_layer(n, 30000, ['#5e6b30', '#6e7a35', '#7f8740', '#8f8a45', '#a2914e', '#b09a58', '#6a5a33', '#556329'], 8, 26, 1.2, 2.6, seed + 1, bg=soilc, hbg=base * 0.3)
    C2, H2 = strokes_layer(n, 14000, ['#98a04c', '#b6a860', '#c7b36a', '#7c8a3c', '#8b7a45'], 6, 16, 1.0, 2.0, seed + 2, bg=C, hbg=H)
    dry = smooth(0.45, 0.75, patch)
    C = lerp(C, C2, 0.6)
    C = lerp(C, C * np.array([1.12, 1.0, 0.78]), dry)
    H = np.maximum(H, H2 * 0.9)
    ao = ao_from_height(H, 3)
    C = C * (0.7 + 0.3 * ao)[..., None]
    save_rgb(name + '_c', srgb_dither(C))
    save_rgb(name + '_n', normal_map(blur_wrap(H, 0.6), 5.0))


def forest_floor(n=N, seed=51, name='forest'):
    base = fbm(n, 2.0, seed)
    soilc = lerp(hexc('#2e2219'), hexc('#4a3626'), base)
    C, H = strokes_layer(n, 26000, ['#7a5a3a', '#8e6a44', '#a07a4c', '#6a4a30', '#b08858', '#5c4028'], 20, 44, 0.8, 1.4, seed + 1, bg=soilc, hbg=base * 0.2, curved=0.12)
    rr = np.random.default_rng(seed + 2)
    im = Image.fromarray((C * 255).astype(np.uint8))
    hm = Image.fromarray((H * 255).astype(np.uint8))
    d, dh = ImageDraw.Draw(im), ImageDraw.Draw(hm)
    leafcols = ['#7b5530', '#8f6636', '#a3743a', '#6e4a2a', '#5f5a2e', '#7d7036']
    for i in range(2600):
        x, y = rr.random() * n, rr.random() * n
        L = 14 + rr.random() * 16
        W = L * (0.35 + rr.random() * 0.15)
        pts = leaf_poly(x, y, L, W, rr.random() * 6.28)
        c = hexc(leafcols[rr.integers(len(leafcols))]) * (0.8 + rr.random() * 0.4)
        for ox in (-n, 0, n):
            for oy in (-n, 0, n):
                p2 = [(a + ox, b + oy) for a, b in pts]
                d.polygon(p2, fill=tuple(int(v * 255) for v in np.clip(c, 0, 1)))
                dh.polygon(p2, fill=int(170 + rr.random() * 80))
    C = np.asarray(im).astype(np.float32) / 255
    H = np.asarray(hm).astype(np.float32) / 255
    ao = ao_from_height(H, 4)
    C = C * (0.6 + 0.4 * ao)[..., None]
    save_rgb(name + '_c', srgb_dither(C))
    save_rgb(name + '_n', normal_map(blur_wrap(H, 0.7), 6.0))


def cobbles(n=N, seed=61, name='cobble'):
    F1, F2, idx, _ = voronoi(n, 196, seed, grid=True, jitter=0.7)
    wn = fbm(n, 2.4, seed + 1)
    cell = n / 14
    edge = (F2 - F1) * 0.5 + (wn - 0.5) * 8
    rr0 = np.random.default_rng(seed + 9)
    rad = cell * (0.36 + 0.12 * rr0.random(idx.max() + 1))[idx]
    dome = np.sqrt(smooth(3.0, cell * 0.32, edge)) * (0.85 + 0.15 * np.clip(1 - (F1 / rad) ** 2, 0, 1))
    dome = np.sqrt(dome) * (0.8 + 0.2 * fbm(n, 1.2, seed + 2))
    col = palette_pick(idx, ['#5a5550', '#6c665f', '#4a4642', '#7b746a', '#57524c', '#3e3b38', '#86796a'], seed + 3)
    spk = fbm(n, 0.4, seed + 4)
    col = col * (0.85 + 0.3 * spk[..., None]) * (0.7 + 0.3 * dome[..., None])
    earth = lerp(hexc('#3b2d22'), hexc('#5a4632'), fbm(n, 1.5, seed + 5))
    grassbits = smooth(0.6, 0.75, fbm(n, 1.0, seed + 6))
    earth = lerp(earth, hexc('#5f6a30'), grassbits * 0.7)
    m = smooth(0.02, 0.12, dome)
    C = lerp(earth, col, m)
    H = dome
    ao = ao_from_height(H, 6)
    C = C * (0.55 + 0.45 * ao)[..., None]
    save_rgb(name + '_c', srgb_dither(C))
    save_rgb(name + '_n', normal_map(blur_wrap(H, 0.8), 16.0))


def ashlar_layout(n, rows_px, len_range, seed):
    rr = np.random.default_rng(seed)
    rows = []
    y = 0
    while y < n:
        h = rows_px[rr.integers(len(rows_px))]
        if n - y - h < min(rows_px):
            h = n - y
        rows.append((y, h))
        y += h
    bid = np.zeros((n, n), np.int32)
    ex = np.zeros((n, n), np.float32)
    ey = np.zeros((n, n), np.float32)
    lx = np.zeros((n, n), np.float32)
    ly = np.zeros((n, n), np.float32)
    bw = np.zeros((n, n), np.float32)
    bh = np.zeros((n, n), np.float32)
    k = 0
    xs = np.arange(n)
    for (y0, h) in rows:
        lens = []
        tot = 0
        while tot < n:
            L = int(len_range[0] + rr.random() * (len_range[1] - len_range[0]))
            if n - tot - L < len_range[0]:
                L = n - tot
            lens.append(L)
            tot += L
        off = int(rr.random() * n)
        starts = np.cumsum([0] + lens[:-1])
        for s, L in zip(starts, lens):
            xx = (xs - off - s) % n
            m = xx < L
            for yy in range(y0, y0 + h):
                row = bid[yy]
                row[m] = k
                lx[yy, m] = xx[m]
                bw[yy, m] = L
                ly[yy, m] = yy - y0
                bh[yy, m] = h
            k += 1
    ex = np.minimum(lx, bw - 1 - lx)
    ey = np.minimum(ly, bh - 1 - ly)
    return bid, np.minimum(ex, ey), lx, ly, bw, bh


def cantera(n=N, seed=71, name='cantera'):
    bid, e, lx, ly, bw, bh = ashlar_layout(n, [150, 170, 196, 214, 240], (260, 560), seed)
    chip = fbm(n, 1.4, seed + 1)
    chip2 = fbm(n, 0.8, seed + 2)
    ee = e - 1.4 + (chip - 0.5) * 6 + (chip2 - 0.5) * 3
    face = smooth(0, 9, ee)
    rr = np.random.default_rng(seed)
    tilt = (rr.random(bid.max() + 1) - 0.5)[bid] * 0.06
    fb = fbm(n, 1.9, seed + 3)
    H = face * (0.85 + 0.1 * fb + tilt * (lx / np.maximum(bw, 1) - 0.5)) + face * 0.05 * fbm(n, 0.7, seed + 4)
    tool = np.sin(lx * 0.9 + ly * 0.35 + fb * 6) * 0.5 + 0.5
    H = H + face * tool * 0.012
    col = palette_pick(bid, ['#c8a795', '#c4a391', '#caab99', '#c0a08f', '#c9a894', '#c3a492', '#ceb09e', '#c5a593', '#c7a794', '#c1a292'], seed + 5)
    grain = fbm(n, 0.5, seed + 6)
    pores = (np.random.default_rng(seed + 7).random((n, n)) > 0.994).astype(np.float32)
    pores = blur_wrap(pores, 0.6) * 3
    col = col * (0.9 + 0.2 * grain[..., None]) * (1 - np.clip(pores, 0, 0.5)[..., None] * 0.6)
    blot = fbm(n, 2.1, seed + 8)
    col = lerp(col, col * np.array([0.86, 0.84, 0.86]), smooth(0.4, 0.85, blot))
    col = col * (0.93 + 0.14 * fbm(n, 1.4, seed + 12))[..., None]
    streak = fbm(n, 1.6, seed + 9, ax=1.0, ay=0.15)
    col = col * (1 - smooth(0.5, 0.9, streak)[..., None] * 0.35)
    big = fbm(n, 2.4, seed + 13)
    col = col * (0.85 + 0.3 * big[..., None])
    lich = smooth(0.78, 0.85, fbm(n, 0.9, seed + 10))
    col = lerp(col, hexc('#c8c6b2'), lich * 0.6)
    mort = lerp(hexc('#a89c8a'), hexc('#938676'), fbm(n, 1.0, seed + 11))
    C = lerp(mort * 0.8, col, smooth(0.0, 0.3, face))
    edge_dark = smooth(0.2, 0.9, face)
    C = C * (0.86 + 0.14 * edge_dark)[..., None]
    save_rgb(name + '_c', srgb_dither(C))
    save_rgb(name + '_n', normal_map(blur_wrap(H, 0.6), 9.0))
    return


def braza(n=N, seed=81, name='braza'):
    w1, w2 = fbm(n, 2.3, seed), fbm(n, 2.3, seed + 1)
    F1, F2, idx, _ = voronoi(n, 70, seed + 2, grid=True, jitter=1.0, aspect=1.35)
    F1 = warp(F1, w1, w2, 50)
    F2 = warp(F2, w1, w2, 50)
    idx = warp(idx.astype(np.float32), w1, w2, 50)
    idx = np.round(idx).astype(np.int32) % 71
    edge = (F2 - F1) * 0.5
    Fs1, Fs2, idxs, _ = voronoi(n, 500, seed + 3)
    small = np.sqrt(np.clip(1 - (Fs1 / 9) ** 2, 0, 1)) * 0.55
    stone = smooth(3, 26, edge)
    stone = np.power(stone, 0.6)
    rough = fbm(n, 1.7, seed + 4)
    H = np.maximum(stone * (0.85 + 0.25 * rough), small * (edge < 10))
    col = palette_pick(idx, ['#5b544d', '#4b4640', '#6c6258', '#3f3b37', '#76695b', '#57504a', '#665e55', '#80766a'], seed + 5)
    colS = palette_pick(idxs, ['#6a625a', '#4f4943', '#7b7064'], seed + 6)
    col = np.where((H == small * (edge < 10))[..., None] & (small > 0.01)[..., None], colS, col)
    col = col * (0.82 + 0.35 * rough[..., None])
    lich = smooth(0.7, 0.8, fbm(n, 1.0, seed + 7)) * stone
    col = lerp(col, hexc('#a3a27e'), lich * 0.55)
    gap = hexc('#1e1a17')
    C = lerp(gap, col, smooth(0.0, 0.3, H))
    ao = ao_from_height(H, 10)
    C = C * (0.5 + 0.5 * ao)[..., None]
    save_rgb(name + '_c', srgb_dither(C))
    save_rgb(name + '_n', normal_map(blur_wrap(H, 0.8), 14.0))


def plaster(n=N, seed=91, name='plaster'):
    p1 = fbm(n, 2.2, seed)
    p2 = fbm(n, 1.8, seed + 1)
    tint = lerp(hexc('#ece3d2'), hexc('#dcc49e'), smooth(0.35, 0.8, p1))
    tint = lerp(tint, hexc('#e6cbb8'), smooth(0.6, 0.9, p2) * 0.5)
    trowel = fbm(n, 1.0, seed + 2, ax=1.0, ay=0.5)
    flake_n = warp(fbm(n, 2.0, seed + 3), p1, p2, 40)
    flake = smooth(0.74, 0.76, flake_n)
    under = lerp(hexc('#8e7a66'), hexc('#a6927b'), fbm(n, 0.9, seed + 4))
    C = lerp(tint * (0.95 + 0.08 * trowel[..., None]), under, flake)
    rim = smooth(0.70, 0.745, flake_n) * (1 - flake)
    C = C * (1 - rim[..., None] * 0.15)
    streak = fbm(n, 1.5, seed + 5, ax=1.0, ay=0.12)
    sm = smooth(0.55, 0.85, streak) * smooth(0.4, 0.7, p2)
    C = lerp(C, C * np.array([0.72, 0.72, 0.66]), sm * 0.6)
    H = (1 - flake) * 0.6 + trowel * 0.2 + fbm(n, 0.6, seed + 6) * 0.1 + flake * fbm(n, 0.8, seed + 7) * 0.3
    save_rgb(name + '_c', srgb_dither(C))
    save_rgb(name + '_n', normal_map(blur_wrap(H, 0.8), 6.0))


def talavera(n=N, seed=101, name='talavera'):
    T = 128
    ss = 2
    im = Image.new('RGB', (n * ss, n * ss), (238, 232, 218))
    d = ImageDraw.Draw(im)
    cob = (31, 62, 140)
    cob2 = (58, 98, 178)
    yel = (222, 164, 52)
    grn = (60, 122, 76)
    rr = np.random.default_rng(seed)
    for ty in range(n // T):
        for tx in range(n // T):
            x0, y0 = tx * T * ss, ty * T * ss
            s = T * ss
            c = (x0 + s / 2, y0 + s / 2)
            kind = (tx + ty) % 2
            if kind == 0:
                for k in range(4):
                    a = k * math.pi / 2 + math.pi / 4
                    px, py = c[0] + math.cos(a) * s * 0.22, c[1] + math.sin(a) * s * 0.22
                    d.ellipse([px - s * 0.16, py - s * 0.16, px + s * 0.16, py + s * 0.16], fill=cob)
                    d.ellipse([px - s * 0.08, py - s * 0.08, px + s * 0.08, py + s * 0.08], fill=cob2)
                d.ellipse([c[0] - s * 0.09, c[1] - s * 0.09, c[0] + s * 0.09, c[1] + s * 0.09], fill=yel)
                for k in range(4):
                    a = k * math.pi / 2
                    px, py = c[0] + math.cos(a) * s * 0.42, c[1] + math.sin(a) * s * 0.42
                    pts = leaf_poly(px - math.cos(a) * s * 0.1, py - math.sin(a) * s * 0.1, s * 0.16, s * 0.05, a)
                    d.polygon(pts, fill=grn)
            else:
                pts = []
                for k in range(16):
                    a = k * math.pi / 8
                    r = s * (0.44 if k % 2 == 0 else 0.2)
                    pts.append((c[0] + math.cos(a) * r, c[1] + math.sin(a) * r))
                d.polygon(pts, fill=cob)
                d.ellipse([c[0] - s * 0.14, c[1] - s * 0.14, c[0] + s * 0.14, c[1] + s * 0.14], fill=(238, 232, 218))
                d.ellipse([c[0] - s * 0.08, c[1] - s * 0.08, c[0] + s * 0.08, c[1] + s * 0.08], fill=yel)
                for k in range(4):
                    a = k * math.pi / 2 + math.pi / 4
                    px, py = c[0] + math.cos(a) * s * 0.5, c[1] + math.sin(a) * s * 0.5
                    d.pieslice([px - s * 0.22, py - s * 0.22, px + s * 0.22, py + s * 0.22], 0, 360, fill=cob2)
    im = im.resize((n, n), Image.LANCZOS)
    C = np.asarray(im).astype(np.float32) / 255
    blur = blur_wrap(C, 1.2)
    C = lerp(C, blur, 0.5)
    yy, xx = np.mgrid[0:n, 0:n]
    lx, ly = xx % T, yy % T
    e = np.minimum(np.minimum(lx, T - 1 - lx), np.minimum(ly, T - 1 - ly)).astype(np.float32)
    face = smooth(1, 6, e)
    wav = fbm(n, 2.0, seed + 1)
    H = face * (0.9 + 0.1 * wav)
    tv = (rr.random((n // T, n // T)) - 0.5)
    tv = np.kron(tv, np.ones((T, T)))
    C = C * (1 + tv[..., None] * 0.08)
    grout = hexc('#b7ae9e')
    C = lerp(grout * 0.8, C, smooth(0, 0.4, face))
    save_rgb(name + '_c', srgb_dither(C))
    save_rgb(name + '_n', normal_map(blur_wrap(H, 0.6), 6.0))


def planks(n=N, seed=111, name='planks'):
    boards = 6
    bh = n / boards
    yy, xx = np.mgrid[0:n, 0:n].astype(np.float32)
    b = np.minimum((yy // bh).astype(np.int32), boards - 1)
    ly = yy - b * bh
    rr = np.random.default_rng(seed)
    grain_lo = fbm(n, 1.6, seed, ax=0.08, ay=1.0)
    grain_hi = fbm(n, 1.0, seed + 1, ax=0.05, ay=1.0)
    warpn = fbm(n, 2.4, seed + 2)
    offs = rr.random(boards)[b] * 40
    wx = fbm(n, 2.2, seed + 7, ax=0.12, ay=1.0)
    rings = np.sin((ly + offs + wx * 60 + grain_lo * 14) * 0.7) * 0.5 + 0.5
    rings = rings ** 6
    H = grain_hi * 0.5 + rings * 0.3 + grain_lo * 0.2
    edge = np.minimum(ly, bh - 1 - ly)
    seam = smooth(0, 4, edge)
    H = H * 0.3 + seam * 0.7
    C = lerp(hexc('#9a7654'), hexc('#5a3e28'), rings * 0.7 + grain_lo * 0.3)
    C = C * (0.92 + 0.12 * grain_hi[..., None])
    C, Hg = strokes_layer(n, 900, ['#6e4d33', '#77553a', '#9a7753', '#7d5a3c', '#654630'], 150, 600, 1.0, 1.8, seed + 8, angle_bias=0.0, bg=C, hbg=H * 0.5, curved=0.01, jit=0.03)
    H = np.maximum(H, Hg * 0.6)
    weather = fbm(n, 2.0, seed + 3)
    C = lerp(C, hexc('#8a8278'), smooth(0.4, 0.8, weather) * 0.45)
    bt = (rr.random(boards) - 0.5)[b] * 0.14
    C = C * (1 + bt[..., None])
    C = C * (0.55 + 0.45 * seam[..., None])
    nails = np.zeros((n, n))
    for bi in range(boards):
        for nx in (60, 60 + n // 2):
            for ny in (bh * 0.3, bh * 0.7):
                cx, cy = nx + rr.random() * 8, bi * bh + ny
                d2 = (xx - cx) ** 2 + (yy - cy) ** 2
                nails = np.maximum(nails, np.exp(-d2 / 14))
    C = lerp(C, hexc('#2f2a26'), np.clip(nails * 1.4, 0, 1))
    H = H + nails * 0.4
    chip = fbm(n, 1.5, seed + 4)
    chip2 = fbm(n, 0.7, seed + 5)
    paint = 1 - smooth(0.62, 0.66, chip * 0.8 + chip2 * 0.2 + (1 - seam) * 0.5)
    paint = paint * (1 - np.clip(nails * 2, 0, 1))
    rgba = np.concatenate([C, paint[..., None]], -1)
    save_rgba(name + '_c', rgba)
    Hp = H + paint * 0.08
    save_rgb(name + '_n', normal_map(blur_wrap(Hp, 0.7), 7.0))


def bark_fibrous(n=N, seed=121, name='bark'):
    w = fbm(n, 2.4, seed + 9)
    f1 = fbm(n, 1.4, seed, ax=1.0, ay=0.06)
    f2 = fbm(n, 0.9, seed + 1, ax=1.0, ay=0.04)
    f1 = warp(f1, w, fbm(n, 2.4, seed + 10), 40)
    ridg = 1 - np.abs(2 * f1 - 1)
    fiss = smooth(0.0, 0.35, ridg)
    blob = fbm(n, 2.0, seed + 2)
    H = fiss * 0.6 + f2 * 0.25 + blob * 0.15
    base = lerp(hexc('#4b3528'), hexc('#7a5c47'), smooth(0.2, 0.9, H))
    grey = lerp(hexc('#6e655c'), hexc('#9b9185'), f2)
    base = lerp(base, grey, smooth(0.45, 0.75, blob) * 0.65)
    base = lerp(base, hexc('#a17a5c'), smooth(0.8, 0.95, f2) * fiss[..., None] * 0.5 if False else smooth(0.8, 0.95, f2) * fiss * 0.5)
    base = base * (0.55 + 0.45 * fiss[..., None])
    moss = smooth(0.7, 0.85, fbm(n, 1.6, seed + 3))
    base = lerp(base, hexc('#5b6636'), moss * 0.4)
    C2, H2 = strokes_layer(n, 1500, ['#7a5a45', '#8b6d56', '#5e4332', '#94796a', '#6e675e'], 120, 420, 2.0, 6.0, seed + 4, angle_bias=math.pi / 2, bg=base, hbg=H * 0.7, curved=0.02, jit=0.12)
    m = smooth(0.75, 0.85, fbm(n, 1.8, seed + 5))
    base = lerp(base, C2, 0.55 + m * 0.3)
    H = np.maximum(H * 0.75, H2 * 0.9)
    base = base * (0.7 + 0.3 * ao_from_height(H, 4))[..., None]
    save_rgb(name + '_c', srgb_dither(base))
    save_rgb(name + '_n', normal_map(blur_wrap(H, 0.7), 12.0))


def bark_smooth(n=N, seed=131, name='barksm'):
    b = fbm(n, 2.1, seed)
    wr = fbm(n, 1.3, seed + 1, ax=0.2, ay=1.0)
    H = b * 0.4 + wr * 0.4
    C = lerp(hexc('#8f8a80'), hexc('#bdb6a8'), smooth(0.2, 0.8, b))
    C = C * (0.9 + 0.2 * wr[..., None])
    rr = np.random.default_rng(seed)
    im = Image.fromarray((np.clip(C, 0, 1) * 255).astype(np.uint8))
    hm = Image.fromarray((H * 255).astype(np.uint8))
    d, dh = ImageDraw.Draw(im), ImageDraw.Draw(hm)
    for i in range(1500):
        x, y = rr.random() * n, rr.random() * n
        L = 4 + rr.random() * 14
        d.line([(x, y), (x + L, y + (rr.random() - 0.5) * 2)], fill=(92, 84, 74), width=int(1 + rr.random() * 2))
        dh.line([(x, y), (x + L, y)], fill=40, width=2)
    C = np.asarray(im).astype(np.float32) / 255
    H = np.asarray(hm).astype(np.float32) / 255
    lich = smooth(0.7, 0.8, fbm(n, 1.2, seed + 2))
    C = lerp(C, hexc('#b9b98f'), lich * 0.5)
    save_rgb(name + '_c', srgb_dither(C))
    save_rgb(name + '_n', normal_map(blur_wrap(H, 0.8), 6.0))


def petate(n=N, seed=141, name='petate'):
    yy, xx = np.mgrid[0:n, 0:n].astype(np.float32)
    w = 16.0
    a = xx + yy
    b = xx - yy + n
    ia = np.floor(a / w).astype(np.int32)
    ib = np.floor(b / w).astype(np.int32)
    fa = (a / w) - ia
    fb = (b / w) - ib
    topA = ((ia + ib) % 4) < 2
    prA = np.sin(np.pi * fa)
    prB = np.sin(np.pi * fb)
    alongA = fb
    alongB = fa
    dipA = 0.75 + 0.25 * np.cos(np.pi * 2 * ((ib % 2) + fb) / 2)
    HA = prA ** 0.5 * 0.6 + 0.4
    HB = prB ** 0.5 * 0.6 + 0.4
    rr = np.random.default_rng(seed)
    cols = [hexc(c) for c in ['#cbb07b', '#bb9f69', '#d7c18f', '#a98b5b', '#c4a56e', '#b89660']]
    ca = np.array(cols)[rr.integers(0, len(cols), 4096)][ia % 4096]
    cb = np.array(cols)[rr.integers(0, len(cols), 4096)][ib % 4096]
    fibA = fbm(n, 0.8, seed + 1, ax=1, ay=1)
    fibA = warp(fibA, np.full((n, n), 0.5), np.full((n, n), 0.5), 0)
    lineA = np.sin((fa * 7 + fibA * 2) * np.pi) * 0.5 + 0.5
    lineB = np.sin((fb * 7 + fibA * 2) * np.pi) * 0.5 + 0.5
    CA = ca * (0.82 + 0.18 * lineA[..., None]) * (0.6 + 0.4 * prA[..., None] ** 0.4)
    CB = cb * (0.82 + 0.18 * lineB[..., None]) * (0.6 + 0.4 * prB[..., None] ** 0.4)
    C = np.where(topA[..., None], CA, CB)
    H = np.where(topA, HA, HB)
    edgeA = smooth(0.0, 0.15, fb) * smooth(1.0, 0.85, fb)
    edgeB = smooth(0.0, 0.15, fa) * smooth(1.0, 0.85, fa)
    sh = np.where(topA, 1 - (1 - edgeA) * 0.0, 1.0)
    H = H * np.where(topA, 1.0, 0.85)
    C = C * np.where(topA, 1.0, 0.88)[..., None]
    age = fbm(n, 2.0, seed + 2)
    C = lerp(C, C * np.array([0.8, 0.74, 0.66]), smooth(0.5, 0.9, age))
    save_rgb(name + '_c', srgb_dither(C))
    save_rgb(name + '_n', normal_map(blur_wrap(H, 0.6), 5.0))


def cloth(n=512, seed=151, name='cloth'):
    yy, xx = np.mgrid[0:n, 0:n].astype(np.float32)
    p = 4.0
    wx = np.sin(xx / p * np.pi) ** 2
    wy = np.sin(yy / p * np.pi) ** 2
    ch = ((np.floor(xx / p) + np.floor(yy / p)) % 2)
    H = np.where(ch > 0, wx * 0.8 + wy * 0.2, wy * 0.8 + wx * 0.2)
    slub = fbm(n, 1.2, seed, ax=0.1, ay=1)
    H = H * (0.8 + 0.3 * slub)
    C = lerp(hexc('#d9d1bf'), hexc('#ece6d6'), fbm(n, 1.8, seed + 1))
    C = C * (0.88 + 0.12 * H[..., None])
    dirt = smooth(0.55, 0.9, fbm(n, 2.2, seed + 2))
    C = lerp(C, C * np.array([0.82, 0.76, 0.66]), dirt * 0.6)
    save_rgb(name + '_c', srgb_dither(C))
    save_rgb(name + '_n', normal_map(H, 2.5))


def rebozo(n=512, seed=161, name='rebozo'):
    rr = np.random.default_rng(seed)
    yy, xx = np.mgrid[0:n, 0:n].astype(np.float32)
    C = np.ones((n, n, 3)) * hexc('#262638')
    stripe = (np.sin(xx / n * np.pi * 2 * 16) > 0.2)
    C = np.where(stripe[..., None], C * 1.15, C)
    dots = (rr.random((n, n)) > 0.975) & ((yy.astype(int) % 6) < 3)
    dots = blur_wrap(dots.astype(np.float32), 1.0, ) if False else ndimage.gaussian_filter(dots.astype(np.float32), [0.5, 1.6], mode='wrap')
    C = lerp(C, hexc('#b4b2c4'), np.clip(dots * 3, 0, 1))
    red = (np.abs(((xx / n * 8) % 1) - 0.5) < 0.02)
    C = np.where(red[..., None], hexc('#7a2d38'), C)
    C = C * (0.9 + 0.2 * fbm(n, 1.0, seed + 1)[..., None])
    save_rgb(name + '_c', srgb_dither(C))


def water_normal(n=512, seed=171, name='water_n', kmin=2, kmax=34, count=90, pw=1.3):
    rr = np.random.default_rng(seed)
    yy, xx = np.mgrid[0:n, 0:n].astype(np.float32) / n
    h = np.zeros((n, n))
    for i in range(count):
        while True:
            kx, ky = rr.integers(-kmax, kmax + 1, 2)
            k = math.hypot(kx, ky)
            if kmin <= k <= kmax:
                break
        amp = k ** (-pw) * (0.6 + rr.random() * 0.8)
        ph = rr.random() * 6.28
        h += amp * np.sin(2 * np.pi * (kx * xx + ky * yy) + ph)
    h = norm01(h)
    h = h ** 1.4
    save_rgb(name, normal_map(h, 60.0 * 512 / n))


def foam(n=512, seed=181, name='foam'):
    F1, F2, idx, _ = voronoi(n, 900, seed)
    lace = np.exp(-((F2 - F1) / 2.2) ** 2)
    F1b, F2b, _, _ = voronoi(n, 300, seed + 1)
    lace2 = np.exp(-((F2b - F1b) / 3.0) ** 2)
    f = fbm(n, 1.6, seed + 2)
    g = np.clip(lace * 0.7 + lace2 * 0.5, 0, 1) * smooth(0.2, 0.7, f) + smooth(0.6, 0.9, f) * 0.5
    save_gray(name, np.clip(g, 0, 1))


def noise_rgba(n=512, seed=191, name='noise'):
    r = fbm(n, 2.2, seed)
    g = fbm(n, 1.7, seed + 1)
    F1, F2, _, _ = voronoi(n, 64, seed + 2)
    b = 1 - norm01(F1)
    a = fbm(n, 1.1, seed + 3)
    save_rgba(name, np.stack([r, g, b, a], -1), lossless=True)


def moon(n=512, seed=201, name='moon'):
    rr = np.random.default_rng(seed)
    yy, xx = np.mgrid[0:n, 0:n].astype(np.float32)
    cx = cy = n / 2
    R = n * 0.48
    r = np.sqrt((xx - cx) ** 2 + (yy - cy) ** 2)
    disk = smooth(R + 1, R - 1, r)
    mar = fbm(n, 2.6, seed)
    base = 0.72 - smooth(0.55, 0.7, mar) * 0.28 + fbm(n, 1.0, seed + 1) * 0.08
    H = np.zeros((n, n))
    for i in range(420):
        s = (rr.random() ** 3) * 34 + 2
        px, py = rr.random() * n, rr.random() * n
        d = np.sqrt((xx - px) ** 2 + (yy - py) ** 2)
        bowl = np.clip(1 - (d / s) ** 2, 0, 1)
        rim = np.exp(-((d - s) / (s * 0.18)) ** 2)
        H += -bowl * 0.6 * s / 30 + rim * 0.35 * s / 30
    nz = np.sqrt(np.clip(1 - (r / R) ** 2, 0, 1))
    shade = np.clip(0.5 + (np.roll(H, 1, 1) - H) * 6, 0, 1)
    val = np.clip(base * (0.75 + 0.5 * shade) * (0.55 + 0.45 * nz), 0, 1)
    rgba = np.stack([val, val * 0.98, val * 0.94, disk], -1)
    save_rgba(name, rgba)


JOBS = dict(pebbles=pebbles, rock=rock, soil=soil, ground=ground, forest=forest_floor, cobble=cobbles, cantera=cantera,
            braza=braza, plaster=plaster, talavera=talavera, planks=planks, bark=bark_fibrous, barksm=bark_smooth,
            petate=petate, cloth=cloth, rebozo=rebozo, water=lambda: (water_normal(), water_normal(512, 172, 'water_n2', 8, 64, 140, 1.0)),
            foam=foam, noise=noise_rgba, moon=moon)

if __name__ == '__main__':
    names = sys.argv[1:] or list(JOBS)
    import time
    for k in names:
        t = time.time()
        JOBS[k]()
        print(k, round(time.time() - t, 1), 's', flush=True)
