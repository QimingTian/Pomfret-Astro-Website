import { listSessionProgressLines } from '@/lib/imaging/core/session-progress-store'
import { authorizeImagingSession, resolveImagingSessionContext } from '@/lib/imaging-session-access'
import { imagingCorsOptions, withImagingCors } from '@/lib/imaging-queue-auth'
import type { NextRequest } from 'next/server'
import { runWithRequestSite } from '@/lib/imaging/run-with-request-site'
import { getProjectById, patchProject, ensureMosaicPanelRemaining, type ImagingProject } from '@/lib/imaging-project-store'
import { projectFilterFrameProgress } from '@/lib/imaging-total-frames'
import { reconcilePendingScheduleStatus } from '@/lib/imaging-queue-reconcile'
import { appendAuditLog } from '@/lib/imaging-audit-log'

export const runtime = 'nodejs'

export function OPTIONS() {
  return imagingCorsOptions()
}

/** Edit captured frame counts for a project, then rebuild its future schedule. */
export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  return runWithRequestSite(request, async () => {
    const id = params.id
    if (!id) return withImagingCors({ ok: false as const, error: 'Missing id' }, 400)
    const providedPassword = request.headers.get('x-session-password')?.trim() || null
    const auth = await authorizeImagingSession(request, id, providedPassword)
    if (!auth.ok) return withImagingCors({ ok: false as const, error: auth.error }, auth.status)
    const project = await getProjectById(id)
    if (!project) return withImagingCors({ ok: false as const, error: 'Project not found' }, 404)
    let body: unknown
    try { body = await request.json() } catch {
      return withImagingCors({ ok: false as const, error: 'Invalid JSON' }, 400)
    }
    const capturedByRow = (body as { capturedByRow?: unknown } | null)?.capturedByRow
    if (!Array.isArray(capturedByRow) || !capturedByRow.every((value) => Number.isInteger(value) && value >= 0)) {
      return withImagingCors({ ok: false as const, error: 'capturedByRow must be an array of non-negative integers' }, 400)
    }
    const rows = projectFilterFrameProgress(project)
    if (capturedByRow.length !== rows.length || capturedByRow.some((count, index) => count > rows[index]!.total)) {
      return withImagingCors({ ok: false as const, error: 'Frame counts do not match the current project progress.' }, 400)
    }
    const remainingFrames = rows.reduce((sum, row, index) => sum + row.total - (capturedByRow[index] as number), 0)
    const status = remainingFrames === 0 ? 'completed' : project.status === 'completed' ? 'in_progress' : project.status
    if (project.mosaicMode && project.mosaicPanels?.length) {
      const panelRemaining = ensureMosaicPanelRemaining(project)
      let rowIndex = 0
      for (let panelIndex = 0; panelIndex < project.mosaicPanels.length; panelIndex++) {
        for (const plan of project.mosaicFilterPlansByPanel?.[panelIndex] ?? []) {
          if (Math.max(0, Math.round(Number(plan.count) || 0)) <= 0) continue
          const count = capturedByRow[rowIndex++] as number
          const remaining = panelRemaining[panelIndex]?.find((row) => row.filterName === plan.filterName)
          if (remaining) remaining.countRemaining = Math.max(0, plan.count - count)
        }
      }
      await patchProject(id, { status, mosaicRemainingByPanel: panelRemaining, remainingByFilter: projectFilterRemainingSummary(project, panelRemaining) })
    } else {
      const remainingByFilter = project.remainingByFilter.map((remaining, index) => ({
        ...remaining,
        countRemaining: Math.max(0, rows[index]!.total - (capturedByRow[index] as number)),
      }))
      await patchProject(id, { status, remainingByFilter })
    }
    await reconcilePendingScheduleStatus({ force: true })
    void appendAuditLog({ kind: 'project.progress.edited', message: `Project ${project.target} frame progress was adjusted.`, detail: { id, capturedByRow } })
    const updated = await getProjectById(id)
    return withImagingCors({ ok: true as const, projectFilterProgress: updated ? projectFilterFrameProgress(updated) : rows }, 200)
  })
}

function projectFilterRemainingSummary(
  project: ImagingProject,
  panelRemaining: ReturnType<typeof ensureMosaicPanelRemaining>
) {
  return project.filterPlansTotal.map((plan) => ({
    filterName: plan.filterName,
    exposureSeconds: plan.exposureSeconds,
    countRemaining: panelRemaining.reduce((sum, rows) => sum + (rows.find((row) => row.filterName === plan.filterName)?.countRemaining ?? 0), 0),
  }))
}

/** Live lines for Remote "terminal" (no auth for now). */
export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  return runWithRequestSite(request, async () => {
  const id = params.id
  if (!id) {
    return withImagingCors({ ok: false as const, error: 'Missing id' }, 400)
  }

  const providedPassword = request.headers.get('x-session-password')?.trim() || null
  const auth = await authorizeImagingSession(request, id, providedPassword)
  if (!auth.ok) {
    return withImagingCors({ ok: false as const, error: auth.error }, auth.status)
  }

  const session = await resolveImagingSessionContext(id)
  if (!session) {
    return withImagingCors({ ok: false as const, error: 'Not found' }, 404)
  }

  const lines = await listSessionProgressLines(id)
  const queueStatus = session.queueStatus
  const adminApprovalPending = session.req?.adminApprovalPending === true

  return withImagingCors({
    ok: true as const,
    queueStatus,
    adminApprovalPending,
    lines,
  })
  })
}
