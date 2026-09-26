"""Painted parts of the trajinera: the front arch sign (name + volutes), the painted floor and the bow deck.
Writes tex/final/t_letrero.webp (RGBA), t_piso.webp and t_proa.webp.
usage: python3 tex/trajinera.py [NAME]"""
import math, os, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter

FINAL = os.path.join(os.path.dirname(__file__), 'final')
FONT = '/usr/share/fonts/truetype/google-fonts/Poppins-Bold.ttf'
NAME = (sys.argv[1] if len(sys.argv) > 1 else 'LUPITA').upper()
C = dict(yellow=(250, 196, 0), orange=(255, 118, 0), red=(222, 24, 44), magenta=(222, 34, 122), pink=(255, 92, 160),
         green=(26, 164, 64), dgreen=(12, 104, 52), blue=(28, 104, 210), turq=(20, 178, 196), purple=(120, 62, 180),
         white=(252, 248, 238), dark=(34, 20, 28), wood=(150, 96, 52))


def grain(im, amt=0.07, seed=1):
    """paint on wood: slight blotchy variation"""
    a = np.asarray(im).astype(np.float32)
    rng = np.random.default_rng(seed)
    n = rng.standard_normal((a.shape[0] // 16 + 2, a.shape[1] // 16 + 2)).astype(np.float32)
    n = np.asarray(Image.fromarray(((n - n.min()) / (np.ptp(n) + 1e-6) * 255).astype(np.uint8)).resize((a.shape[1], a.shape[0]), Image.BICUBIC)).astype(np.float32) / 255
    streak = rng.standard_normal((a.shape[0], 1)).astype(np.float32) * 0.02
    k = 1 + (n - 0.5) * amt * 2 + streak
    a[..., :3] = np.clip(a[..., :3] * k[..., None], 0, 255)
    return Image.fromarray(a.astype(np.uint8), im.mode)


def letter(ch, size, fill, outline, ow):
    f = ImageFont.truetype(FONT, size)
    l, t, r, b = f.getbbox(ch)
    W, H = r - l + ow * 4 + 8, b - t + ow * 4 + 8
    im = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    x, y = ow * 2 + 4 - l, ow * 2 + 4 - t
    d.text((x + ow * 0.35, y + ow * 0.5), ch, font=f, fill=C['dark'] + (160,), stroke_width=ow, stroke_fill=C['dark'] + (160,))
    d.text((x, y), ch, font=f, fill=fill, stroke_width=ow, stroke_fill=outline)
    return im


def text_straight(img, s, cx, cy, size, fills, outline, ow, track=0.0):
    ims = [letter(ch, size, fills[i % len(fills)], outline, ow) if ch != ' ' else None for i, ch in enumerate(s)]
    ws = [(im.width - ow * 2 if im else size * 0.35) for im in ims]
    total = sum(ws) + track * size * (len(s) - 1)
    x = cx - total / 2
    for im, w in zip(ims, ws):
        if im: img.alpha_composite(im, (int(x - ow), int(cy - im.height / 2)))
        x += w + track * size


def text_arc(img, s, cx, cy, rx, ry, size, fills, outline, ow, span=2.3):
    """letters standing on an elliptical arch, centred at the top"""
    n = len(s)
    for i, ch in enumerate(s):
        if ch == ' ': continue
        t = (i - (n - 1) / 2) / max(1, n - 1) * span
        a = math.pi / 2 + t  # 90deg = top
        x, y = cx - math.cos(a) * rx, cy - math.sin(a) * ry
        # tangent direction -> rotation
        tx, ty = math.sin(a) * rx, -math.cos(a) * ry
        ang = math.degrees(math.atan2(-ty, tx))
        im = letter(ch, size, fills[i % len(fills)], outline, ow).rotate(ang, resample=Image.BICUBIC, expand=True)
        img.alpha_composite(im, (int(x - im.width / 2), int(y - im.height / 2)))


def volute(d, cx, cy, s, flip, cols):
    """a painted S-scroll: thick spiral that sweeps out and curls in"""
    pts = []
    for i in range(160):
        u = i / 159
        a = u * 3.4 * math.pi
        r = s * (1.0 - 0.78 * u)
        pts.append((cx + flip * (math.cos(a) * r - s * 0.2 + u * s * 0.6), cy - math.sin(a) * r * 0.85 - u * s * 0.15))
    for w, c in ((int(s * 0.36), cols[0]), (int(s * 0.26), cols[1]), (int(s * 0.12), cols[2])):
        d.line(pts, fill=c, width=w, joint='curve')
        for p in (pts[0], pts[-1]):
            d.ellipse([p[0] - w / 2, p[1] - w / 2, p[0] + w / 2, p[1] + w / 2], fill=c)


def flower(d, x, y, r, petal, center, n=6, rot=0.0):
    for k in range(n):
        a = rot + k * 2 * math.pi / n
        px, py = x + math.cos(a) * r * 0.62, y + math.sin(a) * r * 0.62
        d.ellipse([px - r * 0.48, py - r * 0.48, px + r * 0.48, py + r * 0.48], fill=petal, outline=C['dark'], width=max(2, int(r * 0.07)))
    d.ellipse([x - r * 0.38, y - r * 0.38, x + r * 0.38, y + r * 0.38], fill=center, outline=C['dark'], width=max(2, int(r * 0.07)))


def heart(d, x, y, s, col):
    pts = []
    for i in range(80):
        t = i / 79 * 2 * math.pi
        hx = 16 * math.sin(t) ** 3
        hy = 13 * math.cos(t) - 5 * math.cos(2 * t) - 2 * math.cos(3 * t) - math.cos(4 * t)
        pts.append((x + hx * s / 16, y - hy * s / 16))
    d.polygon(pts, fill=col, outline=C['dark'], width=max(3, int(s * 0.1)))


def sign(S=2048, W=1760):
    """front arch: a crest board with XOCHIMILCO, volutes and flowers, and the boat's name along the arch"""
    im = Image.new('RGBA', (W, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    cx, spring = W / 2, S * 0.62            # arch centre / where the arch meets the posts
    rxo, ryo = W / 2 - W * 0.012, S * 0.36  # outer ellipse of the arch band
    band = S * 0.105
    rxi, ryi = rxo - band, ryo - band
    top = S * 0.02
    # silhouette: crest panel down to the spring line; the arch band carries on straight down as its two legs
    d.rounded_rectangle([0, top, W, spring], radius=int(S * 0.03), fill=C['blue'])
    rings = ((0.0, C['yellow']), (0.012, C['red']), (0.024, C['turq']), (band - S * 0.024, C['red']), (band - S * 0.012, C['yellow']))
    def ell(rx, ry, fill):
        d.ellipse([cx - rx, spring - ry, cx + rx, spring + ry], fill=fill)
    for off, col in rings:
        o = off * S if off < 1 else off
        ell(rxo - o, ryo - o, col)
        for f in (-1, 1):
            xa, xb = cx + f * (rxo - o), cx + f * rxi
            d.rectangle([min(xa, xb), spring, max(xa, xb), S], fill=col)
    # legs: cempasúchil painted down the band
    for f in (-1, 1):
        xm = cx + f * (rxo + rxi) / 2
        for y in range(int(spring + S * 0.06), S, int(S * 0.1)):
            flower(d, xm, y, band * 0.3, C['orange'], C['yellow'], 8)
    # cut the opening: inside the inner ellipse and between the legs
    mask = Image.new('L', (W, S), 0)
    md = ImageDraw.Draw(mask)
    md.ellipse([cx - rxi, spring - ryi, cx + rxi, spring + ryi], fill=255)
    md.rectangle([cx - rxi, spring, cx + rxi, S], fill=255)
    md.rectangle([0, spring, cx - rxo, S], fill=255)
    md.rectangle([cx + rxo, spring, W, S], fill=255)
    a = np.asarray(im).copy()
    a[np.asarray(mask) > 0] = 0
    im = Image.fromarray(a, 'RGBA')
    d = ImageDraw.Draw(im)
    # crest: top board with XOCHIMILCO between flag stripes
    by0, by1 = top + S * 0.01, top + S * 0.13
    d.rounded_rectangle([W * 0.02, by0, W * 0.98, by1], radius=int(S * 0.02), fill=C['white'], outline=C['dark'], width=6)
    for i, c in enumerate((C['green'], C['white'], C['red'])):
        w = W * 0.04
        d.rectangle([W * 0.03 + i * w, by0 + 8, W * 0.03 + (i + 1) * w, by1 - 8], fill=c)
        d.rectangle([W * 0.97 - (3 - i) * w, by0 + 8, W * 0.97 - (2 - i) * w, by1 - 8], fill=c)
    text_straight(im, 'XOCHIMILCO', cx, (by0 + by1) / 2, int(S * 0.074), [C['blue'], C['red'], C['green'], C['magenta'], C['orange']], C['dark'], 5, 0.07)
    d = ImageDraw.Draw(im)
    # crest panel between board and arch: volutes, heart and cempasúchil
    vy = (by1 + spring - ryo) / 2 + S * 0.02
    for f in (-1, 1):
        volute(d, cx + f * W * 0.2, vy, S * 0.12, f, (C['dark'], C['yellow'], C['orange']))
        volute(d, cx + f * W * 0.405, vy + S * 0.02, S * 0.066, -f, (C['dark'], C['pink'], C['magenta']))
    heart(d, cx, vy + S * 0.005, S * 0.075, C['red'])
    for f in (-1, 1):
        flower(d, cx + f * W * 0.09, vy - S * 0.07, S * 0.035, C['orange'], C['yellow'], 8)
        flower(d, cx + f * W * 0.3, vy + S * 0.09, S * 0.03, C['yellow'], C['orange'], 8)
        flower(d, cx + f * W * 0.465, by1 + S * 0.05, S * 0.028, C['white'], C['magenta'], 6)
    # leaves along the arch
    for i in range(26):
        t = (i / 25 - 0.5) * 2.9
        a = math.pi / 2 + t
        x, y = cx - math.cos(a) * (rxo + S * 0.0), spring - math.sin(a) * (ryo + S * 0.0)
        if y > spring - S * 0.02: continue
        r = S * 0.017
        d.ellipse([x - r, y - r * 0.6, x + r, y + r * 0.6], fill=C['green'], outline=C['dark'], width=3)
    # the name along the arch
    text_arc(im, NAME, cx, spring, (rxo + rxi) / 2, (ryo + ryi) / 2, int(band * 0.9), [C['white']], C['dark'], 7, span=min(2.3, 0.3 * len(NAME)))
    im = grain(im, 0.08, 3)
    # painted edge outline
    a = np.asarray(im)
    al = Image.fromarray(a[..., 3])
    edge = np.asarray(al.filter(ImageFilter.MaxFilter(9))).astype(int) - np.asarray(al.filter(ImageFilter.MinFilter(9))).astype(int)
    b = a.copy()
    e = edge > 60
    b[e & (a[..., 3] > 0), :3] = C['dark']
    return Image.fromarray(b, 'RGBA').resize((W // 2, S // 2), Image.LANCZOS)


def floor(W=512, H=2048):
    """passenger floor: red with a yellow runner under the table, triangles and green borders (length along V)"""
    im = Image.new('RGB', (W, H), C['red'])
    d = ImageDraw.Draw(im)
    cw = W * 0.34
    d.rectangle([W / 2 - cw / 2, 0, W / 2 + cw / 2, H], fill=C['yellow'])
    d.rectangle([W / 2 - cw / 2 - 10, 0, W / 2 - cw / 2, H], fill=C['blue'])
    d.rectangle([W / 2 + cw / 2, 0, W / 2 + cw / 2 + 10, H], fill=C['blue'])
    step = W * 0.36
    for y in np.arange(0, H, step):
        for s in (-1, 1):
            x0 = W / 2 + s * (cw / 2 + 10)
            d.polygon([(x0, y), (x0, y + step), (x0 + s * W * 0.2, y + step / 2)], fill=C['yellow'])
            d.polygon([(x0 + s * W * 0.03, y + step * 0.25), (x0 + s * W * 0.03, y + step * 0.75), (x0 + s * W * 0.12, y + step / 2)], fill=C['orange'])
    d.rectangle([0, 0, W * 0.06, H], fill=C['green'])
    d.rectangle([W * 0.94, 0, W, H], fill=C['green'])
    # plank seams
    for x in np.arange(0, W, W / 7):
        d.line([(x, 0), (x, H)], fill=(40, 20, 16), width=2)
    return grain(im.convert('RGBA'), 0.12, 5).convert('RGB')


def proa(S=512):
    """bow / stern deck: four big triangles meeting in the middle"""
    im = Image.new('RGB', (S, S), C['white'])
    d = ImageDraw.Draw(im)
    c = (S / 2, S / 2)
    for (p, q), col in zip((((0, 0), (S, 0)), ((S, 0), (S, S)), ((S, S), (0, S)), ((0, S), (0, 0))), (C['yellow'], C['green'], C['red'], C['blue'])):
        d.polygon([p, q, c], fill=col)
    for p in ((0, 0), (S, 0), (S, S), (0, S)):
        d.line([p, c], fill=C['white'], width=10)
    d.rectangle([0, 0, S - 1, S - 1], outline=C['yellow'], width=14)
    for x in np.arange(0, S, S / 6):
        d.line([(x, 0), (x, S)], fill=(40, 20, 16), width=2)
    return grain(im.convert('RGBA'), 0.12, 7).convert('RGB')


if __name__ == '__main__':
    sign().save(os.path.join(FINAL, 't_letrero.webp'), 'WEBP', quality=90)
    floor().save(os.path.join(FINAL, 't_piso.webp'), 'WEBP', quality=86)
    proa().save(os.path.join(FINAL, 't_proa.webp'), 'WEBP', quality=86)
    print('ok', NAME)
