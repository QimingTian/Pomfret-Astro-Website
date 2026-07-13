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

export type FilterFrameProgress = {
  filterName: string
  total: number
  captured: number
}

/** Per-filter light frame progress for project mode UI. Mosaic rows are `Panel N -- Filter`. */
export function projectFilterFrameProgress(project: {
  filterPlansTotal: FilterPlanLike[]
  remainingByFilter: Array<{ filterName: string; countRemaining: number }>
  mosaicMode?: boolean
  mosaicPanels?: Array<{ id: number; name?: string }>
  mosaicFilterPlansByPanel?: FilterPlanLike[][]
  mosaicRemainingByPanel?: Array<Array<{ filterName: string; countRemaining: number }>>
}): FilterFrameProgress[] {
  if (
    project.mosaicMode &&
    project.mosaicPanels?.length &&
    project.mosaicFilterPlansByPanel?.length === project.mosaicPanels.length &&
    project.mosaicRemainingByPanel?.length === project.mosaicPanels.length
  ) {
    const rows: FilterFrameProgress[] = []
    for (let i = 0; i < project.mosaicPanels.length; i++) {
      const panel = project.mosaicPanels[i]!
      const label = (panel.name?.trim() || `Panel ${panel.id}`).trim()
      const totals = project.mosaicFilterPlansByPanel[i] ?? []
      const remainingRows = project.mosaicRemainingByPanel[i] ?? []
      const remainingByName = new Map<string, number>()
      for (const row of remainingRows) {
        remainingByName.set(
          row.filterName,
          Math.max(0, Math.round(Number(row.countRemaining) || 0)),
        )
      }
      for (const plan of totals) {
        const total = Math.max(0, Math.round(Number(plan.count) || 0))
        if (total <= 0) continue
        const remaining = remainingByName.get(plan.filterName) ?? total
        const captured = Math.max(0, Math.min(total, total - remaining))
        rows.push({
          filterName: `${label} -- ${plan.filterName}`,
          total,
          captured,
        })
      }
    }
    return rows
  }

  const remainingByName = new Map<string, number>()
  for (const row of project.remainingByFilter) {
    remainingByName.set(
      row.filterName,
      Math.max(0, Math.round(Number(row.countRemaining) || 0))
    )
  }
  return project.filterPlansTotal
    .map((plan) => {
      const total = Math.max(0, Math.round(Number(plan.count) || 0))
      if (total <= 0) return null
      const remaining = remainingByName.get(plan.filterName) ?? total
      const captured = Math.max(0, Math.min(total, total - remaining))
      return { filterName: plan.filterName, total, captured }
    })
    .filter((row): row is FilterFrameProgress => row != null)
}

/** Project-wide light frames: total at submission vs remaining in store. */
export function projectFrameCounts(project: {
  filterPlansTotal: FilterPlanLike[]
  remainingByFilter: Array<{ filterName: string; countRemaining: number }>
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
