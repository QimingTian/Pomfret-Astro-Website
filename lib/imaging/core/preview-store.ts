import { kvDel, kvEnabled, kvGetJson, kvIncrFromSeed, kvSetJson } from '@/lib/kv-rest'
import {
  deleteLivePreviewObject,
  putLivePreviewObject,
  readLivePreviewObject,
} from '@/lib/r2-session-download'

/** Tiny KV record — image bytes live in memory + one R2 object per session (overwrite). */
export type PreviewMeta = {
  imageId: string
  queueId: string
  updatedAt: string
  contentType: string
  frameNumber?: number
}

export type PreviewEntry = PreviewMeta & {
  dataBase64: string
}

const LEGACY_BLOB_KEY_PREFIX = 'imaging-preview:'
const LEGACY_MONOLITH_KEY = 'imaging-preview-latest'
const LEGACY_INDEX_KEY = 'imaging-preview-index'
const META_KEY_PREFIX = 'imaging-preview-meta:'
const FRAME_KEY_PREFIX = 'imaging-preview-frame:'

type GlobalWithPreview = typeof globalThis & {
  __pomfret_imaging_preview_by_queue__?: Record<string, PreviewEntry>
  __pomfret_imaging_preview_frame_by_queue__?: Record<string, number>
}

function previewMetaKvKey(queueId: string): string {
  return `${META_KEY_PREFIX}${queueId}`
}

function previewFrameKvKey(queueId: string): string {
  return `${FRAME_KEY_PREFIX}${queueId}`
}

function legacyBlobKvKey(queueId: string): string {
  return `${LEGACY_BLOB_KEY_PREFIX}${queueId}`
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

function entryFromMetaAndBytes(meta: PreviewMeta, body: Buffer): PreviewEntry {
  return {
    ...meta,
    dataBase64: body.toString('base64'),
  }
}

async function readMetaFromKv(queueId: string): Promise<PreviewMeta | null> {
  const meta = await kvGetJson<PreviewMeta>(previewMetaKvKey(queueId))
  if (meta?.updatedAt && meta.queueId) return meta
  return null
}

let legacyMonolithPurgeStarted = false

/** Drop the old base64 monolith (~1MB) so hasPreview / cold paths never re-download it. */
function purgeLegacyPreviewMonolithOnce(): void {
  if (legacyMonolithPurgeStarted || !kvEnabled()) return
  legacyMonolithPurgeStarted = true
  void kvDel(LEGACY_MONOLITH_KEY)
  void kvDel(LEGACY_INDEX_KEY)
}

/** One-time migration: load per-queue legacy KV blob into R2/memory, then delete from KV. */
async function migrateLegacyBlobToMemory(queueId: string): Promise<PreviewEntry | null> {
  purgeLegacyPreviewMonolithOnce()
  const perQueue = await kvGetJson<PreviewEntry>(legacyBlobKvKey(queueId))
  if (perQueue?.dataBase64) {
    memoryMap()[queueId] = perQueue
    await kvDel(legacyBlobKvKey(queueId))
    const body = Buffer.from(perQueue.dataBase64, 'base64')
    await putLivePreviewObject(queueId, body, perQueue.contentType || 'image/jpeg')
    return perQueue
  }

  return null
}

async function legacyFrameSeed(queueId: string): Promise<number> {
  const mem = memoryMap()[queueId]
  if (mem?.frameNumber != null && mem.frameNumber > 0) return mem.frameNumber
  const meta = await readMetaFromKv(queueId)
  if (meta?.frameNumber != null && meta.frameNumber > 0) return meta.frameNumber
  const migrated = await migrateLegacyBlobToMemory(queueId)
  return migrated?.frameNumber ?? 0
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

async function persistMeta(meta: PreviewMeta): Promise<void> {
  if (!kvEnabled()) return
  await kvSetJson(previewMetaKvKey(meta.queueId), meta)
  await kvDel(legacyBlobKvKey(meta.queueId))
}

async function readPreviewFromR2(queueId: string, meta: PreviewMeta): Promise<PreviewEntry | null> {
  const fromR2 = await readLivePreviewObject(queueId)
  if (!fromR2) return null
  const entry = entryFromMetaAndBytes(meta, fromR2.body)
  if (fromR2.contentType) entry.contentType = fromR2.contentType
  memoryMap()[queueId] = entry
  return entry
}

export async function upsertPreviewImage(
  queueId: string,
  imageId: string,
  contentType: string,
  dataBase64: string
): Promise<number> {
  const frameNumber = await nextPreviewFrameNumber(queueId)
  const meta: PreviewMeta = {
    imageId,
    queueId,
    updatedAt: new Date().toISOString(),
    contentType,
    frameNumber,
  }
  const body = Buffer.from(dataBase64, 'base64')
  const entry: PreviewEntry = { ...meta, dataBase64 }

  memoryMap()[queueId] = entry
  await putLivePreviewObject(queueId, body, contentType)
  await persistMeta(meta)

  return frameNumber
}

export async function getPreviewImage(queueId: string): Promise<PreviewEntry | null> {
  purgeLegacyPreviewMonolithOnce()
  const mem = memoryMap()[queueId]
  if (mem?.dataBase64) return mem

  const meta = await readMetaFromKv(queueId)
  if (meta) {
    const fromR2 = await readPreviewFromR2(queueId, meta)
    if (fromR2) return fromR2
  }

  return migrateLegacyBlobToMemory(queueId)
}

export async function hasPreviewImage(queueId: string): Promise<boolean> {
  purgeLegacyPreviewMonolithOnce()
  const mem = memoryMap()[queueId]
  if (mem?.dataBase64) return true

  const meta = await readMetaFromKv(queueId)
  if (meta) return true

  const legacy = await kvGetJson<PreviewEntry>(legacyBlobKvKey(queueId))
  return Boolean(legacy?.dataBase64)
}

export async function removePreviewImage(queueId: string): Promise<void> {
  const mem = memoryMap()
  if (queueId in mem) delete mem[queueId]
  const frameMem = memoryFrameMap()
  if (queueId in frameMem) delete frameMem[queueId]

  await deleteLivePreviewObject(queueId)
  await kvDel(previewMetaKvKey(queueId))
  await kvDel(previewFrameKvKey(queueId))
  await kvDel(legacyBlobKvKey(queueId))

  if (kvEnabled()) {
    const prev = (await kvGetJson<{ queueId: string; updatedAt: string }[]>(LEGACY_INDEX_KEY)) ?? []
    const next = prev.filter((r) => r.queueId !== queueId)
    if (next.length !== prev.length) {
      await kvSetJson(LEGACY_INDEX_KEY, next)
    }
  }
}
