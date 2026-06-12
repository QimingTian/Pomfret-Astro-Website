import {
  personalAuthHeaders,
  personalTenantApiUrl,
} from '@shared/tenant-config'
import { getPersonalTenant } from './tenant'
import type {
  CurrentSessionsResponse,
  HubProbeResult,
  ObservatoryStatusResponse,
} from './types'

const FETCH_TIMEOUT_MS = 12_000

async function hubFetch<T>(path: string): Promise<T> {
  const tenant = getPersonalTenant()
  const url = personalTenantApiUrl(tenant, path)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: personalAuthHeaders(tenant),
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

export async function fetchObservatoryStatus(): Promise<ObservatoryStatusResponse> {
  return hubFetch<ObservatoryStatusResponse>('/imaging/observatory-status')
}

export async function fetchCurrentSessions(): Promise<CurrentSessionsResponse> {
  return hubFetch<CurrentSessionsResponse>('/imaging/current-sessions')
}

export async function probeHub(): Promise<HubProbeResult> {
  try {
    const tenant = getPersonalTenant()
    const healthUrl = personalTenantApiUrl(tenant, '/health')
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
    try {
      const res = await fetch(healthUrl, {
        signal: controller.signal,
        headers: personalAuthHeaders(tenant),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
    } finally {
      clearTimeout(timer)
    }
    const observatory = await fetchObservatoryStatus()
    return { hubReachable: true, observatory }
  } catch (ex) {
    const message = ex instanceof Error ? ex.message : 'Hub unreachable'
    return { hubReachable: false, error: message }
  }
}

export async function patchObservatoryMode(
  mode: 'manual' | 'auto'
): Promise<ObservatoryStatusResponse> {
  const tenant = getPersonalTenant()
  const url = personalTenantApiUrl(tenant, '/imaging/observatory-status')
  const res = await fetch(url, {
    method: 'PATCH',
    headers: personalAuthHeaders(tenant, { 'Content-Type': 'application/json' }),
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

export function getCloudHubLabel(): string {
  const tenant = getPersonalTenant()
  return `${tenant.displayName ?? tenant.tenantId} @ www.boreanastro.com`
}
