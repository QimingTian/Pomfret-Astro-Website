import type { CSSProperties } from 'react'

const overlayTextShadowStyle: CSSProperties = {
  textShadow: '0 1px 4px rgba(0,0,0,0.95), 0 0 14px rgba(0,0,0,0.55)',
}

type MapFrameTimeOverlayProps = {
  /** Section title drawn on the map (e.g. Cloud Map). */
  title?: string
  timeLabel: string | null
}

/** Top-left title + timestamp overlay (matches All Sky Camera overlay styling). */
export default function MapFrameTimeOverlay({ title, timeLabel }: MapFrameTimeOverlayProps) {
  if (!title && !timeLabel) return null

  return (
    <div
      className="pointer-events-none absolute left-0 top-0 z-20 max-w-[min(100%,min(92vw,28rem))] space-y-0.5 px-2.5 py-1.5 text-left text-[0.8rem] leading-tight sm:space-y-1 sm:px-3 sm:py-2 sm:text-[0.9375rem] sm:leading-snug"
      style={overlayTextShadowStyle}
    >
      {title ? <p className="break-words font-semibold text-white">{title}</p> : null}
      {timeLabel ? <p className="break-words text-emerald-400">{timeLabel}</p> : null}
    </div>
  )
}
