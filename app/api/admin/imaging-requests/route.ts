import { NextRequest, NextResponse } from 'next/server'
import { appendAuditLog } from '@/lib/imaging-audit-log'
import { deleteProjectCascade } from '@/lib/imaging-project-delete'
import { formatImagingDurationHours } from '@/lib/imaging/large-project-approval'
import { reconcilePendingScheduleStatus } from '@/lib/imaging-queue-reconcile'
import {
  getRequestById,
  listQueueAwaitingAdminApproval,
  setRequestAdminApprovalPending,
} from '@/lib/imaging-queue-store'
import {
  getProjectById,
  listProjectsAwaitingAdminApproval,
  setProjectAdminApprovalPending,
} from '@/lib/imaging-project-store'
import { checkAuthRateLimitAsync } from '@/lib/auth-rate-limit'
import { isSameSiteMutation } from '@/lib/csrf-origin'
import { runWithRequestSite } from '@/lib/imaging/run-with-request-site'
import { requireImagingAdmin } from '@/lib/imaging/core/admin-auth'
import { listMembersForAdminDirectory, setMemberImagingApproval } from '@/lib/member-store'

export const runtime = 'nodejs'

type MemberRow = {
  kind: 'member_access'
  id: string
  firstName: string
  lastName: string
  email: string
  createdAt: string
}

type LargeProjectRow = {
  kind: 'large_project'
  id: string
  target: string
  submitterLabel: string
  email: string | null
  estimatedDurationSeconds: number
  durationLabel: string
  filterSummary: string
  createdAt: string
}

function submitterLabel(firstName?: string | null, lastName?: string | null, email?: string | null): string {
  const name = [firstName, lastName].filter(Boolean).join(' ').trim()
  return name || email?.trim() || '—'
}

function filterSummaryFromPlans(
  plans: Array<{ filterName: string; exposureSeconds: number; count: number }> | undefined
): string {
  if (!Array.isArray(plans) || plans.length === 0) return '—'
  return plans.map((p) => `${p.filterName} ${p.count}×${p.exposureSeconds}s`).join('; ')
}

/** GET — pending member imaging access + large project approvals for the active site. */
export async function GET(request: NextRequest) {
  return runWithRequestSite(request, async (site) => {
    const auth = await requireImagingAdmin(request, site.id)
    if (!auth.ok) {
      return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status })
    }

    const members: MemberRow[] = (await listMembersForAdminDirectory())
      .filter(
        (m) =>
          m.imagingPending &&
          m.memberships.some((ms) => ms.siteId === site.id)
      )
      .map((m) => ({
        kind: 'member_access' as const,
        id: m.id,
        firstName: m.firstName,
        lastName: m.lastName,
        email: m.email,
        createdAt: '',
      }))

    const queuePending = await listQueueAwaitingAdminApproval()
    const projectsPending = await listProjectsAwaitingAdminApproval()
    const projectById = new Map(projectsPending.map((p) => [p.id, p]))

    const largeProjects: LargeProjectRow[] = queuePending.map((r) => {
      const project = projectById.get(r.id)
      const seconds =
        typeof r.estimatedDurationSeconds === 'number' && Number.isFinite(r.estimatedDurationSeconds)
          ? r.estimatedDurationSeconds
          : project?.estimatedDurationSeconds ?? 0
      const plans = r.filterPlans ?? project?.filterPlansTotal
      return {
        kind: 'large_project' as const,
        id: r.id,
        target: r.target,
        submitterLabel: submitterLabel(r.firstName, r.lastName, r.email),
        email: r.email ?? null,
        estimatedDurationSeconds: seconds,
        durationLabel: formatImagingDurationHours(Math.max(seconds, 1)),
        filterSummary: filterSummaryFromPlans(plans),
        createdAt: r.createdAt,
      }
    })

    return NextResponse.json({
      ok: true as const,
      memberRequests: members,
      largeProjectRequests: largeProjects,
      total: members.length + largeProjects.length,
    })
  })
}

/** PATCH — approve/reject member imaging access or large project. Admin only. */
export async function PATCH(request: NextRequest) {
  return runWithRequestSite(request, async (site) => {
    const auth = await requireImagingAdmin(request, site.id)
    if (!auth.ok) {
      return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status })
    }
  if (!(await checkAuthRateLimitAsync(request, 'admin-imaging-requests', 30))) {
    return NextResponse.json({ ok: false, error: 'Too many requests. Try again later.' }, { status: 429 })
  }
  if (!isSameSiteMutation(request)) {
    return NextResponse.json({ ok: false, error: 'Invalid request origin.' }, { status: 403 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON body' }, { status: 400 })
  }

  const rec = body && typeof body === 'object' ? (body as Record<string, unknown>) : {}
  const kind = rec.kind
  const id = typeof rec.id === 'string' ? rec.id.trim() : ''
  const action = rec.action

  if (!id || (action !== 'approve' && action !== 'reject')) {
    return NextResponse.json({ ok: false, error: 'id and action (approve|reject) are required.' }, { status: 400 })
  }

  if (kind === 'member_access') {
    const result = await setMemberImagingApproval(id, action)
    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.error }, { status: 400 })
    }
    void appendAuditLog({
      kind: 'member.imaging_access',
      message: `Member imaging access ${action}d (${id}).`,
      detail: { memberId: id, action },
    })
    return NextResponse.json({ ok: true as const })
  }

  if (kind === 'large_project') {
    const req = await getRequestById(id)
    const project = await getProjectById(id)
    if (!req?.adminApprovalPending && !project?.adminApprovalPending) {
      return NextResponse.json({ ok: false, error: 'Large project approval request not found.' }, { status: 404 })
    }

    if (action === 'reject') {
      await deleteProjectCascade(id)
      void appendAuditLog({
        kind: 'queue.admin_approval_rejected',
        message: `Large project rejected by admin: ${req?.target ?? project?.target ?? id}.`,
        detail: { id, target: req?.target ?? project?.target ?? null },
      })
      return NextResponse.json({ ok: true as const })
    }

    await setRequestAdminApprovalPending(id, false)
    await setProjectAdminApprovalPending(id, false)
    await reconcilePendingScheduleStatus({ force: true })
    void appendAuditLog({
      kind: 'queue.admin_approval_granted',
      message: `Large project approved by admin: ${req?.target ?? project?.target ?? id}.`,
      detail: { id, target: req?.target ?? project?.target ?? null },
    })
    return NextResponse.json({ ok: true as const })
  }

  return NextResponse.json({ ok: false, error: 'kind must be member_access or large_project.' }, { status: 400 })
  })
}
