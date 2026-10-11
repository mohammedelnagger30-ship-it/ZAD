"""Prepares the Qurra launcher artwork: scripts/assets/icon-prepared.png.

The source artwork (scripts/assets/icon-source.jpg) is a soft-shadowed
mockup of the mark: a deep-green squircle field holding a pointed gold
mihrab arch, a crescent, a mosque silhouette and an open Mushaf on a
wooden stand, all on a light backdrop.

make-icons.ps1 cuts the program's true-squircle border (superellipse
n=5) out of the prepared file and paints everything outside it deep
green, so the prepared file must be the mark on a clean full-bleed
field:
  1. measure the green field (row/column profile of green pixels, so
     the baked drop shadow that hangs below the squircle never counts);
  2. cut a tight square on that field and flood the backdrop leaking
     in at its corners with the field's edge colour -- this patch now
     holds the mark (arch, crescent, mosque, Mushaf) and its glow,
     without the mockup's lit rim, its shadow or its backdrop;
  3. lay that patch, scaled down to MARK_SCALE, onto a radial
     gradient of the same family (glow tone at the centre fading to
     the edge tone), blending the two through a smoothstep ring
     FADE_IN..FADE_OUT -- the mark sits smaller, optically centred,
     in one continuous field with nothing of the mockup left over.

The blend ring follows MARK_SCALE (fractions of the patch rim), so
tune MARK_SCALE alone if a future artwork's mark needs another size.

Run from the repository root:
    python scripts/prep-icon.py
"""

from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent / "assets"
SRC = ROOT / "icon-source.jpg"
OUT = ROOT / "icon-prepared.png"

SIZE = 1024          # output edge (make-icons scales it to every target)
EDGE_INSET = 0.99    # tight field crop, slightly inside the field edge
PROFILE_FLOOR = 0.25  # rows/cols below this share of the peak count are shadow

MARK_SCALE = 0.64    # patch size on the canvas: shrinks the mark into a margin
FADE_IN_FRAC = 0.86  # full-opacity ring, as a fraction of the patch rim
FADE_OUT_FRAC = 0.97  # fully blended ring, still inside the patch rim


def field_mask(a: np.ndarray) -> np.ndarray:
    """Green field pixels: green clearly leads red, and not a light tint."""
    r, g = a[..., 0].astype(int), a[..., 1].astype(int)
    return (g > r + 8) & (g < 190)


def field_box(mask: np.ndarray) -> tuple[int, int, int, int]:
    """Tight square around the true squircle, ignoring the drop shadow."""
    cols = mask.sum(axis=0)
    rows = mask.sum(axis=1)
    x0, x1 = np.nonzero(cols >= PROFILE_FLOOR * cols.max())[0][[0, -1]]
    y0, y1 = np.nonzero(rows >= PROFILE_FLOOR * rows.max())[0][[0, -1]]
    side = int(min(x1 - x0, y1 - y0) * EDGE_INSET)
    cx, cy = (x0 + x1) // 2, (y0 + y1) // 2
    return cx - side // 2, cy - side // 2, cx + side // 2, cy + side // 2


def border_reachable(not_field: np.ndarray) -> np.ndarray:
    """Not-field pixels connected to the border without crossing the field.

    That is exactly the backdrop + shadow leaking in at the corners; the
    ivory arch, crescent, mosque and Mushaf are enclosed by green.
    """
    reach = np.zeros_like(not_field)
    reach[0, :] = not_field[0, :]
    reach[-1, :] = not_field[-1, :]
    reach[:, 0] = not_field[:, 0]
    reach[:, -1] = not_field[:, -1]
    reach &= not_field
    while True:
        grown = reach.copy()
        grown[1:, :] |= reach[:-1, :]
        grown[:-1, :] |= reach[1:, :]
        grown[:, 1:] |= reach[:, :-1]
        grown[:, :-1] |= reach[:, 1:]
        grown &= not_field
        if grown.sum() == reach.sum():
            return reach
        reach = grown


def smoothstep(t: np.ndarray) -> np.ndarray:
    t = np.clip(t, 0.0, 1.0)
    return t * t * (3 - 2 * t)


def main() -> None:
    im = Image.open(SRC).convert("RGB")
    a = np.asarray(im)

    # Tight square on the field; its corners/backdrop get flooded, so the
    # patch holds the mark and its glow but none of the mockup's frame.
    x0, y0, x1, y1 = field_box(field_mask(a))
    tight = a[y0:y1, x0:x1]
    mask = field_mask(tight)
    edge_pixels = tight[mask & border_edge(mask)]
    edge = (np.median(edge_pixels.reshape(-1, 3), axis=0) if len(edge_pixels)
            else np.median(tight[mask].reshape(-1, 3), axis=0))
    patch = tight.copy()
    patch[border_reachable(~mask)] = edge
    h, w = patch.shape[:2]
    # Glow tone: the bright field right above the mark, not the mark itself.
    glow = np.median(patch[int(h * 0.18):int(h * 0.28),
                           int(w * 0.40):int(w * 0.61)].reshape(-1, 3), axis=0)

    # One continuous radial field: glow at the centre fading to the edge.
    half = SIZE / 2
    yy, xx = np.mgrid[0:SIZE, 0:SIZE]
    rr = np.hypot(yy - half, xx - half) / half
    canvas = glow + (edge - glow) * smoothstep(rr)[..., None]

    # The patch, MARK_SCALE big, blended in through a smoothstep ring: the
    # mark shrinks and centres, the blend ends before the patch rim.
    side = int(SIZE * MARK_SCALE)
    small = np.asarray(Image.fromarray(patch).resize((side, side), Image.LANCZOS))
    pad = (SIZE - side) // 2
    layer = np.tile(edge, (SIZE, SIZE, 1)).astype(float)
    layer[pad:pad + side, pad:pad + side] = small
    fade_in, fade_out = FADE_IN_FRAC * MARK_SCALE, FADE_OUT_FRAC * MARK_SCALE
    alpha = smoothstep((fade_out - rr) / (fade_out - fade_in))[..., None]
    out = canvas * (1 - alpha) + layer * alpha

    print(f"field {w}x{h} -> mark at {MARK_SCALE:.0%}, "
          f"glow {tuple(int(v) for v in glow)}, edge {tuple(int(v) for v in edge)}")
    Image.fromarray(np.clip(out, 0, 255).astype(np.uint8)).save(OUT)
    print(f"wrote {OUT}")


def border_edge(mask: np.ndarray, width: int = 3) -> np.ndarray:
    """Field pixels within a few px of the crop border (the edge sample)."""
    ring = np.zeros_like(mask)
    ring[:width, :] = True
    ring[-width:, :] = True
    ring[:, :width] = True
    ring[:, -width:] = True
    return ring


if __name__ == "__main__":
    main()
