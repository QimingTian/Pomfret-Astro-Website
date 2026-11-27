/** Latest NINA safety-monitor telemetry per station — memory + Upstash KV. */

import { kvEnabled, kvGetJson, kvSetJson } from '@/lib/kv-rest'
import { currentObservatorySiteId, scopedKvKey } from '@/lib/observatory-site-scope'
import { isWithinDaytimeClosedWindow } from '@/lib/sunrise-window'

export type SafetyMonitorPayload = {
  source?: string
  stationId?: string
  connected: boolean
  isSafe?: boolean | null
  name?: string | null
  displayName?: string | null
  deviceId?: string | null
  clientUtc?: string | null
  pluginVersion?: string | null
}

export type StoredSafetyMonitorSample = SafetyMonitorPayload & {
  receivedAtUtc: string
}

const latestByStation = new Map<string, StoredSafetyMonitorSample>()
const lastKvPersistAtByStation = new Map<string, number>()

function safetyKvPersistMinMs(): number {
  return isWithinDaytimeClosedWindow() ? 30_000 : 2_000
}

function stationKey(stationId: string | undefined | null): string {
  const t = typeof stationId === 'string' ? stationId.trim() : ''
  return t.length > 0 ? t : 'default'
}

function memoryStationKey(stationId: string | undefined | null): string {
  return `${currentObservatorySiteId()}:${stationKey(stationId)}`
}

function kvKey(stationId: string | undefined | null): string {
  return scopedKvKey(`safety-monitor:${stationKey(stationId)}`)
}

function strOrUndef(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined
}

function boolOrUndef(v: unknown): boolean | undefined {
  return typeof v === 'boolean' ? v : undefined
}

/**
 * Parse plugin POST body. Requires boolean `connected`.
 * When connected, `isSafe` must be boolean; when disconnected it may be omitted/null.
 */
export function parseSafetyMonitorPayload(body: Record<string, unknown>): SafetyMonitorPayload | null {
  const connected = boolOrUndef(body.connected)
  if (connected === undefined) return null

  const isSafeRaw = body.isSafe
  let isSafe: boolean | null | undefined
  if (isSafeRaw === null || isSafeRaw === undefined) {
    isSafe = connected ? undefined : null
  } else if (typeof isSafeRaw === 'boolean') {
    isSafe = isSafeRaw
  } else {
    return null
  }

  if (connected && typeof isSafe !== 'boolean') return null

  return {
    source: strOrUndef(body.source) ?? 'pomfret-safety-monitor',
    stationId: strOrUndef(body.stationId),
    connected,
    isSafe: isSafe === undefined ? null : isSafe,
    name: strOrUndef(body.name) ?? null,
    displayName: strOrUndef(body.displayName) ?? null,
    deviceId: strOrUndef(body.deviceId) ?? null,
    clientUtc: strOrUndef(body.clientUtc) ?? null,
    pluginVersion: strOrUndef(body.pluginVersion) ?? null,
  }
}

export async function setSafetyMonitorSample(
  stationId: string | undefined | null,
  payload: SafetyMonitorPayload
): Promise<StoredSafetyMonitorSample> {
  const key = memoryStationKey(stationId)
  const receivedAtUtc = new Date().toISOString()
  const stored: StoredSafetyMonitorSample = {
    ...payload,
    receivedAtUtc,
  }
  latestByStation.set(key, stored)
  const now = Date.now()
  const lastPersist = lastKvPersistAtByStation.get(key) ?? 0
  const shouldPersist = now - lastPersist >= safetyKvPersistMinMs()
  if (kvEnabled() && shouldPersist) {
    lastKvPersistAtByStation.set(key, now)
    await kvSetJson(kvKey(stationId), stored)
  }
  return stored
}

export async function getSafetyMonitorSample(
  stationId: string | undefined | null
): Promise<StoredSafetyMonitorSample | null> {
  const key = memoryStationKey(stationId)
  if (kvEnabled()) {
    const remote = await kvGetJson<StoredSafetyMonitorSample>(kvKey(stationId))
    if (remote && typeof remote === 'object') {
      latestByStation.set(key, remote)
      return remote
    }
  }
  return latestByStation.get(key) ?? null
}
