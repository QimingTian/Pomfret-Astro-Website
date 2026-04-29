import { NextRequest, NextResponse } from 'next/server'

export const imagingCorsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers':
    'Authorization, Content-Type, x-nina-session-progress-secret, x-imaging-r2-secret, x-delete-credential, x-admin-password, x-session-password',
}

export function imagingCorsOptions() {
  return new NextResponse(null, { status: 204, headers: imagingCorsHeaders })
}

export function withImagingCors<T extends object>(body: T, init?: number) {
  return NextResponse.json(body, {
    status: init ?? 200,
    headers: imagingCorsHeaders,
  })
}

/** When IMAGING_QUEUE_SECRET is set, all queue routes require Authorization: Bearer <secret>. */
export function imagingQueueAuthorized(request: NextRequest): boolean {
  const secret = process.env.IMAGING_QUEUE_SECRET
  if (!secret) return true
  const auth = request.headers.get('authorization')
  return auth === `Bearer ${secret}`
}

export function imagingUnauthorized() {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: imagingCorsHeaders })
}
