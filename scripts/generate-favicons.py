#!/usr/bin/env python3
"""Generate favicon assets from public/olmsted-mark-transparent.png."""

from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
MARK = ROOT / 'public/olmsted-mark-transparent.png'
# ~37% radius — visible in file/bookmark; browser tabs may still apply their own mask.
RADII = {32: 12, 48: 18, 180: 32}


def round_corners(im: Image.Image, radius: int) -> Image.Image:
    im = im.convert('RGBA')
    mask = Image.new('L', im.size, 0)
    draw = ImageDraw.Draw(mask)
    draw.rounded_rectangle((0, 0, im.size[0], im.size[1]), radius=radius, fill=255)
    out = Image.new('RGBA', im.size, (0, 0, 0, 0))
    out.paste(im, mask=mask)
    return out


def resize_square(im: Image.Image, size: int) -> Image.Image:
    return im.resize((size, size), Image.Resampling.LANCZOS)


def main() -> None:
    if not MARK.exists():
        raise SystemExit(f'Missing mark source: {MARK}')

    mark = Image.open(MARK).convert('RGBA')

    for size, radius in RADII.items():
        fav = round_corners(resize_square(mark, size), radius)
        if size == 32:
            fav.save(ROOT / 'public/favicon.png', optimize=True)
            fav.save(ROOT / 'public/icons/favicon-32.png', optimize=True)
            fav.save(ROOT / 'app/icon.png', optimize=True)
        elif size == 48:
            fav.save(ROOT / 'public/icons/favicon-48.png', optimize=True)
        elif size == 180:
            fav.save(ROOT / 'app/apple-icon.png', optimize=True)

    ico_src = round_corners(resize_square(mark, 32), RADII[32])
    ico_src.save(
        ROOT / 'app/favicon.ico',
        format='ICO',
        sizes=[(16, 16), (32, 32), (48, 48)],
    )

    print('Generated favicons in public/, public/icons/, and app/')


if __name__ == '__main__':
    main()
