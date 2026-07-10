'use client'

import dynamic from 'next/dynamic'
import AllSkyCameraView from '@/components/AllSkyCameraView'
import NOAAGoesCloudMap from '@/components/NOAAGoesCloudMap'

const LibreWxrRadarMap = dynamic(() => import('@/components/LibreWxrRadarMap'), { ssr: false })

export default function WeatherPage() {
  return (
    <div className="pb-8 lg:-translate-x-3">
      <div className="mb-8 border-b border-black/10 dark:border-white/10 pb-8" id="all-sky-camera">
        <AllSkyCameraView />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 lg:gap-6 items-start">
        <div className="min-w-0 lg:pr-6">
          <NOAAGoesCloudMap />
        </div>
        <div className="min-w-0 lg:border-l lg:border-white/10 lg:pl-6">
          <LibreWxrRadarMap />
        </div>
      </div>
    </div>
  )
}
