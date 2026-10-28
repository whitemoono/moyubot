"""Export desktop icons from the transparent high-resolution brand artwork (Pillow)."""
from pathlib import Path

from PIL import Image, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "moyubot-landing/site/logo.webp"
BUILD = ROOT / "apps/desktop/build"
BRAND = ROOT / "apps/desktop/src/assets/brand"

image = Image.open(SOURCE).convert("RGBA")
# The source has a hard transparency mask with a few white matte pixels at its
# boundary. Move the mask inward 3 source pixels and soften it before resizing.
# Work from the alpha channel so white details inside the artwork remain intact.
alpha = image.getchannel("A").filter(ImageFilter.MinFilter(7))
image.putalpha(alpha.filter(ImageFilter.GaussianBlur(0.6)))


def resized(size: int) -> Image.Image:
    # Premultiply during filtering so transparent RGB cannot create a pale halo.
    result = image.convert("RGBa").resize((size, size), Image.Resampling.LANCZOS).convert("RGBA")
    result.putalpha(result.getchannel("A").point(lambda value: 0 if value < 4 else value))
    return result


BUILD.mkdir(parents=True, exist_ok=True)
BRAND.mkdir(parents=True, exist_ok=True)
resized(512).save(BUILD / "icon.png", optimize=True)
resized(256).save(BRAND / "logo.png", optimize=True)
sizes = (16, 20, 24, 32, 40, 48, 64, 128, 256)
frames = [resized(size) for size in sizes]
frames[-1].save(BUILD / "icon.ico", format="ICO", sizes=[(size, size) for size in sizes], append_images=frames[:-1])
print("Exported transparent desktop PNGs and Windows multi-size ICO.")
