import type { NextRequest } from 'next/server'
import { getCurrentUser } from '@/lib/member-auth'
import { canAdministerSite } from '@/lib/member-roles'
import { type MemberUser } from '@/lib/member-store'
import { DEFAULT_OBSERVATORY_SITE_ID } from '@/lib/observatory-sites'
import { currentObservatorySiteId } from '@/lib/observatory-site-scope'

export type ImagingAdminActor = {
  displayName: string
  userId: string
  username: string
  email: string
}

/** Human-readable label for audit logs (prefer legal name over username/role). */
export function formatImagingAdminActor(
  user: Pick<MemberUser, 'id' | 'firstName' | 'lastName' | 'username' | 'email'>
): string {
  const display = `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim()
  if (display) return display
  const username = user.username?.trim()
  if (username && username.toLowerCase() !== 'admin') return username
  const email = user.email?.trim()
  if (email) return email
  return user.id
}

export function imagingAdminActorFromUser(user: MemberUser): ImagingAdminActor {
  return {
    displayName: formatImagingAdminActor(user),
    userId: user.id,
    username: user.username,
    email: user.email,
  }
}

function adminSiteId(explicit?: string | null): string {
  return explicit?.trim() || currentObservatorySiteId() || DEFAULT_OBSERVATORY_SITE_ID
}

export function canAdministerImagingSite(
  user: MemberUser | null | undefined,
  siteId?: string | null
): boolean {
  if (!user) return false
  return canAdministerSite({
    systemRole: user.systemRole,
    memberships: user.memberships,
    siteId: adminSiteId(siteId),
  })
}

export async function getAdminFromRequest(
  request: NextRequest,
  siteId?: string | null
): Promise<MemberUser | null> {
  const user = await getCurrentUser(request)
  if (user && canAdministerImagingSite(user, siteId)) return user
  return null
}

/**
 * Requires Pomfret Astro Admin or Observatory Admin for the request site
 * (ALS / `?site=` / header). Pass `siteId` to override.
 */
export async function requireImagingAdmin(
  request: NextRequest,
  siteId?: string | null
): Promise<{ ok: true; user: MemberUser } | { ok: false; status: number; error: string }> {
  const user = await getCurrentUser(request)
  if (user && canAdministerImagingSite(user, siteId)) {
    return { ok: true, user }
  }
  return { ok: false, status: 403, error: 'Admin access required.' }
}
