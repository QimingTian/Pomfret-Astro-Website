'use client'

import { useImagingRigs } from './use-imaging-rigs'
import type { ImagingEquipment } from './equipment'

/** Selected imaging rig for Plan / framing overlays. */
export function useEquipment(): ImagingEquipment | null {
  const { selectedRig } = useImagingRigs()
  return selectedRig
}

export { useImagingRigs } from './use-imaging-rigs'
