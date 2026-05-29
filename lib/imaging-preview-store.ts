import { kvDel, kvEnabled, kvGetJson, kvSetJson } from '@/lib/kv-rest'

/** Legacy monolithic map (pre per-queueId keys). Read-only fallback. */
const LEGACY_KEY = 'imaging-preview-latest'
const INDEX_KEY = 'imaging-preview-index'
const MAX_ENTRIES = 50

export type PreviewEntry = {
  imageId: string
  queueId: string
  updatedAt: string
  contentType: string
  dataBase64: string
  /** Monotonic count of successful preview uploads for this queueId (for terminal Image n/…). */
  frameNumber?: number
}

type PreviewIndexRow = { queueId: string; updatedAt: string }

type GlobalWithPreview = typeof globalThis & {
  __pomfret_imaging_preview_by_queue__?: Record<string, PreviewEntry>
}

function previewKvKey(queueId: string): string {
  return `imaging-preview:${queueId}`
}

function memoryMap(): Record<string, PreviewEntry> {
  const g = globalThis as GlobalWithPreview
  if (!g.__pomfret_imaging_preview_by_queue__) g.__pomfret_imaging_preview_by_queue__ = {}
  return g.__pomfret_imaging_preview_by_queue__
}

async function readLegacyEntry(queueId: string): Promise<PreviewEntry | null> {
  const legacy = await kvGetJson<{ byQueueId?: Record<string, PreviewEntry> }>(LEGACY_KEY)
  const e = legacy?.byQueueId?.[queueId]
  return e && e.dataBase64 ? e : null
}

async function trimPreviewIndex(keepQueueId: string, updatedAt: string): Promise<void> {
  const prev = (await kvGetJson<PreviewIndexRow[]>(INDEX_KEY)) ?? []
  const next = [
    { queueId: keepQueueId, updatedAt },
    ...prev.filter((r) => r.queueId !== keepQueueId),
  ]
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, MAX_ENTRIES)

  const dropped = prev.filter((r) => !next.some((n) => n.queueId === r.queueId))
  await kvSetJson(INDEX_KEY, next)
  for (const row of dropped) {
    await kvDel(previewKvKey(row.queueId))
  }
}

export async function upsertPreviewImage(
  queueId: string,
  imageId: string,
  contentType: string,
  dataBase64: string
): Promise<number> {
  const existing =
    memoryMap()[queueId] ?? (await getPreviewImage(queueId))
  const frameNumber = (existing?.frameNumber ?? 0) + 1
  const entry: PreviewEntry = {
    imageId,
    queueId,
    updatedAt: new Date().toISOString(),
    contentType,
    dataBase64,
    frameNumber,
  }

  memoryMap()[queueId] = entry

  if (kvEnabled()) {
    const ok = await kvSetJson(previewKvKey(queueId), entry)
    if (ok) {
      await trimPreviewIndex(queueId, entry.updatedAt)
    }
  }

  return frameNumber
}

export async function getPreviewImage(queueId: string): Promise<PreviewEntry | null> {
  const mem = memoryMap()[queueId]
  if (mem?.dataBase64) return mem

  const fromKv = await kvGetJson<PreviewEntry>(previewKvKey(queueId))
  if (fromKv?.dataBase64) {
    memoryMap()[queueId] = fromKv
    return fromKv
  }

  const legacy = await readLegacyEntry(queueId)
  if (legacy) {
    memoryMap()[queueId] = legacy
    return legacy
  }

  return null
}

export async function hasPreviewImage(queueId: string): Promise<boolean> {
  const e = await getPreviewImage(queueId)
  return Boolean(e && e.dataBase64)
}

export async function removePreviewImage(queueId: string): Promise<void> {
  const mem = memoryMap()
  if (queueId in mem) delete mem[queueId]

  await kvDel(previewKvKey(queueId))

  if (kvEnabled()) {
    const prev = (await kvGetJson<PreviewIndexRow[]>(INDEX_KEY)) ?? []
    const next = prev.filter((r) => r.queueId !== queueId)
    if (next.length !== prev.length) {
      await kvSetJson(INDEX_KEY, next)
    }
  }
}
