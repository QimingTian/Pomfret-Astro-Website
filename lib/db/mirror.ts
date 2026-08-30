import { eq, inArray, not, sql } from 'drizzle-orm'

import { getDb, withDatabaseBackup, withDatabaseMirror } from '@/lib/db'
import { sameJson, stripNinaJsonFromProjectDocument } from '@/lib/db/skip-unchanged'
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
import { currentObservatorySiteId } from '@/lib/observatory-site-scope'
import type { MemberUser } from '@/lib/member-store'

/** Imaging queue / projects / board / audit / windows / R2 follow request site. */
function imagingSiteId(): string {
  return currentObservatorySiteId() || DEFAULT_OBSERVATORY_SITE_ID
}

/** Gallery / equipment / some member docs stay Pomfret until product scopes them. */
function membershipSiteId(): string {
  return DEFAULT_OBSERVATORY_SITE_ID
}

function ts(value: string | null | undefined): string | null {
  if (!value) return null
  return value
}

export async function mirrorMembers(list: MemberUser[]): Promise<void> {
  await withDatabaseMirror('members', async () => {
    const db = getDb()
    const now = new Date().toISOString()
    for (const user of list) {
      const systemRole = user.systemRole ?? (user.role === 'admin' ? 'pomfret_astro_admin' : 'user')
      await db
        .insert(users)
        .values({
          id: user.id,
          email: user.email,
          username: user.username,
          passwordHash: user.passwordHash,
          firstName: user.firstName,
          lastName: user.lastName,
          displayName: user.displayName ?? null,
          role: systemRole,
          emailVerifiedAt: ts(user.emailVerifiedAt),
          createdAt: user.createdAt,
          updatedAt: user.updatedAt,
        })
        .onConflictDoUpdate({
          target: users.id,
          set: {
            email: user.email,
            username: user.username,
            passwordHash: user.passwordHash,
            firstName: user.firstName,
            lastName: user.lastName,
            displayName: user.displayName ?? null,
            role: systemRole,
            emailVerifiedAt: ts(user.emailVerifiedAt),
            updatedAt: user.updatedAt,
          },
        })

      const membershipList =
        user.memberships?.length > 0
          ? user.memberships
          : [
              {
                siteId: DEFAULT_OBSERVATORY_SITE_ID,
                siteRole:
                  systemRole === 'pomfret_astro_admin' || user.role === 'admin'
                    ? ('observatory_admin' as const)
                    : ('observatory_member' as const),
                imagingApprovedAt: user.imagingApprovedAt ?? null,
                imagingRejectedAt: user.imagingRejectedAt ?? null,
              },
            ]

      for (const m of membershipList) {
        await db
          .insert(memberships)
          .values({
            userId: user.id,
            siteId: m.siteId,
            siteRole: m.siteRole,
            imagingApprovedAt: ts(m.imagingApprovedAt),
            imagingRejectedAt: ts(m.imagingRejectedAt),
            updatedAt: user.updatedAt || now,
          })
          .onConflictDoUpdate({
            target: [memberships.userId, memberships.siteId],
            set: {
              siteRole: m.siteRole,
              imagingApprovedAt: ts(m.imagingApprovedAt),
              imagingRejectedAt: ts(m.imagingRejectedAt),
              updatedAt: user.updatedAt || now,
            },
          })
      }
    }
  })
}

type QueueRow = {
  id: string
  status: string
  target: string
  createdAt: string
  updatedAt: string
  userId?: string
  ninaSequenceJson?: string
}

