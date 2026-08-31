/**
 * Dark basemap for Leaflet radar maps.
 *
 * CARTO raster tiles now watermark requests without an API key (2025+ policy).
 * Set NEXT_PUBLIC_CARTO_API_KEY for the original Carto dark style; otherwise Esri dark canvas.
 */

export type MapBasemapKind = 'carto' | 'esri'

export function resolveRadarBasemap(): { url: string; kind: MapBasemapKind; subdomains?: string; maxZoom: number } {
  const key = process.env.NEXT_PUBLIC_CARTO_API_KEY?.trim()
  if (key) {
    return {
      kind: 'carto',
      url: `https://{s}.basemaps.cartocdn.com/rastertiles/dark_nolabels/{z}/{x}/{y}{r}.png?key=${encodeURIComponent(key)}`,
      subdomains: 'abcd',
      maxZoom: 19,
    }
  }
  return {
    kind: 'esri',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}',
    maxZoom: 16,
  }
}
