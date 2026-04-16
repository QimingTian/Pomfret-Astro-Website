'use client'

import { useEffect, useRef, useState } from 'react'

interface MJPEGStreamProps {
  url: string
  className?: string
  /** Hide FPS and loading overlay for a clean view-only experience */
  minimal?: boolean
  /** Fill container (object-cover) vs letterbox (object-contain). Default: contain */
  fill?: boolean
}

export default function MJPEGStream({ url, className, minimal = false, fill = false }: MJPEGStreamProps) {
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

  return (
    <div className={`relative bg-black ${className || ''}`}>
      <img
        ref={imgRef}
        alt=""
        className={`w-full h-full ${fill ? 'object-cover' : 'object-contain'}`}
        onError={() => setLoading(true)}
      />
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

