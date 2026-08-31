import { NextRequest, NextResponse } from 'next/server'
import { checkAuthRateLimitAsync } from '@/lib/auth-rate-limit'
import { buildSessionCookie, createMemberSession } from '@/lib/member-auth'
import { toPublicMemberUserAsync, verifyMemberCredentials } from '@/lib/member-store'

export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  if (!(await checkAuthRateLimitAsync(request, 'login', 20))) {
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
  let user
  try {
    user = await verifyMemberCredentials(login, password)
  } catch (error) {
    const message = error instanceof Error ? error.message : ''
    if (message === 'MEMBER_STORE_POSTGRES_UNAVAILABLE' || message.includes('MEMBER_STORE_POSTGRES')) {
      console.error('[auth/login] member store unavailable', error)
      return NextResponse.json(
        { ok: false, error: 'Account database is temporarily unreachable. Try again in a moment.' },
        { status: 503 }
      )
    }
    throw error
  }
  if (!user) {
    return NextResponse.json(
      { ok: false, error: 'Invalid email, username, or password.' },
      { status: 401 }
    )
  }

  const session = await createMemberSession(user.id)
  const response = NextResponse.json({ ok: true, user: await toPublicMemberUserAsync(user) })
  response.cookies.set(buildSessionCookie(session.token, session.maxAgeSec))
  return response
}
