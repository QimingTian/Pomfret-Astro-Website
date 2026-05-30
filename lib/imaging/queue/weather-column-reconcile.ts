import { reconcilePendingScheduleStatus } from '@/lib/imaging-queue-reconcile'
import { kvEnabled, kvGetJson, kvSetJson } from '@/lib/kv-rest'

const KV_KEY = 'imaging-queue-schedule-weather-fingerprint'

export type ScheduleWeatherColumnPayload = {
  prediction: 'permitted' | 'not_permitted' | 'unavailable'
  hasAnyPrecipitationTonight: boolean
  readyHourStartsSec: number[]
  nightHourStartsSec: number[]
  notPermittedHourReasons: Array<{ hourStartSec: number; reasons: Array<'cloud' | 'rain' | 'wind'> }>
  /** Same hours as `precipitationHits` in tonight-weather-prediction — drives precip overlay. */
  precipitationHitHourStartsSec: number[]
}

type Stored = {
  windowStartSec: number
  windowEndSec: number
  fingerprint: string
}

function fingerprintForScheduleWeatherColumn(payload: ScheduleWeatherColumnPayload): string {
  const ready = [...payload.readyHourStartsSec].filter((n) => Number.isFinite(n)).sort((a, b) => a - b)
  const night = [...payload.nightHourStartsSec].filter((n) => Number.isFinite(n)).sort((a, b) => a - b)
  const precipHits = [...payload.precipitationHitHourStartsSec].filter((n) => Number.isFinite(n)).sort((a, b) => a - b)
  const reasons = [...payload.notPermittedHourReasons]
    .map((r) => ({
      t: r.hourStartSec,
      reasons: [...r.reasons].sort(),
    }))
    .sort((a, b) => a.t - b.t)
  return JSON.stringify({
    prediction: payload.prediction,
    precipNight: payload.hasAnyPrecipitationTonight,
    precipHits,
    ready,
    night,
    reasons,
  })
}

/** In-process fallback when KV is not configured (dev); resets on cold start. */
let memoryStore: Stored | null = null

/**
 * When the Remote “tonight schedule” weather column inputs change (same 4pm–8am window),
 * re-run queue schedule reconciliation. Skips if fingerprint matches last run for this window.
 */
export async function maybeReconcileQueueWhenScheduleWeatherColumnChanged(
  windowStartSec: number,
  windowEndSec: number,
  payload: ScheduleWeatherColumnPayload
): Promise<void> {
  const fingerprint = fingerprintForScheduleWeatherColumn(payload)

  let prev: Stored | undefined
  if (kvEnabled()) {
    prev = await kvGetJson<Stored>(KV_KEY)
  } else {
    prev = memoryStore ?? undefined
  }

  if (
    prev &&
    prev.windowStartSec === windowStartSec &&
    prev.windowEndSec === windowEndSec &&
    prev.fingerprint === fingerprint
  ) {
    return
  }

  await reconcilePendingScheduleStatus()

  const next: Stored = { windowStartSec, windowEndSec, fingerprint }
  if (kvEnabled()) {
    await kvSetJson(KV_KEY, next)
  } else {
    memoryStore = next
  }
}
