"""Sanity-checks the generated artwork: samples pixels where the mark
and the field should be, so a silent geometry bug can't slip through."""
from PIL import Image

im = Image.open("scripts/assets/icon-prepared.png").convert("RGB")

# (label, x, y, what we expect to see)
samples = [
    ("mark top",       512, 185, "ivory"),
    ("mark middle",    512, 456, "ivory"),
    ("mark base",      512, 722, "ivory"),
    ("field corner",   100, 100, "green field"),
    ("field top",      512, 24, "green field"),
    ("field bottom",   512, 1000, "green field"),
    ("field left",     24, 512, "green field"),
    ("field right",    1000, 512, "green field"),
]


def classify(rgb):
    r, g, b = rgb
    if r > 200 and g > 200 and b > 170:
        return "ivory"
    if g > r and g < 120 and b < 120:
        return "green field"
    return "other"


for label, x, y, want in samples:
    rgb = im.getpixel((x, y))
    got = classify(rgb)
    ok = "OK " if got == want else "?? "
    print(f"{ok}{label:16s} ({x},{y}) -> {rgb} = {got} (want {want})")
