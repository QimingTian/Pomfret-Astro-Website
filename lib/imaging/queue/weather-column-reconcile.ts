import { reconcilePendingScheduleStatus } from '@/lib/imaging-queue-reconcile'
import {
  emitAgentWakePollSequenceDebounced,
  emitSiteSessionsChanged,
} from '@/lib/imaging/site-events'
import { kvEnabled, kvGetJson, kvSetJson } from '@/lib/kv-rest'
import { currentObservatorySiteId, scopedKvKey } from '@/lib/observatory-site-scope'
import type { WeatherNotPermittedReason } from '@/lib/tonight-weather-gate'

const KV_KEY_BASE = 'imaging-queue-schedule-weather-fingerprint'

export type ScheduleWeatherColumnPayload = {
  prediction: 'permitted' | 'not_permitted' | 'unavailable'
  hasAnyPrecipitationTonight: boolean
  readyHourStartsSec: number[]
  nightHourStartsSec: number[]
  notPermittedHourReasons: Array<{ hourStartSec: number; reasons: WeatherNotPermittedReason[] }>
  /** Same hours as `precipitationHits` in tonight-weather-prediction — drives precip overlay. */
  precipitationHitHourStartsSec: number[]
}

type Stored = {
  windowStartSec: number
  windowEndSec: number
  fingerprint: string
}

function fingerprintKvKey(): string {
  return scopedKvKey(KV_KEY_BASE)
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

/** In-process fallback when KV is not configured (dev); per-site so switcher does not cross-talk. */
const memoryStoreBySite: Record<string, Stored> = {}

export function scheduleWeatherColumnFingerprint(payload: ScheduleWeatherColumnPayload): string {
  return fingerprintForScheduleWeatherColumn(payload)
}

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
  const siteId = currentObservatorySiteId()

  let prev: Stored | undefined
  if (kvEnabled()) {
    prev = await kvGetJson<Stored>(fingerprintKvKey())
  } else {
    prev = memoryStoreBySite[siteId]
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
  emitSiteSessionsChanged('weather')
  emitAgentWakePollSequenceDebounced()

  const next: Stored = { windowStartSec, windowEndSec, fingerprint }
  if (kvEnabled()) {
    await kvSetJson(fingerprintKvKey(), next)
  } else {
    memoryStoreBySite[siteId] = next
  }
}
