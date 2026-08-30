import { NextRequest, NextResponse } from 'next/server'

import {
  consumeEmailVerificationToken,
  generateEmailVerificationToken,
  sendEmailVerificationEmail,
  storeEmailVerificationToken,
} from '@/lib/email-verification'
import { buildSessionCookie, createMemberSession } from '@/lib/member-auth'
import { markMemberEmailVerified } from '@/lib/member-store'
import { publicSiteUrl } from '@/lib/site-url'

export const runtime = 'nodejs'

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get('token')?.trim() ?? ''
  if (!token) {
    return NextResponse.redirect(publicSiteUrl('/login?verify=missing'))
  }

  const payload = await consumeEmailVerificationToken(token)
  if (!payload) {
    return NextResponse.redirect(publicSiteUrl('/login?verify=invalid'))
  }

  const { getMemberById } = await import('@/lib/member-store')
  const existing = await getMemberById(payload.userId)
  if (!existing || existing.email !== payload.email) {
    return NextResponse.redirect(publicSiteUrl('/login?verify=invalid'))
  }

  const user = await markMemberEmailVerified(payload.userId)
  if (!user) {
    return NextResponse.redirect(publicSiteUrl('/login?verify=invalid'))
  }

  const session = await createMemberSession(user.id)
  const response = NextResponse.redirect(publicSiteUrl('/dashboard/account?verified=1'))
  response.cookies.set(buildSessionCookie(session.token, session.maxAgeSec))
  return response
}

/** Resend verification (authenticated). */
export async function POST(request: NextRequest) {
  const { requireUser } = await import('@/lib/member-auth')
  const { checkAuthRateLimitAsync } = await import('@/lib/auth-rate-limit')

  if (!(await checkAuthRateLimitAsync(request, 'verify-resend', 5))) {
    return NextResponse.json({ ok: false, error: 'Too many requests. Try again later.' }, { status: 429 })
  }

  const auth = await requireUser(request)
  if (!auth.ok) {
    return NextResponse.json(auth.body, { status: auth.status })
  }

  if (auth.user.emailVerifiedAt) {
    return NextResponse.json({ ok: true, alreadyVerified: true })
  }

  const token = generateEmailVerificationToken()
  await storeEmailVerificationToken(token, { userId: auth.user.id, email: auth.user.email })
  const mail = await sendEmailVerificationEmail({
    email: auth.user.email,
    firstName: auth.user.firstName,
    token,
  })

  if (!mail.sent) {
    return NextResponse.json(
      { ok: false, error: mail.reason ?? 'Could not send verification email.' },
      { status: 502 }
    )
  }

  return NextResponse.json({ ok: true, sent: true })
}
