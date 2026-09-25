"""Procedural, tileable texture helpers (numpy)."""
import numpy as np
from scipy import ndimage
from scipy.spatial import cKDTree
from PIL import Image, ImageDraw, ImageFilter
import math, os

OUT = os.path.join(os.path.dirname(__file__), 'out')
os.makedirs(OUT, exist_ok=True)


def norm01(a):
    a = a - a.min()
    m = a.max()
    return a / m if m > 0 else a


def fbm(n, beta=2.0, seed=0, lo=1.0, hi=None, ax=1.0, ay=1.0, m=None):
    """Periodic spectral noise. beta ~ roughness (higher = smoother). ax/ay anisotropy (freq scale)."""
    rng = np.random.default_rng(seed)
    mm = m or n
    w = rng.standard_normal((mm, n))
    F = np.fft.fft2(w)
    fy = np.fft.fftfreq(mm) * mm
    fx = np.fft.fftfreq(n) * n
    k = np.sqrt((fx[None, :] / ax) ** 2 + (fy[:, None] / ay) ** 2)
    k[0, 0] = 1
    filt = k ** (-beta / 2.0)
    filt[0, 0] = 0
    if lo:
        filt[k < lo] = 0
    if hi:
        filt = filt * np.exp(-(k / hi) ** 4)
    out = np.real(np.fft.ifft2(F * filt))
    return norm01(out)


def warp(img, dx, dy, amt):
    """Sample img at warped coords (wrap). dx,dy in [0,1] noise."""
    h, w = img.shape[:2]
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    cx = xx + (dx - 0.5) * amt
    cy = yy + (dy - 0.5) * amt
    if img.ndim == 2:
        return ndimage.map_coordinates(img, [cy, cx], order=1, mode='grid-wrap')
    return np.stack([ndimage.map_coordinates(img[..., c], [cy, cx], order=1, mode='grid-wrap') for c in range(img.shape[2])], -1)


def voronoi(n, count, seed=0, jitter=1.0, aspect=1.0, grid=False, m=None):
    """Periodic voronoi: returns F1, F2 (pixels), cell index, points."""
    rng = np.random.default_rng(seed)
    mm = m or n
    if grid:
        g = int(round(math.sqrt(count)))
        gy, gx = np.mgrid[0:g, 0:g]
        pts = (np.stack([gx.ravel(), gy.ravel()], 1) + 0.5 + (rng.random((g * g, 2)) - 0.5) * jitter) / g
    else:
        pts = rng.random((count, 2))
    P = pts * [n, mm]
    tiles = []
    for oy in (-1, 0, 1):
        for ox in (-1, 0, 1):
            tiles.append(P + [ox * n, oy * mm])
    T = np.concatenate(tiles)
    T2 = T.copy()
    T2[:, 1] *= aspect
    tree = cKDTree(T2)
    yy, xx = np.mgrid[0:mm, 0:n]
    q = np.stack([xx.ravel() + 0.5, (yy.ravel() + 0.5) * aspect], 1)
    d, i = tree.query(q, k=2)
    F1 = d[:, 0].reshape(mm, n)
    F2 = d[:, 1].reshape(mm, n)
    idx = (i[:, 0] % len(P)).reshape(mm, n)
    return F1, F2, idx, pts


def normal_map(h, strength=4.0):
    dx = (np.roll(h, -1, 1) - np.roll(h, 1, 1)) * 0.5
    dy = (np.roll(h, -1, 0) - np.roll(h, 1, 0)) * 0.5
    nx = -dx * strength
    ny = dy * strength
    nz = np.ones_like(h)
    l = np.sqrt(nx * nx + ny * ny + nz * nz)
    n = np.stack([nx / l, ny / l, nz / l], -1)
    return (n * 0.5 + 0.5)


def blur_wrap(a, s):
    if a.ndim == 2:
        return ndimage.gaussian_filter(a, s, mode='wrap')
    return np.stack([ndimage.gaussian_filter(a[..., c], s, mode='wrap') for c in range(a.shape[2])], -1)


def ao_from_height(h, radius=6):
    b = blur_wrap(h, radius)
    ao = np.clip(1.0 - (b - h) * 3.0, 0, 1)
    return ao


def lerp(a, b, t):
    t = np.asarray(t, dtype=np.float64)
    a = np.asarray(a)
    b = np.asarray(b)
    if t.ndim == 2 and (a.ndim in (1, 3) or b.ndim in (1, 3)) and (a.shape[-1:] == (3,) or b.shape[-1:] == (3,)):
        t = t[..., None]
    return a + (b - a) * t


