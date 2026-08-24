import { applyPostgresMigrations } from '@/lib/db/migrate'
import { kvEnabled, kvGetJson } from '@/lib/kv-rest'
import {
  mirrorAdminClosedWindows,
  mirrorAuditLog,
  mirrorGallerySubmissions,
  mirrorImagingEquipment,
  mirrorImagingProjects,
  mirrorImagingQueue,
  mirrorMembers,
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

  const members = (await kvGetJson<{ users?: MemberUser[] }>('member-users'))?.users ?? []
  await mirrorMembers(members)

  const queue = (await kvGetJson<{ requests?: Array<Record<string, unknown>> }>('imaging-queue-requests'))?.requests ?? []
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

  const projects = (await kvGetJson<{ projects?: Array<Record<string, unknown>> }>('imaging-projects'))?.projects ?? []
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

  const board = (await kvGetJson<{ entries?: Array<Record<string, unknown>> }>('imaging-session-board'))?.entries ?? []
  await mirrorSessionBoard(
    board.map((e) => ({
      id: String(e.id),
      status: String(e.status),
      updatedAt: String(e.updatedAt),
      userId: typeof e.userId === 'string' ? e.userId : undefined,
      ...e,
    })) as Parameters<typeof mirrorSessionBoard>[0]
  )

  const audit = (await kvGetJson<{ entries?: Array<Record<string, unknown>> }>('imaging-audit-log'))?.entries ?? []
  await mirrorAuditLog(
    audit.map((e) => ({
      id: String(e.id),
      at: String(e.at),
      kind: String(e.kind),
      message: String(e.message),
      detail: typeof e.detail === 'object' && e.detail ? (e.detail as Record<string, unknown>) : undefined,
    }))
  )

  const gallery = (await kvGetJson<{ submissions?: Array<Record<string, unknown>> }>('gallery-submissions'))?.submissions ?? []
  await mirrorGallerySubmissions(
    gallery.map((s) => ({
      id: String(s.id),
      userId: String(s.userId),
      status: String(s.status),
      createdAt: String(s.createdAt),
      ...s,
    })) as Parameters<typeof mirrorGallerySubmissions>[0]
  )

  const equipment = await kvGetJson<{ rigs?: unknown }>('pomfret:imaging-equipment')
  if (equipment) await mirrorImagingEquipment(equipment.rigs ?? equipment)

  const windows = (await kvGetJson<{ windows?: Array<Record<string, unknown>> }>('imaging-admin-closed-windows'))?.windows ?? []
  await mirrorAdminClosedWindows(
    windows.map((w) => ({
      id: String(w.id),
      startIso: String(w.startIso),
      endIso: String(w.endIso),
      ...w,
    })) as Parameters<typeof mirrorAdminClosedWindows>[0]
  )

  const objects = (await kvGetJson<{ byQueueId?: Record<string, string> }>('imaging-r2-object-map'))?.byQueueId ?? {}
  for (const [queueId, objectKey] of Object.entries(objects)) {
    await mirrorR2ObjectKey('object', queueId, objectKey)
  }
  const previews = (await kvGetJson<{ byQueueId?: Record<string, string> }>('imaging-r2-preview-map'))?.byQueueId ?? {}
  for (const [queueId, objectKey] of Object.entries(previews)) {
    await mirrorR2ObjectKey('preview', queueId, objectKey)
  }

  return { ok: true }
}
