import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import {
  geocolorFramePaths,
  geocolorSitePinPercent,
  noaaGoesProxyUrl,
  parseGeocolorFrameFilenames,
  parseGeocolorFrameUtc,
  resolveNoaaGoesUrl,
} from '@/lib/noaa-goes'

describe('noaa-goes', () => {
  test('parseGeocolorFrameFilenames extracts and sorts 625x375 frames', () => {
    const html = `
      <a href="20261421911_GOES19-ABI-CONUS-GEOCOLOR-625x375.jpg">x</a>
      <a href="20261421906_GOES19-ABI-CONUS-GEOCOLOR-625x375.jpg">y</a>
      <a href="20261421906_GOES19-ABI-CONUS-GEOCOLOR-1250x750.jpg">z</a>
    `
    assert.deepEqual(parseGeocolorFrameFilenames(html), [
      '20261421906_GOES19-ABI-CONUS-GEOCOLOR-625x375.jpg',
      '20261421911_GOES19-ABI-CONUS-GEOCOLOR-625x375.jpg',
    ])
  })

  test('geocolorFramePaths keeps only the most recent frames', () => {
    const names = Array.from({ length: 30 }, (_, i) => {
      const mm = String(i).padStart(2, '0')
      return `202614219${mm}_GOES19-ABI-CONUS-GEOCOLOR-625x375.jpg`
    })
    const paths = geocolorFramePaths(names, 3)
    assert.equal(paths.length, 3)
    assert.match(paths[2]!, /20261421929_GOES19/)
  })

  test('resolveNoaaGoesUrl allowlists GeoColor JPG paths only', () => {
    const ok =
      'https://cdn.star.nesdis.noaa.gov/GOES19/ABI/CONUS/GEOCOLOR/20261421906_GOES19-ABI-CONUS-GEOCOLOR-625x375.jpg'
    assert.equal(resolveNoaaGoesUrl(ok), ok)
    assert.equal(resolveNoaaGoesUrl(null), null)
    assert.equal(
      resolveNoaaGoesUrl(
        'https://cdn.star.nesdis.noaa.gov/GOES19/ABI/CONUS/GEOCOLOR/GOES19-CONUS-GEOCOLOR-625x375.gif'
      ),
      null
    )
    assert.equal(resolveNoaaGoesUrl('https://evil.example/GOES19/x.jpg'), null)
  })

  test('noaaGoesProxyUrl encodes upstream URL', () => {
    const url = noaaGoesProxyUrl(
      '/GOES19/ABI/CONUS/GEOCOLOR/20261421906_GOES19-ABI-CONUS-GEOCOLOR-625x375.jpg'
    )
    assert.ok(url.startsWith('/api/noaa-goes?url='))
    assert.ok(url.includes(encodeURIComponent('cdn.star.nesdis.noaa.gov')))
  })

  test('parseGeocolorFrameUtc reads YYYY + Julian day + HHMM as UTC', () => {
    const path =
      '/GOES19/ABI/CONUS/GEOCOLOR/20261421906_GOES19-ABI-CONUS-GEOCOLOR-625x375.jpg'
    const utc = parseGeocolorFrameUtc(path)
    assert.ok(utc)
    assert.equal(utc!.getUTCFullYear(), 2026)
    assert.equal(utc!.getUTCMonth(), 4)
    assert.equal(utc!.getUTCDate(), 22)
    assert.equal(utc!.getUTCHours(), 19)
    assert.equal(utc!.getUTCMinutes(), 6)
  })

  test('geocolorSitePinPercent places Pomfret in the NE zoom viewport', () => {
    const pin = geocolorSitePinPercent(41.9159, -71.9626)
    assert.ok(pin)
    assert.ok(pin!.leftPct > 50 && pin!.leftPct < 95)
    assert.ok(pin!.topPct > 40 && pin!.topPct < 70)
    const boston = geocolorSitePinPercent(42.36, -71.06)
    assert.ok(boston)
  })

  test('geocolorSitePinPercent returns null for Cygnus (off CONUS)', () => {
    assert.equal(geocolorSitePinPercent(52.352, 4.912), null)
  })
})
