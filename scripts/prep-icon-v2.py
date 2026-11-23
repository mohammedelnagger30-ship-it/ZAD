"""Recomposes the uploaded mark into professional launcher artwork.

    scripts/assets/icon-source-v2.png  (raw upload: the warm-ivory mark on a
                                        hand-painted green gradient)
        -- extracted + re-laid -->
    scripts/assets/icon-prepared.png          mark at 48% (legacy mipmaps,
                                              PWA icon, notification large icon)
    scripts/assets/icon-prepared-adaptive.png mark at 32% (adaptive foreground;
                                              the launcher crops 108dp to 72dp,
                                              so 32% * 1.5 = the same 48% the
                                              user actually sees on the phone)

The upload's own field is a strong off-centre gradient (bright at the top,
near-black at the bottom), so a squircle cut of it reads uneven. This script
lifts the mark out by luminance (soft alpha, so the AA edge survives), scales
it down, and lays it over one continuous radial brand field (glow centre ->
edge tone) with a soft warm glow behind it. The mark is placed by its *visual
mass* (alpha-weighted centroid) on the canvas centre, so it sits optically in
the middle even though its base is much heavier than its spires; it also stays
well inside the 66dp adaptive safe zone and every circular launcher mask.

Run from the repository root:
    python scripts/prep-icon-v2.py
"""
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent / "assets"
SRC = ROOT / "icon-source-v2.png"
OUT = ROOT / "icon-prepared.png"
OUT_ADAPTIVE = ROOT / "icon-prepared-adaptive.png"

COMPOSE = 1254          # work at the source resolution, downscale once
SIZE = 1024             # final edge (make-icons scales it to every target)
MARK_H = 0.60           # mark height on the legacy / PWA / notification icon
ADAPTIVE_MARK_H = 0.40  # mark height on the 108dp adaptive layer (1.5x crop)

FIELD_GLOW = (23, 74, 61)    # #174A3D at the field's centre
FIELD_EDGE = (9, 30, 25)     # #091E19 at its rim
GLOW_TINT = (190, 158, 92)   # warm halo that lifts the mark off the field
GLOW_STRENGTH = 0.22
GLOW_FACTOR = 0.92           # halo radius as a multiple of the mark height

ALPHA_LO, ALPHA_HI = 115.0, 165.0   # luminance ramp -> mark alpha


def smoothstep(t):
    t = np.clip(t, 0.0, 1.0)
    return t * t * (3 - 2 * t)


def main() -> None:
    src = Image.open(SRC).convert("RGB")
    a = np.asarray(src).astype(float)
    h, w = a.shape[:2]

    lum = a[..., 0] * 0.299 + a[..., 1] * 0.587 + a[..., 2] * 0.114
    alpha = smoothstep((lum - ALPHA_LO) / (ALPHA_HI - ALPHA_LO))

    ys, xs = np.nonzero(alpha > 0.5)
    y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
    mark_a = alpha[y0:y1, x0:x1]
    mark_rgb = a[y0:y1, x0:x1]
    mh, mw = y1 - y0, x1 - x0

    # visual mass of the mark, as a fraction of its bounding box
    total = alpha.sum()
    mass_x = (alpha * (np.arange(w)[None, :] + 0.5)).sum() / total
    mass_y = (alpha * (np.arange(h)[:, None] + 0.5)).sum() / total
    rel_x, rel_y = (mass_x - x0) / mw, (mass_y - y0) / mh

    for mark_h, dest in ((MARK_H, OUT), (ADAPTIVE_MARK_H, OUT_ADAPTIVE)):
        S = COMPOSE
        side = int(round(S * mark_h * mw / mh))   # keep the mark's aspect
        th = int(round(S * mark_h))
        left = int(round(S * 0.5 - rel_x * side))  # mass on the centre point
        top = int(round(S * 0.5 - rel_y * th))

        # one continuous radial field, glow at its centre fading to the rim
        yy, xx = np.mgrid[0:S, 0:S]
        rr = np.hypot(yy - S * 0.46, xx - S * 0.5) / (0.75 * S)
        t = smoothstep(rr)[..., None]
        field = np.asarray(FIELD_GLOW, float) + t * (
            np.asarray(FIELD_EDGE, float) - np.asarray(FIELD_GLOW, float))

        # soft warm halo behind the mark, scaled with it, centred on the canvas
        gd = np.hypot(yy - S * 0.5, xx - S * 0.5) / (GLOW_FACTOR * mark_h * S)
        g = (np.clip(1.0 - gd, 0.0, 1.0) ** 2 * GLOW_STRENGTH)[..., None]
        field = field * (1 - g) + np.asarray(GLOW_TINT, float) * g

        # the mark, scaled down, composited through its soft alpha
        ma = np.asarray(Image.fromarray((mark_a * 255).astype(np.uint8))
                        .resize((side, th), Image.LANCZOS)).astype(float) / 255.0
        mr = np.asarray(Image.fromarray(mark_rgb.astype(np.uint8))
                        .resize((side, th), Image.LANCZOS)).astype(float)
        reg = field[top:top + th, left:left + side]
        field[top:top + th, left:left + side] = (
            reg * (1 - ma[..., None]) + mr * ma[..., None])

        out = Image.fromarray(np.clip(field, 0, 255).astype(np.uint8)).resize(
            (SIZE, SIZE), Image.LANCZOS)
        out.save(dest)
        print(f"mark {mw}x{mh} -> {side}x{th} at top-left ({left},{top}) "
              f"[mass {rel_x:.2f},{rel_y:.2f}]; wrote {dest}")


if __name__ == "__main__":
    main()
