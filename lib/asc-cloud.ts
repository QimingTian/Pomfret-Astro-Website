import type { AscCloudInference } from '@/lib/types'

const DEFAULT_STREAM_URL = 'https://cam.pomfretastro.org/camera/stream'

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

export function defaultAllSkyStatusUrl(): string {
  return allSkyCameraStatusUrl(DEFAULT_STREAM_URL) ?? 'https://cam.pomfretastro.org/camera/status'
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
