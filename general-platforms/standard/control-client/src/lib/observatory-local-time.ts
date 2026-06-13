import { getObservatoryLocation, type ObservatoryLocation } from './settings'

export type ObservatoryCoords = Pick<ObservatoryLocation, 'lat' | 'lon' | 'elevationM'>

export function readObservatoryCoords(): ObservatoryCoords {
  const loc = getObservatoryLocation()
  return { lat: loc.lat, lon: loc.lon, elevationM: loc.elevationM }
}

/** Rough UTC offset from longitude (15° per hour). */
export function observatoryUtcOffsetHours(lon: number): number {
  return Math.round(lon / 15)
}

export function observatoryUtcOffsetMs(lon: number): number {
  return observatoryUtcOffsetHours(lon) * 3600_000
}

export type ObservatoryLocalParts = {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second: number
}

/** Observatory civil clock parts for a UTC instant. */
export function observatoryLocalParts(now: Date, lon: number): ObservatoryLocalParts {
  const shifted = new Date(now.getTime() + observatoryUtcOffsetMs(lon))
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth(),
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
    second: shifted.getUTCSeconds(),
  }
}

/** UTC midnight anchor for the observatory's local civil calendar day containing `now`. */
export function observatoryLocalCalendarAnchorUtc(now: Date, lon?: number): Date {
  const obsLon = lon ?? readObservatoryCoords().lon
  const parts = observatoryLocalParts(now, obsLon)
  return new Date(Date.UTC(parts.year, parts.month, parts.day))
}

/** UTC instant for observatory wall time on the local civil day containing `now`. */
export function observatoryLocalWallTimeUtc(
  now: Date,
  hour: number,
  minute: number,
  second: number,
  lon?: number
): Date {
  const obsLon = lon ?? readObservatoryCoords().lon
  const parts = observatoryLocalParts(now, obsLon)
  const wallUtcMs =
    Date.UTC(parts.year, parts.month, parts.day, hour, minute, second) - observatoryUtcOffsetMs(obsLon)
  return new Date(wallUtcMs)
}

/** UTC instant for observatory wall time on a specific local civil date. */
export function observatoryWallTimeOnLocalDateUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  lon: number
): Date {
  const wallUtcMs =
    Date.UTC(year, month, day, hour, minute, second) - observatoryUtcOffsetMs(lon)
  return new Date(wallUtcMs)
}

export function formatObservatoryLocalTime(now = new Date(), lon?: number): string {
  const obsLon = lon ?? readObservatoryCoords().lon
  const parts = observatoryLocalParts(now, obsLon)
  const d = new Date(Date.UTC(2000, 0, 1, parts.hour, parts.minute, parts.second))
  return d.toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

export function formatObservatoryLocalDateTime(now = new Date(), lon?: number): string {
  const obsLon = lon ?? readObservatoryCoords().lon
  const parts = observatoryLocalParts(now, obsLon)
  const local = new Date(Date.UTC(parts.year, parts.month, parts.day, parts.hour, parts.minute, parts.second))
  return local.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  })
}

export function formatObservatoryLocalTimeFromUnixSec(sec: number, lon?: number): string {
  return formatObservatoryLocalTime(new Date(sec * 1000), lon)
}
