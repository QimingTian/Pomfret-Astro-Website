'use client'

import dynamic from 'next/dynamic'
import AllSkyCameraView from '@/components/AllSkyCameraView'
import NOAAGoesCloudMap from '@/components/NOAAGoesCloudMap'
import ObservatoryWeatherDashboard from '@/components/weather/ObservatoryWeatherDashboard'
import { useObservatorySite } from '@/components/observatory-site-provider'

const LibreWxrRadarMap = dynamic(() => import('@/components/LibreWxrRadarMap'), { ssr: false })

export default function WeatherPage() {
  const { siteId } = useObservatorySite()
  const isPomfret = siteId === 'pomfret'

  if (!isPomfret) {
    return (
      <div className="space-y-6 pb-8 lg:-translate-x-3">
        <ObservatoryWeatherDashboard />
      </div>
    )
  }

  return (
    <div className="space-y-6 pb-8 lg:-translate-x-3">
      <div id="all-sky-camera">
        <AllSkyCameraView />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 lg:gap-6 items-start">
        <div className="min-w-0">
          <NOAAGoesCloudMap />
        </div>
        <div className="min-w-0">
          <LibreWxrRadarMap />
        </div>
      </div>
    </div>
  )
}
