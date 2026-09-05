/** Latest mount telemetry per station — memory + Upstash KV for Vercel multi-instance. */

import { emitLiveEvent, liveMountChannel } from '@/lib/imaging/live-bus'
import { kvEnabled, kvGetJson, kvSetJson } from '@/lib/kv-rest'
import { scopedKvKey } from '@/lib/observatory-site-scope'
import { isWithinDaytimeClosedWindow } from '@/lib/sunrise-window'

export type MountPointingPayload = {
  source?: string
  stationId?: string
  connected: boolean
  raHours?: number | null
  decDeg?: number | null
  siderealTimeHours?: number | null
  siteLatitudeDeg?: number | null
  altitudeDeg?: number | null
  azimuthDeg?: number | null
  slewing?: boolean
  atPark?: boolean
  trackingEnabled?: boolean
  sideOfPier?: string | null
  epoch?: string | null
  clientUtc?: string | null
  pluginVersion?: string | null
}

export type StoredMountSample = MountPointingPayload & {
  receivedAtUtc: string
}

const latestByStation = new Map<string, StoredMountSample>()
const lastKvPersistAtByStation = new Map<string, number>()

function mountKvPersistMinMs(): number {
  return isWithinDaytimeClosedWindow() ? 30_000 : 2_000
}

function stationKey(stationId: string | undefined | null): string {
  const t = typeof stationId === 'string' ? stationId.trim() : ''
  return t.length > 0 ? t : 'default'
}

/**
 * Scoped per observatory as well as per station, so a plugin left on the default
 * station id cannot publish one site's mount into the other site's 3D panel.
 */
function kvKey(stationId: string | undefined | null): string {
  return scopedKvKey(`mount-pointing:${stationKey(stationId)}`)
}

export async function setMountPointingSample(
  stationId: string | undefined | null,
  payload: MountPointingPayload
): Promise<StoredMountSample> {
  const key = stationKey(stationId)
  const receivedAtUtc = new Date().toISOString()
  const stored: StoredMountSample = {
    ...payload,
    receivedAtUtc,
  }
  latestByStation.set(key, stored)
  const now = Date.now()
  const lastPersist = lastKvPersistAtByStation.get(key) ?? 0
  const shouldPersist = now - lastPersist >= mountKvPersistMinMs()
  if (kvEnabled() && shouldPersist) {
    lastKvPersistAtByStation.set(key, now)
    await kvSetJson(kvKey(stationId), stored)
    void emitLiveEvent(liveMountChannel(stationId), { type: 'sample', sample: stored })
  }
  return stored
}

export async function getMountPointingSample(
  stationId: string | undefined | null
): Promise<StoredMountSample | null> {
  const key = stationKey(stationId)
  if (kvEnabled()) {
    const remote = await kvGetJson<StoredMountSample>(kvKey(stationId))
    if (remote && typeof remote === 'object') {
      latestByStation.set(key, remote)
      return remote
    }
  }
  return latestByStation.get(key) ?? null
}

export function listMountPointingStationIds(): string[] {
  return Array.from(latestByStation.keys())
}
