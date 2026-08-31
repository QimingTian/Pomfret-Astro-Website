import assert from 'node:assert/strict'
import test from 'node:test'
import {
  CYGNUS_SITE,
  DEFAULT_OBSERVATORY_SITE_ID,
  liveImagingObservatorySite,
  observatoryKvKey,
  observatorySiteFromSearchParams,
  POMFRET_SITE,
  resolveObservatorySite,
  withObservatorySiteQuery,
} from './observatory-sites'
import { withObservatorySiteAsync, scopedKvKey, currentObservatorySiteId } from './observatory-site-scope'
import { getTonightScheduleStrip } from './schedule-strip'
import { REDIS_LIVE_KEYS } from './db/data-plane'
import { createRequest, listPending, consumeLatestRequest } from './imaging/queue/store'

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

test('Cygnus site resolves with Amsterdam geography', () => {
  assert.equal(resolveObservatorySite('cygnus').id, 'cygnus')
  assert.equal(CYGNUS_SITE.timezone, 'Europe/Amsterdam')
  assert.equal(CYGNUS_SITE.weatherLat, 52.352)
  assert.equal(CYGNUS_SITE.weatherLon, 4.912)
  assert.equal(observatorySiteFromSearchParams(new URLSearchParams('site=cygnus')).id, 'cygnus')
})

test('unknown or missing site resolves to Pomfret', () => {
  assert.equal(resolveObservatorySite(null).id, DEFAULT_OBSERVATORY_SITE_ID)
  assert.equal(resolveObservatorySite('unknown').id, DEFAULT_OBSERVATORY_SITE_ID)
  assert.equal(observatorySiteFromSearchParams(new URLSearchParams()).id, 'pomfret')
  assert.equal(observatorySiteFromSearchParams(new URLSearchParams('site=pomfret')).id, 'pomfret')
})

test('liveImagingObservatorySite accepts explicit id', () => {
  assert.equal(liveImagingObservatorySite().id, 'pomfret')
  assert.equal(liveImagingObservatorySite('cygnus').id, 'cygnus')
})

test('Pomfret KV keys stay unprefixed; Cygnus is namespaced', () => {
  assert.equal(observatoryKvKey('pomfret', 'observatory-status'), 'observatory-status')
  assert.equal(observatoryKvKey('', 'observatory-status'), 'observatory-status')
  assert.equal(observatoryKvKey('cygnus', 'observatory-status'), 'site:cygnus:observatory-status')
  assert.equal(observatoryKvKey('cygnus', REDIS_LIVE_KEYS.queue), 'site:cygnus:imaging-queue-requests')
})

test('withObservatorySiteQuery appends or replaces site', () => {
  assert.equal(
    withObservatorySiteQuery('https://www.pomfretastro.org/api/imaging/session-progress', 'cygnus'),
    'https://www.pomfretastro.org/api/imaging/session-progress?site=cygnus'
  )
  assert.equal(
    withObservatorySiteQuery(
      'https://www.pomfretastro.org/api/imaging/session-progress?site=pomfret',
      'cygnus'
    ),
    'https://www.pomfretastro.org/api/imaging/session-progress?site=cygnus'
  )
})

test('scopedKvKey follows ALS site', async () => {
  await withObservatorySiteAsync('pomfret', async () => {
    assert.equal(currentObservatorySiteId(), 'pomfret')
    assert.equal(scopedKvKey(REDIS_LIVE_KEYS.queue), 'imaging-queue-requests')
  })
  await withObservatorySiteAsync('cygnus', async () => {
    assert.equal(currentObservatorySiteId(), 'cygnus')
    assert.equal(scopedKvKey(REDIS_LIVE_KEYS.queue), 'site:cygnus:imaging-queue-requests')
  })
})

test('schedule strip window follows observatory timezone', () => {
  // Same civil “tonight” date can still have different UTC window starts by TZ.
  const when = new Date('2026-08-26T02:00:00.000Z')
  const pomfret = getTonightScheduleStrip(when, POMFRET_SITE)
  const cygnus = getTonightScheduleStrip(when, CYGNUS_SITE)
  assert.notEqual(pomfret.windowStartMs, cygnus.windowStartMs)
  assert.notEqual(pomfret.windowEndMs, cygnus.windowEndMs)
  // Cygnus (UTC+2 in summer) 16:00 wall is earlier in UTC than Pomfret (UTC−4) 16:00.
  assert.ok(cygnus.windowStartMs < pomfret.windowStartMs)
})

test('Cygnus queue rows are invisible to Pomfret consume', async () => {
  // Never write when live Redis or Postgres is configured — createRequest persists for real.
  const { kvEnabled } = await import('./kv-rest')
  const { postgresReadsEnabled } = await import('./db')
  if (kvEnabled() || postgresReadsEnabled()) {
    // Still verify key namespaces without writing.
    await withObservatorySiteAsync('cygnus', async () => {
      assert.equal(scopedKvKey(REDIS_LIVE_KEYS.queue), 'site:cygnus:imaging-queue-requests')
    })
    await withObservatorySiteAsync('pomfret', async () => {
      assert.equal(scopedKvKey(REDIS_LIVE_KEYS.queue), 'imaging-queue-requests')
    })
    return
  }

  await withObservatorySiteAsync('cygnus', async () => {
    const created = await createRequest({
      raHours: 20,
      decDeg: 40,
      filter: 'L',
      exposureSeconds: 60,
      count: 1,
      userId: 'test-user-cygnus',
      email: 'cygnus@example.com',
      sessionPassword: 'test-pass',
      firstName: 'Cyg',
      lastName: 'Test',
    })
    assert.ok(!('error' in created), JSON.stringify(created))
    assert.equal(created.siteId, 'cygnus')
    const pending = await listPending()
    assert.ok(pending.some((r) => r.id === created.id))
  })

  await withObservatorySiteAsync('pomfret', async () => {
    const pending = await listPending()
    assert.equal(
      pending.some((r) => r.siteId === 'cygnus' || r.userId === 'test-user-cygnus'),
      false
    )
    const consumed = await consumeLatestRequest()
    if (consumed) {
      assert.notEqual(consumed.siteId, 'cygnus')
      assert.notEqual(consumed.userId, 'test-user-cygnus')
    }
  })
})
