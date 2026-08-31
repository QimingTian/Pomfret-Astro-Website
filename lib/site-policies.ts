/**
 * Site guest-access policies + guest grants (Postgres).
 */

import { and, eq } from 'drizzle-orm'

import { getDb, postgresReadsEnabled, withDatabaseMirror } from '@/lib/db'
import { guestSiteAccess, sitePolicies } from '@/lib/db/schema'
import {
  DEFAULT_SITE_POLICIES,
  isGuestAccessMode,
  type GuestAccessMode,
  type GuestAccessStatus,
} from '@/lib/member-roles'
import {
  DEFAULT_MEMBER_PROJECT_DURATION_LIMIT_HOURS,
  guestAccessModeFromSettings,
  normalizeProjectDurationLimitHours,
  settingsFromPolicy,
  type SiteAccessControlSettings,
} from '@/lib/site-access-control'
import {
  DEFAULT_OBSERVATORY_SITE_ID,
  OBSERVATORY_SITES,
  type ObservatorySiteId,
} from '@/lib/observatory-sites'

export type PendingGuestAccessRequest = {
  userId: string
  firstName: string
  lastName: string
  email: string
  updatedAt: string
}

function fallbackGuestAccessMode(siteId: string): GuestAccessMode {
  return (DEFAULT_SITE_POLICIES as Record<string, GuestAccessMode>)[siteId] ?? 'closed'
}

function fallbackAccessControlSettings(siteId: string): SiteAccessControlSettings {
  return settingsFromPolicy(
    fallbackGuestAccessMode(siteId),
    DEFAULT_MEMBER_PROJECT_DURATION_LIMIT_HOURS
  )
}

export async function getSiteGuestAccessMode(siteId: string): Promise<GuestAccessMode> {
  const settings = await getSiteAccessControlSettings(siteId)
  return guestAccessModeFromSettings(settings)
}

export async function getSiteAccessControlSettings(siteId: string): Promise<SiteAccessControlSettings> {
  const fallback = fallbackAccessControlSettings(siteId)
  if (!postgresReadsEnabled()) return fallback
  try {
    const db = getDb()
    const rows = await db.select().from(sitePolicies).where(eq(sitePolicies.siteId, siteId)).limit(1)
    const row = rows[0]
    if (!row) return fallback
    const guestAccess = row.guestAccess
    const mode = guestAccess && isGuestAccessMode(guestAccess) ? guestAccess : fallbackGuestAccessMode(siteId)
    return settingsFromPolicy(mode, row.memberProjectDurationLimitHours)
  } catch (error) {
    console.error('[site-policies] read failed', error)
  }
  return fallback
}

export async function getSiteProjectDurationLimitHours(siteId: string): Promise<number> {
  const settings = await getSiteAccessControlSettings(siteId)
  return settings.memberProjectDurationLimitHours
}

export async function setSiteAccessControlSettings(
  siteId: string,
  settings: SiteAccessControlSettings
): Promise<void> {
  const guestAccess = guestAccessModeFromSettings(settings)
  const memberProjectDurationLimitHours = normalizeProjectDurationLimitHours(
    settings.memberProjectDurationLimitHours
  )
  await withDatabaseMirror('site-policies', async () => {
    const db = getDb()
    const now = new Date().toISOString()
    await db
      .insert(sitePolicies)
      .values({
        siteId,
        guestAccess,
        memberProjectDurationLimitHours,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: sitePolicies.siteId,
        set: {
          guestAccess,
          memberProjectDurationLimitHours,
          updatedAt: now,
        },
      })
  })
}

export async function setSiteGuestAccessMode(
  siteId: string,
  mode: GuestAccessMode
): Promise<void> {
  const current = await getSiteAccessControlSettings(siteId)
  await setSiteAccessControlSettings(siteId, {
    ...settingsFromPolicy(mode, current.memberProjectDurationLimitHours),
  })
}

export async function ensureDefaultSitePolicies(): Promise<void> {
  if (!postgresReadsEnabled()) return
  const now = new Date().toISOString()
  await withDatabaseMirror('site-policies-seed', async () => {
    const db = getDb()
    for (const site of OBSERVATORY_SITES) {
      const mode = DEFAULT_SITE_POLICIES[site.id as ObservatorySiteId] ?? 'closed'
      await db
        .insert(sitePolicies)
        .values({
          siteId: site.id,
          guestAccess: mode,
          memberProjectDurationLimitHours: DEFAULT_MEMBER_PROJECT_DURATION_LIMIT_HOURS,
          updatedAt: now,
        })
        .onConflictDoNothing()
    }
    await db
      .insert(sitePolicies)
      .values({
        siteId: DEFAULT_OBSERVATORY_SITE_ID,
        guestAccess: DEFAULT_SITE_POLICIES.pomfret,
        memberProjectDurationLimitHours: DEFAULT_MEMBER_PROJECT_DURATION_LIMIT_HOURS,
        updatedAt: now,
      })
      .onConflictDoNothing()
  })
}

export async function getGuestSiteAccessStatus(
  userId: string,
  siteId: string
): Promise<GuestAccessStatus | null> {
  if (!postgresReadsEnabled()) return null
  try {
    const db = getDb()
    const rows = await db
      .select()
      .from(guestSiteAccess)
      .where(and(eq(guestSiteAccess.userId, userId), eq(guestSiteAccess.siteId, siteId)))
      .limit(1)
    const status = rows[0]?.status
    if (status === 'pending' || status === 'approved' || status === 'rejected') return status
  } catch (error) {
    console.error('[guest-site-access] read failed', error)
  }
  return null
}

export async function setGuestSiteAccessStatus(input: {
  userId: string
  siteId: string
  status: GuestAccessStatus
  decidedByUserId?: string | null
}): Promise<void> {
  await withDatabaseMirror('guest-site-access', async () => {
    const db = getDb()
    const now = new Date().toISOString()
    await db
      .insert(guestSiteAccess)
      .values({
        userId: input.userId,
        siteId: input.siteId,
        status: input.status,
        updatedAt: now,
        decidedByUserId: input.decidedByUserId ?? null,
      })
      .onConflictDoUpdate({
        target: [guestSiteAccess.userId, guestSiteAccess.siteId],
        set: {
          status: input.status,
          updatedAt: now,
          decidedByUserId: input.decidedByUserId ?? null,
        },
      })
  })
}

export async function listPendingGuestAccessForSite(siteId: string): Promise<PendingGuestAccessRequest[]> {
  if (!postgresReadsEnabled()) return []
  try {
    const db = getDb()
    const rows = await db
      .select()
      .from(guestSiteAccess)
      .where(and(eq(guestSiteAccess.siteId, siteId), eq(guestSiteAccess.status, 'pending')))
    return rows.map((row) => ({
      userId: row.userId,
      firstName: '',
      lastName: '',
      email: '',
      updatedAt: row.updatedAt,
    }))
  } catch (error) {
    console.error('[guest-site-access] list pending failed', error)
    return []
  }
}
