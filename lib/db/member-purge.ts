import { eq } from 'drizzle-orm'

import { getDb, isDatabaseConfigured, withDatabaseMirror } from '@/lib/db'
import {
  gallerySubmissions,
  guestSiteAccess,
  memberSavedSessions,
  memberSessionHistory,
  membershipApplications,
  memberships,
  users,
} from '@/lib/db/schema'

/** Remove a member and related rows from Postgres (when configured). */
export async function purgeMemberUserFromPostgres(userId: string): Promise<void> {
  if (!isDatabaseConfigured() || !userId) return
  await withDatabaseMirror('member-purge', async () => {
    const db = getDb()
    await db.delete(memberships).where(eq(memberships.userId, userId))
    await db.delete(membershipApplications).where(eq(membershipApplications.userId, userId))
    await db.delete(guestSiteAccess).where(eq(guestSiteAccess.userId, userId))
    await db.delete(memberSavedSessions).where(eq(memberSavedSessions.userId, userId))
    await db.delete(memberSessionHistory).where(eq(memberSessionHistory.userId, userId))
    await db.delete(gallerySubmissions).where(eq(gallerySubmissions.userId, userId))
    await db.delete(users).where(eq(users.id, userId))
  })
}
