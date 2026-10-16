import assert from 'node:assert/strict'
import test from 'node:test'
import {
  deliveryWeatherBlockReason,
  evaluateGlobalTonightWeatherPermitted,
  findNightwideSeverePrecipitationHour,
  getTonightWeatherPermittedIntervalsFromSamples,
  isHourWeatherPermitted,
  sessionWindowHourlyPrecipOk,
  weatherNotPermittedReasons,
} from '@/lib/tonight-weather-gate'

function hour(sec: number, cloud: number) {
  return {
    hourStartSec: sec,
    cloudCover: cloud,
    precipProbability: 0,
    windSpeedMs: 5,
  }
}

test('weatherNotPermittedReasons only checks cloud rain wind', () => {
  assert.deepEqual(
    weatherNotPermittedReasons({
      cloudCover: 5,
      precipProbability: 0,
      windSpeedMs: 5,
    }),
    []
  )
  assert.deepEqual(
    weatherNotPermittedReasons({
      cloudCover: 15,
      precipProbability: 12,
      windSpeedMs: 11,
    }),
    ['cloud', 'rain', 'wind']
  )
})

test('isHourWeatherPermitted passes when cloud rain wind are ok', () => {
  assert.equal(
    isHourWeatherPermitted({
      cloudCover: 5,
      precipProbability: 5,
      windSpeedMs: 10,
    }),
    true
  )
})

test('global permitted ignores pre-dusk clear hours outside nautical gate', () => {
  const gateStartSec = 20 * 3600
  const gateEndSec = 30 * 3600
  const nowSec = gateStartSec - 2 * 3600
  const permitted = evaluateGlobalTonightWeatherPermitted({
    nowSec,
    gateStartSec,
    gateEndSec,
    hours: [
      hour(16 * 3600, 5),
      hour(17 * 3600, 5),
      hour(20 * 3600, 50),
      hour(21 * 3600, 50),
      hour(22 * 3600, 50),
    ],
  })
  assert.equal(permitted, false)
})

test('global permitted passes when consecutive clear hours fall inside nautical gate', () => {
  const gateStartSec = 20 * 3600
  const gateEndSec = 30 * 3600
  const nowSec = gateStartSec - 2 * 3600
  const permitted = evaluateGlobalTonightWeatherPermitted({
    nowSec,
    gateStartSec,
    gateEndSec,
    hours: [
      hour(16 * 3600, 5),
      hour(17 * 3600, 5),
      hour(20 * 3600, 5),
      hour(21 * 3600, 5),
      hour(22 * 3600, 50),
    ],
  })
  assert.equal(permitted, true)
})

test('global permitted ignores fully ended gate hours after nautical dusk', () => {
  const gateStartSec = 20 * 3600
  const gateEndSec = 30 * 3600
  const nowSec = 22 * 3600 + 1000
  const permitted = evaluateGlobalTonightWeatherPermitted({
    nowSec,
    gateStartSec,
    gateEndSec,
    hours: [
      hour(20 * 3600, 50),
      hour(21 * 3600, 50),
      hour(22 * 3600, 5),
      hour(23 * 3600, 5),
      hour(24 * 3600, 5),
    ],
  })
  assert.equal(permitted, true)
})

test('scheduler keeps a consecutive clear run from the same forecast snapshot', async () => {
  const sunsetSec = 1_800_000
  const result = await getTonightWeatherPermittedIntervalsFromSamples(
    [hour(sunsetSec, 5), hour(sunsetSec + 3600, 5), hour(sunsetSec + 7200, 5)],
    sunsetSec,
    sunsetSec + 10_800,
    'UTC',
    0
  )
  assert.equal(result.globalHardBlocked, false)
  assert.equal(result.permittedIntervals.length, 3)
})

test('forecast precipitation permits an earlier run that finishes two hours before the hit', async () => {
  const sunsetSec = 1_800_000
  const result = await getTonightWeatherPermittedIntervalsFromSamples(
    [
      hour(sunsetSec, 5),
      hour(sunsetSec + 3600, 5),
      hour(sunsetSec + 7200, 5),
      hour(sunsetSec + 10_800, 5),
      { ...hour(sunsetSec + 14_400, 5), precipProbability: 12 },
    ],
    sunsetSec,
    sunsetSec + 18_000,
    'UTC',
    0
  )
  assert.equal(result.globalHardBlocked, false)
  assert.equal(result.schedulingEndMs, (sunsetSec + 7200) * 1000)
  assert.equal(result.permittedIntervals.length, 2)
})

