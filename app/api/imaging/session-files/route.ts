import { NextRequest } from 'next/server'

import {
  imagingCorsHeaders,
  imagingCorsOptions,
  imagingQueueAuthorized,
  withImagingCors,
} from '@/lib/imaging-queue-auth'
import { upsertR2ObjectKey, upsertR2PreviewObjectKey } from '@/lib/r2-session-download'

export const runtime = 'nodejs'

export function OPTIONS() {
  return imagingCorsOptions()
}

type UploadedFileRow = {
  fileName?: unknown
  objectKey?: unknown
  sizeBytes?: unknown
}

function pickBestObjectKey(queueId: string, files: UploadedFileRow[]): string | null {
  const normalized = files
    .map((f) => {
      const fileName = typeof f.fileName === 'string' ? f.fileName : ''
      const objectKey = typeof f.objectKey === 'string' ? f.objectKey : ''
      const sizeBytes =
        typeof f.sizeBytes === 'number'
          ? f.sizeBytes
          : typeof f.sizeBytes === 'string'
            ? Number(f.sizeBytes)
            : 0
      return { fileName, objectKey, sizeBytes: Number.isFinite(sizeBytes) ? sizeBytes : 0 }
    })
    .filter((f) => f.objectKey)

  if (normalized.length === 0) return null

  const queueLower = queueId.toLowerCase()
  const exactName = normalized.find((f) => f.fileName.toLowerCase() === queueLower)
  if (exactName) return exactName.objectKey

  const stemMatch = normalized.find((f) => {
    const n = f.fileName.toLowerCase()
    const dot = n.lastIndexOf('.')
    const stem = dot === -1 ? n : n.slice(0, dot)
    return stem === queueLower
  })
  if (stemMatch) return stemMatch.objectKey

  const zip = normalized
    .filter((f) => f.fileName.toLowerCase().endsWith('.zip'))
    .sort((a, b) => b.sizeBytes - a.sizeBytes)[0]
  if (zip) return zip.objectKey

  return normalized.sort((a, b) => b.sizeBytes - a.sizeBytes)[0].objectKey
}

export async function POST(request: NextRequest) {
  // Reuse existing bearer auth policy.
  if (!imagingQueueAuthorized(request)) {
    return withImagingCors({ ok: false as const, error: 'Unauthorized' }, 401)
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return withImagingCors({ ok: false as const, error: 'Invalid JSON body' }, 400)
  }

  const queueId =
    typeof (body as Record<string, unknown>).queueId === 'string'
      ? ((body as Record<string, unknown>).queueId as string).trim()
      : ''
  const files = Array.isArray((body as Record<string, unknown>).files)
    ? ((body as Record<string, unknown>).files as UploadedFileRow[])
    : []
  const previewObjectKey =
    typeof (body as Record<string, unknown>).previewObjectKey === 'string'
      ? ((body as Record<string, unknown>).previewObjectKey as string).trim()
      : ''

  if (!queueId) {
    return withImagingCors({ ok: false as const, error: 'queueId is required' }, 400)
  }
  if (files.length === 0) {
    return withImagingCors({ ok: false as const, error: 'files is required' }, 400)
  }

  const chosen = pickBestObjectKey(queueId, files)
  if (!chosen) {
    return withImagingCors({ ok: false as const, error: 'No valid objectKey found in files' }, 400)
  }

  await upsertR2ObjectKey(queueId, chosen)
  if (previewObjectKey) {
    await upsertR2PreviewObjectKey(queueId, previewObjectKey)
  }
  return withImagingCors({
    ok: true as const,
    queueId,
    objectKey: chosen,
    ...(previewObjectKey ? { previewObjectKey } : {}),
  })
}

export const dynamic = 'force-dynamic'
