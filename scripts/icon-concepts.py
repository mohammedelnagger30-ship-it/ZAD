"""Four candidate marks for the Qurra icon — pick one.

Generates scripts/assets/concepts/*.png (512px previews) so the mark
can be chosen before regenerating the full icon set. All four share
the brand field (deep-green radial + soft gold glow) and palette.

Run from the repository root:
    python scripts/icon-concepts.py
"""

from pathlib import Path

from PIL import Image, ImageDraw

SS = 4                                   # supersampling factor
S = 512 * SS                            # working canvas
OUT = Path(__file__).resolve().parent / "assets" / "concepts"

# Palette (kept in sync with prep-icon.py).
FIELD_EDGE = (9, 30, 25)        # #091E19
FIELD_CENTER = (23, 74, 61)     # #174A3D
GLOW_TINT = (190, 158, 92)
GOLD_LIGHT = (236, 224, 184)    # #ECE0B8
GOLD_DEEP = (158, 132, 82)      # #9E8452
IVORY = (253, 247, 229)         # #FDF7E5
IVORY_DEEP = (244, 233, 201)    # #F4E9C9

C = S / 2


def lerp(a, b, t):
    return tuple(int(round(a[i] + (b[i] - a[i]) * t)) for i in range(3))


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


def P(v):
    """Scale a 1024-space coordinate to the working canvas."""
    return v * S / 1024


def W(px):
    return int(round(px * S / 1024))


