import {
  personalAuthHeaders,
  personalTenantApiUrl,
} from '@shared/tenant-config'
import { getPersonalTenant, loadRuntimeTenant } from './tenant'
import type {
  CurrentSessionsResponse,
  HubProbeResult,
  ObservatoryMode,
  ObservatoryStatus,
  ObservatoryStatusResponse,
} from './types'

const FETCH_TIMEOUT_MS = 12_000

function formatHubError(message: string, tenant: ReturnType<typeof getPersonalTenant>): string {
  if (/load failed|failed to fetch|networkerror|network request failed|aborted/i.test(message)) {
    const local =
      tenant.apiBaseUrl.includes('127.0.0.1') || tenant.apiBaseUrl.includes('localhost')
    if (local) {
      return 'Dev hub offline — activate license in Settings or start local hub'
    }
    return 'Unreachable — check network or license in Settings'
  }
  if (/unauthorized|401/i.test(message)) {
    return 'License invalid — re-import tenant.json in Settings'
  }
  return message
}

async function hubFetch<T>(path: string): Promise<T> {
  const tenant = await loadRuntimeTenant()
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

export async function deleteSession(sessionId: string): Promise<{ ok: boolean; error?: string }> {
  const tenant = await loadRuntimeTenant()
  const url = personalTenantApiUrl(tenant, `/imaging/sessions/${encodeURIComponent(sessionId)}`)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      method: 'DELETE',
      signal: controller.signal,
      headers: personalAuthHeaders(tenant),
    })
    const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string }
    if (!res.ok || !data.ok) {
      return {
        ok: false,
        error: typeof data.error === 'string' ? data.error : `HTTP ${res.status}`,
      }
    }
    return { ok: true }
  } catch (ex) {
    return {
      ok: false,
      error: ex instanceof Error ? formatHubError(ex.message, tenant) : 'Unable to delete session',
    }
  } finally {
    clearTimeout(timer)
  }
}

export async function probeHub(): Promise<HubProbeResult> {
  const tenant = await loadRuntimeTenant()
  try {
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
    const raw = ex instanceof Error ? ex.message : 'Hub unreachable'
    return { hubReachable: false, error: formatHubError(raw, tenant) }
  }
}

export async function patchObservatoryMode(
  mode: 'manual' | 'auto'
): Promise<ObservatoryStatusResponse> {
  return patchObservatory({ mode })
}

export async function patchObservatory(input: {
  mode?: ObservatoryMode
  status?: ObservatoryStatus
}): Promise<ObservatoryStatusResponse> {
  const tenant = await loadRuntimeTenant()
  const url = personalTenantApiUrl(tenant, '/imaging/observatory-status')
  const res = await fetch(url, {
    method: 'PATCH',
    headers: personalAuthHeaders(tenant, { 'Content-Type': 'application/json' }),
    body: JSON.stringify(input),
  })
  const data = (await res.json().catch(() => ({}))) as ObservatoryStatusResponse
  if (!res.ok || !data.ok) {
    throw new Error(typeof data.error === 'string' ? data.error : `HTTP ${res.status}`)
  }
  return data
}

export type AuditLogResponse = {
  ok: boolean
  error?: string
  entries?: Array<{
    id: string
    at: string
    kind: string
    message: string
    detail?: Record<string, unknown>
  }>
}

export type LicenseSummaryResponse = {
  ok: boolean
  error?: string
  active?: boolean
  ownerName?: string
  plan?: string
  planLabel?: string
  purchaseType?: string
  purchaseTypeLabel?: string
  validUntil?: string | null
  nextBillAt?: string | null
}

export async function fetchLicenseSummary(): Promise<LicenseSummaryResponse> {
  return hubFetch<LicenseSummaryResponse>('/license')
}

export async function fetchAuditLog(limit = 200): Promise<AuditLogResponse> {
  return hubFetch<AuditLogResponse>(`/imaging/audit-log?limit=${encodeURIComponent(String(limit))}`)
}

/** Observatory status labels for the control-client status bar. */
export function observatoryStatusLabel(status: string | undefined | null): string {
  if (!status) return '—'
  if (status === 'ready') return 'Ready'
  if (status === 'busy_in_use') return 'Busy'
  if (status === 'disconnected') return 'Disconnected'
  return 'Closed'
}

export function stationConnected(probe: HubProbeResult | null): boolean | null {
  if (!probe?.hubReachable) return null
  return probe.observatory?.status !== 'disconnected'
}

export function stationStatusLabel(probe: HubProbeResult | null): string {
  const connected = stationConnected(probe)
  if (connected === null) return '—'
  return connected ? 'Connected' : 'Disconnected'
}

export function getCloudHubLabel(): string {
  const tenant = getPersonalTenant()
  const host = tenant.apiBaseUrl.includes('boreanastro.com')
    ? 'www.boreanastro.com'
    : tenant.apiBaseUrl.replace(/^https?:\/\//, '')
  return `${tenant.displayName ?? tenant.tenantId} @ ${host}`
}

export type EmergencyStopStatusResponse = {
  ok: boolean
  error?: string
  phase?: 'idle' | 'stopping' | 'stopped'
  progress?: number
  label?: string
  agentConnected?: boolean
  canArm?: boolean
}

export async function fetchEmergencyStopStatus(): Promise<EmergencyStopStatusResponse> {
  return hubFetch<EmergencyStopStatusResponse>('/imaging/emergency-stop')
}

export async function armEmergencyStop(): Promise<EmergencyStopStatusResponse> {
  const tenant = await loadRuntimeTenant()
  const url = personalTenantApiUrl(tenant, '/imaging/emergency-stop')
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      method: 'POST',
      signal: controller.signal,
      headers: personalAuthHeaders(tenant, { 'Content-Type': 'application/json' }),
      body: '{}',
    })
    const data = (await res.json().catch(() => ({}))) as EmergencyStopStatusResponse
    if (!res.ok) {
      return {
        ok: false,
        error: typeof data.error === 'string' ? data.error : `HTTP ${res.status}`,
      }
    }
    return { ...data, ok: true }
  } catch (ex) {
    return {
      ok: false,
      error: ex instanceof Error ? formatHubError(ex.message, tenant) : 'Emergency STOP failed.',
    }
  } finally {
    clearTimeout(timer)
  }
}
