"""Generates the Qurra launcher artwork: scripts/assets/icon-prepared.png.

The mark is deliberately minimal so it stays legible at 48dp: a pointed
mihrab arch in gold, a small crescent in its upper opening, and an open
Mushaf fanning out at the arch's base — three shapes with generous
negative space on a deep-green radial field.

Run from the repository root:
    python scripts/prep-icon.py
"""

from pathlib import Path

from PIL import Image, ImageDraw

SS = 4                                   # supersampling factor
S = 1024 * SS                            # working canvas
OUT = Path(__file__).resolve().parent / "assets" / "icon-prepared.png"

# Palette (kept in sync with the app theme).
FIELD_EDGE = (9, 30, 25)        # #091E19  field corners
FIELD_CENTER = (23, 74, 61)     # #174A3D  field middle
GLOW_TINT = (190, 158, 92)      # soft gold glow behind the mark
GOLD_LIGHT = (236, 224, 184)    # #ECE0B8  lit gold (top of the mark)
GOLD_DEEP = (158, 132, 82)      # #9E8452  shadow gold (bottom)
IVORY = (253, 247, 229)         # #FDF7E5  page ivory
IVORY_DEEP = (244, 233, 201)    # #F4E9C9  page ivory, shaded edge

C = S / 2


def lerp(a, b, t):
    return tuple(int(round(a[i] + (b[i] - a[i]) * t)) for i in range(3))


def cubic(p0, p1, p2, p3, steps=220):
    pts = []
    for i in range(steps + 1):
        t = i / steps
        u = 1.0 - t
        pts.append((
            u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
            u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1],
        ))
    return pts


def quad(p0, p1, p2, steps=180):
    pts = []
    for i in range(steps + 1):
        t = i / steps
        u = 1.0 - t
        pts.append((
            u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0],
            u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1],
        ))
    return pts


def radial_field(size, inner, outer, cx=0.5, cy=0.42):
    """Low-res radial gradient, upscaled bicubic."""
    small = 512
    img = Image.new("RGB", (small, small))
    px = img.load()
    for y in range(small):
        for x in range(small):
            dx = (x + 0.5) / small - cx
            dy = (y + 0.5) / small - cy
            d = min(1.0, ((dx * dx + dy * dy) ** 0.5) / 0.75)
            px[x, y] = lerp(inner, outer, d)
    return img.resize((size, size), Image.BICUBIC)


def vertical_gradient(size, top, bottom):
    col = Image.new("RGB", (1, size))
    px = col.load()
    for y in range(size):
        px[0, y] = lerp(top, bottom, y / max(1, size - 1))
    return col.resize((size, size), Image.BILINEAR)


def glow_mask(size, cx, cy, radius):
    """Feathered radial mask (smoothstep falloff)."""
    small = 256
    m = Image.new("L", (small, small), 0)
    px = m.load()
    scx, scy = cx * small / size, cy * small / size
    srad = radius * small / size
    for y in range(small):
        for x in range(small):
            dx = (x + 0.5) - scx
            dy = (y + 0.5) - scy
            d = ((dx * dx + dy * dy) ** 0.5) / srad
            if d < 1.0:
                t = 1.0 - d
                px[x, y] = int(255 * t * t * (3 - 2 * t))
    return m.resize((size, size), Image.BICUBIC)


def build():
    # --- deep-green field with a soft gold glow behind the mark ---
    base = radial_field(S, FIELD_CENTER, FIELD_EDGE)
    glow = glow_mask(S, C, C * 1.02, 340 * SS).point(lambda v: v // 5)
    base = Image.composite(Image.new("RGB", (S, S), GLOW_TINT), base, glow)

    gold = vertical_gradient(S, GOLD_LIGHT, GOLD_DEEP)

    def stamp(mask):
        base.paste(gold, (0, 0), mask)

    # --- mihrab arch: two ogee curves meeting in a rounded point ---
    apex = (C, 320 * SS)
    foot_l = (352 * SS, 730 * SS)
    foot_r = (672 * SS, 730 * SS)
    w = int(58 * SS)
    r = w // 2

    arch = Image.new("L", (S, S), 0)
    d = ImageDraw.Draw(arch)
    d.line(cubic(foot_l, (352 * SS, 560 * SS), (430 * SS, 430 * SS), apex),
           fill=255, width=w, joint="curve")
    d.line(cubic(foot_r, (672 * SS, 560 * SS), (590 * SS, 430 * SS), apex),
           fill=255, width=w, joint="curve")
    for p in (apex, foot_l, foot_r):        # rounded caps at every end
        d.ellipse([p[0] - r, p[1] - r, p[0] + r, p[1] + r], fill=255)
    stamp(arch)

    # --- crescent in the arch's upper opening, horns up-right ---
    cx, cy = C, 470 * SS
    ro, ri = 40 * SS, 34 * SS
    ox, oy = 15 * SS, -11 * SS
    cres = Image.new("L", (S, S), 0)
    d = ImageDraw.Draw(cres)
    d.ellipse([cx - ro, cy - ro, cx + ro, cy + ro], fill=255)
    d.ellipse([cx + ox - ri, cy + oy - ri, cx + ox + ri, cy + oy + ri], fill=0)
    stamp(cres)

    # --- open Mushaf fanning out at the arch's base ---
    top = (quad((430 * SS, 596 * SS), (476 * SS, 620 * SS), (512 * SS, 612 * SS))
           + quad((512 * SS, 612 * SS), (548 * SS, 620 * SS), (594 * SS, 596 * SS))[1:])
    bottom = (quad((404 * SS, 616 * SS), (460 * SS, 664 * SS), (512 * SS, 690 * SS))
              + quad((512 * SS, 690 * SS), (564 * SS, 664 * SS), (620 * SS, 616 * SS))[1:])
    outline = top + bottom[::-1] + [(430 * SS, 596 * SS)]

    edge = Image.new("L", (S, S), 0)
    d = ImageDraw.Draw(edge)
    d.line(outline + [outline[0]], fill=255, width=int(12 * SS), joint="curve")
    stamp(edge)

    pages = Image.new("L", (S, S), 0)
    d = ImageDraw.Draw(pages)
    d.polygon(outline, fill=255)
    base.paste(vertical_gradient(S, IVORY, IVORY_DEEP), (0, 0), pages)

    spine = Image.new("L", (S, S), 0)       # centre crease
    d = ImageDraw.Draw(spine)
    d.line([(512 * SS, 614 * SS), (512 * SS, 688 * SS)],
           fill=255, width=int(6 * SS), joint="curve")
    stamp(spine)

    OUT.parent.mkdir(parents=True, exist_ok=True)
    base.resize((1024, 1024), Image.LANCZOS).save(OUT)
    print(f"wrote {OUT} ({OUT.stat().st_size} bytes)")


if __name__ == "__main__":
    build()