class Canvas:
    def __init__(self):
        self.base = radial_field(S, FIELD_CENTER, FIELD_EDGE)
        glow = glow_mask(S, C, C * 1.02, P(340)).point(lambda v: v // 5)
        self.base = Image.composite(
            Image.new("RGB", (S, S), GLOW_TINT), self.base, glow)
        self.gold = vertical_gradient(S, GOLD_LIGHT, GOLD_DEEP)
        self.ivory = vertical_gradient(S, IVORY, IVORY_DEEP)

    def _mask(self):
        return Image.new("L", (S, S), 0)

    def gold_paste(self, mask):
        self.base.paste(self.gold, (0, 0), mask)

    def ivory_paste(self, mask):
        self.base.paste(self.ivory, (0, 0), mask)

    def glow_paste(self, cx, cy, radius, strength=4):
        glow = glow_mask(S, P(cx), P(cy), P(radius)).point(lambda v: v // strength)
        self.base = Image.composite(
            Image.new("RGB", (S, S), GLOW_TINT), self.base, glow)

    def save(self, name):
        OUT.mkdir(parents=True, exist_ok=True)
        self.base.resize((512, 512), Image.LANCZOS).save(OUT / name)
        print(f"  {name}")


# ---------------------------------------------------------------------------
# Concept 1 — "المصحف": one large open Mushaf, small crescent above the spine.
# ---------------------------------------------------------------------------
def concept_mushaf(cv):
    d = ImageDraw.Draw(cv._mask())  # placeholder, masks created per shape below

    top = (quad((P(330), P(500)), (P(420), P(540)), (P(512), P(515)))
           + quad((P(512), P(515)), (P(604), P(540)), (P(694), P(500)))[1:])
    bottom = (quad((P(330), P(520)), (P(420), P(620)), (P(512), P(655)))
              + quad((P(512), P(655)), (P(604), P(620)), (P(694), P(520)))[1:])
    outline = top + bottom[::-1] + [(P(330), P(500))]

    edge = cv._mask()
    d = ImageDraw.Draw(edge)
    d.line(outline + [outline[0]], fill=255, width=W(13), joint="curve")
    cv.gold_paste(edge)

    pages = cv._mask()
    d = ImageDraw.Draw(pages)
    d.polygon(outline, fill=255)
    cv.ivory_paste(pages)

    spine = cv._mask()
    d = ImageDraw.Draw(spine)
    d.line([(P(512), P(518)), (P(512), P(652))],
           fill=255, width=W(7), joint="curve")
    cv.gold_paste(spine)

    cres = cv._mask()
    d = ImageDraw.Draw(cres)
    cx, cy, ro, ri = P(512), P(370), P(34), P(29)
    ox, oy = P(13), P(-9)
    d.ellipse([cx - ro, cy - ro, cx + ro, cy + ro], fill=255)
    d.ellipse([cx + ox - ri, cy + oy - ri, cx + ox + ri, cy + oy + ri], fill=0)
    cv.gold_paste(cres)


# ---------------------------------------------------------------------------
# Concept 2 — "الهلال والمصحف": a big crescent whose horns cradle the book.
# ---------------------------------------------------------------------------
def concept_crescent_book(cv):
    cres = cv._mask()
    d = ImageDraw.Draw(cres)
    cx, cy, ro, ri = P(512), P(420), P(115), P(95)
    ox, oy = 0, P(55)                      # bite below centre -> horns point down
    d.ellipse([cx - ro, cy - ro, cx + ro, cy + ro], fill=255)
    d.ellipse([cx + ox - ri, cy + oy - ri, cx + ox + ri, cy + oy + ri], fill=0)
    cv.gold_paste(cres)

    top = (quad((P(400), P(515)), (P(456), P(540)), (P(512), P(535)))
           + quad((P(512), P(535)), (P(568), P(540)), (P(624), P(515)))[1:])
    bottom = (quad((P(370), P(535)), (P(440), P(610)), (P(512), P(660)))
              + quad((P(512), P(660)), (P(584), P(610)), (P(654), P(535)))[1:])
    outline = top + bottom[::-1] + [(P(400), P(515))]

    edge = cv._mask()
    d = ImageDraw.Draw(edge)
    d.line(outline + [outline[0]], fill=255, width=W(12), joint="curve")
    cv.gold_paste(edge)

    pages = cv._mask()
    d = ImageDraw.Draw(pages)
    d.polygon(outline, fill=255)
    cv.ivory_paste(pages)

    spine = cv._mask()
    d = ImageDraw.Draw(spine)
    d.line([(P(512), P(538)), (P(512), P(655))],
           fill=255, width=W(6), joint="curve")
    cv.gold_paste(spine)


# ---------------------------------------------------------------------------
# Concept 3 — "النجمة الثمانية": Rub el Hizb (8-point star) with a centre dot.
# ---------------------------------------------------------------------------
def concept_star(cv):
    cx, cy = P(512), P(500)
    half = P(150)
    diag = half * (2 ** 0.5)
    sw = W(34)

    star = cv._mask()
    d = ImageDraw.Draw(star)
    d.rectangle([cx - half, cy - half, cx + half, cy + half],
                outline=255, width=sw)
    d.line([(cx, cy - diag), (cx + diag, cy), (cx, cy + diag), (cx - diag, cy),
            (cx, cy - diag)], fill=255, width=sw, joint="curve")
    cv.gold_paste(star)

    dot = cv._mask()
    d = ImageDraw.Draw(dot)
    r = P(30)
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=255)
    cv.gold_paste(dot)


# ---------------------------------------------------------------------------
# Concept 4 — "الفانوس": a geometric fanoos with a glowing core.
# ---------------------------------------------------------------------------
def concept_lantern(cv):
    cv.glow_paste(512, 425, 120, strength=4)

    chain = cv._mask()
    d = ImageDraw.Draw(chain)
    r = P(10)
    d.ellipse([P(512) - r, P(238) - r, P(512) + r, P(238) + r], fill=255)
    d.line([(P(512), P(250)), (P(512), P(300))], fill=255, width=W(12))
    cv.gold_paste(chain)

    cap = cv._mask()
    d = ImageDraw.Draw(cap)
    d.polygon([(P(482), P(300)), (P(542), P(300)),
               (P(530), P(332)), (P(494), P(332))], fill=255)
    cv.gold_paste(cap)

    pts = [(P(494), P(332)), (P(530), P(332)), (P(574), P(376)),
           (P(574), P(468)), (P(512), P(548)), (P(450), P(468)),
           (P(450), P(376))]
    body = cv._mask()
    d = ImageDraw.Draw(body)
    d.line(pts + [pts[0]], fill=255, width=W(24), joint="curve")
    cv.gold_paste(body)

    core = cv._mask()
    d = ImageDraw.Draw(core)
    d.ellipse([P(512) - P(40), P(425) - P(55),
               P(512) + P(40), P(425) + P(55)], fill=255)
    cv.ivory_paste(core)

    ribs = cv._mask()
    d = ImageDraw.Draw(ribs)
    d.line([(P(478), P(372)), (P(478), P(480))], fill=255, width=W(8))
    d.line([(P(546), P(372)), (P(546), P(480))], fill=255, width=W(8))
    cv.gold_paste(ribs)

    finial = cv._mask()
    d = ImageDraw.Draw(finial)
    d.line([(P(512), P(548)), (P(512), P(566))], fill=255, width=W(10))
    r = P(9)
    d.ellipse([P(512) - r, P(578) - r, P(512) + r, P(578) + r], fill=255)
    cv.gold_paste(finial)


CONCEPTS = [
    ("1-mushaf.png", concept_mushaf),
    ("2-crescent-book.png", concept_crescent_book),
    ("3-star.png", concept_star),
    ("4-lantern.png", concept_lantern),
]

for name, draw in CONCEPTS:
    cv = Canvas()
    draw(cv)
    cv.save(name)
print("done")
