import { OBS_LAT_DEG, OBS_LON_DEG } from '@/lib/target-altitude'

export type OpenMeteoCurrentWeather = {
  temperatureC: number | null
  humidityPercent: number | null
  windSpeedKmh: number | null
  windGustKmh: number | null
}

export function openMeteoCurrentWeatherUrl(): string {
  return (
    `https://api.open-meteo.com/v1/forecast?latitude=${OBS_LAT_DEG}&longitude=${OBS_LON_DEG}` +
    '&current=temperature_2m,relative_humidity_2m,wind_speed_10m,wind_gusts_10m&timezone=auto'
  )
}

export async function fetchOpenMeteoCurrentWeather(): Promise<OpenMeteoCurrentWeather> {
  try {
    const res = await fetch(openMeteoCurrentWeatherUrl(), { cache: 'no-store' })
    const data = (await res.json()) as {
      current?: {
        temperature_2m?: number
        relative_humidity_2m?: number
        wind_speed_10m?: number
        wind_gusts_10m?: number
      }
    }
    const c = data.current
    if (!c) {
      return { temperatureC: null, humidityPercent: null, windSpeedKmh: null, windGustKmh: null }
    }
    return {
      temperatureC:
        typeof c.temperature_2m === 'number' && Number.isFinite(c.temperature_2m)
          ? c.temperature_2m
          : null,
      humidityPercent:
        typeof c.relative_humidity_2m === 'number' && Number.isFinite(c.relative_humidity_2m)
          ? c.relative_humidity_2m
          : null,
      windSpeedKmh:
        typeof c.wind_speed_10m === 'number' && Number.isFinite(c.wind_speed_10m)
          ? c.wind_speed_10m
          : null,
      windGustKmh:
        typeof c.wind_gusts_10m === 'number' && Number.isFinite(c.wind_gusts_10m)
          ? c.wind_gusts_10m
          : null,
    }
  } catch {
    return { temperatureC: null, humidityPercent: null, windSpeedKmh: null, windGustKmh: null }
  }
}
