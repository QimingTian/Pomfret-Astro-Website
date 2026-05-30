import type { NextRequest } from 'next/server'

const ALLOWED_HOSTS = new Set(['www.pomfretastro.org', 'pomfretastro.org', 'localhost', '127.0.0.1'])

function hostFromUrl(raw: string): string | null {
  try {
    return new URL(raw).hostname.toLowerCase()
  } catch {
    return null
  }
}

/** Reject cross-site POST/PATCH/DELETE when Origin/Referer point off-site (CSRF mitigation). */
export function isSameSiteMutation(request: NextRequest): boolean {
  const origin = request.headers.get('origin')
  if (origin) {
    const host = hostFromUrl(origin)
    if (host && ALLOWED_HOSTS.has(host)) return true
    if (host?.endsWith('.vercel.app')) return true
    return false
  }
  const referer = request.headers.get('referer')
  if (referer) {
    const host = hostFromUrl(referer)
    if (host && ALLOWED_HOSTS.has(host)) return true
    if (host?.endsWith('.vercel.app')) return true
    return false
  }
  // Non-browser clients (NINA, curl) often omit both — allow for API routes with bearer auth.
  return true
}
