import { asc, eq } from 'drizzle-orm'

import { getDb, postgresReadsEnabled } from '@/lib/db'
import {
  adminClosedWindows,
  auditLog,
  gallerySubmissions,
  imagingEquipment,
  imagingProjects,
  imagingRequestPayloads,
  imagingRequests,
  memberSavedSessions,
  memberships,
  memberSessionHistory,
  r2ObjectMap,
  sessionBoard,
  users,
} from '@/lib/db/schema'
import { DEFAULT_OBSERVATORY_SITE_ID } from '@/lib/observatory-sites'
import type { MemberUser } from '@/lib/member-store'

const SITE = DEFAULT_OBSERVATORY_SITE_ID

export async function loadMembersFromPostgres(): Promise<MemberUser[] | null> {
  if (!postgresReadsEnabled()) return null
  try {
    const db = getDb()
    const userRows = await db.select().from(users)
    const membershipRows = await db.select().from(memberships).where(eq(memberships.siteId, SITE))
    const membershipByUser = new Map(membershipRows.map((m) => [m.userId, m]))
    return userRows.map((u) => {
      const m = membershipByUser.get(u.id)
      return {
        id: u.id,
        email: u.email,
        passwordHash: u.passwordHash,
        firstName: u.firstName,
        lastName: u.lastName,
        username: u.username,
        displayName: u.displayName ?? undefined,
        role: u.role as MemberUser['role'],
        createdAt: u.createdAt,
        updatedAt: u.updatedAt,
        emailVerifiedAt: u.emailVerifiedAt,
        imagingApprovedAt: m?.imagingApprovedAt ?? null,
        imagingRejectedAt: m?.imagingRejectedAt ?? null,
      }
    })
  } catch (error) {
    console.error('[pg-read] members failed; using KV', error)
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
  try {
    const db = getDb()
    if (kind === 'queue') {
      const rows = await db
        .select({
          request: imagingRequests,
          payload: imagingRequestPayloads,
        })
        .from(imagingRequests)
        .leftJoin(imagingRequestPayloads, eq(imagingRequests.id, imagingRequestPayloads.id))
      return rows
        .filter((r) => r.request.siteId === SITE)
        .map((r) => {
          const doc = (r.request.document ?? {}) as T
          return {
            ...doc,
            id: r.request.id,
            ninaSequenceJson: r.payload?.ninaSequenceJson ?? (doc as { ninaSequenceJson?: string }).ninaSequenceJson,
          }
        }) as T[]
    }
    if (kind === 'projects') {
      const rows = await db.select().from(imagingProjects)
      return rows.filter((r) => r.siteId === SITE).map((r) => r.document as T)
    }
    if (kind === 'board') {
      const rows = await db.select().from(sessionBoard)
      return rows.filter((r) => r.siteId === SITE).map((r) => r.document as T)
    }
    if (kind === 'gallery') {
      const rows = await db.select().from(gallerySubmissions)
      return rows.filter((r) => r.siteId === SITE).map((r) => r.document as T)
    }
    if (kind === 'windows') {
      const rows = await db.select().from(adminClosedWindows)
      return rows.filter((r) => r.siteId === SITE).map((r) => r.document as T)
    }
    const rows = await db.select().from(auditLog).orderBy(asc(auditLog.at))
    return rows
      .filter((r) => r.siteId === SITE)
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
    const rows = await db.select().from(imagingEquipment).where(eq(imagingEquipment.siteId, SITE))
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
    for (const row of rows) {
      if (row.siteId === SITE) out[row.queueId] = row.objectKey
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
