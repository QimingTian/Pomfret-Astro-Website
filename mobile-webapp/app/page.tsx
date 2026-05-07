"use client"

import { useEffect, useState } from "react"

const STREAM_URL =
  process.env.NEXT_PUBLIC_CAMERA_STREAM_URL ??
  "https://cam.pomfretastro.org/camera/stream"

export default function HomePage() {
  const [error, setError] = useState(false)
  const [src, setSrc] = useState(STREAM_URL)

  useEffect(() => {
    const sep = STREAM_URL.includes("?") ? "&" : "?"
    setSrc(`${STREAM_URL}${sep}t=${Date.now()}`)
  }, [])

  return (
    <main>
      <div className="frame">
        <img
          className="stream"
          src={src}
          alt="All sky camera stream"
          onError={() => {
            setError(true)
          }}
        />
        <div className="overlay">
          <div>
            <span className={`status-dot ${error ? "status-offline" : "status-live"}`} />
            {error ? "Stream error" : "Live"}
          </div>
          <div>Pomfret All Sky Camera</div>
          {error ? <div>Stream failed. Check NEXT_PUBLIC_CAMERA_STREAM_URL.</div> : null}
        </div>
      </div>
    </main>
  )
}
