"""Sanity-checks the generated artwork: samples pixels where the mark
and the field should be, so a silent geometry bug can't slip through."""
from PIL import Image

im = Image.open("scripts/assets/android-brand-source.png").convert("RGB")
width, height = im.size

# (label, x, y, what we expect to see)
samples = [
    ("logo center", (round(width * 0.60), round(height * 0.48)), "green logo"),
    ("logo highlight", (round(width * 0.50), round(height * 0.63)), "gold accent"),
    ("background", (round(width * 0.05), round(height * 0.05)), "dark green"),
]


def classify(rgb):
    r, g, b = rgb
    if g > 42 and g > r * 1.5 and g > b * 1.3 and g < 130:
        return "green logo"
    if r < 35 and g < 42 and b < 40:
        return "dark green"
    if r > 180 and g > 130 and r - b > 15:
        return "gold accent"
    return "other"


for label, (x, y), want in samples:
    rgb = im.getpixel((x, y))
    got = classify(rgb)
    ok = "OK " if got == want else "?? "
    print(f"{ok}{label:16s} ({x},{y}) -> {rgb} = {got} (want {want})")
