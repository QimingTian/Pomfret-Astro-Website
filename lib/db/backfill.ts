import { applyPostgresMigrations } from '@/lib/db/migrate'
import { kvEnabled, kvGetJson, kvGetString } from '@/lib/kv-rest'
import {
  mirrorAdminClosedWindows,
  mirrorAuditLog,
  mirrorGallerySubmissions,
  mirrorImagingEquipment,
  mirrorImagingProjects,
  mirrorImagingQueue,
  mirrorMembers,
  mirrorMemberSavedSessions,
  mirrorMemberSessionHistory,
  mirrorR2ObjectKey,
  mirrorSessionBoard,
} from '@/lib/db/mirror'
import { isDatabaseConfigured } from '@/lib/db'
import type { MemberUser } from '@/lib/member-store'

export async function backfillPostgresFromKv(): Promise<{ ok: true; skipped?: string } | { ok: false; error: string }> {
  if (!isDatabaseConfigured()) return { ok: false, error: 'DATABASE_URL is not set' }
  if (!kvEnabled()) return { ok: false, error: 'KV is not configured; refusing to backfill' }

  const migrated = await applyPostgresMigrations()
  if (!migrated.ok) return migrated

  async function kvPresent<T>(key: string): Promise<T | undefined> {
    const raw = await kvGetString(key)
    if (raw === undefined) return undefined
    return (await kvGetJson<T>(key)) as T | undefined
  }

  const membersDoc = await kvPresent<{ users?: MemberUser[] }>('member-users')
  const members = membersDoc?.users ?? []
  if (membersDoc) await mirrorMembers(members)

  const queueDoc = await kvPresent<{ requests?: Array<Record<string, unknown>> }>('imaging-queue-requests')
  if (queueDoc) {
    const queue = queueDoc.requests ?? []
    await mirrorImagingQueue(
      queue.map((r) => ({
        id: String(r.id),
        status: String(r.status),
        target: String(r.target ?? ''),
        createdAt: String(r.createdAt),
        updatedAt: String(r.updatedAt),
        userId: typeof r.userId === 'string' ? r.userId : undefined,
        ninaSequenceJson: typeof r.ninaSequenceJson === 'string' ? r.ninaSequenceJson : undefined,
        ...r,
      })) as Parameters<typeof mirrorImagingQueue>[0]
    )
  }

  const projectsDoc = await kvPresent<{ projects?: Array<Record<string, unknown>> }>('imaging-projects')
  if (projectsDoc) {
    const projects = projectsDoc.projects ?? []
    await mirrorImagingProjects(
      projects.map((p) => ({
        id: String(p.id),
        status: String(p.status),
        target: String(p.target ?? ''),
        createdAt: String(p.createdAt),
        updatedAt: String(p.updatedAt),
        userId: typeof p.userId === 'string' ? p.userId : undefined,
        ...p,
      })) as Parameters<typeof mirrorImagingProjects>[0]
    )
  }

  const boardDoc = await kvPresent<{ entries?: Array<Record<string, unknown>> }>('imaging-session-board')
  if (boardDoc) {
    const board = boardDoc.entries ?? []
    await mirrorSessionBoard(
      board.map((e) => ({
        id: String(e.id),
        status: String(e.status),
        updatedAt: String(e.updatedAt),
        userId: typeof e.userId === 'string' ? e.userId : undefined,
        ...e,
      })) as Parameters<typeof mirrorSessionBoard>[0]
    )
  }

  const auditDoc = await kvPresent<{ entries?: Array<Record<string, unknown>> }>('imaging-audit-log')
  if (auditDoc) {
    const audit = auditDoc.entries ?? []
    await mirrorAuditLog(
      audit.map((e) => ({
        id: String(e.id),
        at: String(e.at),
        kind: String(e.kind),
        message: String(e.message),
        detail: typeof e.detail === 'object' && e.detail ? (e.detail as Record<string, unknown>) : undefined,
      }))
    )
  }

  const galleryDoc = await kvPresent<{ submissions?: Array<Record<string, unknown>> }>('gallery-submissions')
  if (galleryDoc) {
    const gallery = galleryDoc.submissions ?? []
    await mirrorGallerySubmissions(
      gallery.map((s) => ({
        id: String(s.id),
        userId: String(s.userId),
        status: String(s.status),
        createdAt: String(s.createdAt),
        ...s,
      })) as Parameters<typeof mirrorGallerySubmissions>[0]
    )
  }

  const equipment = await kvPresent<{ rigs?: unknown }>('pomfret:imaging-equipment')
  if (equipment) await mirrorImagingEquipment(equipment.rigs ?? equipment)

  const windowsDoc = await kvPresent<{ windows?: Array<Record<string, unknown>> }>('imaging-admin-closed-windows')
  if (windowsDoc) {
    const windows = windowsDoc.windows ?? []
    await mirrorAdminClosedWindows(
      windows.map((w) => ({
        id: String(w.id),
        startIso: String(w.startIso),
        endIso: String(w.endIso),
        ...w,
      })) as Parameters<typeof mirrorAdminClosedWindows>[0]
    )
  }

  const objectsDoc = await kvPresent<{ byQueueId?: Record<string, string> }>('imaging-r2-object-map')
  const objects = objectsDoc?.byQueueId ?? {}
  for (const [queueId, objectKey] of Object.entries(objects)) {
    await mirrorR2ObjectKey('object', queueId, objectKey)
  }
  const previewsDoc = await kvPresent<{ byQueueId?: Record<string, string> }>('imaging-r2-preview-map')
  const previews = previewsDoc?.byQueueId ?? {}
  for (const [queueId, objectKey] of Object.entries(previews)) {
    await mirrorR2ObjectKey('preview', queueId, objectKey)
  }

  for (const user of members) {
    const saved = (await kvGetJson<{ sessions?: Array<Record<string, unknown>> }>(`member-saved-sessions:${user.id}`))
      ?.sessions ?? []
    if (saved.length > 0) {
      await mirrorMemberSavedSessions(
        user.id,
        saved.map((s) => ({
          id: String(s.id),
          userId: user.id,
          name: String(s.name ?? ''),
          updatedAt: String(s.updatedAt ?? s.savedAt ?? ''),
          ...s,
        })) as Parameters<typeof mirrorMemberSavedSessions>[1]
      )
    }
    const hist = (await kvGetJson<{ sessions?: Array<Record<string, unknown>> }>(`member-session-history:${user.id}`))
      ?.sessions ?? []
    if (hist.length > 0) {
      await mirrorMemberSessionHistory(
        user.id,
        hist.map((s) => ({
          id: String(s.id),
          updatedAt: String(s.updatedAt ?? s.createdAt ?? ''),
          ...s,
        })) as Parameters<typeof mirrorMemberSessionHistory>[1]
      )
    }
  }

  return { ok: true }
}
