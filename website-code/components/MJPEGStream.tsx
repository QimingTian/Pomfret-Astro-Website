'use client'

import { useEffect, useRef, useState } from 'react'

interface MJPEGStreamProps {
  url: string
  className?: string
  /** Hide FPS and loading overlay for a clean view-only experience */
  minimal?: boolean
  /**
   * Natural size: `w-full` + intrinsic height (no letterboxing). Default.
   * When false, image fills a sized parent (`object-contain` or `fill` → cover).
   */
  natural?: boolean
  /** Only when natural=false: fill parent with object-cover instead of letterboxing */
  fill?: boolean
}

export default function MJPEGStream({
  url,
  className,
  minimal = false,
  natural = true,
  fill = false,
}: MJPEGStreamProps) {
  const imgRef = useRef<HTMLImageElement>(null)
  const [fps, setFps] = useState(0)
  const [loading, setLoading] = useState(true)
  const frameCountRef = useRef(0)
  const lastFPSUpdateRef = useRef(Date.now())

  useEffect(() => {
    if (!imgRef.current) return

    const img = imgRef.current
    let streamURL = url
    if (!streamURL.includes('?')) {
      streamURL += '?t=' + Date.now()
    }

    img.src = streamURL
    setLoading(false)

    const updateFPS = () => {
      frameCountRef.current++
      const now = Date.now()
      const elapsed = (now - lastFPSUpdateRef.current) / 1000

      if (elapsed >= 1.0) {
        setFps(frameCountRef.current / elapsed)
        frameCountRef.current = 0
        lastFPSUpdateRef.current = now
      }
    }

    img.onload = updateFPS

    return () => {
      img.src = ''
    }
  }, [url])

  const imgClass = natural
    ? 'block h-auto w-full'
    : `block h-full w-full min-h-0 min-w-0 ${fill ? 'object-cover' : 'object-contain'}`

  return (
    <div
      className={`relative bg-black ${natural ? 'w-full' : 'h-full min-h-0 min-w-0 w-full'} ${className || ''}`}
    >
      <img ref={imgRef} alt="" className={imgClass} onError={() => setLoading(true)} />
      {!minimal && loading && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="text-white">Loading stream...</div>
        </div>
      )}
      {!minimal && !loading && fps > 0 && (
        <div className="absolute top-4 right-4 bg-black bg-opacity-70 text-white px-3 py-1.5 rounded text-sm font-medium">
          {fps.toFixed(1)} FPS
        </div>
      )}
    </div>
  )
}

