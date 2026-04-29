import { NextRequest, NextResponse } from 'next/server'

import { publishPreview } from '@/lib/imaging-preview-live'
import { isImagingAdminPassword } from '@/lib/imaging-admin-auth'
import { validateSessionPassword } from '@/lib/imaging-session-access'
import { imagingCorsOptions, imagingQueueAuthorized, withImagingCors } from '@/lib/imaging-queue-auth'
import { getPreviewImage, upsertPreviewImage } from '@/lib/imaging-preview-store'

export const runtime = 'nodejs'

export function OPTIONS() {
  return imagingCorsOptions()
}

export async function GET(request: NextRequest) {
  const queueId = request.nextUrl.searchParams.get('queueId')?.trim() ?? ''
  const responseMode = request.nextUrl.searchParams.get('mode')?.trim() ?? ''

  if (!queueId) {
    return withImagingCors({ ok: false as const, error: 'Missing queueId' }, 400)
  }

  const providedPassword =
    request.headers.get('x-session-password') ?? request.headers.get('x-admin-password') ?? ''
  const isAdmin = isImagingAdminPassword(providedPassword)
  if (!isAdmin) {
    const auth = await validateSessionPassword(queueId, providedPassword)
    if (!auth.ok) {
      return withImagingCors({ ok: false as const, error: auth.error }, auth.status)
    }
  }

  const latest = await getPreviewImage(queueId)
  if (!latest) {
    return withImagingCors({ ok: false as const, error: 'Preview not found' }, 404)
  }

  if (responseMode === 'json') {
    return withImagingCors({
      ok: true as const,
      updatedAt: latest.updatedAt,
      contentType: latest.contentType,
      dataBase64: latest.dataBase64,
    })
  }

  const body = Buffer.from(latest.dataBase64, 'base64')
  return new NextResponse(body, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS',
      'Access-Control-Allow-Headers':
        'Authorization, Content-Type, x-nina-session-progress-secret, x-imaging-r2-secret, x-session-password',
      'Cache-Control': 'no-store',
      'Content-Type': latest.contentType || 'image/jpeg',
      ETag: `"${latest.updatedAt}"`,
    },
  })
}

export async function POST(request: NextRequest) {
  if (!imagingQueueAuthorized(request)) {
    return withImagingCors({ ok: false as const, error: 'Unauthorized' }, 401)
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return withImagingCors({ ok: false as const, error: 'Invalid JSON body' }, 400)
  }

  const queueId = typeof (body as Record<string, unknown>).queueId === 'string'
    ? ((body as Record<string, unknown>).queueId as string).trim()
    : ''
  const imageId = typeof (body as Record<string, unknown>).imageId === 'string'
    ? ((body as Record<string, unknown>).imageId as string).trim()
    : ''
  const dataBase64 = typeof (body as Record<string, unknown>).dataBase64 === 'string'
    ? ((body as Record<string, unknown>).dataBase64 as string).trim()
    : ''
  const contentTypeRaw = typeof (body as Record<string, unknown>).contentType === 'string'
    ? ((body as Record<string, unknown>).contentType as string).trim()
    : ''
  const contentType = contentTypeRaw || 'image/jpeg'

  if (!queueId || !imageId || !dataBase64) {
    return withImagingCors({ ok: false as const, error: 'queueId, imageId and dataBase64 are required' }, 400)
  }
  if (imageId !== queueId) {
    return withImagingCors({ ok: false as const, error: 'imageId must equal queueId' }, 400)
  }
  if (dataBase64.length > 15_000_000) {
    return withImagingCors({ ok: false as const, error: 'Preview payload too large' }, 413)
  }

  await upsertPreviewImage(queueId, imageId, contentType, dataBase64)
  publishPreview(queueId, new Date().toISOString())
  return withImagingCors({ ok: true as const, queueId })
}
