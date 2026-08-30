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
  DEFAULT_OBSERVATORY_SITE_ID,
  OBSERVATORY_SITES,
  type ObservatorySiteId,
} from '@/lib/observatory-sites'

export async function getSiteGuestAccessMode(siteId: string): Promise<GuestAccessMode> {
  const fallback =
    (DEFAULT_SITE_POLICIES as Record<string, GuestAccessMode>)[siteId] ?? 'closed'
  if (!postgresReadsEnabled()) return fallback
  try {
    const db = getDb()
    const rows = await db.select().from(sitePolicies).where(eq(sitePolicies.siteId, siteId)).limit(1)
    const raw = rows[0]?.guestAccess
    if (raw && isGuestAccessMode(raw)) return raw
  } catch (error) {
    console.error('[site-policies] read failed', error)
  }
  return fallback
}

export async function setSiteGuestAccessMode(
  siteId: string,
  mode: GuestAccessMode
): Promise<void> {
  await withDatabaseMirror('site-policies', async () => {
    const db = getDb()
    const now = new Date().toISOString()
    await db
      .insert(sitePolicies)
      .values({ siteId, guestAccess: mode, updatedAt: now })
      .onConflictDoUpdate({
        target: sitePolicies.siteId,
        set: { guestAccess: mode, updatedAt: now },
      })
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
        .values({ siteId: site.id, guestAccess: mode, updatedAt: now })
        .onConflictDoNothing()
    }
    await db
      .insert(sitePolicies)
      .values({
        siteId: DEFAULT_OBSERVATORY_SITE_ID,
        guestAccess: DEFAULT_SITE_POLICIES.pomfret,
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
