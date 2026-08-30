import { asc, eq } from 'drizzle-orm'

import { getDb, postgresReadsEnabled } from '@/lib/db'
import {
  adminClosedWindows,
  auditLog,
  gallerySubmissions,
  imagingEquipment,
  imagingProjects,
  imagingRequests,
  memberSavedSessions,
  memberships,
  memberSessionHistory,
  r2ObjectMap,
  sessionBoard,
  users,
} from '@/lib/db/schema'
import {
  coerceSystemRole,
  isSiteRole,
  legacyMemberRoleLabel,
  type SiteMembership,
  type SiteRole,
} from '@/lib/member-roles'
import type { MemberUser } from '@/lib/member-store'
import { DEFAULT_OBSERVATORY_SITE_ID } from '@/lib/observatory-sites'
import { currentObservatorySiteId } from '@/lib/observatory-site-scope'

/** Imaging hot docs follow the request-scoped site. */
function imagingSiteId(): string {
  return currentObservatorySiteId() || DEFAULT_OBSERVATORY_SITE_ID
}

function membershipFromRow(row: {
  siteId: string
  siteRole: string
  imagingApprovedAt: string | null
  imagingRejectedAt: string | null
}): SiteMembership {
  const siteRole: SiteRole = isSiteRole(row.siteRole) ? row.siteRole : 'observatory_member'
  return {
    siteId: row.siteId,
    siteRole,
    imagingApprovedAt: row.imagingApprovedAt,
    imagingRejectedAt: row.imagingRejectedAt,
  }
}

export async function loadMembersFromPostgres(): Promise<MemberUser[] | null> {
  if (!postgresReadsEnabled()) return null
  try {
    const db = getDb()
    const userRows = await db.select().from(users)
    const membershipRows = await db.select().from(memberships)
    const membershipsByUser = new Map<string, SiteMembership[]>()
    for (const row of membershipRows) {
      const list = membershipsByUser.get(row.userId) ?? []
      list.push(membershipFromRow(row))
      membershipsByUser.set(row.userId, list)
    }
    return userRows.map((u) => {
      const userMemberships = membershipsByUser.get(u.id) ?? []
      const systemRole = coerceSystemRole(u.role)
      const pomfret = userMemberships.find((m) => m.siteId === DEFAULT_OBSERVATORY_SITE_ID)
      return {
        id: u.id,
        email: u.email,
        passwordHash: u.passwordHash,
        firstName: u.firstName,
        lastName: u.lastName,
        username: u.username,
        displayName: u.displayName ?? undefined,
        systemRole,
        memberships: userMemberships,
        role: legacyMemberRoleLabel({ systemRole, memberships: userMemberships }),
        createdAt: u.createdAt,
        updatedAt: u.updatedAt,
        emailVerifiedAt: u.emailVerifiedAt,
        imagingApprovedAt: pomfret?.imagingApprovedAt ?? null,
        imagingRejectedAt: pomfret?.imagingRejectedAt ?? null,
      } satisfies MemberUser
    })
  } catch (error) {
    console.error('[pg-read] members failed', error)
    return null
  }
}

export async function loadJsonDocumentsFromPostgres<T extends { id: string }>(
  kind:
    | 'queue'
    | 'projects'
    | 'board'
    | 'gallery'
    | 'windows'
    | 'audit'
): Promise<T[] | null> {
  if (!postgresReadsEnabled()) return null
  const site = imagingSiteId()
  try {
    const db = getDb()
    if (kind === 'queue') {
      const rows = await db.select().from(imagingRequests)
      return rows
        .filter((r) => r.siteId === site)
        .map((r) => {
          const doc = (r.document ?? {}) as T
          return { ...doc, id: r.id }
        }) as T[]
    }
    if (kind === 'projects') {
      const rows = await db.select().from(imagingProjects)
      return rows.filter((r) => r.siteId === site).map((r) => r.document as T)
    }
    if (kind === 'board') {
      const rows = await db.select().from(sessionBoard)
      return rows.filter((r) => r.siteId === site).map((r) => r.document as T)
    }
    if (kind === 'gallery') {
      // Gallery stays Pomfret until share rules are site-scoped.
      const rows = await db.select().from(gallerySubmissions)
      return rows
        .filter((r) => r.siteId === DEFAULT_OBSERVATORY_SITE_ID)
        .map((r) => r.document as T)
    }
    if (kind === 'windows') {
      const rows = await db
        .select()
        .from(adminClosedWindows)
        .where(eq(adminClosedWindows.siteId, site))
      return rows.map((r) => r.document as T)
    }
    const rows = await db.select().from(auditLog).orderBy(asc(auditLog.at))
    return rows
      .filter((r) => r.siteId === site)
      .map((r) => ({ id: r.id, at: r.at, kind: r.kind, message: r.message, detail: r.detail ?? undefined }) as unknown as T)
  } catch (error) {
    console.error(`[pg-read] ${kind} failed; using KV`, error)
    return null
  }
}

export async function loadEquipmentRigsFromPostgres(): Promise<unknown[] | null> {
  if (!postgresReadsEnabled()) return null
  try {
    const db = getDb()
    const rows = await db
      .select()
      .from(imagingEquipment)
      .where(eq(imagingEquipment.siteId, DEFAULT_OBSERVATORY_SITE_ID))
    const rigs = rows[0]?.rigs
    return Array.isArray(rigs) ? rigs : null
  } catch (error) {
    console.error('[pg-read] equipment failed; using KV', error)
    return null
  }
}

export async function loadR2MapFromPostgres(kind: 'object' | 'preview'): Promise<Record<string, string> | null> {
  if (!postgresReadsEnabled()) return null
  try {
    const db = getDb()
    const rows = await db.select().from(r2ObjectMap).where(eq(r2ObjectMap.kind, kind))
    const out: Record<string, string> = {}
    const site = imagingSiteId()
    for (const row of rows) {
      if (row.siteId === site) out[row.queueId] = row.objectKey
    }
    return out
  } catch (error) {
    console.error('[pg-read] r2 map failed; using KV', error)
    return null
  }
}

export async function loadSavedSessionsFromPostgres<T>(userId: string): Promise<T[] | null> {
  if (!postgresReadsEnabled()) return null
  try {
    const db = getDb()
    const rows = await db.select().from(memberSavedSessions).where(eq(memberSavedSessions.userId, userId))
    return rows.map((r) => r.document as T)
  } catch (error) {
    console.error('[pg-read] saved sessions failed; using KV', error)
    return null
  }
}

export async function loadSessionHistoryFromPostgres<T>(userId: string): Promise<T[] | null> {
  if (!postgresReadsEnabled()) return null
  try {
    const db = getDb()
    const rows = await db.select().from(memberSessionHistory).where(eq(memberSessionHistory.userId, userId))
    return rows.map((r) => r.document as T)
  } catch (error) {
    console.error('[pg-read] session history failed; using KV', error)
    return null
  }
}
