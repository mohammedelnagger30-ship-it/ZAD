"""Build Android launcher, notification, and splash artwork from the Qurra brand image."""
from pathlib import Path
import base64

from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "scripts" / "assets" / "android-brand-source.png"
ANDROID_RES = ROOT / "android" / "app" / "src" / "main" / "res"
PUBLIC_DIR = ROOT / "public"
PUBLIC_ICONS = PUBLIC_DIR / "icons"
BACKGROUND = (3, 31, 17)
ICON_SIZES = {
    "mipmap-mdpi": 48,
    "mipmap-hdpi": 72,
    "mipmap-xhdpi": 96,
    "mipmap-xxhdpi": 144,
    "mipmap-xxxhdpi": 192,
}


def square_crop(image: Image.Image) -> Image.Image:
    width, height = image.size
    side = min(width, height)
    left = (width - side) // 2
    top = (height - side) // 2
    return image.crop((left, top, left + side, top + side))


def make_circle_icon(image: Image.Image, size: int) -> Image.Image:
    scale = 4
    high_size = size * scale
    high_image = image.resize((high_size, high_size), Image.Resampling.LANCZOS)
    mask = Image.new("L", (high_size, high_size), 0)
    ImageDraw.Draw(mask).ellipse((0, 0, high_size - 1, high_size - 1), fill=255)
    background = Image.new("RGB", (high_size, high_size), BACKGROUND)
    background.paste(high_image, mask=mask)
    return background.resize((size, size), Image.Resampling.LANCZOS)


def replace_legacy_splash_assets(image: Image.Image) -> None:
    for path in ANDROID_RES.glob("drawable*/splash.png"):
        with Image.open(path) as old_splash:
            size = old_splash.size

        canvas = Image.new("RGB", size, BACKGROUND)
        mark_size = round(min(size) * 0.38)
        mark = image.resize((mark_size, mark_size), Image.Resampling.LANCZOS)
        canvas.paste(
            mark,
            ((size[0] - mark_size) // 2, (size[1] - mark_size) // 2),
        )
        canvas.save(path, optimize=True)


def generate_web_brand_assets(image: Image.Image) -> None:
    PUBLIC_ICONS.mkdir(parents=True, exist_ok=True)
    for size in (192, 512):
        image.resize((size, size), Image.Resampling.LANCZOS).save(
            PUBLIC_ICONS / f"icon-{size}.png", optimize=True
        )

    encoded_icon = base64.b64encode(
        (PUBLIC_ICONS / "icon-512.png").read_bytes()
    ).decode("ascii")
    (PUBLIC_DIR / "icon.svg").write_text(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" '
        'width="512" height="512">\n'
        "  <title>قُرّة Qurra</title>\n"
        f'  <image href="data:image/png;base64,{encoded_icon}" '
        'x="0" y="0" width="512" height="512"/>\n'
        "</svg>\n",
        encoding="utf-8",
    )

    width, height = 1200, 630
    background = Image.new("RGB", (width, height))
    draw = ImageDraw.Draw(background)
    for x in range(width):
        blend = x / (width - 1)
        color = tuple(
            round(BACKGROUND[channel] * (1 - blend) + (14, 51, 44)[channel] * blend)
            for channel in range(3)
        )
        draw.line((x, 0, x, height), fill=color)

    draw.ellipse((355, -165, 845, 325), outline=(42, 94, 64), width=2)
    draw.ellipse((300, -220, 900, 380), outline=(27, 70, 46), width=2)
    mark_size = 420
    mark = image.resize((mark_size, mark_size), Image.Resampling.LANCZOS)
    background.paste(mark, ((width - mark_size) // 2, (height - mark_size) // 2))
    try:
        font = ImageFont.truetype(r"C:\Windows\Fonts\segoeui.ttf", 32)
    except OSError:
        font = ImageFont.load_default()
    label = "QURRA"
    label_box = draw.textbbox((0, 0), label, font=font)
    draw.text(
        ((width - (label_box[2] - label_box[0])) // 2, 555),
        label,
        font=font,
        fill=(244, 224, 179),
    )
    background.save(PUBLIC_ICONS / "og-image.png", optimize=True)


def main() -> None:
    with Image.open(SOURCE) as uploaded:
        artwork = square_crop(uploaded.convert("RGB"))

    generate_web_brand_assets(artwork)

    for folder, size in ICON_SIZES.items():
        target = ANDROID_RES / folder
        target.mkdir(parents=True, exist_ok=True)
        artwork.resize((size, size), Image.Resampling.LANCZOS).save(
            target / "ic_launcher.png", optimize=True
        )
        make_circle_icon(artwork, size).save(
            target / "ic_launcher_round.png", optimize=True
        )

        adaptive = Image.new("RGB", (size, size), BACKGROUND)
        art_size = round(size * 0.62)
        scaled = artwork.resize((art_size, art_size), Image.Resampling.LANCZOS)
        adaptive.paste(scaled, ((size - art_size) // 2, (size - art_size) // 2))
        adaptive.save(target / "ic_launcher_foreground.png", optimize=True)

    adaptive_foreground = Image.new("RGB", (432, 432), BACKGROUND)
    art_size = round(432 * 0.62)
    scaled = artwork.resize((art_size, art_size), Image.Resampling.LANCZOS)
    adaptive_foreground.paste(scaled, ((432 - art_size) // 2, (432 - art_size) // 2))
    adaptive_foreground.save(
        ANDROID_RES / "drawable-nodpi" / "ic_launcher_foreground.png", optimize=True
    )
    artwork.resize((1024, 1024), Image.Resampling.LANCZOS).save(
        ANDROID_RES / "drawable-nodpi" / "launch_brand.png", optimize=True
    )
    artwork.resize((256, 256), Image.Resampling.LANCZOS).save(
        ANDROID_RES / "drawable-nodpi" / "ic_notification_large.png",
        optimize=True,
    )
    values = ANDROID_RES / "values"
    values.mkdir(parents=True, exist_ok=True)
    (values / "ic_launcher_background.xml").write_text(
        '<?xml version="1.0" encoding="utf-8"?>\n'
        "<resources>\n"
        f'    <color name="ic_launcher_background">#{BACKGROUND[0]:02X}'
        f'{BACKGROUND[1]:02X}{BACKGROUND[2]:02X}</color>\n'
        "</resources>\n",
        encoding="utf-8",
    )
    (values / "launch_colors.xml").write_text(
        '<?xml version="1.0" encoding="utf-8"?>\n'
        "<resources>\n"
        f'    <color name="launch_background">#{BACKGROUND[0]:02X}'
        f'{BACKGROUND[1]:02X}{BACKGROUND[2]:02X}</color>\n'
        "</resources>\n",
        encoding="utf-8",
    )
    replace_legacy_splash_assets(artwork)

    print("Generated web and Android branding from the supplied Qurra artwork.")


if __name__ == "__main__":
    main()
