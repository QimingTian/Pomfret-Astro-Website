#!/usr/bin/env node
/**
 * Grid thumbnails for the Our Data gallery.
 *
 * The grid used to point at the full-size files, so opening the page decoded every deep-sky image
 * at once — around 166 megapixels, over half a gigabyte of bitmap. Mobile Safari killed the tab
 * and offered "a problem repeatedly occurred". Tiles now load these thumbnails and the full file
 * is fetched only when the lightbox opens.
 *
 * Run after adding or replacing anything in public/gallery. Needs cwebp (brew install webp).
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const GALLERY_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'gallery')
const THUMB_SUFFIX = '-thumb.webp'
/** Widest a tile gets is the 2x2 flagship cell, so this covers it at 2x pixel density. */
const THUMB_WIDTH = 1600
const THUMB_QUALITY = 78

function sh(file, args) {
  return execFileSync(file, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
}

if (!existsSync(GALLERY_DIR)) {
  console.error(`No gallery directory at ${GALLERY_DIR}`)
  process.exit(1)
}

try {
  sh('cwebp', ['-version'])
} catch {
  console.error('cwebp not found on PATH. Install it with: brew install webp')
  process.exit(1)
}

const sources = readdirSync(GALLERY_DIR)
  .filter((name) => name.endsWith('.webp') && !name.endsWith(THUMB_SUFFIX))
  .sort()

if (sources.length === 0) {
  console.log('Nothing to do: no full-size .webp files found.')
  process.exit(0)
}

for (const name of sources) {
  const source = join(GALLERY_DIR, name)
  const thumb = join(GALLERY_DIR, name.replace(/\.webp$/, THUMB_SUFFIX))
  // cwebp only reads PNG/JPEG/TIFF, so decode the source first.
  const decoded = join(GALLERY_DIR, `${name}.tmp.png`)
  sh('dwebp', [source, '-o', decoded])
  try {
    sh('cwebp', [
      '-q',
      String(THUMB_QUALITY),
      '-m',
      '6',
      '-resize',
      String(THUMB_WIDTH),
      '0',
      '-metadata',
      'none',
      decoded,
      '-o',
      thumb,
    ])
  } finally {
    sh('rm', ['-f', decoded])
  }
  const fullKb = Math.round(statSync(source).size / 1024)
  const thumbKb = Math.round(statSync(thumb).size / 1024)
  console.log(`${name}: ${fullKb} KB -> ${thumbKb} KB thumbnail`)
}
