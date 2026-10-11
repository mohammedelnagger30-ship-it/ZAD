"""Sanity-checks the generated artwork: samples pixels where each
shape should be, so a silent geometry bug can't slip through."""
from PIL import Image

im = Image.open("scripts/assets/icon-prepared.png").convert("RGB")

# (label, x, y, what we expect to see)
samples = [
    ("arch apex",      512, 320, "gold"),
    ("arch left foot", 352, 730, "gold"),
    ("arch right foot", 672, 730, "gold"),
    ("crescent body",  480, 494, "gold"),
    ("crescent bite",  527, 459, "green field"),
    ("book pages",     512, 650, "ivory"),
    ("book spine",     512, 640, "gold line"),
    ("field corner",   100, 100, "dark green"),
    ("field top",      512, 100, "mid green"),
    ("gap arch/book",  512, 550, "green field"),
]


def classify(rgb):
    r, g, b = rgb
    if r > 200 and g > 200 and b > 170:
        return "ivory"
    if r > 140 and g > 110 and b < 140 and r > b + 40:
        return "gold"
    if g > r and g > b:
        return "green field"
    return "other"


for label, x, y, want in samples:
    rgb = im.getpixel((x, y))
    got = classify(rgb)
    ok = "OK " if got == want else "?? "
    print(f"{ok}{label:16s} ({x},{y}) -> {rgb} = {got} (want {want})")
