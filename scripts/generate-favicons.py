#!/usr/bin/env python3
"""Generate favicon assets from public/olmsted-mark-transparent.png.

Why opaque backgrounds: browsers composite favicons on a solid plate. Transparent
"rounded" corners become the same color as that plate, so the tab icon still
looks square. We bake a contrasting opaque frame so rounding is visible.
"""

from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
MARK = ROOT / 'public/olmsted-mark-transparent.png'

# Outer plate (shows in the corner crescents); inner tile holds the mark.
FRAME = (45, 45, 48, 255)  # #2d2d30 — reads on light and dark tab bars
TILE = (255, 255, 255, 255)
RADII = {32: 10, 48: 14, 180: 36}
INSET = {32: 1, 48: 2, 180: 4}


def resize_square(im: Image.Image, size: int) -> Image.Image:
    return im.resize((size, size), Image.Resampling.LANCZOS)


def rounded_rect(size: int, radius: int, color: tuple[int, int, int, int]) -> Image.Image:
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    draw.rounded_rectangle((0, 0, size - 1, size - 1), radius=radius, fill=color)
    return img


def build_favicon(mark: Image.Image, size: int, radius: int, inset: int) -> Image.Image:
    """Opaque favicon: dark frame + white rounded tile + mark."""
    canvas = Image.new('RGBA', (size, size), FRAME)
    inner = size - inset * 2
    inner_radius = max(2, radius - inset)
    tile = rounded_rect(inner, inner_radius, TILE)
    glyph = resize_square(mark, inner)
    tile.alpha_composite(glyph, (0, 0))
    canvas.alpha_composite(tile, (inset, inset))
    return canvas


def main() -> None:
    if not MARK.exists():
        raise SystemExit(f'Missing mark source: {MARK}')

    mark = Image.open(MARK).convert('RGBA')

    for size, radius in RADII.items():
        fav = build_favicon(mark, size, radius, INSET[size])
        if size == 32:
            fav.save(ROOT / 'public/favicon.png', optimize=True)
            fav.save(ROOT / 'public/icons/favicon-32.png', optimize=True)
            fav.save(ROOT / 'app/icon.png', optimize=True)
        elif size == 48:
            fav.save(ROOT / 'public/icons/favicon-48.png', optimize=True)
        elif size == 180:
            fav.save(ROOT / 'app/apple-icon.png', optimize=True)

    ico_src = build_favicon(mark, 32, RADII[32], INSET[32])
    ico_src.save(
        ROOT / 'app/favicon.ico',
        format='ICO',
        sizes=[(16, 16), (32, 32), (48, 48)],
    )

    # Legacy path still referenced by some clients
    build_favicon(mark, 180, RADII[180], INSET[180]).save(ROOT / 'public/icon.png', optimize=True)

    print('Generated opaque framed favicons (public/, public/icons/, app/)')


if __name__ == '__main__':
    main()
