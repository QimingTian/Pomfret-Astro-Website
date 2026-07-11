import type { MemberUser, PublicMemberUser } from '@/lib/member-store'
import { isPomfretOrgEmail } from '@/lib/member-store'

type ImagingSubmitFlags = {
  email: string
  emailVerified: boolean
  imagingApproved: boolean
  imagingRejected: boolean
}

export function canSubmitImagingFromFlags(
  input: ImagingSubmitFlags
): { ok: true } | { ok: false; error: string } {
  if (!input.emailVerified) {
    return {
      ok: false,
      error: 'Verify your email before submitting imaging requests. Check your inbox or resend from Account.',
    }
  }
  if (input.imagingRejected) {
    return { ok: false, error: 'Imaging access was not approved for this account.' }
  }
  if (!input.imagingApproved) {
    if (isPomfretOrgEmail(input.email)) {
      return { ok: false, error: 'Imaging access is being activated. Try again shortly.' }
    }
    return {
      ok: false,
      error: 'Imaging access requires administrator approval for non-@pomfret.org accounts.',
    }
  }
  return { ok: true }
}

export function isEmailVerified(user: Pick<MemberUser, 'emailVerifiedAt'>): boolean {
  return typeof user.emailVerifiedAt === 'string' && user.emailVerifiedAt.length > 0
}

export function isImagingApproved(user: Pick<MemberUser, 'imagingApprovedAt' | 'imagingRejectedAt'>): boolean {
  if (user.imagingRejectedAt) return false
  return typeof user.imagingApprovedAt === 'string' && user.imagingApprovedAt.length > 0
}

export function isImagingPending(user: Pick<MemberUser, 'email' | 'emailVerifiedAt' | 'imagingApprovedAt' | 'imagingRejectedAt'>): boolean {
  if (!isEmailVerified(user)) return false
  if (isImagingApproved(user)) return false
  if (user.imagingRejectedAt) return false
  return !isPomfretOrgEmail(user.email)
}

export function canSubmitImaging(user: MemberUser): { ok: true } | { ok: false; error: string } {
  return canSubmitImagingFromFlags({
    email: user.email,
    emailVerified: isEmailVerified(user),
    imagingApproved: isImagingApproved(user),
    imagingRejected: Boolean(user.imagingRejectedAt),
  })
}

export function canSubmitImagingPublic(user: PublicMemberUser): { ok: true } | { ok: false; error: string } {
  return canSubmitImagingFromFlags({
    email: user.email,
    emailVerified: user.emailVerified,
    imagingApproved: user.imagingApproved,
    imagingRejected: user.imagingRejected,
  })
}

export type MemberAccessFlags = {
  emailVerified: boolean
  imagingApproved: boolean
  imagingPending: boolean
  imagingRejected: boolean
}

export type MemberVerificationStatusLabel =
  | 'All Verified'
  | 'Email Not Verified'
  | 'Imaging Not Verified'

/** Admin All members line: email first, then imaging (rejected counts as imaging not verified). */
export function memberVerificationStatusLabel(input: {
  emailVerified: boolean
  imagingApproved: boolean
}): MemberVerificationStatusLabel {
  if (!input.emailVerified) return 'Email Not Verified'
  if (!input.imagingApproved) return 'Imaging Not Verified'
  return 'All Verified'
}

export function memberAccessFlags(user: MemberUser): MemberAccessFlags {
  return {
    emailVerified: isEmailVerified(user),
    imagingApproved: isImagingApproved(user),
    imagingPending: isImagingPending(user),
    imagingRejected: Boolean(user.imagingRejectedAt),
  }
}
