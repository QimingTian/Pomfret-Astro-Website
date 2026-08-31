import {
  isObservatorySiteId,
  resolveObservatorySite,
  OBSERVATORY_SITES,
  type ObservatorySiteId,
} from '@/lib/observatory-sites'
import { isPomfretAstroAdmin, isSiteRole, type SiteRole } from '@/lib/member-roles'

export type AdminMemberRoleOption = {
  key: string
  label: string
}

export function parseAdminMemberRoleKey(
  key: string
): { type: 'pomfret_astro_admin' } | { type: 'guest' } | { type: 'site'; siteId: string; siteRole: SiteRole } | null {
  if (key === 'pomfret_astro_admin') return { type: 'pomfret_astro_admin' }
  if (key === 'guest') return { type: 'guest' }
  const m = /^site:([^:]+):(observatory_admin|observatory_member)$/.exec(key)
  if (!m || !isObservatorySiteId(m[1]!) || !isSiteRole(m[2]!)) return null
  return { type: 'site', siteId: m[1]!, siteRole: m[2]! }
}

export function memberRoleKey(input: {
  systemRole: string
  memberships: Array<{ siteId: string; siteRole: SiteRole }>
  preferredSiteId?: string
}): string {
  if (isPomfretAstroAdmin(input.systemRole)) return 'pomfret_astro_admin'
  if (!input.memberships.length) return 'guest'
  if (input.preferredSiteId) {
    const atSite = input.memberships.find((m) => m.siteId === input.preferredSiteId)
    if (atSite) return `site:${atSite.siteId}:${atSite.siteRole}`
  }
  const primary = input.memberships[0]!
  return `site:${primary.siteId}:${primary.siteRole}`
}

export function adminMemberRoleOptions(input: {
  isPaAdmin: boolean
  siteId: ObservatorySiteId
}): AdminMemberRoleOption[] {
  if (input.isPaAdmin) {
    return [
      { key: 'pomfret_astro_admin', label: 'Pomfret Astro Admin' },
      ...OBSERVATORY_SITES.flatMap((site) => [
        { key: `site:${site.id}:observatory_admin`, label: `Observatory Admin · ${site.name}` },
        { key: `site:${site.id}:observatory_member`, label: `Observatory Member · ${site.name}` },
      ]),
      { key: 'guest', label: 'Guest' },
    ]
  }
  const site = resolveObservatorySite(input.siteId)
  return [
    { key: `site:${input.siteId}:observatory_admin`, label: `Observatory Admin · ${site.name}` },
    { key: `site:${input.siteId}:observatory_member`, label: `Observatory Member · ${site.name}` },
  ]
}
