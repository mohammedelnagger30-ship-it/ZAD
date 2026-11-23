#!/usr/bin/env python3
"""Build the notification icons from the traced hollow-Qaf vector.

Android's notification *small* icon must be a bitmap alpha mask: a VectorDrawable
works on some devices but Xiaomi/MIUI (and a few other skins) silently falls back
to the launcher icon. Rendering the very same path from
``res/drawable/ic_qaf_notification.xml`` to density-specific PNGs keeps the shape
identical everywhere while making it a real notification icon.

The large icon is the same lettering in silver, so the notification row shows the
hollow Qaf instead of the full launcher artwork.
"""

from __future__ import annotations

import re
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
RES = ROOT / "android" / "app" / "src" / "main" / "res"
VECTOR = RES / "drawable" / "ic_qaf_notification.xml"

# Density bucket -> icon size in dp-independent pixels (24dp at each density).
DENSITIES = {
    "mdpi": 24,
    "hdpi": 36,
    "xhdpi": 48,
    "xxhdpi": 72,
    "xxxhdpi": 96,
}

VIEWPORT = 24.0
SUPERSAMPLE = 8


def read_path_data() -> str:
    text = VECTOR.read_text(encoding="utf-8")
    match = re.search(r'android:pathData="([^"]+)"', text, re.S)
    if not match:
        raise SystemExit(f"No pathData found in {VECTOR}")
    return match.group(1)


def parse_subpaths(path_data: str) -> list[list[tuple[float, float]]]:
    """Read the M/L/Z absolute path used by the vector drawable."""
    tokens = re.findall(r"[MLZ]|-?\d+(?:\.\d+)?", path_data)
    subpaths: list[list[tuple[float, float]]] = []
    current: list[tuple[float, float]] = []
    i = 0
    while i < len(tokens):
        token = tokens[i]
        if token == "M":
            if current:
                subpaths.append(current)
            current = [(float(tokens[i + 1]), float(tokens[i + 2]))]
            i += 3
        elif token == "L":
            current.append((float(tokens[i + 1]), float(tokens[i + 2])))
            i += 3
        elif token == "Z":
            if current:
                subpaths.append(current)
                current = []
            i += 1
        else:
            raise SystemExit(f"Unexpected token in pathData: {token!r}")
    if current:
        subpaths.append(current)
    return subpaths


def render_mask(subpaths: list[list[tuple[float, float]]], size: int) -> Image.Image:
    """Even-odd filled alpha mask of all subpaths, antialiased via downsampling."""
    scale = SUPERSAMPLE
    hi = size * scale
    result: Image.Image | None = None
    for subpath in subpaths:
        layer = Image.new("1", (hi, hi), 0)
        draw = ImageDraw.Draw(layer)
        polygon = [(x / VIEWPORT * hi, y / VIEWPORT * hi) for x, y in subpath]
        draw.polygon(polygon, fill=1)
        result = layer if result is None else ImageChops.logical_xor(result, layer)
    if result is None:
        raise SystemExit("No subpaths to render")
    return result.convert("L").resize((size, size), Image.Resampling.LANCZOS)


def main() -> None:
    subpaths = parse_subpaths(read_path_data())
    for density, size in DENSITIES.items():
        folder = RES / f"drawable-{density}"
        folder.mkdir(parents=True, exist_ok=True)
        mask = render_mask(subpaths, size)
        # Notification small icons are alpha masks; the system tints the white.
        icon = Image.new("RGBA", (size, size), (255, 255, 255, 0))
        icon.putalpha(mask)
        target = folder / "ic_qaf_notification.png"
        icon.save(target, optimize=True)
        print(f"wrote {target.relative_to(ROOT)} ({size}x{size})")

    # The large icon shown inside the notification row: silver Qaf, transparent
    # background, so it stays legible on both light and dark notification themes.
    large = Image.new("RGBA", (256, 256), (0, 0, 0, 0))
    alpha = render_mask(subpaths, 256)
    large.paste((226, 232, 232, 255), (0, 0), alpha)
    target = RES / "drawable-nodpi" / "ic_notification_large.png"
    large.save(target, optimize=True)
    print(f"wrote {target.relative_to(ROOT)} (256x256)")

    # The browser test notification in Settings references this path.
    web = Image.new("RGBA", (96, 96), (0, 0, 0, 0))
    web.paste((226, 232, 232, 255), (0, 0), render_mask(subpaths, 96))
    target = ROOT / "public" / "ic_qaf_notification.png"
    web.save(target, optimize=True)
    print(f"wrote {target.relative_to(ROOT)} (96x96)")


if __name__ == "__main__":
    main()
