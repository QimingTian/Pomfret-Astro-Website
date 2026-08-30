import { NextRequest } from 'next/server'
import { mountTelemetryPostAuthorized } from '@/lib/mount-telemetry-auth'
import { imagingCorsOptions, withImagingCors } from '@/lib/imaging-queue-auth'
import { getMountPointingSample, setMountPointingSample, type MountPointingPayload } from '@/lib/mount-pointing-store'
import { isWithinDaytimeClosedWindow } from '@/lib/sunrise-window'
import { runWithRequestSite } from '@/lib/imaging/run-with-request-site'

export const runtime = 'nodejs'
/** Avoid CDN / disk caching live mount JSON (Chrome often kept a stale GET; Safari did not). */
export const dynamic = 'force-dynamic'

const NO_STORE_HEADERS = {
  'Cache-Control': 'private, no-store, no-cache, must-revalidate, max-age=0',
} as const

const mountPostLastAcceptedAt = new Map<string, number>()
const MOUNT_POST_MIN_INTERVAL_NIGHT_MS = 2_000
const MOUNT_POST_MIN_INTERVAL_DAY_MS = 30_000

function mountPostMinIntervalMs(): number {
  return isWithinDaytimeClosedWindow() ? MOUNT_POST_MIN_INTERVAL_DAY_MS : MOUNT_POST_MIN_INTERVAL_NIGHT_MS
}

function numOrNull(v: unknown): number | null | undefined {
  if (v === null || v === undefined) return v as undefined
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v)
    if (Number.isFinite(n)) return n
  }
  return undefined
}

function strOrUndef(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined
}

function boolOrUndef(v: unknown): boolean | undefined {
  return typeof v === 'boolean' ? v : undefined
}

function parsePayload(body: Record<string, unknown>): MountPointingPayload | null {
  const connected = boolOrUndef(body.connected)
  if (connected === undefined) return null

  const stationId = strOrUndef(body.stationId)
  const ra = numOrNull(body.raHours)
  const dec = numOrNull(body.decDeg)
  const sidereal = numOrNull(body.siderealTimeHours)
  const siteLatitude = numOrNull(body.siteLatitudeDeg)
  const alt = numOrNull(body.altitudeDeg)
  const az = numOrNull(body.azimuthDeg)

  return {
    source: strOrUndef(body.source) ?? 'nina-plugin',
    stationId,
    connected,
    raHours: ra === undefined ? null : ra,
    decDeg: dec === undefined ? null : dec,
    siderealTimeHours: sidereal === undefined ? null : sidereal,
    siteLatitudeDeg: siteLatitude === undefined ? null : siteLatitude,
    altitudeDeg: alt === undefined ? null : alt,
    azimuthDeg: az === undefined ? null : az,
    slewing: boolOrUndef(body.slewing),
    atPark: boolOrUndef(body.atPark),
    trackingEnabled: boolOrUndef(body.trackingEnabled),
    sideOfPier: strOrUndef(body.sideOfPier) ?? null,
    epoch: strOrUndef(body.epoch) ?? null,
    clientUtc: strOrUndef(body.clientUtc) ?? null,
    pluginVersion: strOrUndef(body.pluginVersion) ?? null,
  }
}

export function OPTIONS() {
  return imagingCorsOptions()
}

/**
 * NINA plugin → HTTP POST. Stores latest sample per `stationId` (default bucket when omitted).
 *
 * Auth: POST requires `NINA_MOUNT_TELEMETRY_SECRET` (or basic password). GET is open for the dashboard.
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

  const payload = parsePayload(raw as Record<string, unknown>)
  if (!payload) {
    return withImagingCors({ ok: false as const, error: 'Missing boolean "connected"' }, 400, NO_STORE_HEADERS)
  }

  const stationKey = (payload.stationId?.trim() || 'default')
  const now = Date.now()
  const lastAccepted = mountPostLastAcceptedAt.get(stationKey) ?? 0
  const minInterval = mountPostMinIntervalMs()
  if (now - lastAccepted < minInterval) {
    const cached = await getMountPointingSample(payload.stationId)
    return withImagingCors(
      { ok: true as const, receivedAtUtc: cached?.receivedAtUtc ?? new Date().toISOString(), throttled: true as const },
      200,
      NO_STORE_HEADERS
    )
  }
  mountPostLastAcceptedAt.set(stationKey, now)

  const stored = await setMountPointingSample(payload.stationId, payload)
  return withImagingCors({ ok: true as const, receivedAtUtc: stored.receivedAtUtc }, 200, NO_STORE_HEADERS)
  })
}

/**
 * Latest stored sample for optional `?stationId=`. No plugin secret required (Remote dashboard poll).
 */
export async function GET(request: NextRequest) {
  return runWithRequestSite(request, async () => {
  const stationId = request.nextUrl.searchParams.get('stationId') ?? undefined
  const sample = await getMountPointingSample(stationId)
  const serverNowUtc = new Date().toISOString()
  if (!sample) {
    return withImagingCors({ ok: true as const, sample: null, serverNowUtc }, 200, NO_STORE_HEADERS)
  }
  return withImagingCors({ ok: true as const, sample, serverNowUtc }, 200, NO_STORE_HEADERS)
  })
}
