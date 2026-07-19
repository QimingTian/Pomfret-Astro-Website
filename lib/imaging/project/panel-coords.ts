/** Resolve RA/Dec for a mosaic panel (1-based) or fall back to project center. */
export function skyCoordsForMosaicPanel(
  project: {
    raHours: number
    decDeg: number
    mosaicMode?: boolean
    mosaicPanels?: ReadonlyArray<{ raHours: number; decDeg: number }> | null
  },
  panelIndex1Based: number | null | undefined,
): { raHours: number; decDeg: number } {
  const panels = project.mosaicPanels
  if (
    project.mosaicMode &&
    Array.isArray(panels) &&
    panels.length > 0 &&
    typeof panelIndex1Based === 'number' &&
    Number.isFinite(panelIndex1Based)
  ) {
    const panelIdx = Math.max(0, Math.min(panels.length - 1, Math.round(panelIndex1Based) - 1))
    const panel = panels[panelIdx]
    if (panel && Number.isFinite(panel.raHours) && Number.isFinite(panel.decDeg)) {
      return { raHours: panel.raHours, decDeg: panel.decDeg }
    }
  }
  return { raHours: project.raHours, decDeg: project.decDeg }
}
