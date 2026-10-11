"""
Icon prep step for the Qurra launcher icon (run BEFORE scripts\\make-icons.ps1).

The raw artwork (scripts\\assets\\icon-source.png) is an AI render: the green
squircle sits in a cream margin with a soft drop shadow, it is 916x961 rather
than square, and the margin is uneven — which is why a naive crop produced a
wobbly border. This script turns it into a clean full-bleed tile:

  1. keys out the cream margin + its shadow (flood fill from the frame edges,
     so the ivory arch and pages inside the artwork are never touched),
  2. extends the green field with a coarse-to-fine harmonic (Laplace) fill —
     no streaks, no visible seam where the squircle used to end,
  3. crops a square centred on the squircle (no stretching),
  4. colour-grades it into one coordinated palette: richer green, warm
     ivory/gold highlights, deep-green shadows, soft vignette.

Output: scripts\\assets\\icon-prepared.png (1024x1024, square, unmasked).
scripts\\make-icons.ps1 then only has to scale it and cut the program's
rounded-square border, so the whole icon set stays reproducible.

Requires: numpy, Pillow (dev-only; the prepared PNG is committed).
    python scripts\\prep-icon.py
"""
import numpy as np
from PIL import Image

try:
    from PIL import ImageFilter  # noqa: F401  (kept for local experiments)
except ImportError:
    pass

import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'scripts', 'assets', 'icon-source.png')
PREPARED = os.path.join(ROOT, 'scripts', 'assets', 'icon-prepared.png')
OUT_SIZE = 1024


def key_background(img):
    """Cream margin + drop shadow, but only what is reachable from the frame.

    Flood fill from the border so interior ivory (arch, crescent, pages) is
    never classified as background even though it shares the colour.
    """
    mx = img.max(2)
    chroma = mx - img.min(2)
    bg = ((mx > 236) & (chroma < 24)) | ((mx > 168) & (mx <= 236) & (chroma < 30))
    conn = np.zeros_like(bg)
    conn[0, :] |= bg[0, :]
    conn[-1, :] |= bg[-1, :]
    conn[:, 0] |= bg[:, 0]
    conn[:, -1] |= bg[:, -1]
    while True:
        new = conn.copy()
        new[1:, :] |= conn[:-1, :]
        new[:-1, :] |= conn[1:, :]
        new[:, 1:] |= conn[:, :-1]
        new[:, :-1] |= conn[:, 1:]
        new &= bg
        if np.array_equal(new, conn):
            return conn
        conn = new


def diffusion_fill(img, bgm):
    """Harmonic (Laplace) fill of the keyed margin, coarse-to-fine so it is
    fast. The field continues past the squircle with no streaks and no seam."""
    H, W = img.shape[:2]

    def jacobi(u, m, iters):
        for _ in range(iters):
            p = np.pad(u, ((1, 1), (1, 1), (0, 0)), mode='edge')
            nb = (p[:-2, 1:-1] + p[2:, 1:-1] + p[1:-1, :-2] + p[1:-1, 2:]) / 4.0
            u = np.where(m[..., None], nb, u)
        return u

    def down(a, h, w):
        im = Image.fromarray(np.rint(np.clip(a, 0, 255)).astype(np.uint8))
        return np.asarray(im.resize((w, h), Image.BILINEAR)).astype(np.float32)

    u = img.astype(np.float32).copy()
    u[bgm] = img[~bgm].reshape(-1, 3).mean(0)
    for size, iters in ((80, 2600), (160, 700), (320, 250), (640, 90), (0, 40)):
        if size == 0:
            u = jacobi(u, bgm, iters)
            break
        h = max(8, int(round(H / min(H, W) * size)))
        w = max(8, int(round(W / min(H, W) * size)))
        u_s = down(u, h, w)
        m_s = np.asarray(Image.fromarray((bgm * 255).astype(np.uint8))
                         .resize((w, h), Image.BILINEAR)) > 128
        u_s = jacobi(u_s, m_s, iters)
        u = np.where(bgm[..., None], down(u_s, H, W), img)
    return np.clip(u, 0, 255)


def grade(x):
    """One coordinated palette: richer green, ivory/gold highlights, soft depth."""
    x = x / 255.0
    lum = x @ np.array([0.2126, 0.7152, 0.0722], np.float32)
    x = lum[..., None] + (x - lum[..., None]) * 1.12      # saturation
    x = (x - 0.45) * 1.07 + 0.45                           # gentle contrast
    hi = np.array([0.788, 0.682, 0.455], np.float32)       # #C9AE74 app gold
    sh = np.array([0.055, 0.200, 0.160], np.float32)       # #0E3329 deep green
    k_hi = (0.07 * lum ** 3)[..., None]
    k_sh = (0.07 * (1 - lum) ** 3)[..., None]
    x = x * (1 - k_hi) + hi * k_hi
    x = x * (1 - k_sh) + sh * k_sh
    H, W = x.shape[:2]
    ys, xs = np.mgrid[0:H, 0:W]
    rr = np.hypot(xs - (W - 1) / 2, ys - (H - 1) / 2)
    rr = rr / rr.max()
    x = x * (1 - 0.08 * rr ** 2.4)[..., None]              # gentle vignette
    # soft key light from the top-centre: lifts the field so the icon holds its
    # own next to the bright global apps without touching the ivory or gold
    x = x * (1.0 + 0.085 * np.exp(-((rr / 0.62) ** 2)))[..., None]
    return np.clip(x, 0, 1)


def main():
    if not os.path.exists(SRC):
        sys.exit('missing source artwork: %s' % SRC)
    src = np.asarray(Image.open(SRC).convert('RGB')).astype(np.float32)

    bgm = key_background(src)
    print('keyed %.2f%% of the canvas as margin/shadow' % (100 * bgm.mean()))

    filled = diffusion_fill(src, bgm)

    # square crop centred on the squircle (it is 916x961, so a symmetric
    # square crop avoids any stretching)
    green = ~bgm
    ys, xs = np.where(green)
    x0, x1 = xs.min(), xs.max()
    y0, y1 = ys.min(), ys.max()
    print('squircle bbox %d,%d - %d,%d -> %dx%d'
          % (x0, y0, x1, y1, x1 - x0 + 1, y1 - y0 + 1))
    side = max(x1 - x0 + 1, y1 - y0 + 1)
    sx0 = int(round((x0 + x1) / 2.0 - side / 2.0))
    sy0 = int(round((y0 + y1) / 2.0 - side / 2.0))
    crop = filled[sy0:sy0 + side, sx0:sx0 + side]
    im = Image.fromarray(np.rint(crop).astype(np.uint8)).resize(
        (OUT_SIZE, OUT_SIZE), Image.LANCZOS)

    out = grade(np.asarray(im).astype(np.float32))
    im = Image.fromarray(np.rint(out * 255).astype(np.uint8))
    im.save(PREPARED)

    px = im.load()
    print('wrote %s (%dx%d)' % (PREPARED, im.size[0], im.size[1]))
    for name, pt in [('corner TL', (2, 2)), ('corner TR', (OUT_SIZE - 3, 2)),
                     ('corner BL', (2, OUT_SIZE - 3)), ('corner BR', (OUT_SIZE - 3, OUT_SIZE - 3)),
                     ('mid top', (OUT_SIZE // 2, 2)), ('mid bottom', (OUT_SIZE // 2, OUT_SIZE - 3)),
                     ('centre', (OUT_SIZE // 2, OUT_SIZE // 2))]:
        print('  %-12s #%02X%02X%02X' % ((name,) + px[pt]))


if __name__ == '__main__':
    main()
