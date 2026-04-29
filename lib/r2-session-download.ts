import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

import { kvGetJson, kvSetJson } from '@/lib/kv-rest'

const KEY = 'imaging-r2-object-map'
const PREVIEW_KEY = 'imaging-r2-preview-map'
const DEFAULT_CACHE_MS = 30_000
const DEFAULT_SIGN_TTL_SEC = 300

type MappingPayload = { byQueueId: Record<string, string> }
type CacheEntry = { expiresAt: number; exists: boolean; objectKey: string | null }
type GlobalWithR2Cache = typeof globalThis & { __pomfret_r2_exists_cache__?: Map<string, CacheEntry> }

function cacheMap(): Map<string, CacheEntry> {
  const g = globalThis as GlobalWithR2Cache
  if (!g.__pomfret_r2_exists_cache__) g.__pomfret_r2_exists_cache__ = new Map()
  return g.__pomfret_r2_exists_cache__
}

function r2Enabled(): boolean {
  return Boolean(
    process.env.R2_ENDPOINT &&
      process.env.R2_BUCKET &&
      process.env.R2_ACCESS_KEY_ID &&
      process.env.R2_SECRET_ACCESS_KEY
  )
}

function r2Bucket(): string {
  return (process.env.R2_BUCKET ?? '').trim()
}

function signTtlSec(): number {
  const n = Number(process.env.R2_PRESIGN_TTL_SEC ?? DEFAULT_SIGN_TTL_SEC)
  if (!Number.isFinite(n) || n < 30) return DEFAULT_SIGN_TTL_SEC
  return Math.min(Math.floor(n), 3600)
}

function createR2Client(): S3Client {
  return new S3Client({
    region: process.env.R2_REGION ?? 'auto',
    endpoint: process.env.R2_ENDPOINT,
    forcePathStyle: true,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID ?? '',
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY ?? '',
    },
  })
}

function fallbackObjectKeyForQueueId(queueId: string): string {
  const suffix = (process.env.R2_SESSION_OBJECT_SUFFIX ?? '').trim()
  return suffix ? `${queueId}${suffix}` : queueId
}

function fileNameFromObjectKey(objectKey: string): string {
  const cleaned = objectKey.trim().replace(/\/+$/, '')
  const slash = cleaned.lastIndexOf('/')
  return slash === -1 ? cleaned : cleaned.slice(slash + 1)
}

export async function upsertR2ObjectKey(queueId: string, objectKey: string): Promise<void> {
  const current = ((await kvGetJson<MappingPayload>(KEY)) ?? { byQueueId: {} }) as MappingPayload
  current.byQueueId[queueId] = objectKey
  await kvSetJson(KEY, current)
}

export async function upsertR2PreviewObjectKey(queueId: string, objectKey: string): Promise<void> {
  const current = ((await kvGetJson<MappingPayload>(PREVIEW_KEY)) ?? { byQueueId: {} }) as MappingPayload
  current.byQueueId[queueId] = objectKey
  await kvSetJson(PREVIEW_KEY, current)
}

async function removeR2ObjectKeyMapping(queueId: string): Promise<void> {
  const current = ((await kvGetJson<MappingPayload>(KEY)) ?? { byQueueId: {} }) as MappingPayload
  delete current.byQueueId[queueId]
  await kvSetJson(KEY, current)
}

async function removeR2PreviewObjectKeyMapping(queueId: string): Promise<void> {
  const current = ((await kvGetJson<MappingPayload>(PREVIEW_KEY)) ?? { byQueueId: {} }) as MappingPayload
  delete current.byQueueId[queueId]
  await kvSetJson(PREVIEW_KEY, current)
}

export async function getR2ObjectKey(queueId: string): Promise<string> {
  const current = await kvGetJson<MappingPayload>(KEY)
  const saved = current?.byQueueId?.[queueId]
  if (typeof saved === 'string' && saved.trim()) return saved.trim()
  return fallbackObjectKeyForQueueId(queueId)
}

