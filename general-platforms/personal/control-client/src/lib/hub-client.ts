import { getHubBaseUrl, normalizeHubBaseUrl } from './settings'
import type {
  CurrentSessionsResponse,
  HubProbeResult,
  ObservatoryStatusResponse,
} from './types'

const FETCH_TIMEOUT_MS = 12_000

async function hubFetch<T>(path: string, baseUrl = getHubBaseUrl()): Promise<T> {
  const url = `${normalizeHubBaseUrl(baseUrl)}${path}`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    })
    const data = (await res.json().catch(() => ({}))) as T
    if (!res.ok) {
      throw new Error(
        typeof (data as { error?: unknown }).error === 'string'
          ? (data as { error: string }).error
          : `HTTP ${res.status}`
      )
    }
    return data
  } finally {
    clearTimeout(timer)
  }
}

export async function fetchObservatoryStatus(
  baseUrl = getHubBaseUrl()
): Promise<ObservatoryStatusResponse> {
  return hubFetch<ObservatoryStatusResponse>('/api/imaging/observatory-status', baseUrl)
}

export async function fetchCurrentSessions(
  baseUrl = getHubBaseUrl()
): Promise<CurrentSessionsResponse> {
  return hubFetch<CurrentSessionsResponse>('/api/imaging/current-sessions', baseUrl)
}

export async function probeHub(baseUrl = getHubBaseUrl()): Promise<HubProbeResult> {
  try {
    const observatory = await fetchObservatoryStatus(baseUrl)
    return { hubReachable: true, observatory }
  } catch (ex) {
    const message = ex instanceof Error ? ex.message : 'Hub unreachable'
    return { hubReachable: false, error: message }
  }
}

export async function patchObservatoryMode(
  mode: 'manual' | 'auto',
  baseUrl = getHubBaseUrl()
): Promise<ObservatoryStatusResponse> {
  const url = `${normalizeHubBaseUrl(baseUrl)}/api/imaging/observatory-status`
  const res = await fetch(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ mode }),
  })
  const data = (await res.json().catch(() => ({}))) as ObservatoryStatusResponse
  if (!res.ok || !data.ok) {
    throw new Error(typeof data.error === 'string' ? data.error : `HTTP ${res.status}`)
  }
  return data
}

export function observatoryStatusLabel(status: string | undefined): string {
  switch (status) {
    case 'ready':
      return 'Ready'
    case 'busy_in_use':
      return 'Busy'
    case 'disconnected':
      return 'Disconnected'
    case 'closed_weather_not_permitted':
      return 'Closed — Weather'
    case 'closed_daytime':
      return 'Closed — Daytime'
    case 'closed_observatory_maintenance':
      return 'Closed — Maintenance'
    default:
      return status ?? 'Unknown'
  }
}
