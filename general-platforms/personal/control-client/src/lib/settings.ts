const STORAGE_KEY = 'pomfret.personal.hubBaseUrl'
const LOCATION_KEY = 'pomfret.personal.observatoryLocation'

export const DEFAULT_HUB_BASE_URL = 'http://127.0.0.1:7841'
export const DEFAULT_OBS_LAT = 41.9159
export const DEFAULT_OBS_LON = -71.9626

export type ObservatoryLocation = {
  lat: number
  lon: number
  label: string
}

export function getHubBaseUrl(): string {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw && raw.trim()) return normalizeHubBaseUrl(raw)
  } catch {
    // ignore
  }
  return DEFAULT_HUB_BASE_URL
}

export function setHubBaseUrl(url: string): void {
  localStorage.setItem(STORAGE_KEY, normalizeHubBaseUrl(url))
}

export function normalizeHubBaseUrl(url: string): string {
  return url.trim().replace(/\/+$/, '')
}

export function getObservatoryLocation(): ObservatoryLocation {
  try {
    const raw = localStorage.getItem(LOCATION_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<ObservatoryLocation>
      const lat = Number(parsed.lat)
      const lon = Number(parsed.lon)
      if (Number.isFinite(lat) && Number.isFinite(lon)) {
        return {
          lat,
          lon,
          label: typeof parsed.label === 'string' ? parsed.label : 'Observatory',
        }
      }
    }
  } catch {
    // ignore
  }
  return { lat: DEFAULT_OBS_LAT, lon: DEFAULT_OBS_LON, label: 'Observatory' }
}

export function setObservatoryLocation(loc: ObservatoryLocation): void {
  localStorage.setItem(
    LOCATION_KEY,
    JSON.stringify({
      lat: loc.lat,
      lon: loc.lon,
      label: loc.label.trim() || 'Observatory',
    })
  )
}
