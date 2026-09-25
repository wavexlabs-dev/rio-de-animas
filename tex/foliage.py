import sys, math
import numpy as np
from lib import *
from PIL import Image, ImageDraw, ImageFilter


def jit(c, rr, a=0.12):
    c = np.asarray(c)
    return np.clip(c * (1 - a / 2 + rr.random() * a) + (rr.random(3) - 0.5) * a * 0.3, 0, 1)


def finish(im, name, dil=10, q=90):
    a = pil_to_np(im)
    a = dilate_color(a, dil)
    save_rgba(name, a, q=q)


def pinnate_shoot(cv, rr, x, y, ang, length, leafL, leafW, col, twig, curv=0.0, step=3.2, spread=1.0, taper=0.55, wid=1.6):
    pts = [(x, y)]
    a = ang
    cx, cy = x, y
    n = int(length / step)
    angs = []
    for i in range(n):
        a += (rr.random() - 0.5) * 0.06 + curv
        cx += math.cos(a) * step
        cy += math.sin(a) * step
        pts.append((cx, cy))
        angs.append(a)
    cv.line(pts, twig, wid)
    for i in range(1, n, 1):
        t = i / n
        L = leafL * (1 - taper * t ** 1.5) * (0.85 + rr.random() * 0.3)
        px, py = pts[i]
        for side in (-1, 1):
            la = angs[i - 1] + side * (spread + (rr.random() - 0.5) * 0.25)
            c = jit(col, rr, 0.16)
            c = c * (0.85 + 0.3 * t)
            cv.poly(leaf_poly(px, py, L, leafW, la, n=6), c)
    return pts


