import type { AscCloudInference } from '@/lib/types'

export const DEFAULT_ALL_SKY_STREAM_URL = 'https://cam.pomfretastro.org/camera/stream'

/** Resolve camera /status URL from MJPEG stream URL (same host). */
export function allSkyCameraStatusUrl(streamUrl: string | null | undefined): string | null {
  if (!streamUrl) return null
  try {
    const u = new URL(streamUrl)
    if (/\/camera\//.test(u.pathname)) {
      return new URL('status', streamUrl).href
    }
    return new URL('/status', streamUrl).href
  } catch {
    return null
  }
}

/** Resolve /camera/sequence/status from MJPEG stream URL (same host). */
export function allSkyCameraSequenceStatusUrl(streamUrl: string | null | undefined): string | null {
  if (!streamUrl) return null
  try {
    const u = new URL(streamUrl)
    if (/\/camera\//.test(u.pathname)) {
      return new URL('sequence/status', streamUrl).href
    }
    return new URL('/camera/sequence/status', u.origin).href
  } catch {
    return null
  }
}

export function defaultAllSkyStatusUrl(): string {
  return (
    allSkyCameraStatusUrl(DEFAULT_ALL_SKY_STREAM_URL) ??
    'https://cam.pomfretastro.org/camera/status'
  )
}

export function defaultAllSkySequenceStatusUrl(): string {
  return (
    allSkyCameraSequenceStatusUrl(DEFAULT_ALL_SKY_STREAM_URL) ??
    'https://cam.pomfretastro.org/camera/sequence/status'
  )
}

type StatusPayload = {
  sensors?: {
    allSkyCam?: {
      ascCloud?: AscCloudInference | null
    }
  }
}

export function parseAscCloudFromStatus(data: unknown): AscCloudInference | null {
  if (!data || typeof data !== 'object') return null
  const ascCloud = (data as StatusPayload).sensors?.allSkyCam?.ascCloud
  if (!ascCloud || typeof ascCloud !== 'object') return null
  return ascCloud
}

export async function fetchAscCloud(statusUrl?: string | null): Promise<AscCloudInference | null> {
  const url = statusUrl ?? defaultAllSkyStatusUrl()
  try {
    const res = await fetch(url, {
      mode: 'cors',
      credentials: 'omit',
      cache: 'no-store',
    })
    if (!res.ok) return null
    const data = (await res.json()) as unknown
    return parseAscCloudFromStatus(data)
  } catch {
    return null
  }
}

/** Observatory Ready weather gate — cloud/rain from ASC AI; wind checked separately (Open-Meteo). */
export const OBSERVATORY_READY_MAX_CLOUD_PERCENT = 20
export const OBSERVATORY_READY_MAX_WIND_MS = 10
export const OBSERVATORY_READY_GATE_RULE =
  'ASC AI cloud < 20% and no rain detected and wind_speed_10m < 10 m/s (Open-Meteo)'

export function evaluateObservatoryReadyWeather(args: {
  cloudCoverPercent: number | null | undefined
  rainDetected: boolean | undefined
  windSpeedMs: number
}): boolean {
  const cloud = args.cloudCoverPercent
  if (cloud == null || !Number.isFinite(cloud)) return false
  if (args.rainDetected === true) return false
  if (!Number.isFinite(args.windSpeedMs) || args.windSpeedMs >= OBSERVATORY_READY_MAX_WIND_MS) {
    return false
  }
  return cloud < OBSERVATORY_READY_MAX_CLOUD_PERCENT
}
