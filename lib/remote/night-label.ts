import { projectSessionDisplayLabel } from '@/lib/imaging/project/session-display-label'

export function nightDisplayLabel(night: {
  nightIndex: number
  sessionLabel?: string
  mosaicPanelIndex?: number
  mosaicSubIndex?: number
}): string {
  if (typeof night.sessionLabel === 'string' && night.sessionLabel.trim()) return night.sessionLabel.trim()
  return projectSessionDisplayLabel(night)
}
