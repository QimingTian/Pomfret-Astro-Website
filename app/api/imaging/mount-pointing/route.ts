import { NextRequest } from 'next/server'
import { mountTelemetryAuthorized } from '@/lib/mount-telemetry-auth'
import { imagingCorsOptions, withImagingCors } from '@/lib/imaging-queue-auth'
import { getMountPointingSample, setMountPointingSample, type MountPointingPayload } from '@/lib/mount-pointing-store'

export const runtime = 'nodejs'
/** Avoid CDN / disk caching live mount JSON (Chrome often kept a stale GET; Safari did not). */
export const dynamic = 'force-dynamic'

const NO_STORE_HEADERS = {
  'Cache-Control': 'private, no-store, no-cache, must-revalidate, max-age=0',
} as const

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
 * Auth: optional — set `NINA_MOUNT_TELEMETRY_SECRET` and/or `NINA_MOUNT_TELEMETRY_BASIC_PASSWORD` on the server.
 */
export async function POST(request: NextRequest) {
  if (!mountTelemetryAuthorized(request)) {
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

  const stored = setMountPointingSample(payload.stationId, payload)
  return withImagingCors({ ok: true as const, receivedAtUtc: stored.receivedAtUtc }, 200, NO_STORE_HEADERS)
}

/**
 * Latest stored sample for optional `?stationId=`. Same auth as POST when secrets are set.
 */
export async function GET(request: NextRequest) {
  if (!mountTelemetryAuthorized(request)) {
    return withImagingCors({ ok: false as const, error: 'Unauthorized' }, 401, NO_STORE_HEADERS)
  }

  const stationId = request.nextUrl.searchParams.get('stationId') ?? undefined
  const sample = getMountPointingSample(stationId)
  if (!sample) {
    return withImagingCors({ ok: true as const, sample: null }, 200, NO_STORE_HEADERS)
  }
  return withImagingCors({ ok: true as const, sample }, 200, NO_STORE_HEADERS)
}
