import { NextRequest, NextResponse } from 'next/server'
import { checkAuthRateLimitAsync } from '@/lib/auth-rate-limit'
import { isSameSiteMutation } from '@/lib/csrf-origin'
import {
  generateEmailVerificationToken,
  sendEmailVerificationEmail,
  storeEmailVerificationToken,
} from '@/lib/email-verification'
import { requireUser } from '@/lib/member-auth'
import { toPublicMemberUserAsync, updateMemberProfile } from '@/lib/member-store'

export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  if (!(await checkAuthRateLimitAsync(request, 'update-profile', 15))) {
    return NextResponse.json(
      { ok: false, error: 'Too many attempts. Try again later.' },
      { status: 429 }
    )
  }

  if (!isSameSiteMutation(request)) {
    return NextResponse.json({ ok: false, error: 'Invalid request origin.' }, { status: 403 })
  }

  const auth = await requireUser(request)
  if (!auth.ok) {
    return NextResponse.json(auth.body, { status: auth.status })
  }

  const body = await request.json().catch(() => ({}))
  const b = body && typeof body === 'object' ? (body as Record<string, unknown>) : {}
  const currentPassword = typeof b.currentPassword === 'string' ? b.currentPassword : ''
  if (!currentPassword) {
    return NextResponse.json({ ok: false, error: 'Current password is required.' }, { status: 400 })
  }

  const updated = await updateMemberProfile(auth.user.id, {
    currentPassword,
    firstName: typeof b.firstName === 'string' ? b.firstName : undefined,
    lastName: typeof b.lastName === 'string' ? b.lastName : undefined,
    username: typeof b.username === 'string' ? b.username : undefined,
    email: typeof b.email === 'string' ? b.email : undefined,
    newPassword: typeof b.newPassword === 'string' ? b.newPassword : null,
  })

  if (!updated.ok) {
    return NextResponse.json({ ok: false, error: updated.error }, { status: 400 })
  }

  let verificationSent = false
  let verificationError: string | null = null
  if (updated.emailChanged) {
    const token = generateEmailVerificationToken()
    await storeEmailVerificationToken(token, {
      userId: updated.user.id,
      email: updated.user.email,
    })
    const mail = await sendEmailVerificationEmail({
      email: updated.user.email,
      firstName: updated.user.firstName,
      token,
    })
    verificationSent = mail.sent
    if (!mail.sent) verificationError = mail.reason ?? 'Could not send verification email.'
  }

  return NextResponse.json({
    ok: true,
    user: await toPublicMemberUserAsync(updated.user),
    emailChanged: updated.emailChanged,
    verificationSent,
    ...(verificationError ? { verificationError } : {}),
  })
}
