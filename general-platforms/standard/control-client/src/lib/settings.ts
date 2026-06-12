const LOCATION_KEY = 'borean.personal.observatoryLocation'

export const DEFAULT_OBS_LAT = 41.9159
export const DEFAULT_OBS_LON = -71.9626

export type ObservatoryLocation = {
  lat: number
  lon: number
  label: string
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
