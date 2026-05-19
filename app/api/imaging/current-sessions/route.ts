import type { NextRequest } from 'next/server'
import { imagingCorsOptions, withImagingCors } from '@/lib/imaging-queue-auth'
import { getCurrentUser } from '@/lib/member-auth'
import { appendAuditLog } from '@/lib/imaging-audit-log'
import {
  effectiveProjectStatus,
  listProjects,
  tonightDurationSecondsFromPlans,
  type ImagingProject,
  type ProjectNight,
} from '@/lib/imaging-project-store'
import { projectFrameCounts } from '@/lib/imaging-total-frames'
import { boardEnsureScheduleBarForTerminal, boardPurgeCompletedOlderThan, listBoardEntries } from '@/lib/imaging-session-board'
import { listAll, toPublicImagingRequest, type CreateImagingInput } from '@/lib/imaging-queue-store'
import { purgeExpiredProjectAssets } from '@/lib/imaging-project-retention'
import { reconcilePendingScheduleStatus } from '@/lib/imaging-queue-reconcile'
import { deleteR2ObjectForQueueId, hasR2ObjectForQueueId } from '@/lib/r2-session-download'

const RETENTION_MS = 48 * 60 * 60 * 1000
import { hasPreviewImage, removePreviewImage } from '@/lib/imaging-preview-store'

export const runtime = 'nodejs'

export function OPTIONS() {
  return imagingCorsOptions()
}

/**
 * Queue rows (e.g. pending) + board rows (in_progress / completed after NINA download).
 * NINA still uses GET /api/imaging/queue (pending) and GET /api/imaging/nina-sequence (consume).
 */
function redactContactFields<T extends { email?: string | null; firstName?: string | null; lastName?: string | null }>(
  row: T,
  includeContact: boolean
): T {
  if (includeContact) return row
  return { ...row, email: null, firstName: null, lastName: null }
}

