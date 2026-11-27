import { NextRequest } from 'next/server'
import { mountTelemetryPostAuthorized } from '@/lib/mount-telemetry-auth'
import { imagingCorsOptions, withImagingCors } from '@/lib/imaging-queue-auth'
import {
  getSafetyMonitorSample,
  parseSafetyMonitorPayload,
  setSafetyMonitorSample,
} from '@/lib/safety-monitor-store'
import { isWithinDaytimeClosedWindow } from '@/lib/sunrise-window'
import { runWithRequestSite } from '@/lib/imaging/run-with-request-site'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const NO_STORE_HEADERS = {
  'Cache-Control': 'private, no-store, no-cache, must-revalidate, max-age=0',
} as const

const safetyPostLastAcceptedAt = new Map<string, number>()
const SAFETY_POST_MIN_INTERVAL_NIGHT_MS = 2_000
const SAFETY_POST_MIN_INTERVAL_DAY_MS = 30_000

function safetyPostMinIntervalMs(): number {
  return isWithinDaytimeClosedWindow() ? SAFETY_POST_MIN_INTERVAL_DAY_MS : SAFETY_POST_MIN_INTERVAL_NIGHT_MS
}

export function OPTIONS() {
  return imagingCorsOptions()
}

/**
 * NINA Pomfret Astro Network plugin → HTTP POST for safety-monitor status.
 * Auth: same `NINA_MOUNT_TELEMETRY_SECRET` (or basic) as mount-pointing.
 * GET is open for debugging / future dashboard use.
 */
export async function POST(request: NextRequest) {
  return runWithRequestSite(request, async () => {
    if (!mountTelemetryPostAuthorized(request)) {
      return withImagingCors({ ok: false as const, error: 'Unauthorized' }, 401, NO_STORE_HEADERS)
    }

    let raw: unknown
    try {
      raw = await request.json()
    } catch {
      return withImagingCors({ ok: false as const, error: 'Invalid JSON' }, 400, NO_STORE_HEADERS)
    }

    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return withImagingCors({ ok: false as const, error: 'Expected JSON object' }, 400, NO_STORE_HEADERS)
    }

    const payload = parseSafetyMonitorPayload(raw as Record<string, unknown>)
    if (!payload) {
      return withImagingCors(
        { ok: false as const, error: 'Invalid payload (need connected; isSafe when connected)' },
        400,
        NO_STORE_HEADERS
      )
    }

    const stationKey = payload.stationId?.trim() || 'default'
    const now = Date.now()
    const lastAccepted = safetyPostLastAcceptedAt.get(stationKey) ?? 0
    const minInterval = safetyPostMinIntervalMs()
    if (now - lastAccepted < minInterval) {
      const cached = await getSafetyMonitorSample(payload.stationId)
      return withImagingCors(
        { ok: true as const, receivedAtUtc: cached?.receivedAtUtc ?? new Date().toISOString(), throttled: true as const },
        200,
        NO_STORE_HEADERS
      )
    }
    safetyPostLastAcceptedAt.set(stationKey, now)

    const stored = await setSafetyMonitorSample(payload.stationId, payload)
    return withImagingCors({ ok: true as const, receivedAtUtc: stored.receivedAtUtc }, 200, NO_STORE_HEADERS)
  })
}

/** Latest stored sample for optional `?stationId=`. No plugin secret required. */
export async function GET(request: NextRequest) {
  return runWithRequestSite(request, async () => {
    const stationId = request.nextUrl.searchParams.get('stationId') ?? undefined
    const sample = await getSafetyMonitorSample(stationId)
    const serverNowUtc = new Date().toISOString()
    if (!sample) {
      return withImagingCors({ ok: true as const, sample: null, serverNowUtc }, 200, NO_STORE_HEADERS)
    }
    return withImagingCors({ ok: true as const, sample, serverNowUtc }, 200, NO_STORE_HEADERS)
  })
}
