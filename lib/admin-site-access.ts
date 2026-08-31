import {
  isPomfretAstroAdmin,
  type SiteMembership,
  type SiteRole,
} from '@/lib/member-roles'
import {
  isObservatorySiteId,
  OBSERVATORY_SITES,
  type ObservatorySiteId,
} from '@/lib/observatory-sites'
import type { AdminMemberDirectoryEntry } from '@/lib/member-store'

type AdminMembershipRow = Pick<SiteMembership, 'siteId' | 'siteRole'> | {
  siteId: string
  siteRole: SiteRole
}

/** Sites this admin may operate in the dashboard (header switcher + admin panels). */
export function adminAccessibleSiteIds(input: {
  systemRole?: string | null
  memberships?: AdminMembershipRow[]
}): ObservatorySiteId[] {
  if (isPomfretAstroAdmin(input.systemRole)) {
    return OBSERVATORY_SITES.map((s) => s.id)
  }
  const ids = (input.memberships ?? [])
    .filter((m) => m.siteRole === 'observatory_admin' && isObservatorySiteId(m.siteId))
    .map((m) => m.siteId as ObservatorySiteId)
  return Array.from(new Set(ids))
}

export function adminCanAccessSite(input: {
  systemRole?: string | null
  memberships?: AdminMembershipRow[]
  siteId: string
}): boolean {
  if (isPomfretAstroAdmin(input.systemRole)) return true
  return (input.memberships ?? []).some(
    (m) => m.siteId === input.siteId && m.siteRole === 'observatory_admin'
  )
}

/** PA Admin: all members. Site admin: affiliated members at their site only. */
export function adminMembersDirectoryScope(input: {
  systemRole?: string | null
  memberships?: AdminMembershipRow[]
}): 'all' | ObservatorySiteId {
  if (isPomfretAstroAdmin(input.systemRole)) return 'all'
  const sites = adminAccessibleSiteIds(input)
  return sites[0] ?? 'pomfret'
}

export function filterMembersForAdminSite(
  members: AdminMemberDirectoryEntry[],
  siteId: string
): AdminMemberDirectoryEntry[] {
  return members.filter((m) => m.memberships.some((ms) => ms.siteId === siteId))
}

export function siteHasAllSkyCamera(siteId: ObservatorySiteId): boolean {
  return siteId === 'pomfret'
}
