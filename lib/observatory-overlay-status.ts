import { evaluateObservatoryReadyWeather } from '@/lib/asc-cloud'
import { isWithinDaytimeClosedWindow } from '@/lib/sunrise-window'

export type ObservatoryOverlayStatus =
  | 'ready'
  | 'busy_in_use'
  | 'disconnected'
  | 'closed_weather_not_permitted'
  | 'closed_daytime'
  | 'closed_observatory_maintenance'

export function isObservatoryOverlayStatus(value: string): value is ObservatoryOverlayStatus {
  return (
    value === 'ready' ||
    value === 'busy_in_use' ||
    value === 'disconnected' ||
    value === 'closed_weather_not_permitted' ||
    value === 'closed_daytime' ||
    value === 'closed_observatory_maintenance'
  )
}

export function observatoryOverlayStatusLabel(status: ObservatoryOverlayStatus | null): string {
  if (!status) return '—'
  if (status === 'ready') return 'Ready'
  if (status === 'busy_in_use') return 'Busy'
  if (status === 'disconnected') return 'Disconnected'
  return 'Closed'
}

export function observatoryOverlayStatusIsRed(status: ObservatoryOverlayStatus | null): boolean {
  if (!status) return false
  return status !== 'ready'
}

function windKmhToMs(kmh: number | null): number {
  if (kmh == null || !Number.isFinite(kmh)) return 999
  return kmh / 3.6
}

/** Live ASC + Open-Meteo wind gate (same rule as observatory-status-store auto weather). */
export function computeAutoWeatherOverlayStatus(input: {
  cloudPct: number | null
  rainDetected: boolean | null
  windKmh: number | null
  now?: Date
}): 'ready' | 'closed_weather_not_permitted' {
  const weatherOk = evaluateObservatoryReadyWeather({
    cloudCoverPercent: input.cloudPct,
    rainDetected: input.rainDetected === true,
    windSpeedMs: windKmhToMs(input.windKmh),
  })
  return weatherOk ? 'ready' : 'closed_weather_not_permitted'
}

/**
 * Overlay Observatory Status: in Auto, recompute weather from live ASC + wind every tick;
 * still respect server envelope for disconnected / busy / admin maintenance.
 */
export function computeOverlayObservatoryStatus(input: {
  mode: 'manual' | 'auto' | null
  serverStatus: ObservatoryOverlayStatus | null
  cloudPct: number | null
  rainDetected: boolean | null
  windKmh: number | null
  now?: Date
}): ObservatoryOverlayStatus | null {
  const { mode, serverStatus, cloudPct, rainDetected, windKmh, now = new Date() } = input
  if (!serverStatus) return null
  if (mode === 'manual') return serverStatus

  if (serverStatus === 'disconnected') return 'disconnected'
  if (serverStatus === 'busy_in_use') return 'busy_in_use'
  if (serverStatus === 'closed_observatory_maintenance') return 'closed_observatory_maintenance'
  if (isWithinDaytimeClosedWindow(now)) return 'closed_daytime'

  return computeAutoWeatherOverlayStatus({ cloudPct, rainDetected, windKmh, now })
}