def smooth(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


def hexc(h):
    h = h.lstrip('#')
    return np.array([int(h[i:i + 2], 16) / 255.0 for i in (0, 2, 4)])


def palette_pick(idx, cols, seed=0):
    rng = np.random.default_rng(seed)
    table = np.array([hexc(c) for c in cols])
    choice = rng.integers(0, len(cols), idx.max() + 1)
    var = 0.85 + rng.random(idx.max() + 1) * 0.3
    return table[choice[idx]] * var[idx][..., None]


def save_rgb(name, rgb, q=86):
    rgb = np.clip(rgb, 0, 1)
    im = Image.fromarray((rgb * 255 + 0.5).astype(np.uint8), 'RGB')
    im.save(os.path.join(OUT, name + '.webp'), 'WEBP', quality=q, method=6)
    return im


def save_rgba(name, rgba, q=88, lossless=False):
    rgba = np.clip(rgba, 0, 1)
    im = Image.fromarray((rgba * 255 + 0.5).astype(np.uint8), 'RGBA')
    im.save(os.path.join(OUT, name + '.webp'), 'WEBP', quality=q, method=6, lossless=lossless)
    return im


def save_gray(name, g, q=88):
    g = np.clip(g, 0, 1)
    rgb = np.stack([g, g, g], -1)
    return save_rgb(name, rgb, q)


def srgb_dither(rgb, seed=0):
    rng = np.random.default_rng(seed)
    return rgb + (rng.random(rgb.shape) - 0.5) / 255.0


class Canvas:
    """Supersampled RGBA canvas for drawing foliage/flowers with PIL."""

    def __init__(self, w, h, ss=2):
        self.ss = ss
        self.w, self.h = w, h
        self.im = Image.new('RGBA', (w * ss, h * ss), (0, 0, 0, 0))
        self.d = ImageDraw.Draw(self.im)

    def col(self, c, a=1.0):
        c = np.clip(np.asarray(c), 0, 1)
        return (int(c[0] * 255), int(c[1] * 255), int(c[2] * 255), int(a * 255))

    def line(self, pts, c, width, a=1.0):
        s = self.ss
        self.d.line([(x * s, y * s) for x, y in pts], fill=self.col(c, a), width=max(1, int(width * s)), joint='curve')

    def ellipse(self, cx, cy, rx, ry, c, a=1.0):
        s = self.ss
        self.d.ellipse([(cx - rx) * s, (cy - ry) * s, (cx + rx) * s, (cy + ry) * s], fill=self.col(c, a))

    def poly(self, pts, c, a=1.0):
        s = self.ss
        self.d.polygon([(x * s, y * s) for x, y in pts], fill=self.col(c, a))

    def result(self):
        return self.im.resize((self.w, self.h), Image.LANCZOS)


def leaf_poly(cx, cy, length, width, ang, tip=1.0, base=0.3, n=10, curve=0.0):
    """Leaf outline polygon points."""
    pts = []
    ca, sa = math.cos(ang), math.sin(ang)
    side = []
    for i in range(n + 1):
        t = i / n
        wdt = width * math.sin(math.pi * (t ** (0.6 + base))) * (1 - t ** 6 * 0.2)
        side.append((t, wdt))
    for t, wdt in side:
        x = t * length
        y = wdt + curve * t * t * length
        pts.append((cx + x * ca - y * sa, cy + x * sa + y * ca))
    for t, wdt in reversed(side):
        x = t * length
        y = -wdt + curve * t * t * length
        pts.append((cx + x * ca - y * sa, cy + x * sa + y * ca))
    return pts


def dilate_color(rgba, iters=8):
    """Bleed RGB into transparent pixels to avoid dark fringes under mipmapping."""
    a = rgba[..., 3]
    rgb = rgba[..., :3].copy()
    mask = a > 0.02
    for _ in range(iters):
        acc = np.zeros_like(rgb)
        cnt = np.zeros(a.shape)
        for dy, dx in ((0, 1), (0, -1), (1, 0), (-1, 0), (1, 1), (-1, -1), (1, -1), (-1, 1)):
            m2 = np.roll(np.roll(mask, dy, 0), dx, 1)
            c2 = np.roll(np.roll(rgb, dy, 0), dx, 1)
            acc += c2 * m2[..., None]
            cnt += m2
        grow = (~mask) & (cnt > 0)
        rgb[grow] = acc[grow] / cnt[grow][..., None]
        mask = mask | grow
    out = rgba.copy()
    out[..., :3] = rgb
    return out


def pil_to_np(im):
    return np.asarray(im).astype(np.float32) / 255.0
