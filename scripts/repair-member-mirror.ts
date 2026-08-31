/**
 * One-off repair: align Postgres memberships with in-memory member model.
 * Removes phantom Pomfret rows for guests and stale multi-site membership rows.
 *
 * Usage: npx tsx scripts/repair-member-mirror.ts
 */
import { and, eq, notInArray } from 'drizzle-orm'

import { getDb, isDatabaseConfigured } from '@/lib/db'
import { loadMembersFromPostgres } from '@/lib/db/read'
import { memberships } from '@/lib/db/schema'

async function main() {
  if (!isDatabaseConfigured()) {
    console.error('DATABASE_URL is not configured.')
    process.exit(1)
  }

  const users = await loadMembersFromPostgres()
  if (!users) {
    console.error('Could not load members from Postgres.')
    process.exit(1)
  }
  const db = getDb()
  let deletedPhantom = 0
  let deletedStale = 0

  for (const user of users) {
    const keepSiteIds = (user.memberships ?? []).map((m) => m.siteId)
    if (keepSiteIds.length === 0) {
      const result = await db.delete(memberships).where(eq(memberships.userId, user.id))
      deletedPhantom += result.rowCount ?? 0
      continue
    }
    const result = await db
      .delete(memberships)
      .where(
        and(eq(memberships.userId, user.id), notInArray(memberships.siteId, keepSiteIds))
      )
    deletedStale += result.rowCount ?? 0
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        usersScanned: users.length,
        deletedPhantomGuestRows: deletedPhantom,
        deletedStaleSiteRows: deletedStale,
        database: 'configured',
      },
      null,
      2
    )
  )
}

void main().catch((error) => {
  console.error(error)
  process.exit(1)
})
