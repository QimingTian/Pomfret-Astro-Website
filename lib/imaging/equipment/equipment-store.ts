import { postgresReadsEnabled } from '@/lib/db'
import { kvGetJson, kvSetJson, kvEnabled } from '@/lib/kv-rest'
import { isEquipmentValid, normalizeEquipment, type ImagingEquipment } from './equipment'

export const IMAGING_EQUIPMENT_KV_KEY = 'pomfret:imaging-equipment'
export const IMAGING_EQUIPMENT_CHANGED = 'pomfret:imaging-equipment-changed'

export function notifyImagingEquipmentChanged(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(IMAGING_EQUIPMENT_CHANGED))
  }
}

type EquipmentKvPayload =
  | ImagingEquipment
  | { rigs?: Array<ImagingEquipment | null | undefined> }
  | null
  | undefined

type GlobalWithRigs = typeof globalThis & {
  __pomfret_imaging_equipment_rigs__?: Array<ImagingEquipment | null>
}

function defaultRigs(): Array<ImagingEquipment | null> {
  return [null]
}

function memoryRigs(): Array<ImagingEquipment | null> {
  const g = globalThis as GlobalWithRigs
  if (!g.__pomfret_imaging_equipment_rigs__) {
    g.__pomfret_imaging_equipment_rigs__ = defaultRigs()
  }
  return g.__pomfret_imaging_equipment_rigs__
}

function snapshotRigs(): Array<ImagingEquipment | null> {
  return [...memoryRigs()]
}

function normalizeRigsPayload(raw: EquipmentKvPayload): Array<ImagingEquipment | null> {
  if (!raw || typeof raw !== 'object') {
    return defaultRigs()
  }
  if ('rigs' in raw && Array.isArray(raw.rigs)) {
    const rigs = raw.rigs.map((r) => (r ? normalizeEquipment(r as Partial<ImagingEquipment>) : null))
    return rigs.length > 0 ? rigs : defaultRigs()
  }
  const single = normalizeEquipment(raw as Partial<ImagingEquipment>)
  if (single) {
    return [single]
  }
  return defaultRigs()
}

async function readRigsFromKv(): Promise<Array<ImagingEquipment | null> | undefined> {
  if (!kvEnabled()) return undefined
  try {
    const raw = await kvGetJson<EquipmentKvPayload>(IMAGING_EQUIPMENT_KV_KEY)
    return normalizeRigsPayload(raw)
  } catch {
    return undefined
  }
}

async function writeRigsToKv(rigs: Array<ImagingEquipment | null>): Promise<void> {
  if (postgresReadsEnabled()) {
    const { mirrorImagingEquipment } = await import('@/lib/db/mirror')
    await mirrorImagingEquipment(rigs)
    return
  }
  if (!kvEnabled()) return
  await kvSetJson(IMAGING_EQUIPMENT_KV_KEY, { rigs })
  const { mirrorImagingEquipment } = await import('@/lib/db/mirror')
  await mirrorImagingEquipment(rigs)
}

export async function listImagingRigs(): Promise<Array<ImagingEquipment | null>> {
  if (postgresReadsEnabled()) {
    try {
      const { loadEquipmentRigsFromPostgres } = await import('@/lib/db/read')
      const pg = await loadEquipmentRigsFromPostgres()
      if (Array.isArray(pg)) {
        memoryRigs().splice(0, memoryRigs().length, ...(pg as Array<ImagingEquipment | null>))
        return snapshotRigs()
      }
    } catch (error) {
      console.error('[pg-read] equipment failed; using KV', error)
    }
  }
  const remote = await readRigsFromKv()
  if (remote) {
    memoryRigs().splice(0, memoryRigs().length, ...remote)
    return snapshotRigs()
  }
  return snapshotRigs()
}

export async function getPrimaryImagingEquipment(): Promise<ImagingEquipment | null> {
  const rigs = await listImagingRigs()
  return rigs.find((r) => r != null) ?? null
}

export async function setImagingRigAt(
  index: number,
  equipment: ImagingEquipment,
): Promise<Array<ImagingEquipment | null> | null> {
  if (!isEquipmentValid(equipment)) return null
  const normalized = normalizeEquipment(equipment)
  if (!normalized) return null
  if (index < 0) return null

  // Always hydrate from KV first — serverless instances start with empty in-memory rigs.
  await listImagingRigs()
  const rigs = snapshotRigs()
  while (rigs.length <= index) rigs.push(null)
  rigs[index] = normalized
  memoryRigs().splice(0, memoryRigs().length, ...rigs)
  await writeRigsToKv(rigs)
  return snapshotRigs()
}

export async function deleteImagingRigAt(index: number): Promise<Array<ImagingEquipment | null>> {
  await listImagingRigs()
  const rigs = snapshotRigs()
  if (index < 0 || index >= rigs.length) return rigs

  if (rigs.length === 1) {
    rigs[0] = null
  } else {
    rigs.splice(index, 1)
  }

  memoryRigs().splice(0, memoryRigs().length, ...rigs)
  await writeRigsToKv(rigs)
  return snapshotRigs()
}

export function rigDisplayLabel(index: number, rig: ImagingEquipment | null): string {
  const custom = rig?.label?.trim()
  if (custom) return custom
  return `Rig ${index + 1}`
}
