'use client'

import { useEffect, useMemo, useState } from 'react'
import MapFrameTimeOverlay from '@/components/MapFrameTimeOverlay'
import { formatObservatoryDateTime } from '@/lib/est-datetime'
import { noaaGoesProxyUrl, parseGeocolorFrameUtc } from '@/lib/noaa-goes'
import { useAppStore } from '@/lib/store'
import { useObservatorySite } from '@/components/observatory-site-provider'

const FRAME_MS = 900
const MANIFEST_REFRESH_MS = 600_000

type FrameEntry = { path: string }

export default function NOAAGoesCloudMap() {
  const { site } = useObservatorySite()
  const [frames, setFrames] = useState<FrameEntry[]>([])
  const [frameIndex, setFrameIndex] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false

    async function loadManifest(isRefresh: boolean) {
      try {
        if (!isRefresh) setLoading(true)
        const res = await fetch('/api/noaa-goes/frames', { cache: 'no-store' })
        const data = (await res.json()) as { frames?: FrameEntry[]; error?: string }
        if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`)
        const list = data.frames ?? []
        if (list.length === 0) throw new Error('No cloud map frames available')
        if (cancelled) return

        setFrames(list)
        setFrameIndex((prev) => {
          if (!isRefresh) return 0
          return Math.min(prev, Math.max(0, list.length - 1))
        })
        setError(null)

        if (!isRefresh) {
          useAppStore.getState().addLog({
            module: 'noaa-goes',
            level: 'info',
            message: `NOAA GOES frame list loaded (${list.length} frames)`,
          })
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Failed to load cloud map')
        }
      } finally {
        if (!cancelled && !isRefresh) setLoading(false)
      }
    }

    void loadManifest(false)
    const refreshTimer = window.setInterval(() => {
      void loadManifest(true)
    }, MANIFEST_REFRESH_MS)

    return () => {
      cancelled = true
      window.clearInterval(refreshTimer)
    }
  }, [])

  const frameCount = frames.length

  useEffect(() => {
    if (frameCount < 2) return
    const playTimer = window.setInterval(() => {
      setFrameIndex((i) => (i + 1) % frameCount)
    }, FRAME_MS)
    return () => window.clearInterval(playTimer)
  }, [frameCount])

  useEffect(() => {
    if (frameCount < 2) return
    const nextIdx = (frameIndex + 1) % frameCount
    const nextPath = frames[nextIdx]?.path
    if (!nextPath) return
    const img = new Image()
    img.src = noaaGoesProxyUrl(nextPath)
  }, [frameIndex, frameCount, frames])

  const currentPath = frames[frameIndex]?.path
  const imageSrc = currentPath ? noaaGoesProxyUrl(currentPath) : null
  const frameTimeLabel = useMemo(() => {
    if (!currentPath) return null
    const utc = parseGeocolorFrameUtc(currentPath)
    return utc ? formatObservatoryDateTime(utc, site.timezone) : null
  }, [currentPath, site.timezone])

  return (
    <div
      className="relative w-full overflow-hidden rounded-lg bg-gray-200 aspect-[4/3] dark:bg-gray-800"
    >
      <MapFrameTimeOverlay title="Cloud Map" timeLabel={frameTimeLabel} />
      {loading && !imageSrc ? (
        <p className="absolute inset-0 flex items-center justify-center text-sm text-gray-500">
          Loading cloud map…
        </p>
      ) : null}
      {error ? (
        <p className="absolute inset-0 flex items-center justify-center px-4 text-center text-sm text-red-400">
          {error}
        </p>
      ) : null}
      {imageSrc ? (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img
          key={currentPath}
          src={imageSrc}
          alt="NOAA GOES-East CONUS GeoColor cloud animation"
          className="absolute inset-0 h-full w-full object-cover"
          style={{ transform: 'scale(2)', transformOrigin: '100% 0%' }}
        />
      ) : null}
    </div>
  )
}
