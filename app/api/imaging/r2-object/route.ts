import { NextRequest } from 'next/server'

import { imagingCorsOptions, withImagingCors } from '@/lib/imaging-queue-auth'
import { upsertR2ObjectKey } from '@/lib/r2-session-download'

export const runtime = 'nodejs'

export function OPTIONS() {
  return imagingCorsOptions()
}

function authorized(request: NextRequest): boolean {
  const secret = process.env.IMAGING_R2_WRITE_SECRET
  if (!secret) return false
  return request.headers.get('x-imaging-r2-secret') === secret
}

export async function POST(request: NextRequest) {
  if (!authorized(request)) {
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
  const objectKey = typeof (body as Record<string, unknown>).objectKey === 'string'
    ? ((body as Record<string, unknown>).objectKey as string).trim()
    : ''

  if (!queueId || !objectKey) {
    return withImagingCors({ ok: false as const, error: 'queueId and objectKey are required' }, 400)
  }

  await upsertR2ObjectKey(queueId, objectKey)
  return withImagingCors({ ok: true as const })
}
