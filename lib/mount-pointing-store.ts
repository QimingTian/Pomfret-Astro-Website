/** In-memory latest mount telemetry (single-node; use KV later for multi-instance). */

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

function stationKey(stationId: string | undefined | null): string {
  const t = typeof stationId === 'string' ? stationId.trim() : ''
  return t.length > 0 ? t : 'default'
}

export function setMountPointingSample(
  stationId: string | undefined | null,
  payload: MountPointingPayload
): StoredMountSample {
  const key = stationKey(stationId)
  const receivedAtUtc = new Date().toISOString()
  const stored: StoredMountSample = {
    ...payload,
    receivedAtUtc,
  }
  latestByStation.set(key, stored)
  return stored
}

export function getMountPointingSample(stationId: string | undefined | null): StoredMountSample | null {
  return latestByStation.get(stationKey(stationId)) ?? null
}

export function listMountPointingStationIds(): string[] {
  return Array.from(latestByStation.keys())
}
