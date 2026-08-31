export const NOAA_GOES_CDN_HOST = 'cdn.star.nesdis.noaa.gov'
export const NOAA_GOES_GEOCOLOR_DIR = '/GOES19/ABI/CONUS/GEOCOLOR/'
export const NOAA_GOES_GEOCOLOR_INDEX_URL = `https://${NOAA_GOES_CDN_HOST}${NOAA_GOES_GEOCOLOR_DIR}`

/** CONUS GeoColor 625×375 frames: `YYYYDDDHHMM_GOES19-ABI-CONUS-GEOCOLOR-625x375.jpg` */
export const GEOCOLOR_FRAME_FILENAME_RE =
  /^(\d{11})_GOES19-ABI-CONUS-GEOCOLOR-625x375\.jpg$/

export const GEOCOLOR_FRAME_PATH_RE =
  /^\/GOES19\/ABI\/CONUS\/GEOCOLOR\/\d{11}_GOES19-ABI-CONUS-GEOCOLOR-625x375\.jpg$/

/** Recent frames to animate (~2 h at 5 min cadence). */
export const GEOCOLOR_FRAME_LIMIT = 24

export function resolveNoaaGoesUrl(raw: string | null): string | null {
  if (!raw?.trim()) return null

  let parsed: URL
  try {
    parsed = new URL(raw.trim())
  } catch {
    return null
  }
  if (parsed.protocol !== 'https:') return null
  if (parsed.hostname.toLowerCase() !== NOAA_GOES_CDN_HOST) return null
  if (!GEOCOLOR_FRAME_PATH_RE.test(parsed.pathname)) return null
  return parsed.toString()
}

export function parseGeocolorFrameFilenames(html: string): string[] {
  const names = new Set<string>()
  const re = /(\d{11}_GOES19-ABI-CONUS-GEOCOLOR-625x375\.jpg)/g
  let match: RegExpExecArray | null
  while ((match = re.exec(html)) !== null) {
    const name = match[1]
    if (name && GEOCOLOR_FRAME_FILENAME_RE.test(name)) names.add(name)
  }
  return Array.from(names).sort()
}

export function geocolorFramePaths(filenames: string[], limit = GEOCOLOR_FRAME_LIMIT): string[] {
  const slice = filenames.slice(-limit)
  return slice.map((name) => `${NOAA_GOES_GEOCOLOR_DIR}${name}`)
}

export function noaaGoesProxyUrl(path: string): string {
  const upstream = `https://${NOAA_GOES_CDN_HOST}${path}`
  return `/api/noaa-goes?url=${encodeURIComponent(upstream)}`
}

/**
 * Approximate geographic extent of NESDIS GOES-East CONUS GeoColor 625×375 previews.
 * Tuned so New England stays inside the NE `scale(2)` crop used by Cloud Map.
 */
export const GEOCOLOR_CONUS_BOUNDS = {
  westLon: -126,
  eastLon: -55,
  northLat: 52,
  southLat: 15,
} as const

/**
 * CSS crop on Cloud Map: `object-cover` into 4:3, then `scale(2)` from top-right.
 * Returns pin position as % of the visible container, or null if off-frame.
 */
export function geocolorSitePinPercent(
  lat: number,
  lon: number
): { leftPct: number; topPct: number } | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null
  const { westLon, eastLon, northLat, southLat } = GEOCOLOR_CONUS_BOUNDS
  const fx = (lon - westLon) / (eastLon - westLon)
  const fy = (northLat - lat) / (northLat - southLat)
  if (fx < 0 || fx > 1 || fy < 0 || fy > 1) return null

  // object-cover into 4:3 from 5:3 image → crop 10% from each side of width.
  const coverWest = 0.1
  const coverEast = 0.9
  // scale(2) from top-right → visible is right half × top half of the covered paint.
  const visWest = coverWest + 0.5 * (coverEast - coverWest)
  const visEast = coverEast
  const visNorth = 0
  const visSouth = 0.5

  if (fx < visWest || fx > visEast || fy < visNorth || fy > visSouth) return null

  const leftPct = ((fx - visWest) / (visEast - visWest)) * 100
  const topPct = ((fy - visNorth) / (visSouth - visNorth)) * 100
  return { leftPct, topPct }
}

/** Parse UTC observation time from GeoColor frame path or filename (`YYYY` + Julian `DDD` + `HHMM`). */
export function parseGeocolorFrameUtc(pathOrName: string): Date | null {
  const basename = pathOrName.split('/').pop() ?? pathOrName
  const match = GEOCOLOR_FRAME_FILENAME_RE.exec(basename)
  if (!match?.[1] || match[1].length !== 11) return null

  const stamp = match[1]
  const year = Number(stamp.slice(0, 4))
  const dayOfYear = Number(stamp.slice(4, 7))
  const hour = Number(stamp.slice(7, 9))
  const minute = Number(stamp.slice(9, 11))

  if (
    !Number.isFinite(year) ||
    !Number.isFinite(dayOfYear) ||
    dayOfYear < 1 ||
    dayOfYear > 366 ||
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59
  ) {
    return null
  }

  const ms = Date.UTC(year, 0, 1) + (dayOfYear - 1) * 86_400_000 + hour * 3_600_000 + minute * 60_000
  const date = new Date(ms)
  return Number.isNaN(date.getTime()) ? null : date
}
