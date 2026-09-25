"""Convert Poly Haven scanned textures into the web set used by the scene.

Colour maps get a gentle AO multiply (cavity depth) and optional grading.
Normal maps (OpenGL convention) carry the roughness map in their alpha channel.
Output names replace the old procedural ones in tex/final/ so the engine picks them up.
"""
import os
import numpy as np
from PIL import Image
from lib import fbm, smooth

SRC = os.path.join(os.path.dirname(__file__), '..', 'ph', 'rio-de-animas-assets', 'texturas')
DST = os.path.join(os.path.dirname(__file__), 'final')


def load(slug, kind, size):
    d = os.path.join(SRC, slug)
    cand = [f for f in os.listdir(d) if (f'_{kind}_' in f) or (kind == 'diff' and '_diffuse_' in f)]
    im = Image.open(os.path.join(d, cand[0]))
    im = im.convert('L' if kind in ('rough', 'ao') else 'RGB')
    if im.size[0] != size:
        im = im.resize((size, size), Image.LANCZOS)
    return np.asarray(im).astype(np.float32) / 255.0


def grade(rgb, mul=(1, 1, 1), sat=1.0, gamma=1.0, lift=0.0):
    rgb = rgb * np.array(mul, np.float32)[None, None, :]
    lum = rgb.mean(-1, keepdims=True)
    rgb = lum + (rgb - lum) * sat
    rgb = np.clip(rgb, 0, 1) ** gamma
    return np.clip(rgb * (1 - lift) + lift, 0, 1)


def convert(name, slug, size=1024, nsize=512, ao=0.55, q=78, alpha=None, rough=True, **g):
    col = load(slug, 'diff', size)
    a = load(slug, 'ao', size)
    col = col * (1 - ao + ao * a[..., None])
    col = grade(col, **g)
    rgb8 = (col * 255 + 0.5).astype(np.uint8)
    if alpha is not None:
        al = (np.clip(alpha(col, size), 0, 1) * 255 + 0.5).astype(np.uint8)
        Image.fromarray(np.dstack([rgb8, al]), 'RGBA').save(os.path.join(DST, name + '_c.webp'), quality=q, alpha_quality=70, method=6)
    else:
        Image.fromarray(rgb8, 'RGB').save(os.path.join(DST, name + '_c.webp'), quality=q, method=6)
    nrm = load(slug, 'nor_gl', nsize)
    r = load(slug, 'rough', nsize)
    n8 = (nrm * 255 + 0.5).astype(np.uint8)
    r8 = (r * 255 + 0.5).astype(np.uint8)
    if rough:
        Image.fromarray(np.dstack([n8, r8]), 'RGBA').save(os.path.join(DST, name + '_n.webp'), quality=80, alpha_quality=55, method=6)
    else:  # terrain array layers go through a 2D canvas: keep them opaque
        Image.fromarray(n8, 'RGB').save(os.path.join(DST, name + '_n.webp'), quality=80, method=6)
    print(name, '<-', slug, os.path.getsize(os.path.join(DST, name + '_c.webp')) // 1024, 'k +', os.path.getsize(os.path.join(DST, name + '_n.webp')) // 1024, 'k')


def paint_mask(col, n):
    # paint survives on board faces, wears off in the gaps and in scattered scuffs
    lum = col.mean(-1)
    faces = smooth(0.18, 0.34, lum)
    scuff = fbm(n, beta=2.6, seed=77, lo=4)
    scratches = fbm(n, beta=1.2, seed=78, lo=24, ax=6.0, ay=0.6)
    return faces * smooth(0.28, 0.42, scuff) * (1 - 0.8 * smooth(0.78, 0.9, scratches))


if __name__ == '__main__':
    # terrain layers
    convert('ground', 'leafy_grass', 1024, 512, ao=0.5, rough=False)
    convert('soil', 'brown_mud_leaves_01', 1024, 512, ao=0.55, rough=False)
    convert('pebbles', 'ganges_river_pebbles', 1024, 512, ao=0.7, rough=False)
    convert('rock', 'lichen_rock', 1024, 512, ao=0.6, mul=(1.18, 1.14, 1.1), lift=0.03, rough=False)
    convert('forest', 'forest_leaves_02', 1024, 512, ao=0.6, rough=False)
    convert('cobble', 'cobblestone_floor_08', 1024, 512, ao=0.65, rough=False)
    # architecture
    convert('cantera', 'red_sandstone_wall', 1024, 512, ao=0.6, mul=(1.06, 0.97, 0.96), sat=0.62, lift=0.06)
    convert('braza', 'old_stone_wall', 1024, 512, ao=0.7)
    convert('plaster', 'damaged_plaster', 1024, 512, ao=0.5, mul=(1.02, 1.0, 0.97), lift=0.04)
    convert('plasterblue', 'blue_plaster_weathered', 1024, 512, ao=0.5)
    # bark
    convert('bark', 'pine_bark', 1024, 512, ao=0.6)
    convert('barksm', 'jolcham_oak_bark_01', 1024, 512, ao=0.6)
    convert('barkahue', 'bark_willow_02', 1024, 512, ao=0.6)
    convert('barkliso', 'eucalyptus_bark', 1024, 512, ao=0.5, mul=(1.05, 1.02, 0.98))
    # wood & weave
    convert('planks', 'weathered_planks', 1024, 512, ao=0.6, alpha=paint_mask)
    convert('doors', 'brown_planks_09', 1024, 512, ao=0.6)
    convert('petate', 'reed_roof_04', 1024, 512, ao=0.6)
