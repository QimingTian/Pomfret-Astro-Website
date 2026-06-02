import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "frame-src 'self'",
  "img-src 'self' data: blob: https://cdn.star.nesdis.noaa.gov https://*.r2.cloudflarestorage.com https://svs.gsfc.nasa.gov https://www.pomfretastro.org https://cam.pomfretastro.org https://*.basemaps.cartocdn.com https://tile.openstreetmap.org",
  "connect-src 'self' https://api.open-meteo.com https://svs.gsfc.nasa.gov https://cdn.star.nesdis.noaa.gov https://*.r2.cloudflarestorage.com https://cam.pomfretastro.org wss:",
  "font-src 'self' data:",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ')

export function middleware(request: NextRequest) {
  const response = NextResponse.next()

  response.headers.set('Content-Security-Policy', CSP)
  if (process.env.NODE_ENV === 'production') {
    response.headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
  }
  response.headers.set('X-Frame-Options', 'DENY')
  response.headers.set('X-Content-Type-Options', 'nosniff')
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin')
  response.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')

  return response
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|stellarium/|skydata/).*)'],
}
