import type { MemberUser } from '@/lib/member-store'
import { canSubmitImagingAtSite, membershipForSite } from '@/lib/member-roles'
import { DEFAULT_OBSERVATORY_SITE_ID } from '@/lib/observatory-sites'
import { currentObservatorySiteId } from '@/lib/observatory-site-scope'
import { guestAccessModeFromSettings } from '@/lib/site-access-control'
import {
  getGuestSiteAccessStatus,
  getSiteAccessControlSettings,
  getSiteGuestAccessMode,
  setGuestSiteAccessStatus,
} from '@/lib/site-policies'

export function isEmailVerified(user: Pick<MemberUser, 'emailVerifiedAt'>): boolean {
  return typeof user.emailVerifiedAt === 'string' && user.emailVerifiedAt.length > 0
}

/**
 * Site-aware imaging submit gate (affiliation + guest policy).
 * Falls back to legacy Pomfret flags when memberships are empty.
 */
export async function canSubmitImagingForSite(
  user: MemberUser,
  siteId?: string | null
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isEmailVerified(user)) {
    return {
      ok: false,
      error: 'Verify your email before submitting imaging requests. Check your inbox or resend from Account.',
    }
  }

  const site = siteId?.trim() || currentObservatorySiteId() || DEFAULT_OBSERVATORY_SITE_ID
  const memberships = user.memberships ?? []

  const settings = await getSiteAccessControlSettings(site)
  const guestAccessMode = guestAccessModeFromSettings(settings)
  const guestGrant = membershipForSite(memberships, site)
    ? null
    : await getGuestSiteAccessStatus(user.id, site)

  const decision = canSubmitImagingAtSite({
    systemRole: user.systemRole,
    memberships,
    siteId: site,
    guestAccessMode,
    guestGrant,
    openToOtherObservatoryMembers: settings.openToOtherObservatoryMembers,
    otherObservatoryMemberScope: settings.otherObservatoryMemberScope,
  })

  if (!decision.ok) return { ok: false, error: decision.error }
  return { ok: true }
}

/** Create a pending guest access row when a guest first requests imaging under open_approval. */
export async function maybeCreateGuestAccessRequest(
  user: Pick<MemberUser, 'id' | 'memberships'>,
  siteId: string
): Promise<boolean> {
  if (membershipForSite(user.memberships, siteId)) return false
  const guestAccessMode = await getSiteGuestAccessMode(siteId)
  if (guestAccessMode !== 'open_approval') return false
  const existing = await getGuestSiteAccessStatus(user.id, siteId)
  if (existing === 'pending') return true
  if (existing) return false
  await setGuestSiteAccessStatus({ userId: user.id, siteId, status: 'pending' })
  return true
}
