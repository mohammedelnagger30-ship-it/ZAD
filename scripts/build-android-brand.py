"""Build Android launcher, notification, and splash artwork from the Qurra brand image."""
from pathlib import Path

from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "scripts" / "assets" / "android-brand-source.png"
ANDROID_RES = ROOT / "android" / "app" / "src" / "main" / "res"
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


def make_notification_icon(image: Image.Image) -> Image.Image:
    width, height = image.size
    logo = image.crop((
        round(width * 0.29),
        round(height * 0.16),
        round(width * 0.80),
        round(height * 0.78),
    ))
    mask = Image.new("L", logo.size)
    source_pixels = logo.load()
    mask_pixels = mask.load()

    for y in range(logo.height):
        for x in range(logo.width):
            red, green, blue = source_pixels[x, y]
            green_contrast = green - max(red, blue)
            mask_pixels[x, y] = max(0, min(255, (green_contrast - 7) * 10))

    bounds = mask.point(lambda alpha: 255 if alpha > 64 else 0).getbbox()
    if bounds is None:
        raise ValueError("The supplied artwork has no recognizable green logo mark.")

    mark = mask.crop(bounds)
    mark.thumbnail((72, 82), Image.Resampling.LANCZOS)
    icon = Image.new("RGBA", (96, 96), (255, 255, 255, 0))
    white_mark = Image.new("RGBA", mark.size, (255, 255, 255, 255))
    white_mark.putalpha(mark)
    icon.alpha_composite(
        white_mark,
        ((icon.width - mark.width) // 2, (icon.height - mark.height) // 2),
    )
    return icon


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


def main() -> None:
    with Image.open(SOURCE) as uploaded:
        artwork = square_crop(uploaded.convert("RGB"))

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
    make_notification_icon(artwork).save(
        ANDROID_RES / "drawable-nodpi" / "ic_notification.png", optimize=True
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

    print("Generated Android launcher, notification, and splash artwork.")


if __name__ == "__main__":
    main()