export async function GET(request: NextRequest) {
  const viewer = await getCurrentUser(request)
  const includeContact = viewer != null

  await reconcilePendingScheduleStatus()

  const purgedBoardIds = await boardPurgeCompletedOlderThan(RETENTION_MS)
  for (const queueId of purgedBoardIds) {
    await deleteR2ObjectForQueueId(queueId)
    await removePreviewImage(queueId)
    void appendAuditLog({
      kind: 'queue.deleted',
      message: `Session ${queueId} deleted by 48h retention trigger (current-sessions refresh).`,
      detail: { id: queueId, source: 'retention_48h_current_sessions' },
    })
  }
  const purgedProjectIds = await purgeExpiredProjectAssets(RETENTION_MS)
  for (const queueId of purgedProjectIds) {
    void appendAuditLog({
      kind: 'queue.deleted',
      message: `Project assets ${queueId} deleted by 48h retention after project completion.`,
      detail: { id: queueId, source: 'retention_48h_project_complete' },
    })
  }

  const queue = await listAll()
  const board = await listBoardEntries()

  const boardNeedsBar = board.filter(
    (b) =>
      (b.status === 'completed' || b.status === 'failed') &&
      !(typeof b.scheduleBarStartMs === 'number' && typeof b.scheduleBarEndMs === 'number')
  )
  if (boardNeedsBar.length > 0) {
    await Promise.all(boardNeedsBar.map((b) => boardEnsureScheduleBarForTerminal(b.id)))
  }

  const boardAfterBackfill = boardNeedsBar.length > 0 ? await listBoardEntries() : board

  type Row = {
    id: string
    target: string
    createdAt: string
    updatedAt: string
    status: string
    firstName?: string | null
    lastName?: string | null
    email?: string | null
    raHours?: number | null
    decDeg?: number | null
    filter?: string | null
    exposureSeconds?: number
    count?: number
    outputMode?: 'raw_zip' | 'stacked_master' | 'none'
    estimatedDurationSeconds?: number
    filterPlans?: Array<{ filterName: string; exposureSeconds: number; count: number }>
    plannedStartIso?: string | null
    scheduleReasons?: string[]
    failedAt?: string | null
    scheduleStripNightKey?: string | null
    scheduleBarStartMs?: number | null
    scheduleBarEndMs?: number | null
    hasDownload?: boolean
    downloadPath?: string
    hasPreview?: boolean
    previewPath?: string
    sessionType?: 'dso' | 'variable_star'
    projectMode?: boolean
    userId?: string | null
    projectFramesTotal?: number
    projectFramesCaptured?: number
    nights?: Array<{
      id: string
      nightIndex: number
      nightKey: string
      sessionLabel?: string
      status: string
      plannedStartIso?: string | null
      scheduleStripNightKey?: string | null
      scheduleBarStartMs?: number | null
      scheduleBarEndMs?: number | null
      failedAt?: string | null
      estimatedDurationSeconds?: number
      filterPlans?: Array<{ filterName: string; exposureSeconds: number; count: number }>
      hasDownload?: boolean
      downloadPath?: string
    }>
  }

  type ProjectNightRow = NonNullable<Row['nights']>[number]

  async function enrichProjectNights(
    nights: ProjectNightRow[] | undefined,
    outputMode: Row['outputMode']
  ): Promise<ProjectNightRow[] | undefined> {
    if (!nights) return nights
    if (outputMode === 'none') return nights
    return Promise.all(
      nights.map(async (n) => {
        if (n.status !== 'completed') return n
        const hasDownload = await hasR2ObjectForQueueId(n.id)
        if (!hasDownload) return n
        return {
          ...n,
          hasDownload: true,
          downloadPath: `/api/imaging/download?queueId=${encodeURIComponent(n.id)}`,
        }
      })
    )
  }

  const sessions: Row[] = []
  const queueIds = new Set<string>()
  const projects = await listProjects()
  const projectById = new Map(projects.map((p) => [p.id, p]))

  function projectRow(p: ImagingProject, queueStatus?: string): Row {
    const boardEntry = boardAfterBackfill.find((b) => b.id === p.id)
    const status = effectiveProjectStatus(p)
    const { total: projectFramesTotal, captured: projectFramesCaptured } = projectFrameCounts(p)
    return {
      id: p.id,
      target: p.target,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
      status,
      firstName: p.firstName ?? null,
      lastName: p.lastName ?? null,
      email: p.email ?? null,
      raHours: p.raHours,
      decDeg: p.decDeg,
      filter: p.filterPlansTotal[0]?.filterName ?? null,
      exposureSeconds: p.filterPlansTotal[0]?.exposureSeconds,
      count: p.filterPlansTotal[0]?.count,
      outputMode: p.outputMode,
      estimatedDurationSeconds: p.estimatedDurationSeconds,
      filterPlans: p.filterPlansTotal,
      plannedStartIso:
        p.nights.find((n) => n.status === 'scheduled' || n.status === 'in_progress')?.plannedStartIso ?? null,
      projectMode: true,
      userId: p.userId ?? null,
      projectFramesTotal,
      projectFramesCaptured,
      nights: p.nights.map((n: ProjectNight) => ({
        id: n.id,
        nightIndex: n.nightIndex,
        nightKey: n.nightKey,
        sessionLabel: `Session ${n.nightIndex}`,
        status: n.status === 'planned' ? 'scheduled' : n.status,
        plannedStartIso: n.plannedStartIso ?? null,
        scheduleStripNightKey: n.scheduleStripNightKey ?? null,
        scheduleBarStartMs: n.scheduleBarStartMs ?? null,
        scheduleBarEndMs: n.scheduleBarEndMs ?? null,
        failedAt: n.failedAt ?? null,
        filterPlans: n.filterPlansTonight,
        estimatedDurationSeconds: tonightDurationSecondsFromPlans(n.filterPlansTonight),
      })),
      scheduleStripNightKey: boardEntry?.scheduleStripNightKey ?? null,
      scheduleBarStartMs: boardEntry?.scheduleBarStartMs ?? null,
      scheduleBarEndMs: boardEntry?.scheduleBarEndMs ?? null,
    }
  }

  for (const r of queue) {
    const p = toPublicImagingRequest(r)
    queueIds.add(p.id)
    const project = projectById.get(p.id)
    if (project) {
      sessions.push(projectRow(project, p.status))
      continue
    }
    sessions.push({
      id: p.id,
      target: p.target,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
      status: p.status,
      firstName: p.firstName ?? null,
      lastName: p.lastName ?? null,
      email: p.email ?? null,
      raHours: p.raHours,
      decDeg: p.decDeg,
      filter: p.filter ?? null,
      exposureSeconds: p.exposureSeconds,
      count: p.count,
      outputMode: p.outputMode,
      estimatedDurationSeconds:
        typeof p.estimatedDurationSeconds === 'number' && Number.isFinite(p.estimatedDurationSeconds)
          ? p.estimatedDurationSeconds
          : undefined,
      filterPlans: Array.isArray(p.filterPlans) ? p.filterPlans : undefined,
      plannedStartIso: p.plannedStartIso ?? null,
      scheduleReasons: Array.isArray(p.scheduleReasons) ? p.scheduleReasons : undefined,
      sessionType: p.sequenceTemplate === 'variable_star' ? 'variable_star' : 'dso',
      scheduleStripNightKey: null,
      scheduleBarStartMs: null,
      scheduleBarEndMs: null,
      ...(p.projectMode ? { projectMode: true } : {}),
      userId: p.userId ?? null,
    })
  }

  for (const p of projects) {
    if (!queueIds.has(p.id) && p.onBoard) {
      queueIds.add(p.id)
      sessions.push(projectRow(p))
    }
  }

  for (const b of boardAfterBackfill) {
    if (!queueIds.has(b.id)) {
      if (projectById.has(b.id)) continue
      sessions.push({
        id: b.id,
        target: b.target,
        createdAt: b.createdAt,
        updatedAt: b.updatedAt,
        status: b.status,
        firstName: b.firstName ?? null,
        lastName: b.lastName ?? null,
        email: b.email ?? null,
        raHours: b.raHours ?? null,
        decDeg: b.decDeg ?? null,
        filter: b.filter ?? null,
        exposureSeconds: b.exposureSeconds,
        count: b.count,
        outputMode: b.outputMode,
        estimatedDurationSeconds:
          typeof b.estimatedDurationSeconds === 'number' && Number.isFinite(b.estimatedDurationSeconds)
            ? b.estimatedDurationSeconds
            : undefined,
        filterPlans: Array.isArray(b.filterPlans) ? b.filterPlans : undefined,
        failedAt: b.failedAt ?? null,
        scheduleStripNightKey: b.scheduleStripNightKey ?? null,
        scheduleBarStartMs:
          typeof b.scheduleBarStartMs === 'number' && Number.isFinite(b.scheduleBarStartMs)
            ? b.scheduleBarStartMs
            : null,
        scheduleBarEndMs:
          typeof b.scheduleBarEndMs === 'number' && Number.isFinite(b.scheduleBarEndMs)
            ? b.scheduleBarEndMs
            : null,
        userId: b.userId ?? null,
      })
    }
  }

  sessions.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))

  const enriched = await Promise.all(
    sessions.map(async (s) => {
      if (s.projectMode) {
        const nights = await enrichProjectNights(s.nights, s.outputMode)
        const hasDownload =
          s.outputMode !== 'none' && (nights?.some((n) => n.hasDownload === true) ?? false)
        const hasPreview = await hasPreviewImage(s.id)
        return {
          ...s,
          nights,
          ...(hasDownload ? { hasDownload: true as const } : {}),
          ...(hasPreview ? { hasPreview: true, previewPath: `/api/imaging/preview?queueId=${encodeURIComponent(s.id)}` } : {}),
        }
      }
      if (s.outputMode === 'none') {
        return s
      }
      const hasDownload = await hasR2ObjectForQueueId(s.id)
      const hasPreview = await hasPreviewImage(s.id)
      return {
        ...s,
        ...(hasDownload ? { hasDownload: true, downloadPath: `/api/imaging/download?queueId=${encodeURIComponent(s.id)}` } : {}),
        ...(hasPreview ? { hasPreview: true, previewPath: `/api/imaging/preview?queueId=${encodeURIComponent(s.id)}` } : {}),
      }
    })
  )

  const sessionsOut = enriched.map((s) => redactContactFields(s, includeContact))

  return withImagingCors({ ok: true as const, sessions: sessionsOut })
}
