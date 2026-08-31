'use client'

import { useCallback, useMemo } from 'react'
import {
  adminAccessibleSiteIds,
  adminMembersDirectoryScope,
  siteHasAllSkyCamera,
} from '@/lib/admin-site-access'
import { observatorySiteFetch, useObservatorySite } from '@/components/observatory-site-provider'
import { useMember } from '@/hooks/use-member'
import { isPomfretAstroAdmin } from '@/lib/member-roles'
import { resolveObservatorySite, type ObservatorySiteId } from '@/lib/observatory-sites'

export function useAdminSiteScope() {
  const member = useMember()
  const { siteId } = useObservatorySite()

  const user = member.status === 'authenticated' ? member.user : null

  const administeredSiteIds = useMemo(
    () =>
      user
        ? adminAccessibleSiteIds({
            systemRole: user.systemRole,
            memberships: user.memberships,
          })
        : [],
    [user]
  )

  const isPaAdmin = Boolean(user && isPomfretAstroAdmin(user.systemRole))

  const membersScope = useMemo(
    () =>
      user
        ? adminMembersDirectoryScope({
            systemRole: user.systemRole,
            memberships: user.memberships,
          })
        : ('all' as const),
    [user]
  )

  /** PA Admin follows header site; site admins always operate their own observatory. */
  const adminSiteId: ObservatorySiteId = useMemo(() => {
    if (isPaAdmin) return siteId
    if (administeredSiteIds.length > 0) return administeredSiteIds[0]!
    return siteId
  }, [isPaAdmin, siteId, administeredSiteIds])

  const adminSite = useMemo(() => resolveObservatorySite(adminSiteId), [adminSiteId])

  const siteFetch = useCallback(
    (input: string, init?: RequestInit) =>
      observatorySiteFetch(input, adminSiteId, {
        credentials: 'include',
        cache: 'no-store',
        ...init,
      }),
    [adminSiteId]
  )

  return {
    adminSiteId,
    adminSite,
    siteFetch,
    administeredSiteIds,
    isPaAdmin,
    membersScope,
    showAllSkyCamera: siteHasAllSkyCamera(adminSiteId),
  }
}
