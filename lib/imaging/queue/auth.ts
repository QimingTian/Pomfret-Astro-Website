import { headers } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/member-auth'

/** Fallback for tools without an `Origin` header (e.g. NINA HTTP client). */
export const imagingCorsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers':
    'Authorization, Content-Type, x-nina-session-progress-secret, x-nina-mount-telemetry-secret, x-imaging-r2-secret, x-delete-credential, x-session-password',
}

const CORS_ALLOW_METHODS = imagingCorsHeaders['Access-Control-Allow-Methods']
const CORS_ALLOW_HEADERS = imagingCorsHeaders['Access-Control-Allow-Headers']

function isAllowedBrowserOrigin(origin: string): boolean {
  const o = origin.trim()
  if (!o) return false
  let url: URL
  try {
    url = new URL(o)
  } catch {
    return false
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return false
  const host = url.hostname.toLowerCase()
  if (url.protocol === 'https:' && (host === 'www.pomfretastro.org' || host === 'pomfretastro.org')) return true
  if (url.protocol === 'https:' && host.endsWith('.vercel.app')) return true
  if (url.protocol === 'http:' && (host === 'localhost' || host === '127.0.0.1')) return true
  return false
}

/**
 * CORS headers for imaging API responses. Safari rejects some same-site `fetch` calls when the
 * response only carries `Access-Control-Allow-Origin: *`; echo the request `Origin` when it is an
 * allowed first-party host (see Safari Web Inspector: "due to access control checks").
 */
export function imagingCorsHeadersResolved(): Record<string, string> {
  try {
    const origin = headers().get('origin')
    if (origin && isAllowedBrowserOrigin(origin)) {
      return {
        'Access-Control-Allow-Origin': origin,
        Vary: 'Origin',
        'Access-Control-Allow-Methods': CORS_ALLOW_METHODS,
        'Access-Control-Allow-Headers': CORS_ALLOW_HEADERS,
      }
    }
  } catch {
    /* `headers()` outside a request (e.g. static import) */
  }
  return { ...imagingCorsHeaders }
}

export function imagingCorsOptions() {
  return new NextResponse(null, { status: 204, headers: imagingCorsHeadersResolved() })
}

export function withImagingCors<T extends object>(
  body: T,
  init?: number,
  extraHeaders?: Record<string, string>
) {
  return NextResponse.json(body, {
    status: init ?? 200,
    headers: { ...imagingCorsHeadersResolved(), ...extraHeaders },
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
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: imagingCorsHeadersResolved() })
}

/** Member cookie or observatory Bearer secret (when IMAGING_QUEUE_SECRET is set). */
export async function imagingQueueReadable(request: NextRequest): Promise<boolean> {
  if (imagingQueueAuthorized(request)) return true
  return (await getCurrentUser(request)) != null
}