export async function mirrorImagingQueue(rows: QueueRow[]): Promise<void> {
  await withDatabaseBackup('imaging-queue', async () => {
    const db = getDb()
    const sid = imagingSiteId()
    const ids = rows.map((r) => r.id)
    const existingDocs = await db
      .select({
        id: imagingRequests.id,
        status: imagingRequests.status,
        userId: imagingRequests.userId,
        target: imagingRequests.target,
        document: imagingRequests.document,
      })
      .from(imagingRequests)
      .where(eq(imagingRequests.siteId, sid))
    const existingById = new Map(existingDocs.map((r) => [r.id, r]))
    const existingPayloads = await db
      .select({
        id: imagingRequestPayloads.id,
        ninaSequenceJson: imagingRequestPayloads.ninaSequenceJson,
      })
      .from(imagingRequestPayloads)
      .where(eq(imagingRequestPayloads.siteId, sid))
    const payloadById = new Map(existingPayloads.map((r) => [r.id, r.ninaSequenceJson]))
    for (const row of rows) {
      const ninaJson = row.ninaSequenceJson ?? (row as QueueRow & { ninaSequenceJson?: string }).ninaSequenceJson
      const { ninaSequenceJson: _payload, ...rest } = row
      const document = JSON.parse(JSON.stringify(rest)) as Record<string, unknown>
      delete document.ninaSequenceJson
      delete document.ninaSequenceJson
      const prev = existingById.get(row.id)
      const docUnchanged =
        prev != null &&
        prev.status === row.status &&
        prev.userId === (row.userId ?? null) &&
        prev.target === row.target &&
        sameJson(prev.document, document)
      if (!docUnchanged) {
        await db
          .insert(imagingRequests)
          .values({
            id: row.id,
            siteId: sid,
            status: row.status,
            userId: row.userId ?? null,
            target: row.target,
            createdAt: row.createdAt,
            updatedAt: row.updatedAt,
            document,
          })
          .onConflictDoUpdate({
            target: imagingRequests.id,
            set: {
              status: row.status,
              userId: row.userId ?? null,
              target: row.target,
              updatedAt: row.updatedAt,
              document,
            },
          })
      }
      if (ninaJson !== undefined && payloadById.get(row.id) !== ninaJson) {
        await db
          .insert(imagingRequestPayloads)
          .values({
            id: row.id,
            siteId: sid,
            ninaSequenceJson: ninaJson ?? null,
          })
          .onConflictDoUpdate({
            target: imagingRequestPayloads.id,
            set: { ninaSequenceJson: ninaJson ?? null },
          })
      }
    }
    if (ids.length === 0) {
      await db.delete(imagingRequests).where(sql`${imagingRequests.siteId} = ${sid}`)
      await db.delete(imagingRequestPayloads).where(sql`${imagingRequestPayloads.siteId} = ${sid}`)
      return
    }
    await db
      .delete(imagingRequests)
      .where(sql`${imagingRequests.siteId} = ${sid} AND ${imagingRequests.id} NOT IN (${sql.join(
        ids.map((id) => sql`${id}`),
        sql`, `
      )})`)
    await db
      .delete(imagingRequestPayloads)
      .where(sql`${imagingRequestPayloads.siteId} = ${sid} AND ${imagingRequestPayloads.id} NOT IN (${sql.join(
        ids.map((id) => sql`${id}`),
        sql`, `
      )})`)
  })
}

type ProjectRow = {
  id: string
  status: string
  target: string
  createdAt: string
  updatedAt: string
  userId?: string
}

export async function mirrorImagingProjects(rows: ProjectRow[]): Promise<void> {
  await withDatabaseBackup('imaging-projects', async () => {
    const db = getDb()
    const sid = imagingSiteId()
    const ids = rows.map((r) => r.id)
    const existing = await db
      .select({
        id: imagingProjects.id,
        status: imagingProjects.status,
        userId: imagingProjects.userId,
        target: imagingProjects.target,
        document: imagingProjects.document,
      })
      .from(imagingProjects)
      .where(eq(imagingProjects.siteId, sid))
    const existingById = new Map(existing.map((r) => [r.id, r]))
    for (const row of rows) {
      const document = stripNinaJsonFromProjectDocument(row)
      const prev = existingById.get(row.id)
      if (
        prev &&
        prev.status === row.status &&
        prev.userId === (row.userId ?? null) &&
        prev.target === row.target &&
        sameJson(prev.document, document)
      ) {
        continue
      }
      await db
        .insert(imagingProjects)
        .values({
          id: row.id,
          siteId: sid,
          status: row.status,
          userId: row.userId ?? null,
          target: row.target,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
          document,
        })
        .onConflictDoUpdate({
          target: imagingProjects.id,
          set: {
            status: row.status,
            userId: row.userId ?? null,
            target: row.target,
            updatedAt: row.updatedAt,
            document,
          },
        })
    }
    if (ids.length === 0) {
      await db.delete(imagingProjects).where(sql`${imagingProjects.siteId} = ${sid}`)
      return
    }
    await db
      .delete(imagingProjects)
      .where(sql`${imagingProjects.siteId} = ${sid} AND ${imagingProjects.id} NOT IN (${sql.join(
        ids.map((id) => sql`${id}`),
        sql`, `
      )})`)
  })
}

