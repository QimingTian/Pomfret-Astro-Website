'use client'

import { useEffect, useState } from 'react'
import { useAppStore } from '@/lib/store'
import type { WeatherModel } from '@/lib/types'

function NOAAGoesCloudMap() {
  const store = useAppStore()
  // NOAA official animated CONUS loop (GOES16 URL currently redirects to GOES19).
  const imageURL = 'https://cdn.star.nesdis.noaa.gov/GOES19/ABI/CONUS/GEOCOLOR/GOES19-CONUS-GEOCOLOR-625x375.gif'
  const [refreshKey, setRefreshKey] = useState(Date.now())

  const handleImageLoad = () => {
    store.addLog({
      module: 'noaa-goes',
      level: 'info',
      message: 'NOAA GOES satellite image loaded successfully',
    })
  }

  useEffect(() => {
    // Auto-refresh every 10 minutes (600 seconds)
    const interval = setInterval(() => {
      store.addLog({
        module: 'noaa-goes',
        level: 'info',
        message: 'Auto-refreshing NOAA GOES satellite image',
      })
      // Force reload by updating refresh key
      setRefreshKey(Date.now())
    }, 600000) // 10 minutes

    return () => {
      clearInterval(interval)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div>
      <div className="mb-4">
        <h1 className="text-2xl font-semibold text-apple-dark dark:text-white mb-4">Cloud Map</h1>
      </div>

      <div className="relative w-full rounded-lg overflow-hidden bg-gray-200 dark:bg-gray-700" style={{ height: '400px' }}>
        <img
          src={`/api/noaa-goes?url=${encodeURIComponent(imageURL)}&t=${refreshKey}`}
          alt="NOAA GOES-East Satellite Cloud Map Animation"
          key={refreshKey}
          className="absolute"
          style={{
            width: '200%',
            height: '200%',
            objectFit: 'cover',
            objectPosition: 'top right',
          }}
          onLoad={handleImageLoad}
        />
      </div>
      <p className="text-xs text-gray-500 dark:text-gray-500 mt-3">Powered by NOAA GOES</p>
    </div>
  )
}

export default function WeatherPage() {
  const store = useAppStore()
  const [weather, setWeather] = useState<WeatherModel>(store.weather)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const fetchWeather = async () => {
      try {
        setLoading(true)
        const response = await fetch(
          'https://api.open-meteo.com/v1/forecast?latitude=41.9159&longitude=-71.9626&current=temperature_2m,apparent_temperature,relative_humidity_2m,precipitation,cloud_cover,wind_speed_10m,wind_gusts_10m&timezone=auto'
        )
        const data = await response.json()
        
        if (data.current) {
          const weatherData: WeatherModel = {
            temperatureC: data.current.temperature_2m,
            apparentTemperatureC: data.current.apparent_temperature,
            humidityPercent: data.current.relative_humidity_2m,
            precipitationMm: data.current.precipitation,
            cloudCoverPercent: data.current.cloud_cover,
            windSpeed: data.current.wind_speed_10m,
            windGust: data.current.wind_gusts_10m,
            observationTime: new Date(data.current.time),
          }
          setWeather(weatherData)
          store.setWeather(weatherData)
          store.addLog({
            module: 'weather',
            level: 'info',
            message: `Weather updated: Temp ${weatherData.temperatureC?.toFixed(1)}°C, Humidity ${weatherData.humidityPercent?.toFixed(0)}%`,
          })
        }
      } catch (error) {
        store.addLog({
          module: 'weather',
          level: 'error',
          message: `Failed to fetch weather: ${error instanceof Error ? error.message : 'Unknown error'}`,
        })
      } finally {
        setLoading(false)
      }
    }

    fetchWeather()
    const interval = setInterval(fetchWeather, 300000) // Update every 5 minutes
    return () => clearInterval(interval)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const formatValue = (value: number | undefined, suffix: string): string => {
    if (value === undefined) return '—'
    if (suffix.includes('%')) {
      return `${value.toFixed(0)}${suffix}`
    }
    if (suffix.includes('mm') || suffix.includes('km')) {
      return `${value.toFixed(0)}${suffix}`
    }
    return `${value.toFixed(1)}${suffix}`
  }

  return (
    <div className="pb-8 lg:-translate-x-3">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-apple-dark dark:text-white mb-4">Weather</h1>
        <p className="text-gray-600 dark:text-gray-400">Pomfret, CT</p>
        <p className="text-sm text-gray-500 dark:text-gray-500 mt-1">Powered by Open-Meteo</p>
        {weather.observationTime && (
          <p className="text-sm text-gray-500 dark:text-gray-500 mt-1">
            Last updated: {weather.observationTime.toLocaleTimeString()}
          </p>
        )}
      </div>

      {loading ? (
        <div className="text-center py-12">
          <p className="text-gray-600 dark:text-gray-400">Loading weather data...</p>
        </div>
      ) : (
        <div className="space-y-6">
          <div>
            {(() => {
              const metrics = [
                { title: 'Temperature', value: formatValue(weather.temperatureC, '°C') },
                { title: 'Apparent Temperature', value: formatValue(weather.apparentTemperatureC, '°C') },
                { title: 'Humidity', value: formatValue(weather.humidityPercent, '%') },
                { title: 'Cloud Cover', value: formatValue(weather.cloudCoverPercent, '%') },
                { title: 'Wind Speed', value: formatValue(weather.windSpeed, ' km/h') },
                { title: 'Wind Gust', value: formatValue(weather.windGust, ' km/h') },
              ]

              return (
                <>
                  <div className="grid grid-cols-1 md:grid-cols-3">
                    {metrics.slice(0, 3).map((metric, index) => (
                      <div
                        key={metric.title}
                        className={`p-6 text-center flex flex-col items-center justify-center ${index < 2 ? 'md:border-r md:border-white/35' : ''}`}
                      >
                        <div className="mb-3">
                          <h3 className="text-lg font-medium text-white">{metric.title}</h3>
                        </div>
                        <p className="text-3xl font-semibold text-apple-dark dark:text-white">{metric.value}</p>
                      </div>
                    ))}
                  </div>
                  <div className="border-t border-white/35" />
                  <div className="grid grid-cols-1 md:grid-cols-3">
                    {metrics.slice(3).map((metric, index) => (
                      <div
                        key={metric.title}
                        className={`p-6 text-center flex flex-col items-center justify-center ${index < 2 ? 'md:border-r md:border-white/35' : ''}`}
                      >
                        <div className="mb-3">
                          <h3 className="text-lg font-medium text-white">{metric.title}</h3>
                        </div>
                        <p className="text-3xl font-semibold text-apple-dark dark:text-white">{metric.value}</p>
                      </div>
                    ))}
                  </div>
                </>
              )
            })()}
          </div>

          {/* NOAA GOES Cloud Map Section */}
          <div className="mt-6 border-t border-black/10 dark:border-white/10 pt-8">
            <NOAAGoesCloudMap />
          </div>
        </div>
      )}
    </div>
  )
}
