/**
 * Membership / affiliation applications (signup "Choose Your Affiliation").
 */

import { and, eq } from 'drizzle-orm'

import { getDb, postgresReadsEnabled, withDatabaseMirror } from '@/lib/db'
import { membershipApplications } from '@/lib/db/schema'
import type { GuestAccessStatus } from '@/lib/member-roles'

export type PendingMembershipApplication = {
  userId: string
  siteId: string
  updatedAt: string
}

export async function getMembershipApplicationStatus(
  userId: string,
  siteId: string
): Promise<GuestAccessStatus | null> {
  if (!postgresReadsEnabled()) return null
  try {
    const db = getDb()
    const rows = await db
      .select()
      .from(membershipApplications)
      .where(
        and(eq(membershipApplications.userId, userId), eq(membershipApplications.siteId, siteId))
      )
      .limit(1)
    const status = rows[0]?.status
    if (status === 'pending' || status === 'approved' || status === 'rejected') return status
  } catch (error) {
    console.error('[membership-applications] read failed', error)
  }
  return null
}

export async function setMembershipApplicationStatus(input: {
  userId: string
  siteId: string
  status: GuestAccessStatus
  decidedByUserId?: string | null
}): Promise<void> {
  await withDatabaseMirror('membership-applications', async () => {
    const db = getDb()
    const now = new Date().toISOString()
    await db
      .insert(membershipApplications)
      .values({
        userId: input.userId,
        siteId: input.siteId,
        status: input.status,
        updatedAt: now,
        decidedByUserId: input.decidedByUserId ?? null,
      })
      .onConflictDoUpdate({
        target: [membershipApplications.userId, membershipApplications.siteId],
        set: {
          status: input.status,
          updatedAt: now,
          decidedByUserId: input.decidedByUserId ?? null,
        },
      })
  })
}

export async function listPendingMembershipApplicationsForUser(
  userId: string
): Promise<PendingMembershipApplication[]> {
  if (!postgresReadsEnabled()) return []
  try {
    const db = getDb()
    const rows = await db
      .select()
      .from(membershipApplications)
      .where(
        and(eq(membershipApplications.userId, userId), eq(membershipApplications.status, 'pending'))
      )
    return rows.map((row) => ({
      userId: row.userId,
      siteId: row.siteId,
      updatedAt: row.updatedAt,
    }))
  } catch (error) {
    console.error('[membership-applications] list pending for user failed', error)
    return []
  }
}

export async function listPendingMembershipApplicationsForSite(
  siteId: string
): Promise<PendingMembershipApplication[]> {
  if (!postgresReadsEnabled()) return []
  try {
    const db = getDb()
    const rows = await db
      .select()
      .from(membershipApplications)
      .where(
        and(eq(membershipApplications.siteId, siteId), eq(membershipApplications.status, 'pending'))
      )
    return rows.map((row) => ({
      userId: row.userId,
      siteId: row.siteId,
      updatedAt: row.updatedAt,
    }))
  } catch (error) {
    console.error('[membership-applications] list pending failed', error)
    return []
  }
}

export async function deleteMembershipApplicationsForUser(userId: string): Promise<void> {
  await withDatabaseMirror('membership-applications-delete', async () => {
    const db = getDb()
    await db.delete(membershipApplications).where(eq(membershipApplications.userId, userId))
  })
}
