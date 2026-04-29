import { kvEnabled, kvGetJson, kvSetJson } from '@/lib/kv-rest'

const KEY = 'imaging-preview-latest'
const MAX_ENTRIES = 50

type PreviewEntry = {
  imageId: string
  queueId: string
  updatedAt: string
  contentType: string
  dataBase64: string
}

type Payload = { byQueueId: Record<string, PreviewEntry> }

type GlobalWithPreview = typeof globalThis & {
  __pomfret_imaging_preview_latest__?: Record<string, PreviewEntry>
}

function memoryMap(): Record<string, PreviewEntry> {
  const g = globalThis as GlobalWithPreview
  if (!g.__pomfret_imaging_preview_latest__) g.__pomfret_imaging_preview_latest__ = {}
  return g.__pomfret_imaging_preview_latest__
}

async function readMap(): Promise<Record<string, PreviewEntry>> {
  if (kvEnabled()) {
    const remote = await kvGetJson<Payload>(KEY)
    if (remote && typeof remote === 'object' && remote.byQueueId && typeof remote.byQueueId === 'object') {
      return remote.byQueueId
    }
  }
  return { ...memoryMap() }
}

async function writeMap(byQueueId: Record<string, PreviewEntry>): Promise<void> {
  const values = Object.values(byQueueId).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  const trimmed = values.slice(0, MAX_ENTRIES)
  const next: Record<string, PreviewEntry> = {}
  for (const e of trimmed) next[e.queueId] = e
  if (kvEnabled()) {
    const ok = await kvSetJson(KEY, { byQueueId: next })
    if (ok) return
  }
  const mem = memoryMap()
  for (const k of Object.keys(mem)) delete mem[k]
  Object.assign(mem, next)
}

export async function upsertPreviewImage(
  queueId: string,
  imageId: string,
  contentType: string,
  dataBase64: string
): Promise<void> {
  const byQueueId = await readMap()
  byQueueId[queueId] = {
    imageId,
    queueId,
    updatedAt: new Date().toISOString(),
    contentType,
    dataBase64,
  }
  await writeMap(byQueueId)
}

export async function getPreviewImage(queueId: string): Promise<PreviewEntry | null> {
  const byQueueId = await readMap()
  return byQueueId[queueId] ?? null
}

export async function hasPreviewImage(queueId: string): Promise<boolean> {
  const e = await getPreviewImage(queueId)
  return Boolean(e && e.dataBase64)
}

export async function removePreviewImage(queueId: string): Promise<void> {
  const byQueueId = await readMap()
  if (!(queueId in byQueueId)) return
  delete byQueueId[queueId]
  await writeMap(byQueueId)
}
