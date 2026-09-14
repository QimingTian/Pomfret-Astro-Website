import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import {
  geocolorFramePaths,
  geocolorLatLonToScan,
  geocolorSiteInCoverFrame,
  geocolorSitePinPercent,
  geocolorSiteView,
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

  test('geocolorSitePinPercent centers Pomfret in the zoomed viewport', () => {
    const pin = geocolorSitePinPercent(41.9159, -71.9626)
    assert.ok(pin)
    assert.ok(Math.abs(pin!.leftPct - 50) < 0.01)
    assert.ok(Math.abs(pin!.topPct - 50) < 0.01)

    const pomfret = geocolorSiteInCoverFrame(41.9159, -71.9626)
    const boston = geocolorSiteInCoverFrame(42.36, -71.06)
    assert.ok(pomfret)
    assert.ok(boston)
    // Boston is east/north of Pomfret in the covered CONUS paint.
    assert.ok(boston!.x > pomfret!.x)
    assert.ok(boston!.y < pomfret!.y)
  })

  test('geocolorSiteView zooms around Pomfret cover coordinates', () => {
    const view = geocolorSiteView(41.9159, -71.9626)
    const cover = geocolorSiteInCoverFrame(41.9159, -71.9626)
    assert.ok(view)
    assert.ok(cover)
    assert.equal(view!.transformOrigin, `${cover!.x * 100}% ${cover!.y * 100}%`)
    assert.match(view!.transform, /scale\(2\)/)
    assert.equal(view!.pinLeftPct, 50)
    assert.equal(view!.pinTopPct, 50)
  })

  test('geocolorLatLonToScan returns ABI angles for Pomfret', () => {
    const scan = geocolorLatLonToScan(41.9159, -71.9626)
    assert.ok(scan)
    assert.ok(scan!.x > 0 && scan!.x < 0.02)
    assert.ok(scan!.y > 0.1 && scan!.y < 0.13)
  })

  test('geocolorSitePinPercent returns null for Cygnus (off CONUS)', () => {
    assert.equal(geocolorSitePinPercent(52.352, 4.912), null)
    assert.equal(geocolorSiteView(52.352, 4.912), null)
  })
})
