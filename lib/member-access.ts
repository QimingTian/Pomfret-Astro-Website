import type { MemberUser } from '@/lib/member-store'
import { isPomfretOrgEmail } from '@/lib/member-store'

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
  if (!isEmailVerified(user)) {
    return {
      ok: false,
      error: 'Verify your email before submitting imaging requests. Check your inbox or resend from Account.',
    }
  }
  if (user.imagingRejectedAt) {
    return { ok: false, error: 'Imaging access was not approved for this account.' }
  }
  if (!isImagingApproved(user)) {
    if (isPomfretOrgEmail(user.email)) {
      return { ok: false, error: 'Imaging access is being activated. Try again shortly.' }
    }
    return {
      ok: false,
      error: 'Imaging access requires administrator approval for non-@pomfret.org accounts.',
    }
  }
  return { ok: true }
}

export type MemberAccessFlags = {
  emailVerified: boolean
  imagingApproved: boolean
  imagingPending: boolean
  imagingRejected: boolean
}

export function memberAccessFlags(user: MemberUser): MemberAccessFlags {
  return {
    emailVerified: isEmailVerified(user),
    imagingApproved: isImagingApproved(user),
    imagingPending: isImagingPending(user),
    imagingRejected: Boolean(user.imagingRejectedAt),
  }
}
