import { NextRequest, NextResponse } from 'next/server'
import { authRateLimitKey, checkAuthRateLimit } from '@/lib/auth-rate-limit'
import {
  buildSessionCookie,
  createMemberSession,
} from '@/lib/member-auth'
import { toPublicMemberUser, verifyMemberCredentials } from '@/lib/member-store'

export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  if (!checkAuthRateLimit(authRateLimitKey(request, 'login'))) {
    return NextResponse.json(
      { ok: false, error: 'Too many login attempts. Try again later.' },
      { status: 429 }
    )
  }

  const body = await request.json().catch(() => ({}))
  const login =
    typeof body.login === 'string'
      ? body.login
      : typeof body.email === 'string'
        ? body.email
        : ''
  const password = typeof body.password === 'string' ? body.password : ''
  const user = await verifyMemberCredentials(login, password)
  if (!user) {
    return NextResponse.json(
      { ok: false, error: 'Invalid email, username, or password.' },
      { status: 401 }
    )
  }

  const session = await createMemberSession(user.id)
  const response = NextResponse.json({ ok: true, user: toPublicMemberUser(user) })
  response.cookies.set(buildSessionCookie(session.token, session.maxAgeSec))
  return response
}
