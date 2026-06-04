#!/usr/bin/env python3
"""Generate all site icons from public/olmsted-mark-transparent.png.

Browser behaviour (why icons looked different):
- Chrome tabs use favicon.ico / favicon.png (32px).
- Safari tabs prefer apple-touch-icon (180px) when linked — ours was stale.
- A square dark *frame* around a rounded inner tile still reads as a square icon.
- Fix: one rounded white tile on a dark toolbar-matched background; same asset at every size.
"""

from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
MARK = ROOT / 'public/olmsted-mark-transparent.png'

# Dark toolbar chrome (Safari / Chrome dark tabs) shows in corner crescents.
BG = (43, 43, 45, 255)
TILE = (255, 255, 255, 255)
SIZES = (32, 48, 180, 192, 512)


def resize_square(im: Image.Image, size: int) -> Image.Image:
    return im.resize((size, size), Image.Resampling.LANCZOS)


def build_icon(mark: Image.Image, size: int) -> Image.Image:
    """Rounded-rect silhouette: dark crescents outside, white tile + mark inside."""
    radius = max(4, round(size * 0.22))
    pad = max(2, round(size * 0.16))

    canvas = Image.new('RGBA', (size, size), BG)

    tile = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(tile)
    draw.rounded_rectangle((0, 0, size - 1, size - 1), radius=radius, fill=TILE)

    inner = size - pad * 2
    glyph = resize_square(mark, inner)
    tile.alpha_composite(glyph, (pad, pad))

    mask = Image.new('L', (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, size - 1, size - 1), radius=radius, fill=255)
    canvas.paste(tile, (0, 0), mask)
    return canvas


def build_maskable(mark: Image.Image, size: int) -> Image.Image:
    """PWA maskable: extra padding inside the safe zone."""
    radius = max(8, round(size * 0.18))
    pad = max(12, round(size * 0.22))

    canvas = Image.new('RGBA', (size, size), BG)
    tile = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(tile)
    inset = round(size * 0.06)
    draw.rounded_rectangle(
        (inset, inset, size - 1 - inset, size - 1 - inset),
        radius=radius,
        fill=TILE,
    )

    inner = size - pad * 2
    glyph = resize_square(mark, inner)
    tile.alpha_composite(glyph, (pad, pad))

    mask = Image.new('L', (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        (inset, inset, size - 1 - inset, size - 1 - inset),
        radius=radius,
        fill=255,
    )
    canvas.paste(tile, (0, 0), mask)
    return canvas


def write_outputs(mark: Image.Image) -> None:
    for size in SIZES:
        icon = build_icon(mark, size)
        if size == 32:
            icon.save(ROOT / 'public/favicon.png', optimize=True)
            icon.save(ROOT / 'public/icons/favicon-32.png', optimize=True)
            icon.save(ROOT / 'app/icon.png', optimize=True)
        elif size == 48:
            icon.save(ROOT / 'public/icons/favicon-48.png', optimize=True)
        elif size == 180:
            icon.save(ROOT / 'app/apple-icon.png', optimize=True)
            icon.save(ROOT / 'public/icons/apple-touch-icon.png', optimize=True)
            icon.save(ROOT / 'public/icon.png', optimize=True)
            icon.save(ROOT / 'mobile-webapp/public/icons/apple-touch-icon.png', optimize=True)
        elif size == 192:
            icon.save(ROOT / 'public/icons/icon-192.png', optimize=True)
            icon.save(ROOT / 'mobile-webapp/public/icons/icon-192.png', optimize=True)
        elif size == 512:
            icon.save(ROOT / 'public/icons/icon-512.png', optimize=True)
            icon.save(ROOT / 'mobile-webapp/public/icons/icon-512.png', optimize=True)

    build_maskable(mark, 512).save(ROOT / 'public/icons/icon-maskable-512.png', optimize=True)

    build_icon(mark, 32).save(
        ROOT / 'app/favicon.ico',
        format='ICO',
        sizes=[(16, 16), (32, 32), (48, 48)],
    )


def main() -> None:
    if not MARK.exists():
        raise SystemExit(f'Missing mark source: {MARK}')
    mark = Image.open(MARK).convert('RGBA')
    write_outputs(mark)
    print('Generated unified rounded icons for all sizes and platforms.')


if __name__ == '__main__':
    main()