type BoardRow = {
  id: string
  status: string
  updatedAt: string
  userId?: string
}

export async function mirrorSessionBoard(rows: BoardRow[]): Promise<void> {
  await withDatabaseBackup('session-board', async () => {
    const db = getDb()
    const sid = imagingSiteId()
    const ids = rows.map((r) => r.id)
    for (const row of rows) {
      await db
        .insert(sessionBoard)
        .values({
          id: row.id,
          siteId: sid,
          status: row.status,
          userId: row.userId ?? null,
          updatedAt: row.updatedAt,
          document: JSON.parse(JSON.stringify(row)) as Record<string, unknown>,
        })
        .onConflictDoUpdate({
          target: sessionBoard.id,
          set: {
            status: row.status,
            userId: row.userId ?? null,
            updatedAt: row.updatedAt,
            document: JSON.parse(JSON.stringify(row)) as Record<string, unknown>,
          },
        })
    }
    if (ids.length === 0) {
      await db.delete(sessionBoard).where(sql`${sessionBoard.siteId} = ${sid}`)
      return
    }
    await db
      .delete(sessionBoard)
      .where(sql`${sessionBoard.siteId} = ${sid} AND ${sessionBoard.id} NOT IN (${sql.join(
        ids.map((id) => sql`${id}`),
        sql`, `
      )})`)
  })
}

type AuditRow = { id: string; at: string; kind: string; message: string; detail?: Record<string, unknown> }

export async function mirrorAuditLog(rows: AuditRow[]): Promise<void> {
  await withDatabaseBackup('audit-log', async () => {
    const db = getDb()
    const sid = imagingSiteId()
    const existing = await db.select({ id: auditLog.id }).from(auditLog).where(eq(auditLog.siteId, sid))
    const have = new Set(existing.map((r) => r.id))
    for (const row of rows) {
      if (have.has(row.id)) continue
      await db
        .insert(auditLog)
        .values({
          id: row.id,
          siteId: sid,
          at: row.at,
          kind: row.kind,
          message: row.message,
          detail: row.detail ?? null,
        })
        .onConflictDoUpdate({
          target: auditLog.id,
          set: {
            at: row.at,
            kind: row.kind,
            message: row.message,
            detail: row.detail ?? null,
          },
        })
    }
  })
}

type GalleryRow = { id: string; userId: string; status: string; createdAt: string }

export async function mirrorGallerySubmissions(rows: GalleryRow[]): Promise<void> {
  await withDatabaseMirror('gallery', async () => {
    const db = getDb()
    const sid = membershipSiteId()
    const ids = rows.map((r) => r.id)
    for (const row of rows) {
      await db
        .insert(gallerySubmissions)
        .values({
          id: row.id,
          siteId: sid,
          userId: row.userId,
          status: row.status,
          createdAt: row.createdAt,
          document: JSON.parse(JSON.stringify(row)) as Record<string, unknown>,
        })
        .onConflictDoUpdate({
          target: gallerySubmissions.id,
          set: {
            status: row.status,
            document: JSON.parse(JSON.stringify(row)) as Record<string, unknown>,
          },
        })
    }
    if (ids.length > 0) {
      await db.delete(gallerySubmissions).where(not(inArray(gallerySubmissions.id, ids)))
    }
  })
}

export async function mirrorImagingEquipment(rigs: unknown): Promise<void> {
  await withDatabaseMirror('equipment', async () => {
    const db = getDb()
    const sid = membershipSiteId()
    await db
      .insert(imagingEquipment)
      .values({
        siteId: sid,
        rigs,
        updatedAt: new Date().toISOString(),
      })
      .onConflictDoUpdate({
        target: imagingEquipment.siteId,
        set: { rigs, updatedAt: new Date().toISOString() },
      })
  })
}

type WindowRow = { id: string; startIso: string; endIso: string }

