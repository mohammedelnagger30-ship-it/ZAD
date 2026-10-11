"""Prepares the Qurra launcher artwork: scripts/assets/icon-prepared.png.

The source artwork (scripts/assets/icon-source.jpg) is a soft-shadowed
mockup of the mark: a deep-green squircle field holding a pointed gold
mihrab arch, a crescent, a mosque silhouette and an open Mushaf on a
wooden stand, all on a light backdrop.

make-icons.ps1 cuts the program's true-squircle border (superellipse
n=5) out of the prepared file and paints everything outside it deep
green, so the prepared file must be the mark full-bleed:
  1. crop the green squircle field edge-to-edge (its extents come from
     a row/column profile of green pixels, so the baked drop shadow
     that hangs below the squircle never counts as field);
  2. flood the light backdrop (and its shadow) that leaks in at the
     corners with the field's own edge colour -- every such pixel is
     reachable from the border without crossing green, while the arch,
     crescent, mosque and Mushaf stay safely inside the field.

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
EDGE_INSET = 0.99    # crop slightly inside the field so no light halo
PROFILE_FLOOR = 0.25  # rows/cols below this share of the peak count are shadow


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


def main() -> None:
    im = Image.open(SRC).convert("RGB")
    a = np.asarray(im)
    x0, y0, x1, y1 = field_box(field_mask(a))
    crop = a[y0:y1, x0:x1]
    print(f"field crop {x1 - x0}x{y1 - y0} from {im.size[0]}x{im.size[1]}")

    mask = field_mask(crop)
    leak = border_reachable(~mask)
    # The field's own edge colour, sampled where it meets the crop border.
    edge_pixels = crop[mask & border_edge(mask)]
    edge = (np.median(edge_pixels.reshape(-1, 3), axis=0) if len(edge_pixels)
            else np.median(crop[mask].reshape(-1, 3), axis=0))
    print(f"backdrop pixels to fill: {int(leak.sum())}, edge colour {tuple(int(v) for v in edge)}")

    out = crop.copy()
    out[leak] = edge
    Image.fromarray(out).resize((SIZE, SIZE), Image.LANCZOS).save(OUT)
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
