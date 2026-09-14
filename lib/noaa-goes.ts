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

/** GOES-East ABI perspective (GOES-16/19). */
const GOES_EAST_LON0_DEG = -75.2
const GOES_REQ_M = 6_378_137.0
const GOES_RPOL_M = 6_356_752.31414
const GOES_H_M = 42_164_160.0
const GOES_E2 = (GOES_REQ_M ** 2 - GOES_RPOL_M ** 2) / GOES_REQ_M ** 2

/**
 * NESDIS CONUS GeoColor sector in ABI fixed-grid scan angles (radians).
 * Matches GOES-R CONUS L1b image bounds (north at top of the JPG).
 */
export const GEOCOLOR_CONUS_SCAN = {
  xWest: -0.101332,
  xEast: 0.038612,
  yNorth: 0.128212,
  ySouth: 0.044248,
} as const

/** @deprecated Linear lon/lat box — kept only for tests/compat; pin math uses {@link GEOCOLOR_CONUS_SCAN}. */
export const GEOCOLOR_CONUS_BOUNDS = {
  westLon: -126,
  eastLon: -55,
  northLat: 52,
  southLat: 15,
} as const

/** Geographic → GOES-East ABI fixed-grid scan angles (radians). */
export function geocolorLatLonToScan(latDeg: number, lonDeg: number): { x: number; y: number } | null {
  if (!Number.isFinite(latDeg) || !Number.isFinite(lonDeg)) return null
  if (latDeg <= -90 || latDeg >= 90) return null

  const lat = (latDeg * Math.PI) / 180
  const lon = (lonDeg * Math.PI) / 180
  const lon0 = (GOES_EAST_LON0_DEG * Math.PI) / 180

  const latc = Math.atan((GOES_RPOL_M ** 2 / GOES_REQ_M ** 2) * Math.tan(lat))
  const rc = GOES_RPOL_M / Math.sqrt(1 - GOES_E2 * Math.cos(latc) ** 2)
  const sx = GOES_H_M - rc * Math.cos(latc) * Math.cos(lon - lon0)
  const sy = -rc * Math.cos(latc) * Math.sin(lon - lon0)
  const sz = rc * Math.sin(latc)

  if (!(sx > 0)) return null
  const x = Math.atan(-sy / sx)
  const y = Math.asin(sz / Math.sqrt(sx * sx + sy * sy + sz * sz))
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null
  return { x, y }
}

/**
 * object-cover into 4:3 from 5:3 GeoColor → crop 10% from each side of width.
 * Returns site position as fractions of the covered element box, or null if off CONUS / cropped out.
 */
export function geocolorSiteInCoverFrame(
  lat: number,
  lon: number
): { x: number; y: number } | null {
  const scan = geocolorLatLonToScan(lat, lon)
  if (!scan) return null

  const { xWest, xEast, yNorth, ySouth } = GEOCOLOR_CONUS_SCAN
  const fx = (scan.x - xWest) / (xEast - xWest)
  const fy = (yNorth - scan.y) / (yNorth - ySouth)
  if (fx < 0 || fx > 1 || fy < 0 || fy > 1) return null

  const coverWest = 0.1
  const coverEast = 0.9
  if (fx < coverWest || fx > coverEast) return null

  return {
    x: (fx - coverWest) / (coverEast - coverWest),
    y: fy,
  }
}

export const GEOCOLOR_VIEW_SCALE = 2

/**
 * Cloud Map CSS: `object-cover` into 4:3, then scale centered on the observatory.
 * Pin sits at the viewport center when the site is on CONUS.
 */
export function geocolorSiteView(
  lat: number,
  lon: number
): {
  transformOrigin: string
  transform: string
  pinLeftPct: number
  pinTopPct: number
} | null {
  const p = geocolorSiteInCoverFrame(lat, lon)
  if (!p) return null
  const ox = p.x * 100
  const oy = p.y * 100
  const tx = (0.5 - p.x) * 100
  const ty = (0.5 - p.y) * 100
  return {
    transformOrigin: `${ox}% ${oy}%`,
    transform: `translate(${tx}%, ${ty}%) scale(${GEOCOLOR_VIEW_SCALE})`,
    pinLeftPct: 50,
    pinTopPct: 50,
  }
}

/**
 * Pin position as % of the visible Cloud Map container, or null if off-frame.
 * With site-centered crop the pin is at 50%/50%.
 */
export function geocolorSitePinPercent(
  lat: number,
  lon: number
): { leftPct: number; topPct: number } | null {
  const view = geocolorSiteView(lat, lon)
  if (!view) return null
  return { leftPct: view.pinLeftPct, topPct: view.pinTopPct }
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
