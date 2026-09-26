import assert from 'node:assert/strict'
import test from 'node:test'
import {
  meteoAlarmThunderObservations,
  metarThunderObservations,
  nwsThunderObservations,
  parseMetarThunder,
} from './storm-observations'
import { pickObservedStormThreat, pickWeatherSafetyThreat } from './weather-safety-estop'

const POMFRET = { lat: 41.886, lon: -71.965 }

test('parseMetarThunder finds TS in present weather and LTG in remarks', () => {
  assert.deepEqual(
    parseMetarThunder(
      'METAR KIJD 261652Z AUTO 03011KT 1 1/2SM +TSRA BR SCT011 BKN018 OVC029 13/12 A2984 RMK AO2 PK WND 03030/1612 LTG DSNT NE TSB38'
    ),
    { thunder: true, lightning: true }
  )
  assert.deepEqual(
    parseMetarThunder('METAR KORH 261654Z 03020G34KT 3SM -RA BR BKN018 OVC028 12/11 A2989 RMK AO2 LTG DSNT S AND SW'),
    { thunder: false, lightning: true }
  )
  assert.deepEqual(parseMetarThunder('SPECI KXYZ 261700Z 18005KT 10SM VCTS SCT050 20/15 A2990'), {
    thunder: true,
    lightning: false,
  })
  assert.deepEqual(parseMetarThunder('METAR EHAM 261655Z 04005KT 9999 FEW032 17/11 Q1022 NOSIG'), {
    thunder: false,
    lightning: false,
  })
})

test('parseMetarThunder ignores TS-looking station ids and remark-only TSE', () => {
  assert.deepEqual(parseMetarThunder('METAR KTSP 261700Z 18005KT 10SM CLR 20/15 A2990 RMK AO2 TSE10'), {
    thunder: false,
    lightning: false,
  })
})

test('metarThunderObservations keeps latest report per station within radius and age', () => {
  const nowMs = Date.parse('2026-09-26T17:00:00Z')
  const obs = (min: number) => Math.floor((nowMs - min * 60_000) / 1000)
  const out = metarThunderObservations(
    [
      { icaoId: 'KIJD', obsTime: obs(8), lat: 41.74, lon: -72.18, rawOb: 'METAR KIJD 261652Z AUTO 03011KT 1SM +TSRA BR OVC029 13/12 A2984' },
      { icaoId: 'KIJD', obsTime: obs(60), lat: 41.74, lon: -72.18, rawOb: 'METAR KIJD 261552Z AUTO 03011KT 10SM -RA OVC026 14/11 A2984' },
      { icaoId: 'KBDL', obsTime: obs(9), lat: 41.94, lon: -72.68, rawOb: 'METAR KBDL 261651Z 03018KT 10SM TSRA OVC038 18/09 A2987' },
      { icaoId: 'KOLD', obsTime: obs(120), lat: 41.8, lon: -72.0, rawOb: 'METAR KOLD 261500Z 03018KT 10SM TSRA OVC038 18/09 A2987' },
    ],
    POMFRET,
    nowMs
  )
  assert.deepEqual(
    out.map((o) => (o.source === 'metar' ? o.station : '')),
    ['KIJD']
  )
})

test('metarThunderObservations uses the newest report, so a cleared station stops counting', () => {
  const nowMs = Date.parse('2026-09-26T18:00:00Z')
  const obs = (min: number) => Math.floor((nowMs - min * 60_000) / 1000)
  const out = metarThunderObservations(
    [
      { icaoId: 'KIJD', obsTime: obs(50), lat: 41.74, lon: -72.18, rawOb: 'METAR KIJD 261710Z 03011KT 1SM +TSRA OVC029 13/12 A2984' },
      { icaoId: 'KIJD', obsTime: obs(5), lat: 41.74, lon: -72.18, rawOb: 'METAR KIJD 261755Z 03011KT 10SM OVC029 13/12 A2984 RMK AO2 TSE40' },
    ],
    POMFRET,
    nowMs
  )
  assert.equal(out.length, 0)
})

test('nwsThunderObservations only counts severe thunderstorm and tornado warnings', () => {
  const out = nwsThunderObservations({
    features: [
      { properties: { event: 'Wind Advisory', headline: 'wind' } },
      { properties: { event: 'Severe Thunderstorm Warning', headline: 'svr', expires: '2026-09-26T18:00:00Z' } },
      { properties: { event: 'Severe Thunderstorm Watch', headline: 'watch' } },
    ],
  })
  assert.deepEqual(
    out.map((o) => (o.source === 'nws' ? o.event : '')),
    ['Severe Thunderstorm Warning']
  )
})

test('meteoAlarmThunderObservations needs thunderstorm type, yellow+, area match, active window', () => {
  const nowMs = Date.parse('2026-09-26T15:00:00Z')
  const info = (over: Record<string, unknown>) => ({
    event: 'Moderate thunderstorm warning',
    language: 'en-GB',
    onset: '2026-09-26T12:00:00Z',
    expires: '2026-09-26T20:00:00Z',
    area: [{ geocode: [{ value: 'NL011' }] }],
    parameter: [
      { valueName: 'awareness_type', value: '3; Thunderstorm' },
      { valueName: 'awareness_level', value: '2; yellow; Moderate' },
    ],
    ...over,
  })
  const data = {
    warnings: [
      { alert: { info: [info({}), info({ language: 'nl-NL', event: 'Onweer' })] } },
      {
        alert: {
          info: [
            info({
              parameter: [
                { valueName: 'awareness_type', value: '3; Thunderstorm' },
                { valueName: 'awareness_level', value: '1; green; Minor' },
              ],
            }),
          ],
        },
      },
      { alert: { info: [info({ area: [{ geocode: [{ value: 'NL012' }] }] })] } },
      { alert: { info: [info({ onset: '2026-09-26T18:00:00Z' })] } },
      {
        alert: {
          info: [
            info({
              parameter: [
                { valueName: 'awareness_type', value: '1; Wind' },
                { valueName: 'awareness_level', value: '3; orange; Severe' },
              ],
            }),
          ],
        },
      },
    ],
  }
  const out = meteoAlarmThunderObservations(data, ['NL011'], nowMs)
  assert.equal(out.length, 1)
  assert.equal(out[0]!.source === 'meteoalarm' ? out[0]!.event : '', 'Moderate thunderstorm warning')
})

test('observed storm outranks a quiet Open-Meteo forecast in pickWeatherSafetyThreat', () => {
  const hourStart = Date.parse('2026-09-27T02:00:00.000Z') / 1000
  const observedStorms = [
    {
      source: 'metar' as const,
      station: 'KIJD',
      distanceKm: 24,
      observedAt: '2026-09-27T02:05:00.000Z',
      thunder: true,
      lightning: true,
      rawOb: 'METAR KIJD 270205Z +TSRA',
    },
  ]
  const threat = pickWeatherSafetyThreat({
    ringLocations: [
      {
        lat: 41.9,
        lon: -71.96,
        distanceKm: 0,
        hours: [{ timeSec: hourStart, precipProbability: 10, weatherCode: 3 }],
      },
    ],
    observedStorms,
    nowSec: hourStart + 300,
  })
  assert.equal(threat?.kind, 'storm_observed')
  assert.match(threat!.reason, /KIJD \(~24 km\) reports thunderstorm/)
  assert.equal(pickObservedStormThreat([]), null)
})
