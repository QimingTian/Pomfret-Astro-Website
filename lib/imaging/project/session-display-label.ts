/** Display label for project sub-sessions (mosaic uses Panel-Sub form). */
export function projectSessionDisplayLabel(night: {
  nightIndex: number
  mosaicPanelIndex?: number
  mosaicSubIndex?: number
}): string {
  if (night.mosaicPanelIndex != null && night.mosaicSubIndex != null) {
    return `Session ${night.mosaicPanelIndex}-${night.mosaicSubIndex}`
  }
  return `Session ${night.nightIndex}`
}
