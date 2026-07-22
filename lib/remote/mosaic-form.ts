import type { MosaicDraft, MosaicPanel } from '@/lib/mosaic/framing-rectangle'

export type FilterPlanFormRow = { filterName: string; count: string; exposureSeconds: string }

export function cloneFilterPlanForms(plans: FilterPlanFormRow[]): FilterPlanFormRow[] {
  return plans.map((p) => ({ ...p }))
}

export function buildMosaicPanel(id: number, raHours: number, decDeg: number): MosaicPanel {
  return {
    id,
    raHours,
    decDeg,
    positionAngleDeg: 0,
    name: `Panel ${id}`,
    screenDeltaXPx: 0,
    screenDeltaYPx: 0,
  }
}

export function mosaicDraftFromCoords(
  panels: MosaicPanel[],
  targetName: string,
  centerRaHours: number,
  centerDecDeg: number,
  equipmentSnapshot: unknown = null,
): MosaicDraft {
  return {
    targetName,
    panels,
    equipmentSnapshot,
    centerRaHours,
    centerDecDeg,
  }
}

export function toMosaicDraftPanel(p: {
  id: number
  raHours: number
  decDeg: number
  positionAngleDeg?: number
  name?: string
}): MosaicPanel {
  return {
    id: p.id,
    raHours: p.raHours,
    decDeg: p.decDeg,
    positionAngleDeg: typeof p.positionAngleDeg === 'number' ? p.positionAngleDeg : 0,
    name: typeof p.name === 'string' && p.name.trim() ? p.name : `Panel ${p.id}`,
    screenDeltaXPx: 0,
    screenDeltaYPx: 0,
  }
}
