"""Rasterises the PGet icon (same geometry as icons/icon.svg) to PNG with Pillow.

    python extension/scripts/make-icons.py

Pillow cannot read SVG, so the shapes are redrawn here at 8x and downsampled.
The 16 px version drops the eyes so it stays readable.
"""
from pathlib import Path
from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parent.parent / "icons"
NAVY, WHITE, BEAK, ARROW = "#13213a", "#ffffff", "#f59e0b", "#1f6feb"


def draw(size: int) -> Image.Image:
    ss = 8
    S = size * ss
    k = S / 128
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))

    # vertical gradient background in a rounded square
    grad = Image.new("RGBA", (S, S))
    gd = ImageDraw.Draw(grad)
    top, bot = (0x3B, 0x82, 0xF6), (0x1F, 0x5F, 0xD6)
    for y in range(S):
        f = y / (S - 1)
        gd.line([(0, y), (S, y)], fill=tuple(round(a + (b - a) * f) for a, b in zip(top, bot)) + (255,))
    mask = Image.new("L", (S, S), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, S - 1, S - 1], radius=28 * k, fill=255)
    img.paste(grad, (0, 0), mask)

    d = ImageDraw.Draw(img)

    def ell(cx, cy, rx, ry, fill):
        d.ellipse([(cx - rx) * k, (cy - ry) * k, (cx + rx) * k, (cy + ry) * k], fill=fill)

    def poly(pts, fill):
        d.polygon([(x * k, y * k) for x, y in pts], fill=fill)

    ell(64, 72, 40, 46, NAVY)
    ell(64, 82, 27, 32, WHITE)
    if size >= 32:
        ell(52, 47, 8.5, 8.5, WHITE)
        ell(76, 47, 8.5, 8.5, WHITE)
        ell(53.5, 48, 4, 4, NAVY)
        ell(74.5, 48, 4, 4, NAVY)
        poly([(57, 58), (71, 58), (64, 67)], BEAK)
        d.rounded_rectangle([60 * k, 72 * k, 68 * k, 89 * k], radius=2 * k, fill=ARROW)
        poly([(48, 85.5), (80, 85.5), (64, 104)], ARROW)
    else:
        # 16 px: beak + chunkier arrow only
        poly([(54, 52), (74, 52), (64, 64)], BEAK)
        d.rectangle([57 * k, 68 * k, 71 * k, 86 * k], fill=ARROW)
        poly([(44, 84), (84, 84), (64, 108)], ARROW)

    return img.resize((size, size), Image.LANCZOS)


for s in (16, 32, 48, 128):
    draw(s).save(OUT / f"icon-{s}.png", optimize=True)
    print("wrote", OUT / f"icon-{s}.png")
