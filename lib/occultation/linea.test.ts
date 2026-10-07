import assert from 'node:assert/strict'
import test from 'node:test'

import { occultationEventFromLinea } from './linea'

test('linea row becomes an event pointed at the star', () => {
  const event = occultationEventFromLinea({
    id: 'abc',
    name: 'Interamnia',
    number: 704,
    date_time: '2026-10-08T03:00:00Z',
    ra_star_deg: 30,
    dec_star_deg: 20,
    g_star: 11.2,
    magnitude_drop: 1.4,
    event_duration: 8,
    moon_separation: 90,
    gaia_source_id: '123',
  })
  assert.ok(event)
  assert.equal(event.asteroid, '(704) Interamnia')
  assert.equal(event.star, 'Gaia DR3 123')
  assert.equal(event.raHours, 2)
  assert.equal(event.decDeg, 20)
  assert.equal(event.durationSeconds, 8)
  assert.equal(event.magnitudeDrop, 1.4)
  assert.equal(event.moonSeparationDeg, 90)
  assert.equal(event.exposureSeconds, 0.5)
  assert.ok(event.exposureCount > 30 * 60)
  assert.equal(event.plannedStartIso, '2026-10-08T02:30:00.000Z')
})

test('stars fainter than magnitude 14 are dropped', () => {
  const event = occultationEventFromLinea({
    id: 'faint',
    name: 'Faint',
    date_time: '2026-10-08T03:00:00Z',
    ra_star_deg: 30,
    dec_star_deg: 20,
    g_star: 14.5,
  })
  assert.equal(event, null)
})
