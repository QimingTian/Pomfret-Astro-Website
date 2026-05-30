import { getProjectByNightSubId } from '@/lib/imaging-project-store'
import { getRequestById } from '@/lib/imaging-queue-store'
import { getBoardEntry } from '@/lib/imaging-session-board'

export type FilterPlanLike = { filterName: string; exposureSeconds: number; count: number }

/** Sum of `count` across plans (lights sub-frames), or null if unknown / zero. */
export function totalFramesFromFilterPlans(plans: FilterPlanLike[] | undefined | null): number | null {
  if (!plans?.length) return null
  let sum = 0
  for (const p of plans) {
    const c = Math.round(Number(p.count))
    if (Number.isFinite(c) && c > 0) sum += c
  }
  return sum > 0 ? sum : null
}

/** Project-wide light frames: total at submission vs remaining in store. */
export function projectFrameCounts(project: {
  filterPlansTotal: FilterPlanLike[]
  remainingByFilter: Array<{ countRemaining: number }>
}): { total: number; captured: number } {
  const total = totalFramesFromFilterPlans(project.filterPlansTotal) ?? 0
  const remaining = project.remainingByFilter.reduce(
    (sum, r) => sum + Math.max(0, Math.round(Number(r.countRemaining) || 0)),
    0
  )
  const captured = Math.max(0, total - remaining)
  return { total, captured }
}

/** After queue consume, plans live on the session board; before that, on the queue row. */
export async function totalExposureFramesForQueueId(queueId: string): Promise<number | null> {
  const req = await getRequestById(queueId)
  const fromReq = totalFramesFromFilterPlans(req?.filterPlans)
  if (fromReq != null) return fromReq
  const board = await getBoardEntry(queueId)
  const fromBoard = totalFramesFromFilterPlans(board?.filterPlans)
  if (fromBoard != null) return fromBoard
  const match = await getProjectByNightSubId(queueId)
  return totalFramesFromFilterPlans(match?.night.filterPlansTonight)
}
