/**
 * Multi-site member roles and authorization (backend).
 * UI labels / directory UX come later — this module is the source of truth for ACL.
 */

import {
  isObservatorySiteId,
  resolveObservatorySite,
  type ObservatorySiteId,
} from '@/lib/observatory-sites'

/** Global account class on `users.role`. */
export type SystemRole = 'pomfret_astro_admin' | 'user'

/** Per-site affiliation on `memberships.site_role`. Guests have no membership row. */
export type SiteRole = 'observatory_admin' | 'observatory_member'

/** Per-site Guest Access policy on `site_policies.guest_access`. */
export type GuestAccessMode = 'closed' | 'open_direct' | 'open_approval'

/** Guest grant on `guest_site_access.status` (only when mode is open_approval). */
export type GuestAccessStatus = 'pending' | 'approved' | 'rejected'

export type SiteMembership = {
  siteId: string
  siteRole: SiteRole
  imagingApprovedAt: string | null
  imagingRejectedAt: string | null
}

export type GuestSiteAccess = {
  siteId: string
  status: GuestAccessStatus
  updatedAt: string
}

export function isSystemRole(value: string): value is SystemRole {
  return value === 'pomfret_astro_admin' || value === 'user'
}

export function isSiteRole(value: string): value is SiteRole {
  return value === 'observatory_admin' || value === 'observatory_member'
}

export function isGuestAccessMode(value: string): value is GuestAccessMode {
  return value === 'closed' || value === 'open_direct' || value === 'open_approval'
}

/** Normalize legacy `admin` / `member` rows into SystemRole. */
export function coerceSystemRole(raw: string | null | undefined): SystemRole {
  if (raw === 'pomfret_astro_admin' || raw === 'admin') return 'pomfret_astro_admin'
  return 'user'
}

/**
 * Legacy UI/API still expose `admin` | `member`.
 * `admin` = system admin OR observatory admin on at least one site.
 */
export function legacyMemberRoleLabel(input: {
  systemRole: SystemRole
  memberships: SiteMembership[]
}): 'admin' | 'member' {
  if (input.systemRole === 'pomfret_astro_admin') return 'admin'
  if (input.memberships.some((m) => m.siteRole === 'observatory_admin')) return 'admin'
  return 'member'
}

export function siteDisplayName(siteId: string): string {
  if (isObservatorySiteId(siteId)) return resolveObservatorySite(siteId).name
  return siteId
}

export function siteRoleDisplayLabel(siteRole: SiteRole): string {
  return siteRole === 'observatory_admin' ? 'Observatory Admin' : 'Observatory Member'
}

/**
 * Human-readable roles for Account / directory UI (may be multiple).
 * Example: ["Pomfret Astro Admin", "Observatory Admin · Pomfret School"]
 */
export function formatMemberRoleLabels(input: {
  systemRole: SystemRole | string | null | undefined
  memberships?: SiteMembership[]
}): string[] {
  const labels: string[] = []
  if (isPomfretAstroAdmin(input.systemRole)) {
    labels.push('Pomfret Astro Admin')
    return labels
  }
  const memberships = input.memberships ?? []
  for (const m of memberships) {
    labels.push(`${siteRoleDisplayLabel(m.siteRole)} · ${siteDisplayName(m.siteId)}`)
  }
  if (labels.length === 0) labels.push('Guest')
  return labels
}

export function isPomfretAstroAdmin(systemRole: SystemRole | string | null | undefined): boolean {
  return systemRole === 'pomfret_astro_admin' || systemRole === 'admin'
}

export function membershipForSite(
  memberships: SiteMembership[] | undefined,
  siteId: string
): SiteMembership | null {
  if (!memberships?.length) return null
  return memberships.find((m) => m.siteId === siteId) ?? null
}

export function isObservatoryAdminAt(
  memberships: SiteMembership[] | undefined,
  siteId: string
): boolean {
  return membershipForSite(memberships, siteId)?.siteRole === 'observatory_admin'
}

export function isObservatoryMemberAt(
  memberships: SiteMembership[] | undefined,
  siteId: string
): boolean {
  const m = membershipForSite(memberships, siteId)
  return m?.siteRole === 'observatory_admin' || m?.siteRole === 'observatory_member'
}

