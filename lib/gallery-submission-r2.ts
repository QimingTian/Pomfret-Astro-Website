import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

const DEFAULT_SIGN_TTL_SEC = 600
export const GALLERY_SUBMISSION_MAX_BYTES = 50 * 1024 * 1024

const ALLOWED_CONTENT_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp'])

export function gallerySubmissionR2Enabled(): boolean {
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
  if (!Number.isFinite(n) || n < 60) return DEFAULT_SIGN_TTL_SEC
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

export function normalizeGallerySubmissionContentType(raw: string): string | null {
  const t = raw.trim().toLowerCase()
  if (ALLOWED_CONTENT_TYPES.has(t)) return t
  return null
}

export function extensionForContentType(contentType: string): string {
  if (contentType === 'image/jpeg') return 'jpg'
  if (contentType === 'image/webp') return 'webp'
  return 'png'
}

export function pendingSubmissionStorageKey(id: string, ext: string): string {
  return `gallery-submissions/pending/${id}.${ext}`
}

export async function createGallerySubmissionPresignedPut(
  storageKey: string,
  contentType: string,
  fileSize: number
): Promise<string | null> {
  if (!gallerySubmissionR2Enabled()) return null
  if (fileSize < 1 || fileSize > GALLERY_SUBMISSION_MAX_BYTES) return null
  const client = createR2Client()
  const command = new PutObjectCommand({
    Bucket: r2Bucket(),
    Key: storageKey,
    ContentType: contentType,
    ContentLength: fileSize,
  })
  return getSignedUrl(client, command, { expiresIn: signTtlSec() })
}

export async function headGallerySubmissionObject(
  storageKey: string
): Promise<{ contentType: string; contentLength: number } | null> {
  if (!gallerySubmissionR2Enabled()) return null
  try {
    const client = createR2Client()
    const out = await client.send(new HeadObjectCommand({ Bucket: r2Bucket(), Key: storageKey }))
    const len = out.ContentLength
    if (len == null || len < 1) return null
    return {
      contentType: out.ContentType?.trim() || 'application/octet-stream',
      contentLength: len,
    }
  } catch {
    return null
  }
}

export async function getGallerySubmissionObjectBuffer(storageKey: string): Promise<{
  body: Buffer
  contentType: string
} | null> {
  if (!gallerySubmissionR2Enabled()) return null
  try {
    const client = createR2Client()
    const out = await client.send(new GetObjectCommand({ Bucket: r2Bucket(), Key: storageKey }))
    if (!out.Body) return null
    const bytes = await out.Body.transformToByteArray()
    return {
      body: Buffer.from(bytes),
      contentType: out.ContentType?.trim() || 'application/octet-stream',
    }
  } catch {
    return null
  }
}

export async function deleteGallerySubmissionObject(storageKey: string): Promise<void> {
  if (!gallerySubmissionR2Enabled()) return
  try {
    const client = createR2Client()
    await client.send(new DeleteObjectCommand({ Bucket: r2Bucket(), Key: storageKey }))
  } catch {
    // ignore
  }
}
