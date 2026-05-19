import { NextRequest, NextResponse } from 'next/server'
import { authRateLimitKey, checkAuthRateLimit } from '@/lib/auth-rate-limit'
import { requireUser } from '@/lib/member-auth'
import { updateMemberPassword, verifyMemberPassword } from '@/lib/member-store'

export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  if (!checkAuthRateLimit(authRateLimitKey(request, 'change-password'), 15)) {
    return NextResponse.json(
      { ok: false, error: 'Too many attempts. Try again later.' },
      { status: 429 }
    )
  }

  const auth = await requireUser(request)
  if (!auth.ok) {
    return NextResponse.json(auth.body, { status: auth.status })
  }

  const body = await request.json().catch(() => ({}))
  const currentPassword = typeof body.currentPassword === 'string' ? body.currentPassword : ''
  const newPassword = typeof body.newPassword === 'string' ? body.newPassword : ''

  const valid = await verifyMemberPassword(auth.user.email, currentPassword)
  if (!valid) {
    return NextResponse.json({ ok: false, error: 'Current password is incorrect.' }, { status: 403 })
  }

  const updated = await updateMemberPassword(auth.user.id, newPassword)
  if (!updated.ok) {
    return NextResponse.json({ ok: false, error: updated.error }, { status: 400 })
  }

  return NextResponse.json({ ok: true })
}