def ahuehuete(S=512, seed=1):
    out = Image.new('RGBA', (S * 2, S * 2))
    for k in range(4):
        rr = np.random.default_rng(seed + k)
        cv = Canvas(S, S, 2)
        base = [hexc('#56702f'), hexc('#6b8438'), hexc('#7c9444'), hexc('#4d6a31')][k]
        # main twig from bottom-center
        bx, by = S * 0.5, S * 0.96
        for j in range(150):
            a0 = rr.random() * 6.28
            rad = (rr.random() ** 0.6) * S * 0.36
            sx = S * 0.5 + math.cos(a0) * rad
            sy = S * 0.52 + math.sin(a0) * rad * 0.85
            ang = math.atan2(sy - S * 0.7, sx - S * 0.5) + (rr.random() - 0.5) * 1.4
            L = S * (0.08 + rr.random() * 0.1)
            sh = 0.7 + 0.5 * (1 - (sy / S))
            pinnate_shoot(cv, rr, sx, sy, ang, L, S * 0.016, S * 0.0028, base * sh * (0.8 + rr.random() * 0.3), hexc('#6a5238'),
                          curv=(rr.random() - 0.5) * 0.06, step=S * 0.0038, spread=1.2, wid=0.9, taper=0.5)
        im = cv.result()
        out.paste(im, ((k % 2) * S, (k // 2) * S))
    finish(out, 'f_ahue')


def heno(W=256, H=1024, seed=2):
    rr = np.random.default_rng(seed)
    cv = Canvas(W, H, 2)
    for i in range(260):
        x = W * (0.1 + 0.8 * rr.random())
        y = rr.random() * H * 0.08
        L = H * (0.35 + 0.63 * rr.random() ** 0.7)
        pts = []
        ph = rr.random() * 6.28
        freq = 0.02 + rr.random() * 0.03
        amp = 2 + rr.random() * 6
        drift = (rr.random() - 0.5) * 30
        for s in range(0, int(L), 4):
            pts.append((x + math.sin(s * freq + ph) * amp + drift * s / L, y + s))
        c = lerp(hexc('#8f9784'), hexc('#b9bfae'), rr.random()) * (0.85 + rr.random() * 0.25)
        cv.line(pts, c, 1.1 + rr.random() * 1.4, a=0.75 + rr.random() * 0.25)
        # little curls
        for s in range(8, len(pts), 9):
            px, py = pts[s]
            cv.line([(px, py), (px + (rr.random() - 0.5) * 10, py + 4 + rr.random() * 8)], c * 0.95, 1.0, a=0.7)
    im = cv.result()
    finish(im, 'f_heno')


def broadleaf(S, seed, name, cols, leafL, leafW, count, twig, clusters=6, glossy=True):
    out = Image.new('RGBA', (S * 2, S * 2))
    for k in range(4):
        rr = np.random.default_rng(seed + k)
        cv = Canvas(S, S, 2)
        # twigs
        bx, by = S * 0.5, S * 0.97
        tips = []
        for j in range(clusters):
            ang = -math.pi / 2 + (rr.random() - 0.5) * 2.4
            L = S * (0.25 + rr.random() * 0.25)
            ex = bx + math.cos(ang) * L
            ey = by + math.sin(ang) * L
            mx = (bx + ex) / 2 + (rr.random() - 0.5) * 40
            my = (by + ey) / 2 + (rr.random() - 0.5) * 40
            cv.line([(bx, by), (mx, my), (ex, ey)], twig, 3)
            tips.append((ex, ey, ang))
        for i in range(count):
            ex, ey, ang = tips[rr.integers(len(tips))]
            r = rr.random() ** 0.6 * S * 0.2
            a2 = rr.random() * 6.28
            px, py = ex + math.cos(a2) * r, ey + math.sin(a2) * r
            px = min(max(px, leafL), S - leafL)
            py = min(max(py, leafL), S - leafL)
            la = ang + (rr.random() - 0.5) * 2.6
            L = leafL * (0.75 + rr.random() * 0.5)
            c = jit(hexc(cols[rr.integers(len(cols))]), rr, 0.2)
            pts = leaf_poly(px, py, L, leafW * L / leafL, la, n=9, curve=(rr.random() - 0.5) * 0.15)
            cv.poly(pts, c)
            if glossy:
                cv.line([(px, py), (px + math.cos(la) * L * 0.9, py + math.sin(la) * L * 0.9)], np.clip(c * 1.3, 0, 1), 1.0, a=0.6)
        out.paste(cv.result(), ((k % 2) * S, (k // 2) * S))
    finish(out, name)


def pine(S=512, seed=4):
    out = Image.new('RGBA', (S * 2, S * 2))
    for k in range(4):
        rr = np.random.default_rng(seed + k)
        cv = Canvas(S, S, 2)
        bx, by = S * 0.5, S * 0.95
        for j in range(8):
            ang = -math.pi / 2 + (rr.random() - 0.5) * 2.2
            L = S * (0.3 + rr.random() * 0.2)
            ex, ey = bx + math.cos(ang) * L, by + math.sin(ang) * L
            cv.line([(bx, by), (ex, ey)], hexc('#4f3b2a'), 4)
            for f in range(170):
                t = rr.random() ** 0.5
                px, py = bx + (ex - bx) * t, by + (ey - by) * t
                na = ang + (rr.random() - 0.5) * 2.2
                nl = S * (0.08 + rr.random() * 0.1) * (0.6 + 0.4 * t)
                c = jit(hexc(['#44583a', '#56693f', '#3a4d33', '#627848'][rr.integers(4)]), rr, 0.2)
                cv.line([(px, py), (px + math.cos(na) * nl * 0.5, py + math.sin(na) * nl * 0.5 + nl * 0.05), (px + math.cos(na) * nl, py + math.sin(na) * nl + nl * 0.15)], c, 2.2)
        out.paste(cv.result(), ((k % 2) * S, (k // 2) * S))
    finish(out, 'f_pine')


def trumpet(cv, rr, x, y, r, facing):
    white = hexc('#f6f2ea')
    if facing < 0.5:
        # front view: 5-lobed disc
        pts = []
        for i in range(60):
            a = i / 60 * 6.283
            rad = r * (0.88 + 0.12 * math.cos(a * 5 + rr.random() * 0.3))
            pts.append((x + math.cos(a) * rad, y + math.sin(a) * rad))
        cv.poly(pts, jit(white, rr, 0.06))
        cv.ellipse(x, y, r * 0.62, r * 0.62, hexc('#efe7df'))
        for i in range(5):
            a = i / 5 * 6.283 + 0.3
            cv.line([(x, y), (x + math.cos(a) * r * 0.85, y + math.sin(a) * r * 0.85)], hexc('#e6ddd6'), max(1, r * 0.08))
        cv.ellipse(x, y, r * 0.28, r * 0.28, hexc('#8a4e72'))
        cv.ellipse(x, y, r * 0.14, r * 0.14, hexc('#5a2c48'))
    else:
        a = rr.random() * 6.283
        ca, sa = math.cos(a), math.sin(a)
        L = r * 1.6
        tip = (x + ca * L, y + sa * L)
        px, py = -sa, ca
        pts = [(x + px * r * 0.15, y + py * r * 0.15), (tip[0] + px * r * 0.8, tip[1] + py * r * 0.8), (tip[0] - px * r * 0.8, tip[1] - py * r * 0.8), (x - px * r * 0.15, y - py * r * 0.15)]
        cv.poly(pts, hexc('#ece6de'))
        cv.ellipse(tip[0], tip[1], r * 0.82, r * 0.82, jit(white, rr, 0.05))
        cv.ellipse(tip[0] - ca * r * 0.1, tip[1] - sa * r * 0.1, r * 0.3, r * 0.3, hexc('#9a6488'))


def cazahuate(S=512, seed=5):
    out = Image.new('RGBA', (S * 2, S * 2))
    for k in range(4):
        rr = np.random.default_rng(seed + k)
        cv = Canvas(S, S, 2)
        bx, by = S * 0.5, S * 0.97
        tips = []
        for j in range(6):
            ang = -math.pi / 2 + (rr.random() - 0.5) * 2.0
            L = S * (0.3 + rr.random() * 0.3)
            pts = [(bx, by)]
            cx, cy, a = bx, by, ang
            for s in range(12):
                a += (rr.random() - 0.5) * 0.4
                cx += math.cos(a) * L / 12
                cy += math.sin(a) * L / 12
                pts.append((cx, cy))
            cv.line(pts, hexc('#7d766c'), 4 - j * 0.3)
            tips += pts[6:]
        for i in range(8):
            px, py = tips[rr.integers(len(tips))]
            c = jit(hexc('#8fa060'), rr, 0.2)
            cv.poly(leaf_poly(px, py, S * 0.12, S * 0.02, rr.random() * 6.28, n=8), c)
        for i in range(70):
            px, py = tips[rr.integers(len(tips))]
            px += (rr.random() - 0.5) * 70
            py += (rr.random() - 0.5) * 70
            r = S * (0.045 + rr.random() * 0.035)
            px = min(max(px, r * 2), S - r * 2)
            py = min(max(py, r * 2), S - r * 2)
            if rr.random() < 0.25:
                cv.ellipse(px, py, r * 0.3, r * 0.55, hexc('#e8e0d4'))
            else:
                trumpet(cv, rr, px, py, r, rr.random())
        out.paste(cv.result(), ((k % 2) * S, (k // 2) * S))
    finish(out, 'f_caza')


def bract(cv, rr, x, y, r, a0, col):
    for i in range(3):
        a = a0 + i * 2.094 + (rr.random() - 0.5) * 0.3
        c = jit(col, rr, 0.15)
        pts = leaf_poly(x, y, r, r * 0.42, a, base=0.1, n=8)
        cv.poly(pts, c)
        cv.line([(x, y), (x + math.cos(a) * r * 0.8, y + math.sin(a) * r * 0.8)], c * 0.8, 1.0, a=0.6)
    cv.ellipse(x, y, r * 0.12, r * 0.12, hexc('#f2e6c8'))


def bugambilia(S=512, seed=6):
    out = Image.new('RGBA', (S * 2, S * 2))
    mags = [hexc('#c8246a'), hexc('#d6337c'), hexc('#b81c62'), hexc('#e0488c'), hexc('#a8185c')]
    for k in range(4):
        rr = np.random.default_rng(seed + k)
        cv = Canvas(S, S, 2)
        for i in range(40):
            px, py = S * (0.1 + 0.8 * rr.random()), S * (0.1 + 0.8 * rr.random())
            if (px - S / 2) ** 2 + (py - S / 2) ** 2 > (S * 0.45) ** 2:
                continue
            c = jit(hexc(['#2f5a2a', '#3b6a30', '#2a4d25'][rr.integers(3)]), rr, 0.2)
            cv.poly(leaf_poly(px, py, S * 0.09, S * 0.04, rr.random() * 6.28, n=8), c)
        for i in range(120):
            ang = rr.random() * 6.28
            rad = (rr.random() ** 0.7) * S * 0.4
            px, py = S / 2 + math.cos(ang) * rad, S / 2 + math.sin(ang) * rad
            bract(cv, rr, px, py, S * (0.045 + rr.random() * 0.03), rr.random() * 6.28, mags[rr.integers(len(mags))])
        out.paste(cv.result(), ((k % 2) * S, (k // 2) * S))
    finish(out, 'f_buga')


def ruffle_petal(cv, rr, x, y, a, L, W, c):
    pts = []
    n = 14
    ca, sa = math.cos(a), math.sin(a)
    for i in range(n + 1):
        t = i / n
        w = W * math.sin(math.pi * t ** 0.7)
        pts.append((t * L, w))
    for i in range(n, -1, -1):
        t = i / n
        w = W * math.sin(math.pi * t ** 0.7)
        pts.append((t * L, -w))
    # ruffled tip
    out = []
    for (px, py) in pts:
        r = math.hypot(px, py)
        wob = 1 + 0.08 * math.sin(math.atan2(py, px) * 14 + rr.random())
        out.append((x + (px * ca - py * sa) * wob, y + (px * sa + py * ca) * wob))
    cv.poly(out, c)


def cempa_head(cv, rr, x, y, R):
    outer = hexc('#d9580a')
    mid = hexc('#ee7a10')
    inner = hexc('#f7a81a')
    rings = 7
    for ri in range(rings):
        t = ri / (rings - 1)
        rr_ = R * (1 - t * 0.85)
        cnt = int(10 + 18 * (1 - t))
        base_col = lerp(outer, lerp(mid, inner, t), min(1, t * 1.4))
        for i in range(cnt):
            a = i / cnt * 6.283 + ri * 0.4 + rr.random() * 0.2
            c = jit(base_col, rr, 0.14)
            L = R * 0.5 * (1 - t * 0.4)
            px = x + math.cos(a) * (rr_ - L * 0.6)
            py = y + math.sin(a) * (rr_ - L * 0.6)
            ruffle_petal(cv, rr, px, py, a, L, L * 0.5, c * (0.72 + 0.28 * t))
            ruffle_petal(cv, rr, px, py, a + 0.2, L * 0.9, L * 0.35, np.clip(c * (0.9 + 0.3 * t), 0, 1))
    cv.ellipse(x, y, R * 0.12, R * 0.12, hexc('#e08a12'))


def cempa(S=512, seed=7):
    out = Image.new('RGBA', (S * 2, S * 2))
    # 0: top view head
    rr = np.random.default_rng(seed)
    cv = Canvas(S, S, 2)
    cempa_head(cv, rr, S / 2, S / 2, S * 0.46)
    out.paste(cv.result(), (0, 0))
    # 1: side view (dome)
    rr = np.random.default_rng(seed + 1)
    cv = Canvas(S, S, 2)
    cv.line([(S * 0.5, S * 0.99), (S * 0.5, S * 0.6)], hexc('#4a6b2c'), 10)
    cv.ellipse(S * 0.5, S * 0.62, S * 0.2, S * 0.1, hexc('#4f7430'))
    for i in range(200):
        a = math.pi + rr.random() * math.pi
        rad = S * 0.4 * math.sqrt(rr.random())
        px = S * 0.5 + math.cos(a) * rad * 1.05
        py = S * 0.58 + math.sin(a) * rad * 0.85
        t = 1 - rad / (S * 0.4)
        c = jit(lerp(hexc('#d45208'), hexc('#f5a01a'), t * 0.8 + 0.1), rr, 0.14)
        ruffle_petal(cv, rr, px, py, -math.pi / 2 + (rr.random() - 0.5) * 2.2, S * 0.09, S * 0.045, c * (0.75 + 0.35 * t))
    out.paste(cv.result(), (S, 0))
    # 2: leaves (pinnate, serrated)
    rr = np.random.default_rng(seed + 2)
    cv = Canvas(S, S, 2)
    for j in range(6):
        ang = -math.pi / 2 + (rr.random() - 0.5) * 2.4
        pinnate_shoot(cv, rr, S * 0.5 + (rr.random() - 0.5) * 60, S * 0.98, ang, S * (0.45 + rr.random() * 0.4), S * 0.07, S * 0.013,
                      hexc('#3b5a26') * (0.85 + rr.random() * 0.3), hexc('#3d5a28'), step=S * 0.018, spread=0.9, taper=0.4, wid=3)
    out.paste(cv.result(), (0, S))
    # 3: small head + bud cluster
    rr = np.random.default_rng(seed + 3)
    cv = Canvas(S, S, 2)
    cempa_head(cv, rr, S * 0.36, S * 0.4, S * 0.26)
    cempa_head(cv, rr, S * 0.7, S * 0.62, S * 0.2)
    cv.ellipse(S * 0.3, S * 0.8, S * 0.06, S * 0.09, hexc('#4f7430'))
    out.paste(cv.result(), (S, S))
    finish(out, 'f_cempa')


def cosmos(S=256, seed=8):
    out = Image.new('RGBA', (S * 2, S * 2))
    cols = [hexc('#e46ca3'), hexc('#c13f7c'), hexc('#f4e9ee')]
    for k in range(3):
        rr = np.random.default_rng(seed + k)
        cv = Canvas(S, S, 2)
        x = y = S / 2
        R = S * 0.46
        for i in range(8):
            a = i / 8 * 6.283 + rr.random() * 0.15
            c = jit(cols[k], rr, 0.08)
            pts = leaf_poly(x, y, R, R * 0.28, a, base=0.8, n=10)
            cv.poly(pts, c)
            tipx, tipy = x + math.cos(a) * R, y + math.sin(a) * R
            cv.ellipse(tipx, tipy, R * 0.05, R * 0.05, (0, 0, 0), a=0.0)
            for v in (-0.12, 0, 0.12):
                cv.line([(x, y), (x + math.cos(a + v) * R * 0.85, y + math.sin(a + v) * R * 0.85)], c * 0.88, 1, a=0.6)
        cv.ellipse(x, y, R * 0.2, R * 0.2, hexc('#e8b21a'))
        cv.ellipse(x, y, R * 0.1, R * 0.1, hexc('#c98a10'))
        out.paste(cv.result(), ((k % 2) * S, (k // 2) * S))
    # fern-like cosmos leaves
    rr = np.random.default_rng(seed + 9)
    cv = Canvas(S, S, 2)
    for j in range(5):
        pinnate_shoot(cv, rr, S * 0.5, S * 0.98, -math.pi / 2 + (rr.random() - 0.5) * 1.6, S * 0.7, S * 0.12, S * 0.008, hexc('#5a7a32'), hexc('#5a7a32'), step=S * 0.03, spread=0.7, taper=0.3, wid=2)
    out.paste(cv.result(), (S, S))
    finish(out, 'f_cosmos')


def fern(S=512, seed=9):
    out = Image.new('RGBA', (S * 2, S))
    for k in range(2):
        rr = np.random.default_rng(seed + k)
        cv = Canvas(S, S, 2)
        x, y = S * 0.5, S * 0.99
        pts = [(x, y)]
        a = -math.pi / 2
        angs = []
        for s in range(60):
            a += 0.008 + (rr.random() - 0.5) * 0.02
            x += math.cos(a) * S * 0.015
            y += math.sin(a) * S * 0.015
            pts.append((x, y))
            angs.append(a)
        cv.line(pts, hexc('#4d5a2a'), 3)
        for i in range(2, 60, 2):
            t = i / 60
            L = S * 0.3 * math.sin(math.pi * min(1, t * 1.1)) * (1 - t * 0.4)
            px, py = pts[i]
            for side in (-1, 1):
                la = angs[i - 1] + side * 1.25
                c = jit(hexc('#4f7a2e'), rr, 0.2)
                sub = pinnate_shoot(cv, rr, px, py, la, L, S * 0.026, S * 0.007, c, c * 0.8, curv=side * 0.01, step=S * 0.016, spread=1.0, taper=0.6, wid=1.4)
        out.paste(cv.result(), (k * S, 0))
    finish(out, 'f_fern')


def corn(W=256, H=1024, seed=10):
    rr = np.random.default_rng(seed)
    cv = Canvas(W, H, 2)
    x0 = W * 0.5
    cv.line([(x0, H), (x0 + 4, H * 0.3), (x0 + 8, H * 0.05)], hexc('#b39a68'), 10)
    for i in range(9):
        y = H * (0.9 - i * 0.09)
        side = 1 if i % 2 else -1
        pts = []
        L = W * (0.45 + rr.random() * 0.4)
        droop = 0.3 + rr.random() * 0.6
        for s in range(12):
            t = s / 11
            pts.append((x0 + side * L * t, y - L * 0.5 * t + droop * L * t * t))
        c = jit(hexc(['#c2a978', '#b39564', '#a8895a', '#cdb88c'][rr.integers(4)]), rr, 0.1)
        top = [(px, py - 15 * math.sin(math.pi * (k / 11) ** 0.6)) for k, (px, py) in enumerate(pts)]
        bot = [(px, py + 15 * math.sin(math.pi * (k / 11) ** 0.6)) for k, (px, py) in enumerate(pts)]
        cv.poly(top + bot[::-1], c)
        cv.line(pts, c * 0.85, 1.2)
    cv.ellipse(x0 + 12, H * 0.5, 12, 40, hexc('#b8a070'))
    cv.line([(x0 + 12, H * 0.45), (x0 + 30, H * 0.4)], hexc('#8a6a40'), 2)
    finish(cv.result(), 'f_corn')


def monarch(S=256, seed=11):
    rr = np.random.default_rng(seed)
    cv = Canvas(S, S, 2)
    # right wing pair, body at x=0 line
    fore = [(4, 120), (60, 30), (160, 12), (240, 40), (236, 70), (200, 110), (120, 132), (40, 136)]
    hind = [(4, 132), (80, 136), (170, 150), (200, 190), (170, 240), (90, 250), (30, 210), (6, 160)]
    for wing in (hind, fore):
        cv.poly(wing, hexc('#1c1410'))
        cx = sum(p[0] for p in wing) / len(wing)
        cy = sum(p[1] for p in wing) / len(wing)
        inner = [(cx + (px - cx) * 0.82, cy + (py - cy) * 0.82) for px, py in wing]
        cv.poly(inner, hexc('#e8761c'))
        for px, py in wing[1:-1]:
            cv.line([(8, (wing[0][1] + wing[-1][1]) / 2), (cx + (px - cx) * 0.8, cy + (py - cy) * 0.8)], hexc('#1c1410'), 3)
        for i in range(len(wing) - 1):
            (ax, ay), (bx, by) = wing[i], wing[i + 1]
            for t in (0.3, 0.7):
                px, py = ax + (bx - ax) * t, ay + (by - ay) * t
                px, py = cx + (px - cx) * 0.93, cy + (py - cy) * 0.93
                cv.ellipse(px, py, 3, 3, hexc('#f4efe6'))
    cv.ellipse(210, 36, 7, 5, hexc('#f0b35a'))
    finish(cv.result(), 'f_monarch')


def papel(S=256, seed=12):
    out = Image.new('L', (S * 4, S), 0)
    for k in range(4):
        im = Image.new('L', (S * 2, S * 2), 0)
        d = ImageDraw.Draw(im)
        s = 2
        W, H = S * s, S * s
        d.rectangle([0, 0, W, H * 0.92], fill=255)
        # scalloped bottom
        for i in range(12):
            x = (i + 0.5) * W / 12
            d.pieslice([x - W / 24, H * 0.92 - W / 24, x + W / 24, H * 0.92 + W / 24], 0, 180, fill=255)
        d.rectangle([0, 0, W, H * 0.07], fill=255)
        # frame holes
        for i in range(14):
            x = (i + 0.5) * W / 14
            d.polygon([(x, H * 0.1), (x + W / 40, H * 0.13), (x, H * 0.16), (x - W / 40, H * 0.13)], fill=0)
            d.polygon([(x, H * 0.78), (x + W / 40, H * 0.81), (x, H * 0.84), (x - W / 40, H * 0.81)], fill=0)
        cx, cy = W / 2, H * 0.47
        if k == 0:  # flower
            for i in range(8):
                a = i / 8 * 6.283
                pts = leaf_poly(cx + math.cos(a) * W * 0.06, cy + math.sin(a) * W * 0.06, W * 0.2, W * 0.055, a, n=10)
                d.polygon(pts, fill=0)
            d.ellipse([cx - W * 0.05, cy - W * 0.05, cx + W * 0.05, cy + W * 0.05], fill=255)
            for (ox, oy) in ((-0.36, -0.2), (0.36, -0.2), (-0.36, 0.2), (0.36, 0.2)):
                x, y = cx + ox * W, cy + oy * H * 0.7
                for i in range(5):
                    a = i / 5 * 6.283
                    d.ellipse([x + math.cos(a) * W * 0.04 - W * 0.025, y + math.sin(a) * W * 0.04 - W * 0.025, x + math.cos(a) * W * 0.04 + W * 0.025, y + math.sin(a) * W * 0.04 + W * 0.025], fill=0)
        elif k == 1:  # calavera silhouette cut
            d.ellipse([cx - W * 0.22, cy - H * 0.3, cx + W * 0.22, cy + H * 0.12], fill=0)
            d.rectangle([cx - W * 0.13, cy + H * 0.05, cx + W * 0.13, cy + H * 0.24], fill=0)
            d.ellipse([cx - W * 0.15, cy - H * 0.12, cx - W * 0.03, cy + H * 0.01], fill=255)
            d.ellipse([cx + W * 0.03, cy - H * 0.12, cx + W * 0.15, cy + H * 0.01], fill=255)
            d.polygon([(cx, cy + H * 0.02), (cx - W * 0.03, cy + H * 0.09), (cx + W * 0.03, cy + H * 0.09)], fill=255)
            for i in range(5):
                x = cx - W * 0.1 + i * W * 0.05
                d.rectangle([x - W * 0.008, cy + H * 0.13, x + W * 0.008, cy + H * 0.24], fill=255)
            for i in range(6):
                a = i / 6 * 3.14
                d.ellipse([cx + math.cos(a) * W * 0.3 - 10, cy - H * 0.1 - math.sin(a) * H * 0.2 - 10, cx + math.cos(a) * W * 0.3 + 10, cy - H * 0.1 - math.sin(a) * H * 0.2 + 10], fill=0)
        elif k == 2:  # sun rays
            d.ellipse([cx - W * 0.1, cy - W * 0.1, cx + W * 0.1, cy + W * 0.1], fill=0)
            d.ellipse([cx - W * 0.05, cy - W * 0.05, cx + W * 0.05, cy + W * 0.05], fill=255)
            for i in range(16):
                a = i / 16 * 6.283
                r1, r2 = W * 0.14, W * 0.3
                d.polygon([(cx + math.cos(a - 0.08) * r1, cy + math.sin(a - 0.08) * r1 * 0.9), (cx + math.cos(a) * r2, cy + math.sin(a) * r2 * 0.75), (cx + math.cos(a + 0.08) * r1, cy + math.sin(a + 0.08) * r1 * 0.9)], fill=0)
        else:  # grecas + birds
            for i in range(9):
                x = W * 0.1 + i * W * 0.1
                d.polygon([(x, H * 0.25), (x + W * 0.05, H * 0.35), (x, H * 0.45), (x - W * 0.05, H * 0.35)], fill=0)
                d.polygon([(x, H * 0.5), (x + W * 0.05, H * 0.6), (x, H * 0.7), (x - W * 0.05, H * 0.6)], fill=0)
            for i in range(8):
                x = W * 0.15 + i * W * 0.1
                d.ellipse([x - W * 0.015, H * 0.46 - W * 0.015, x + W * 0.015, H * 0.46 + W * 0.015], fill=0)
        im = im.resize((S, S), Image.LANCZOS)
        out.paste(im, (k * S, 0))
    out.save(os.path.join(OUT, 'f_papel.webp'), 'WEBP', lossless=True)


def tin(S=256):
    im = Image.new('L', (S * 2, S * 2), 0)
    d = ImageDraw.Draw(im)
    c = S
    for ring in range(1, 9):
        r = ring * S * 0.11
        cnt = 6 * ring
        for i in range(cnt):
            a = i / cnt * 6.283 + ring * 0.2
            x, y = c + math.cos(a) * r, c + math.sin(a) * r
            rad = 5 + (ring % 3) * 2
            d.ellipse([x - rad, y - rad, x + rad, y + rad], fill=255)
    for i in range(8):
        a = i / 8 * 6.283
        for t in range(3, 14):
            x, y = c + math.cos(a) * t * S * 0.065, c + math.sin(a) * t * S * 0.065
            d.ellipse([x - 4, y - 4, x + 4, y + 4], fill=255)
    im = im.resize((S, S), Image.LANCZOS)
    im.save(os.path.join(OUT, 'f_tin.webp'), 'WEBP', lossless=True)


def arch_paint(W=1024, H=256, seed=13):
    rr = np.random.default_rng(seed)
    cv = Canvas(W, H, 2)
    cv.poly([(0, 0), (W, 0), (W, H), (0, H)], hexc('#1f6f8b'))
    cv.poly([(0, 0), (W, 0), (W, 18), (0, 18)], hexc('#e8b420'))
    cv.poly([(0, H - 18), (W, H - 18), (W, H), (0, H)], hexc('#e8b420'))
    cv.poly([(0, 18), (W, 18), (W, 26), (0, 26)], hexc('#c8283c'))
    cv.poly([(0, H - 26), (W, H - 26), (W, H - 18), (0, H - 18)], hexc('#c8283c'))
    # garland vine
    pts = [(x, H / 2 + math.sin(x / W * 6.283 * 3) * 40) for x in range(0, W + 1, 8)]
    cv.line(pts, hexc('#2f7a3a'), 5)
    for i in range(0, len(pts), 3):
        px, py = pts[i]
        for side in (-1, 1):
            cv.poly(leaf_poly(px, py, 26, 8, side * 1.2 + (rr.random() - 0.5), n=8), hexc('#3f9a44') * (0.8 + rr.random() * 0.3))
    def rose(x, y, r, c):
        for k in range(5):
            rr_ = r * (1 - k * 0.18)
            cv.ellipse(x + (rr.random() - 0.5) * 2, y + (rr.random() - 0.5) * 2, rr_, rr_ * 0.9, np.clip(c * (0.7 + k * 0.1), 0, 1))
            cv.ellipse(x, y - rr_ * 0.2, rr_ * 0.6, rr_ * 0.4, np.clip(c * (0.95 + k * 0.08), 0, 1))
    for i in range(14):
        x = (i + 0.5) * W / 14
        y = H / 2 + math.sin(x / W * 6.283 * 3) * 40
        c = [hexc('#e03a4a'), hexc('#f2a01a'), hexc('#f4f0e6'), hexc('#d6337c'), hexc('#f07a1a')][i % 5]
        rose(x, y, 22 + rr.random() * 8, c)
        rose(x + 30, y + 30 * (1 if i % 2 else -1), 12, [hexc('#f4f0e6'), hexc('#f2c21a')][i % 2])
    im = cv.result()
    a = pil_to_np(im)
    a = a * np.concatenate([0.92 + 0.12 * fbm(W, 1.5, seed, m=H)[..., None].repeat(3, -1), np.ones((H, W, 1))], -1)
    save_rgba('f_arch', a, q=90)


def palm_fringe(S=512, seed=14):
    rr = np.random.default_rng(seed)
    cv = Canvas(S, S, 2)
    for i in range(520):
        x = rr.random() * S
        y0 = rr.random() * S * 0.1
        L = S * (0.55 + rr.random() * 0.45)
        w = 3 + rr.random() * 5
        bend = (rr.random() - 0.5) * 0.3
        pts_l, pts_r = [], []
        for s in range(13):
            t = s / 12
            px = x + math.sin(t * 2 + bend * 6) * 6 * bend * 5
            py = y0 + L * t
            ww = w * (1 - t * 0.7)
            pts_l.append((px - ww / 2, py))
            pts_r.append((px + ww / 2, py))
        c = jit(lerp(hexc('#b89b62'), hexc('#8a7040'), rr.random()), rr, 0.18)
        cv.poly(pts_l + pts_r[::-1], c)
        cv.line([((a[0] + b[0]) / 2, a[1]) for a, b in zip(pts_l, pts_r)], c * 1.15, 0.8, a=0.7)
    finish(cv.result(), 'f_palm')


def petals(S=64, seed=15):
    out = Image.new('RGBA', (S * 4, S))
    rr = np.random.default_rng(seed)
    cv = Canvas(S, S, 4)
    ruffle_petal(cv, rr, S * 0.15, S * 0.5, 0, S * 0.75, S * 0.34, hexc('#ee7410'))
    ruffle_petal(cv, rr, S * 0.2, S * 0.5, 0.1, S * 0.6, S * 0.2, hexc('#f7a018'))
    out.paste(cv.result(), (0, 0))
    cv = Canvas(S, S, 4)
    cv.poly(leaf_poly(S * 0.1, S * 0.5, S * 0.85, S * 0.36, 0, base=0.1, n=12), hexc('#d02a74'))
    cv.line([(S * 0.1, S * 0.5), (S * 0.85, S * 0.5)], hexc('#a01858'), 1.2)
    for v in (-0.5, 0.5):
        cv.line([(S * 0.3, S * 0.5), (S * 0.6, S * 0.5 + v * S * 0.3)], hexc('#b01e62'), 0.8)
    out.paste(cv.result(), (S, 0))
    cv = Canvas(S, S, 4)
    trumpet(cv, rr, S / 2, S / 2, S * 0.44, 0.0)
    out.paste(cv.result(), (S * 2, 0))
    cv = Canvas(S, S, 4)
    cv.poly(leaf_poly(S * 0.08, S * 0.5, S * 0.85, S * 0.3, 0, n=10), hexc('#8a6a3a'))
    cv.line([(S * 0.08, S * 0.5), (S * 0.9, S * 0.5)], hexc('#6a4a2a'), 1)
    out.paste(cv.result(), (S * 3, 0))
    finish(out, 'f_petals', dil=4)


JOBS = dict(ahue=ahuehuete, heno=heno,
            oak=lambda: broadleaf(512, 3, 'f_oak', ['#34492a', '#3e5530', '#2d4026', '#4a5f36'], 36, 13, 900, hexc('#4a3a2a')),
            amate=lambda: broadleaf(512, 31, 'f_amate', ['#2f5a26', '#3a6a2c', '#2a4d22', '#46743a'], 70, 26, 160, hexc('#8a7a5a'), clusters=5),
            pine=pine, caza=cazahuate, buga=bugambilia, cempa=cempa, cosmos=cosmos, fern=fern, corn=corn,
            monarch=monarch, papel=papel, tin=tin, arch=arch_paint, palm=palm_fringe, petals=petals)

if __name__ == '__main__':
    import time
    for k in (sys.argv[1:] or list(JOBS)):
        t = time.time()
        JOBS[k]()
        print(k, round(time.time() - t, 1), flush=True)
