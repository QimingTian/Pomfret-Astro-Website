import { NextRequest, NextResponse } from 'next/server'

import { validateSessionPassword } from '@/lib/imaging-session-access'
import { imagingCorsOptions, withImagingCors } from '@/lib/imaging-queue-auth'
import { boardMarkDownloaded } from '@/lib/imaging-session-board'
import { buildSignedDownloadUrl } from '@/lib/r2-session-download'

export const runtime = 'nodejs'

export function OPTIONS() {
  return imagingCorsOptions()
}

export async function GET(request: NextRequest) {
  const queueId = request.nextUrl.searchParams.get('queueId')?.trim() ?? ''
  const file = request.nextUrl.searchParams.get('file')?.trim() ?? ''
  const responseMode = request.nextUrl.searchParams.get('mode')?.trim() ?? ''

  if (!queueId) {
    return withImagingCors({ ok: false as const, error: 'Missing queueId' }, 400)
  }

  const providedPassword = request.headers.get('x-session-password')
  const auth = await validateSessionPassword(queueId, providedPassword)
  if (!auth.ok) {
    return withImagingCors({ ok: false as const, error: auth.error }, auth.status)
  }

  const signed = await buildSignedDownloadUrl(queueId, file || undefined)
  if (!signed) {
    return withImagingCors({ ok: false as const, error: 'File not found' }, 404)
  }

  // Mark this session as downloaded once user requested a valid download URL.
  await boardMarkDownloaded(queueId)

  if (responseMode === 'json') {
    return withImagingCors({ ok: true as const, signedUrl: signed })
  }

  return NextResponse.redirect(signed, {
    status: 302,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS',
      'Access-Control-Allow-Headers':
        'Authorization, Content-Type, x-nina-session-progress-secret, x-imaging-r2-secret',
      'Cache-Control': 'no-store',
    },
  })
}