test('precipitation blocks when the two-hour buffer leaves no clear run', async () => {
  const sunsetSec = 1_800_000
  const result = await getTonightWeatherPermittedIntervalsFromSamples(
    [hour(sunsetSec, 5), hour(sunsetSec + 3600, 5), { ...hour(sunsetSec + 7200, 5), precipProbability: 12 }],
    sunsetSec,
    sunsetSec + 10_800,
    'UTC',
    0
  )
  assert.equal(result.globalHardBlocked, true)
  assert.match(result.globalHardBlockReason ?? '', /2 hours before precipitation/)
})

test('weather beyond a site nautical dawn cannot block the site imaging night', async () => {
  const sunsetSec = 1_800_000
  const samples = [
    hour(sunsetSec, 5),
    hour(sunsetSec + 3600, 5),
    hour(sunsetSec + 7200, 5),
    { ...hour(sunsetSec + 10_800, 5), precipProbability: 12 },
  ]
  const pomfret = await getTonightWeatherPermittedIntervalsFromSamples(
    samples, sunsetSec, sunsetSec + 14_400, 'UTC', 0,
    { startMs: sunsetSec * 1000, endMs: (sunsetSec + 10_800) * 1000 }
  )
  const cygnus = await getTonightWeatherPermittedIntervalsFromSamples(
    samples, sunsetSec, sunsetSec + 14_400, 'UTC', 0,
    { startMs: sunsetSec * 1000, endMs: (sunsetSec + 14_400) * 1000 }
  )
  assert.equal(pomfret.globalHardBlocked, false)
  assert.equal(pomfret.precipitationHourStartMs, undefined)
  assert.equal(cygnus.globalHardBlocked, true)
  assert.equal(cygnus.precipitationHourStartMs, (sunsetSec + 10_800) * 1000)
})

test('precipitation above 80% anywhere from sunset to sunrise blocks the entire night', async () => {
  const sunsetSec = 1_800_000
  const samples = [
    { ...hour(sunsetSec - 3600, 5), precipProbability: 99 }, // before sunset
    { ...hour(sunsetSec, 5), precipProbability: 81 }, // before nautical dusk
    hour(sunsetSec + 3600, 5),
    hour(sunsetSec + 7200, 5),
    hour(sunsetSec + 10_800, 5),
  ]
  const result = await getTonightWeatherPermittedIntervalsFromSamples(
    samples, sunsetSec, sunsetSec + 14_400, 'UTC', 0,
    { startMs: (sunsetSec + 3600) * 1000, endMs: (sunsetSec + 14_400) * 1000 }
  )
  assert.equal(result.globalHardBlocked, true)
  assert.equal(result.severePrecipitationHourStartMs, sunsetSec * 1000)
  assert.equal(result.severePrecipitationProbability, 81)
  assert.match(result.globalHardBlockReason ?? '', /81%.*sunset-to-sunrise.*Entire night blocked/)
  assert.match(deliveryWeatherBlockReason(result, (sunsetSec + 3600) * 1000, 3600) ?? '', /81%/)
})

test('severe rain after nautical dawn or already past still vetoes the civil night', async () => {
  const sunsetSec = 1_800_000
  const samples = [
    { ...hour(sunsetSec, 5), precipProbability: 85 },
    hour(sunsetSec + 3600, 5),
    hour(sunsetSec + 7200, 5),
    { ...hour(sunsetSec + 10_800, 5), precipProbability: 95 },
  ]
  const result = await getTonightWeatherPermittedIntervalsFromSamples(
    samples, sunsetSec, sunsetSec + 14_400, 'UTC', (sunsetSec + 3600) * 1000,
    { startMs: sunsetSec * 1000, endMs: (sunsetSec + 10_800) * 1000 }
  )
  assert.equal(result.globalHardBlocked, true)
  assert.equal(result.severePrecipitationHourStartMs, sunsetSec * 1000)
  assert.equal(findNightwideSeverePrecipitationHour(samples.slice(1), sunsetSec, sunsetSec + 14_400)?.precipProbability, 95)
})

