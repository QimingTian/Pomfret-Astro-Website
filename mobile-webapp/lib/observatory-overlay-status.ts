export type ObservatoryOverlayStatus =
  | "ready"
  | "busy_in_use"
  | "disconnected"
  | "closed_weather_not_permitted"
  | "closed_daytime"
  | "closed_observatory_maintenance"

const MAX_CLOUD_PERCENT = 20
const MAX_WIND_MS = 10
const MAX_PRECIP_PROBABILITY = 20

export function isObservatoryOverlayStatus(value: string): value is ObservatoryOverlayStatus {
  return (
    value === "ready" ||
    value === "busy_in_use" ||
    value === "disconnected" ||
    value === "closed_weather_not_permitted" ||
    value === "closed_daytime" ||
    value === "closed_observatory_maintenance"
  )
}

export function observatoryOverlayStatusLabel(status: ObservatoryOverlayStatus | null): string {
  if (!status) return "—"
  if (status === "ready") return "Ready"
  if (status === "busy_in_use") return "Busy"
  if (status === "disconnected") return "Disconnected"
  return "Closed"
}

function windKmhToMs(kmh: number | null): number {
  if (kmh == null || !Number.isFinite(kmh)) return 999
  return kmh / 3.6
}

function computeAutoWeatherOverlayStatus(input: {
  cloudPct: number | null
  rainDetected: boolean | null
  windKmh: number | null
  precipProbabilityPercent?: number | null
}): "ready" | "closed_weather_not_permitted" {
  const cloud = input.cloudPct
  if (cloud == null || !Number.isFinite(cloud)) return "closed_weather_not_permitted"
  if (input.rainDetected === true) return "closed_weather_not_permitted"
  const windMs = windKmhToMs(input.windKmh)
  if (!Number.isFinite(windMs) || windMs >= MAX_WIND_MS) return "closed_weather_not_permitted"
  const precip = input.precipProbabilityPercent
  if (precip == null || !Number.isFinite(precip) || precip > MAX_PRECIP_PROBABILITY) {
    return "closed_weather_not_permitted"
  }
  return cloud < MAX_CLOUD_PERCENT ? "ready" : "closed_weather_not_permitted"
}

export function computeOverlayObservatoryStatus(input: {
  mode: "manual" | "auto" | null
  serverStatus: ObservatoryOverlayStatus | null
  cloudPct: number | null
  rainDetected: boolean | null
  windKmh: number | null
  precipProbabilityPercent?: number | null
}): ObservatoryOverlayStatus | null {
  const { mode, serverStatus, cloudPct, rainDetected, windKmh, precipProbabilityPercent } = input
  if (!serverStatus) return null
  if (mode === "manual") return serverStatus
  if (serverStatus === "disconnected") return "disconnected"
  if (serverStatus === "busy_in_use") return "busy_in_use"
  if (serverStatus === "closed_observatory_maintenance") return "closed_observatory_maintenance"
  if (serverStatus === "closed_daytime") return "closed_daytime"
  return computeAutoWeatherOverlayStatus({ cloudPct, rainDetected, windKmh, precipProbabilityPercent })
}