export async function getR2PreviewObjectKey(queueId: string): Promise<string | null> {
  const current = await kvGetJson<MappingPayload>(PREVIEW_KEY)
  const saved = current?.byQueueId?.[queueId]
  if (typeof saved === 'string' && saved.trim()) return saved.trim()
  return null
}

async function objectExists(objectKey: string): Promise<boolean> {
  if (!r2Enabled()) return false
  const cache = cacheMap()
  const now = Date.now()
  const cached = cache.get(objectKey)
  if (cached && cached.expiresAt > now) return cached.exists

  try {
    const client = createR2Client()
    await client.send(new HeadObjectCommand({ Bucket: r2Bucket(), Key: objectKey }))
    cache.set(objectKey, { exists: true, objectKey, expiresAt: now + DEFAULT_CACHE_MS })
    return true
  } catch {
    cache.set(objectKey, { exists: false, objectKey: null, expiresAt: now + DEFAULT_CACHE_MS })
    return false
  }
}

export async function hasR2ObjectForQueueId(queueId: string): Promise<boolean> {
  const objectKey = await getR2ObjectKey(queueId)
  return objectExists(objectKey)
}

export async function hasR2PreviewObjectForQueueId(queueId: string): Promise<boolean> {
  const objectKey = await getR2PreviewObjectKey(queueId)
  if (!objectKey) return false
  return objectExists(objectKey)
}

export async function buildSignedDownloadUrl(queueId: string, overrideObjectKey?: string): Promise<string | null> {
  if (!r2Enabled()) return null

  const objectKey = (overrideObjectKey ?? (await getR2ObjectKey(queueId))).trim()
  if (!objectKey) return null
  if (!(await objectExists(objectKey))) return null

  const client = createR2Client()
  const filename = fileNameFromObjectKey(objectKey) || `${queueId}.bin`
  const command = new GetObjectCommand({
    Bucket: r2Bucket(),
    Key: objectKey,
    ResponseContentDisposition: `attachment; filename="${filename}"`,
    ResponseContentType: 'application/octet-stream',
  })
  return getSignedUrl(client, command, { expiresIn: signTtlSec() })
}

export async function buildSignedPreviewUrl(queueId: string): Promise<string | null> {
  if (!r2Enabled()) return null
  const objectKey = (await getR2PreviewObjectKey(queueId))?.trim()
  if (!objectKey) return null
  if (!(await objectExists(objectKey))) return null

  const client = createR2Client()
  const command = new GetObjectCommand({
    Bucket: r2Bucket(),
    Key: objectKey,
    ResponseContentDisposition: 'inline',
    ResponseContentType: 'image/jpeg',
  })
  return getSignedUrl(client, command, { expiresIn: signTtlSec() })
}

/** Delete the session object from R2 and drop queueId → objectKey mapping (e.g. 48h after user download). */
export async function deleteR2ObjectForQueueId(queueId: string): Promise<void> {
  if (!r2Enabled()) return

  const objectKey = (await getR2ObjectKey(queueId)).trim()
  if (!objectKey) {
    await removeR2ObjectKeyMapping(queueId)
    return
  }

  const client = createR2Client()
  try {
    await client.send(new DeleteObjectCommand({ Bucket: r2Bucket(), Key: objectKey }))
  } catch {
    // Object may already be gone; still clear mapping.
  }

  const cache = cacheMap()
  cache.delete(objectKey)

  await removeR2ObjectKeyMapping(queueId)

  const previewObjectKey = (await getR2PreviewObjectKey(queueId))?.trim()
  if (previewObjectKey) {
    try {
      await client.send(new DeleteObjectCommand({ Bucket: r2Bucket(), Key: previewObjectKey }))
    } catch {
      // ignore cleanup failures
    }
    cache.delete(previewObjectKey)
  }
  await removeR2PreviewObjectKeyMapping(queueId)
}
