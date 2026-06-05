import { listAuditLog } from '@/lib/imaging-audit-log'
import { parseProjectNightSubId } from '@/lib/imaging-project-ids'
import { getTonightScheduleStrip } from '@/lib/schedule-strip'
import {
  buildNightNinaJson,
  dedupeProjectNights,
  getProjectById,
  patchProject,
  type FilterPlanRow,
  type ProjectNight,
} from '@/lib/imaging-project-store'

function filterPlansFromDetail(d: Record<string, unknown>): FilterPlanRow[] | null {
  const raw = d.filterPlansTonight
  if (!Array.isArray(raw)) return null
  const out: FilterPlanRow[] = []
  for (const row of raw) {
    if (!row || typeof row !== 'object') return null
    const rec = row as Record<string, unknown>
    if (typeof rec.filterName !== 'string') return null
    const exposureSeconds = Number(rec.exposureSeconds)
    const count = Number(rec.count)
    if (!Number.isFinite(exposureSeconds) || !Number.isFinite(count)) return null
    out.push({ filterName: rec.filterName, exposureSeconds, count })
  }
  return out.length > 0 ? out : null
}

function auditDetailMatchesNightSub(d: Record<string, unknown>, sessionId: string): boolean {
  return d.nightSubId === sessionId || d.subSessionId === sessionId || d.id === sessionId
}

/** Last audit row with filter plans for this sub-session (schedule or NINA delivery). */
async function lastAuditSnapshotForNightSub(sessionId: string): Promise<Record<string, unknown> | null> {
  const entries = await listAuditLog(400)
  for (const e of entries) {
    const d = e.detail
    if (!d || typeof d !== 'object' || Array.isArray(d)) continue
    const rec = d as Record<string, unknown>
    if (!auditDetailMatchesNightSub(rec, sessionId)) continue
    if (filterPlansFromDetail(rec)) return rec
  }
  return null
}

/**
 * Re-insert a project sub-session row removed by reconcile (scheduled -> unscheduled).
 * Uses the newest audit snapshot with filterPlansTonight for that night id.
 */
export async function restoreProjectNightSubFromAudit(sessionId: string): Promise<ProjectNight | null> {
  const parsed = parseProjectNightSubId(sessionId)
  if (!parsed) return null
  const project = await getProjectById(parsed.projectId)
  if (!project) return null

  const existing = project.nights.find((n) => n.id === sessionId)
  if (existing) return existing

  const snapshot = await lastAuditSnapshotForNightSub(sessionId)
  if (!snapshot) return null

  const filterPlansTonight = filterPlansFromDetail(snapshot)
  if (!filterPlansTonight) return null

  const nightKey =
    typeof snapshot.nightKey === 'string' ? snapshot.nightKey : getTonightScheduleStrip().nightKey
  const nightIndex =
    typeof snapshot.nightIndex === 'number' && Number.isFinite(snapshot.nightIndex)
      ? snapshot.nightIndex
      : parsed.nightIndex
  const plannedStartIso =
    typeof snapshot.plannedStartIso === 'string' ? snapshot.plannedStartIso : null

  const night: ProjectNight = {
    id: sessionId,
    nightKey,
    nightIndex,
    status: 'failed',
    filterPlansTonight,
    ninaSequenceJson: buildNightNinaJson(project, sessionId, filterPlansTonight),
    plannedStartIso,
    failedAt: new Date().toISOString(),
  }

  const nights = dedupeProjectNights([...project.nights, night]).sort((a, b) => a.nightIndex - b.nightIndex)
  await patchProject(parsed.projectId, { nights })
  return night
}