test('80% exactly and forecast hours outside sunset-to-sunrise do not trigger the nightwide veto', async () => {
  const sunsetSec = 1_800_000
  const samples = [
    { ...hour(sunsetSec - 3600, 5), precipProbability: 99 },
    hour(sunsetSec, 5),
    hour(sunsetSec + 3600, 5),
    hour(sunsetSec + 7200, 5),
    hour(sunsetSec + 10_800, 5),
    { ...hour(sunsetSec + 14_400, 5), precipProbability: 80 },
    { ...hour(sunsetSec + 18_000, 5), precipProbability: 99 },
  ]
  const result = await getTonightWeatherPermittedIntervalsFromSamples(
    samples, sunsetSec, sunsetSec + 18_000, 'UTC', 0,
    { startMs: sunsetSec * 1000, endMs: (sunsetSec + 14_400) * 1000 }
  )
  assert.equal(result.globalHardBlocked, false)
  assert.equal(result.severePrecipitationHourStartMs, undefined)
  assert.equal(findNightwideSeverePrecipitationHour(samples, sunsetSec, sunsetSec + 18_000), undefined)
})

test('admin force-run precipitation check catches severe rain outside its session window', async () => {
  const nowSec = Math.floor(Date.now() / 3600_000) * 3600
  const sunsetSec = nowSec - 3600
  const sunriseSec = nowSec + 8 * 3600
  const originalFetch = globalThis.fetch
  let severeProbability = 81
  globalThis.fetch = async () => new Response(JSON.stringify({
    daily: {
      sunset: [sunsetSec, sunriseSec + 10 * 3600],
      sunrise: [sunsetSec - 10 * 3600, sunriseSec, sunriseSec + 24 * 3600],
    },
    hourly: {
      time: [nowSec, nowSec + 3600, nowSec + 5 * 3600],
      precipitation_probability: [0, 0, severeProbability],
    },
  }))
  try {
    const startMs = nowSec * 1000
    const endMs = (nowSec + 3600) * 1000
    const blocked = await sessionWindowHourlyPrecipOk(startMs, endMs)
    assert.equal(blocked.ok, false)
    if (!blocked.ok) assert.match(blocked.reason, /81%.*Entire night blocked/)
    severeProbability = 80
    const permitted = await sessionWindowHourlyPrecipOk(startMs, endMs)
    assert.deepEqual(permitted, { ok: true })
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('NINA delivery uses the latest site forecast and two-hour cutoff', () => {
  const startMs = 1_800_000_000
  const weather = {
    status: 'ok' as const,
    globalHardBlocked: false,
    schedulingEndMs: startMs + 3 * 3600_000,
    permittedIntervals: [{ startMs, endMs: startMs + 3 * 3600_000 }],
  }
  assert.equal(deliveryWeatherBlockReason(weather, startMs, 2 * 3600), null)
  assert.match(deliveryWeatherBlockReason(weather, startMs, 4 * 3600) ?? '', /2 hours before/)
  assert.match(
    deliveryWeatherBlockReason({ ...weather, globalHardBlocked: true, globalHardBlockReason: 'site blocked' }, startMs, 3600) ?? '',
    /site blocked/
  )
  assert.match(
    deliveryWeatherBlockReason({ ...weather, permittedIntervals: [] }, startMs, 3600) ?? '',
    /below 80%/
  )
})

test('missing clear run reason includes the closest window and failed weather values', async () => {
  const sunsetSec = 1_800_000
  const result = await getTonightWeatherPermittedIntervalsFromSamples(
    [hour(sunsetSec, 22), hour(sunsetSec + 3600, 5), hour(sunsetSec + 7200, 18)],
    sunsetSec,
    sunsetSec + 10_800,
    'UTC',
    0
  )
  assert.equal(result.globalHardBlocked, true)
  assert.match(result.globalHardBlockReason ?? '', /no 2-hour clear run/)
  assert.match(result.globalHardBlockReason ?? '', /cloud 22%/)
  assert.match(result.globalHardBlockReason ?? '', /Closest window/)
})
