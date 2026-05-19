import {
  getActiveOnBoardProject,
  getProjectById,
  listProjects,
  type ImagingProject,
} from '@/lib/imaging-project-store'
import { listPending } from '@/lib/imaging-queue-store'

export function nightKeyFromDusk(dusk: Date): string {
  const y = dusk.getFullYear()
  const m = String(dusk.getMonth() + 1).padStart(2, '0')
  const day = String(dusk.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function isPlannedTonight(
  plannedStartIso: string,
  nightStartMs: number,
  deadlineMs: number
): boolean {
  const ms = Date.parse(plannedStartIso)
  return Number.isFinite(ms) && ms >= nightStartMs && ms < deadlineMs
}

/** Sub-sessions tonight that NINA can still receive (in progress or scheduled with JSON). */
export function hasDeliverableTonightSubs(project: ImagingProject, nightKey: string): boolean {
  return project.nights.some(
    (n) =>
      n.nightKey === nightKey &&
      (n.status === 'in_progress' || n.status === 'scheduled') &&
      !!n.ninaSequenceJson
  )
}

/**
 * True while something still needs imaging tonight (deliverable project subs or a
 * normal queue row planned for this strip night). Ignores queue rows for projects
 * whose tonight subs are already finished (row may linger while active target is ≥30°).
 */
export async function hasRemainingTonightImagingWork(
  nightKey: string,
  nightStartMs: number,
  deadlineMs: number,
  activeOnBoard?: ImagingProject | null
): Promise<boolean> {
  const active = activeOnBoard ?? (await getActiveOnBoardProject())
  if (active && hasDeliverableTonightSubs(active, nightKey)) return true

  const projects = await listProjects()
  for (const p of projects) {
    if (active && p.id === active.id) continue
    if (p.status !== 'in_progress' && p.status !== 'pending') continue
    if (hasDeliverableTonightSubs(p, nightKey)) return true
  }

  const pending = await listPending()
  for (const r of pending) {
    if (r.status !== 'scheduled' || r.plannedStartIso == null) continue
    if (!isPlannedTonight(r.plannedStartIso, nightStartMs, deadlineMs)) continue
    if (r.projectMode) {
      const p = await getProjectById(r.id)
      if (p && hasDeliverableTonightSubs(p, nightKey)) return true
    } else {
      return true
    }
  }
  return false
}
