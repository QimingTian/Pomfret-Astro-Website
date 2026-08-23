import assert from 'node:assert/strict'
import test from 'node:test'
import {
  DEFAULT_OBSERVATORY_SITE_ID,
  liveImagingObservatorySite,
  observatoryKvKey,
  observatorySiteFromSearchParams,
  POMFRET_SITE,
  resolveObservatorySite,
} from './observatory-sites'

test('Pomfret weather pin matches historical Open-Meteo constants', () => {
  assert.equal(POMFRET_SITE.weatherLat, 41.9159)
  assert.equal(POMFRET_SITE.weatherLon, -71.9626)
  assert.equal(POMFRET_SITE.elevationMeters, 150)
  assert.equal(POMFRET_SITE.timezone, 'America/New_York')
})

test('Pomfret observer coordinates match historical DMS', () => {
  assert.equal(POMFRET_SITE.observerLatDeg, 41 + 53 / 60 + 10 / 3600)
  assert.equal(POMFRET_SITE.observerLonDeg, -(71 + 57 / 60 + 54 / 3600))
})

test('unknown or missing site resolves to Pomfret', () => {
  assert.equal(resolveObservatorySite(null).id, DEFAULT_OBSERVATORY_SITE_ID)
  assert.equal(resolveObservatorySite('cygnus').id, DEFAULT_OBSERVATORY_SITE_ID)
  assert.equal(observatorySiteFromSearchParams(new URLSearchParams()).id, 'pomfret')
  assert.equal(observatorySiteFromSearchParams(new URLSearchParams('site=pomfret')).id, 'pomfret')
})

test('imaging live site is always Pomfret', () => {
  assert.equal(liveImagingObservatorySite().id, 'pomfret')
})

test('Pomfret KV keys stay unprefixed', () => {
  assert.equal(observatoryKvKey('pomfret', 'observatory-status'), 'observatory-status')
  assert.equal(observatoryKvKey('', 'observatory-status'), 'observatory-status')
  assert.equal(observatoryKvKey('cygnus', 'observatory-status'), 'site:cygnus:observatory-status')
})
