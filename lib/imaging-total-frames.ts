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

/** After queue consume, plans live on the session board; before that, on the queue row. */
export async function totalExposureFramesForQueueId(queueId: string): Promise<number | null> {
  const req = await getRequestById(queueId)
  const fromReq = totalFramesFromFilterPlans(req?.filterPlans)
  if (fromReq != null) return fromReq
  const board = await getBoardEntry(queueId)
  return totalFramesFromFilterPlans(board?.filterPlans)
}
