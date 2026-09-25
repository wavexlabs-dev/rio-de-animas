"""Tileable water normal maps from a wind-wave spectrum (Phillips with short fetch), computed by FFT.

Two patches: a 7.5 m patch of wind chop and a 1.9 m patch of capillary ripples. Slopes come straight from
the spectrum (i k h), then a mild non-linear sharpening narrows the crests the way real ripples look.
"""
import numpy as np
from PIL import Image
import os

OUT = os.path.join(os.path.dirname(__file__), 'final')


def spectrum(n, L, wind, wdir, seed, lmin, spread=1.0, swell=0.0):
    rng = np.random.default_rng(seed)
    k1 = np.fft.fftfreq(n, d=L / n) * 2 * np.pi
    kx, ky = np.meshgrid(k1, k1)
    k = np.hypot(kx, ky)
    k[0, 0] = 1e-6
    g = 9.81
    Lw = wind * wind / g
    wx, wy = np.cos(wdir), np.sin(wdir)
    cosang = (kx * wx + ky * wy) / k
    # directional spreading: mostly downwind, some cross-wind chop
    D = (np.abs(cosang) ** spread) * 0.8 + 0.2
    P = np.exp(-1.0 / (k * Lw) ** 2) / k ** 4 * D
    P *= np.exp(-(k * lmin) ** 2)          # kill waves shorter than lmin
    P[0, 0] = 0
    h0 = (rng.normal(size=(n, n)) + 1j * rng.normal(size=(n, n))) * np.sqrt(P / 2)
    return kx, ky, h0


def normal_tex(n, L, wind, wdir, seed, lmin, slope_gain, sharp, name):
    kx, ky, H = spectrum(n, L, wind, wdir, seed, lmin)
    h = np.real(np.fft.ifft2(H))
    sx = np.real(np.fft.ifft2(1j * kx * H))
    sy = np.real(np.fft.ifft2(1j * ky * H))
    # normalise slope so the texture uses its range, then sharpen crests (positive heights get steeper)
    s = np.sqrt(np.mean(sx ** 2 + sy ** 2))
    sx /= s; sy /= s
    hn = (h - h.mean()) / (h.std() + 1e-9)
    w = 1.0 + sharp * np.tanh(hn)            # crests steeper, troughs flatter
    sx *= w * slope_gain; sy *= w * slope_gain
    nz = 1.0 / np.sqrt(1 + sx * sx + sy * sy)
    nx, ny = -sx * nz, -sy * nz
    rgb = np.dstack([nx * 0.5 + 0.5, ny * 0.5 + 0.5, nz * 0.5 + 0.5])
    # height in alpha (used for crest glints / foam hints)
    a = np.clip(hn * 0.18 + 0.5, 0, 1)
    img = (np.dstack([rgb, a]) * 255 + 0.5).astype(np.uint8)
    Image.fromarray(img, 'RGBA').save(os.path.join(OUT, name + '.webp'), lossless=True, method=6)
    print(name, 'slope rms', round(float(np.sqrt(np.mean(sx * sx + sy * sy))), 3))


if __name__ == '__main__':
    # chop: 7.5 m tile, light breeze over a sheltered canal
    normal_tex(512, 7.5, 1.7, 0.6, 311, 0.02, 0.55, 0.4, 'water_n')
    # ripples: 1.9 m tile, capillary scale
    normal_tex(512, 1.9, 0.85, 2.1, 312, 0.0045, 0.6, 0.3, 'water_n2')
