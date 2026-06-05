import { kvDel, kvEnabled, kvGetJson, kvIncrFromSeed, kvSetJson } from '@/lib/kv-rest'

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
  __pomfret_imaging_preview_frame_by_queue__?: Record<string, number>
}

function previewKvKey(queueId: string): string {
  return `imaging-preview:${queueId}`
}

function previewFrameKvKey(queueId: string): string {
  return `imaging-preview-frame:${queueId}`
}

function memoryMap(): Record<string, PreviewEntry> {
  const g = globalThis as GlobalWithPreview
  if (!g.__pomfret_imaging_preview_by_queue__) g.__pomfret_imaging_preview_by_queue__ = {}
  return g.__pomfret_imaging_preview_by_queue__
}

function memoryFrameMap(): Record<string, number> {
  const g = globalThis as GlobalWithPreview
  if (!g.__pomfret_imaging_preview_frame_by_queue__) g.__pomfret_imaging_preview_frame_by_queue__ = {}
  return g.__pomfret_imaging_preview_frame_by_queue__
}

async function readLegacyEntry(queueId: string): Promise<PreviewEntry | null> {
  const legacy = await kvGetJson<{ byQueueId?: Record<string, PreviewEntry> }>(LEGACY_KEY)
  const e = legacy?.byQueueId?.[queueId]
  return e && e.dataBase64 ? e : null
}

async function readPreviewEntryFromKv(queueId: string): Promise<PreviewEntry | null> {
  const fromKv = await kvGetJson<PreviewEntry>(previewKvKey(queueId))
  if (fromKv?.dataBase64) return fromKv
  return readLegacyEntry(queueId)
}

/** Seed for first atomic INCR when migrating from frameNumber stored on the preview blob. */
async function legacyFrameSeed(queueId: string): Promise<number> {
  const mem = memoryMap()[queueId]
  if (mem?.frameNumber != null && mem.frameNumber > 0) return mem.frameNumber
  const fromKv = await readPreviewEntryFromKv(queueId)
  return fromKv?.frameNumber ?? 0
}

async function nextPreviewFrameNumber(queueId: string): Promise<number> {
  if (kvEnabled()) {
    const seed = await legacyFrameSeed(queueId)
    const fromKv = await kvIncrFromSeed(previewFrameKvKey(queueId), seed)
    if (fromKv != null) {
      memoryFrameMap()[queueId] = fromKv
      return fromKv
    }
  }

  const prev = memoryFrameMap()[queueId] ?? (await legacyFrameSeed(queueId))
  const frameNumber = prev + 1
  memoryFrameMap()[queueId] = frameNumber
  return frameNumber
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
    await kvDel(previewFrameKvKey(row.queueId))
  }
}

export async function upsertPreviewImage(
  queueId: string,
  imageId: string,
  contentType: string,
  dataBase64: string
): Promise<number> {
  const frameNumber = await nextPreviewFrameNumber(queueId)
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

  const fromKv = await readPreviewEntryFromKv(queueId)
  if (fromKv) {
    memoryMap()[queueId] = fromKv
    return fromKv
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
  const frameMem = memoryFrameMap()
  if (queueId in frameMem) delete frameMem[queueId]

  await kvDel(previewKvKey(queueId))
  await kvDel(previewFrameKvKey(queueId))

  if (kvEnabled()) {
    const prev = (await kvGetJson<PreviewIndexRow[]>(INDEX_KEY)) ?? []
    const next = prev.filter((r) => r.queueId !== queueId)
    if (next.length !== prev.length) {
      await kvSetJson(INDEX_KEY, next)
    }
  }
}
