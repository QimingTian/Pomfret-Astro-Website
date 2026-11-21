import assert from 'node:assert/strict'
import test from 'node:test'
import {
  PUBLIC_DATA_CATALOG,
  publicDataAltText,
  publicDataByCategory,
  publicDataBySlug,
  publicDataExploreSrc,
} from '@/lib/public-data-catalog'

test('catalog has unique slugs and SEO explore paths', () => {
  const slugs = PUBLIC_DATA_CATALOG.map((e) => e.slug)
  assert.equal(new Set(slugs).size, slugs.length)
  for (const e of PUBLIC_DATA_CATALOG) {
    assert.ok(e.exploreImage.endsWith('.webp'))
    assert.ok(e.exploreThumb.endsWith('-thumb.webp') || e.exploreThumb.includes('thumb'))
    assert.ok(publicDataExploreSrc(e).startsWith('/explore/'))
  }
})

test('w80 includes North America / NGC 7000 aliases', () => {
  const w80 = publicDataBySlug('w80')
  assert.ok(w80)
  assert.equal(w80.flagship, true)
  assert.ok(w80.aliases.includes('North America Nebula'))
  assert.ok(w80.aliases.includes('NGC 7000'))
  assert.match(publicDataAltText(w80), /North America Nebula/)
})

test('category filters deep sky vs photometry', () => {
  assert.ok(publicDataByCategory('deep_sky').length >= 7)
  assert.equal(publicDataByCategory('photometry').length, 1)
  assert.equal(publicDataByCategory('photometry')[0]?.slug, 'xz-dra')
})
