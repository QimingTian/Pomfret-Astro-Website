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

function allSkySequenceStatusUrlFromStatusUrl(statusUrl: string): string {
  try {
    const u = new URL(statusUrl)
    if (u.pathname.endsWith('/status')) {
      return new URL(u.pathname.replace(/\/status$/, '/sequence/status'), u.origin).href
    }
    if (u.pathname.includes('/camera/')) {
      return new URL('sequence/status', statusUrl).href
    }
    return new URL('/camera/sequence/status', u.origin).href
  } catch {
    return defaultAllSkySequenceStatusUrl()
  }
}

/** True when ASC cloud/rain may gate observatory Ready (not stale, sequence idle). */
export function isAscCloudGateApplicable(
  ascCloud: AscCloudInference | null | undefined,
  sequenceActive: boolean
): boolean {
  if (sequenceActive) return false
  if (ascCloud?.stale === true) return false
  return true
}

export async function fetchAllSkyCamGateState(statusUrl?: string | null): Promise<{
  ascCloud: AscCloudInference | null
  sequenceActive: boolean
}> {
  const url = statusUrl ?? defaultAllSkyStatusUrl()
  const seqUrl = allSkySequenceStatusUrlFromStatusUrl(url)
  try {
    const [statusRes, seqRes] = await Promise.all([
      fetch(url, { mode: 'cors', credentials: 'omit', cache: 'no-store' }),
      fetch(seqUrl, { mode: 'cors', credentials: 'omit', cache: 'no-store' }),
    ])
    const ascCloud = statusRes.ok ? parseAscCloudFromStatus((await statusRes.json()) as unknown) : null
    let sequenceActive = false
    if (seqRes.ok) {
      const seq = (await seqRes.json()) as { active?: unknown }
      sequenceActive = seq.active === true
    }
    return { ascCloud, sequenceActive }
  } catch {
    return { ascCloud: null, sequenceActive: false }
  }
}

export async function fetchAscCloud(statusUrl?: string | null): Promise<AscCloudInference | null> {
  const { ascCloud } = await fetchAllSkyCamGateState(statusUrl)
  return ascCloud
}

/** Observatory Ready weather gate — ASC or Open-Meteo cloud; wind/precip from Open-Meteo. */
export const OBSERVATORY_READY_MAX_ASC_CLOUD_PERCENT = 20
export const OBSERVATORY_READY_MAX_OPEN_METEO_CLOUD_PERCENT = 10
export const OBSERVATORY_READY_MAX_WIND_MS = 10
export const OBSERVATORY_READY_MAX_PRECIP_PROBABILITY = 20
export const OBSERVATORY_READY_GATE_RULE =
  'ASC AI cloud < 20% and no rain (when ASC gate applies) OR Open-Meteo cloud_cover < 10% (when ASC unavailable); wind_speed_10m < 10 m/s; precipitation_probability <= 20%'

export function evaluateObservatoryReadyWeather(args: {
  cloudCoverPercent: number | null | undefined
  /** Open-Meteo cloud_cover when ASC cloud/rain gate does not apply. */
  openMeteoCloudCoverPercent?: number | null | undefined
  rainDetected: boolean | undefined
  windSpeedMs: number
  precipProbabilityPercent?: number | null | undefined
  /** When false, skip ASC cloud/rain (sequence active or stale inference). */
  ascGateApplicable?: boolean
}): boolean {
  const ascGateApplicable = args.ascGateApplicable !== false
  if (ascGateApplicable) {
    const cloud = args.cloudCoverPercent
    if (cloud == null || !Number.isFinite(cloud)) return false
    if (args.rainDetected === true) return false
    if (cloud >= OBSERVATORY_READY_MAX_ASC_CLOUD_PERCENT) return false
  } else {
    const omCloud = args.openMeteoCloudCoverPercent
    if (omCloud == null || !Number.isFinite(omCloud)) return false
    if (omCloud >= OBSERVATORY_READY_MAX_OPEN_METEO_CLOUD_PERCENT) return false
  }
  if (!Number.isFinite(args.windSpeedMs) || args.windSpeedMs >= OBSERVATORY_READY_MAX_WIND_MS) {
    return false
  }
  const precip = args.precipProbabilityPercent
  if (precip == null || !Number.isFinite(precip) || precip > OBSERVATORY_READY_MAX_PRECIP_PROBABILITY) {
    return false
  }
  return true
}