/** Pomfret Astro Admin or Observatory Admin for this site. */
export function canAdministerSite(input: {
  systemRole: SystemRole | string | null | undefined
  memberships?: SiteMembership[]
  siteId: string
}): boolean {
  if (isPomfretAstroAdmin(input.systemRole)) return true
  return isObservatoryAdminAt(input.memberships, input.siteId)
}

/** Affiliated member/admin of the site (not guest). */
export function isAffiliatedWithSite(input: {
  systemRole: SystemRole | string | null | undefined
  memberships?: SiteMembership[]
  siteId: string
}): boolean {
  if (isPomfretAstroAdmin(input.systemRole)) return true
  return isObservatoryMemberAt(input.memberships, input.siteId)
}

export type SiteSubmitDecision =
  | {
      ok: true
      as: 'system_admin' | 'site_admin' | 'site_member' | 'cross_obs_member' | 'guest_direct' | 'guest_approved'
    }
  | {
      ok: false
      error: string
      code:
        | 'not_affiliated'
        | 'guest_closed'
        | 'guest_pending'
        | 'guest_rejected'
        | 'imaging_rejected'
        | 'imaging_pending'
        | 'other_obs_closed'
    }

/**
 * Whether the account may create imaging sessions at `siteId`.
 * Email verification is checked by the caller.
 *
 * Order: system admin → this-site member → other-obs member (if allowed) → guest policy.
 */
export function canSubmitImagingAtSite(input: {
  systemRole: SystemRole | string | null | undefined
  memberships?: SiteMembership[]
  siteId: string
  guestAccessMode: GuestAccessMode
  guestGrant?: GuestAccessStatus | null
  openToOtherObservatoryMembers?: boolean
  otherObservatoryMemberScope?: 'all' | string[]
}): SiteSubmitDecision {
  if (isPomfretAstroAdmin(input.systemRole)) {
    return { ok: true, as: 'system_admin' }
  }

  const membership = membershipForSite(input.memberships, input.siteId)
  if (membership) {
    if (membership.siteRole === 'observatory_admin') {
      return { ok: true, as: 'site_admin' }
    }
    if (membership.imagingRejectedAt) {
      return {
        ok: false,
        error: 'Imaging access was not approved for this account at this observatory.',
        code: 'imaging_rejected',
      }
    }
    if (!membership.imagingApprovedAt) {
      return {
        ok: false,
        error: 'Imaging access requires administrator approval for this observatory.',
        code: 'imaging_pending',
      }
    }
    return { ok: true, as: 'site_member' }
  }

  const memberships = input.memberships ?? []
  if (input.openToOtherObservatoryMembers) {
    const scope = input.otherObservatoryMemberScope ?? 'all'
    const allowed =
      scope === 'all'
        ? memberships.some((m) => m.siteId !== input.siteId)
        : memberships.some(
            (m) => m.siteId !== input.siteId && scope.includes(m.siteId)
          )
    if (allowed) {
      return { ok: true, as: 'cross_obs_member' }
    }
  }

  // Guest path — no affiliation at this site (and not allowed as other-obs member).
  switch (input.guestAccessMode) {
    case 'closed':
      return {
        ok: false,
        error: input.openToOtherObservatoryMembers
          ? 'This observatory is not open to guests, and you are not an allowed member of another observatory.'
          : 'This observatory is not open to guests. Request affiliation from an observatory administrator.',
        code: 'guest_closed',
      }
    case 'open_direct':
      return { ok: true, as: 'guest_direct' }
    case 'open_approval': {
      if (input.guestGrant === 'approved') return { ok: true, as: 'guest_approved' }
      if (input.guestGrant === 'pending') {
        return {
          ok: false,
          error: 'Guest access to this observatory is pending administrator approval.',
          code: 'guest_pending',
        }
      }
      if (input.guestGrant === 'rejected') {
        return {
          ok: false,
          error: 'Guest access to this observatory was not approved.',
          code: 'guest_rejected',
        }
      }
      return {
        ok: false,
        error: 'Guest access to this observatory requires administrator approval.',
        code: 'guest_pending',
      }
    }
    default:
      return { ok: false, error: 'Guest access is not available.', code: 'guest_closed' }
  }
}

export const DEFAULT_SITE_POLICIES: Record<ObservatorySiteId, GuestAccessMode> = {
  pomfret: 'closed',
  cygnus: 'closed',
}