export async function mirrorAdminClosedWindows(rows: WindowRow[]): Promise<void> {
  await withDatabaseBackup('admin-closed-windows', async () => {
    const db = getDb()
    const sid = imagingSiteId()
    const ids = rows.map((r) => r.id)
    for (const row of rows) {
      await db
        .insert(adminClosedWindows)
        .values({
          id: row.id,
          siteId: sid,
          startIso: row.startIso,
          endIso: row.endIso,
          document: JSON.parse(JSON.stringify(row)) as Record<string, unknown>,
        })
        .onConflictDoUpdate({
          target: adminClosedWindows.id,
          set: {
            startIso: row.startIso,
            endIso: row.endIso,
            document: JSON.parse(JSON.stringify(row)) as Record<string, unknown>,
          },
        })
    }
    if (ids.length === 0) {
      await db.delete(adminClosedWindows).where(sql`${adminClosedWindows.siteId} = ${sid}`)
      return
    }
    await db
      .delete(adminClosedWindows)
      .where(sql`${adminClosedWindows.siteId} = ${sid} AND ${adminClosedWindows.id} NOT IN (${sql.join(
        ids.map((id) => sql`${id}`),
        sql`, `
      )})`)
  })
}

export async function mirrorR2ObjectKey(kind: 'object' | 'preview', queueId: string, objectKey: string | null): Promise<void> {
  await withDatabaseMirror('r2-map', async () => {
    const db = getDb()
    if (!objectKey) {
      await db.delete(r2ObjectMap).where(sql`${r2ObjectMap.kind} = ${kind} AND ${r2ObjectMap.queueId} = ${queueId}`)
      return
    }
    await db
      .insert(r2ObjectMap)
      .values({
        queueId,
        kind,
        siteId: imagingSiteId(),
        objectKey,
      })
      .onConflictDoUpdate({
        target: [r2ObjectMap.kind, r2ObjectMap.queueId],
        set: { objectKey },
      })
  })
}

type SavedRow = { id: string; userId: string; name: string; updatedAt: string }

export async function mirrorMemberSavedSessions(userId: string, rows: SavedRow[]): Promise<void> {
  await withDatabaseMirror('saved-sessions', async () => {
    const db = getDb()
    const sid = membershipSiteId()
    const ids = rows.map((r) => r.id)
    for (const row of rows) {
      await db
        .insert(memberSavedSessions)
        .values({
          id: row.id,
          userId,
          siteId: sid,
          name: row.name,
          updatedAt: row.updatedAt,
          document: JSON.parse(JSON.stringify(row)) as Record<string, unknown>,
        })
        .onConflictDoUpdate({
          target: [memberSavedSessions.userId, memberSavedSessions.id],
          set: {
            name: row.name,
            updatedAt: row.updatedAt,
            document: JSON.parse(JSON.stringify(row)) as Record<string, unknown>,
          },
        })
    }
    if (ids.length === 0) {
      await db.delete(memberSavedSessions).where(sql`${memberSavedSessions.userId} = ${userId}`)
      return
    }
    await db
      .delete(memberSavedSessions)
      .where(sql`${memberSavedSessions.userId} = ${userId} AND ${memberSavedSessions.id} NOT IN (${sql.join(
        ids.map((id) => sql`${id}`),
        sql`, `
      )})`)
  })
}

type HistoryRow = { id: string; updatedAt: string }

export async function mirrorMemberSessionHistory(userId: string, rows: HistoryRow[]): Promise<void> {
  await withDatabaseMirror('session-history', async () => {
    const db = getDb()
    const sid = membershipSiteId()
    const ids = rows.map((r) => r.id)
    for (const row of rows) {
      await db
        .insert(memberSessionHistory)
        .values({
          id: row.id,
          userId,
          siteId: sid,
          updatedAt: row.updatedAt,
          document: JSON.parse(JSON.stringify(row)) as Record<string, unknown>,
        })
        .onConflictDoUpdate({
          target: [memberSessionHistory.userId, memberSessionHistory.id],
          set: {
            updatedAt: row.updatedAt,
            document: JSON.parse(JSON.stringify(row)) as Record<string, unknown>,
          },
        })
    }
    if (ids.length === 0) {
      await db.delete(memberSessionHistory).where(sql`${memberSessionHistory.userId} = ${userId}`)
      return
    }
    await db
      .delete(memberSessionHistory)
      .where(sql`${memberSessionHistory.userId} = ${userId} AND ${memberSessionHistory.id} NOT IN (${sql.join(
        ids.map((id) => sql`${id}`),
        sql`, `
      )})`)
  })
}
