import Image from 'next/image'

type SiteLogoProps = {
  /** Full lockup (building + OLMSTED OBSERVATORY) or dome mark only */
  variant?: 'full' | 'mark'
  className?: string
  /** Width in px; height follows aspect ratio unless height is set */
  width?: number
  height?: number
  priority?: boolean
}

const SOURCES = {
  full: '/olmsted-logo-transparent.png',
  mark: '/olmsted-mark-transparent.png',
} as const

const ASPECT = {
  full: 1,
  mark: 1160 / 720,
} as const

export function SiteLogo({
  variant = 'full',
  className = '',
  width = 160,
  height,
  priority = false,
}: SiteLogoProps) {
  const src = SOURCES[variant]
  const resolvedHeight = height ?? Math.round(width / ASPECT[variant])

  return (
    <Image
      src={src}
      alt="Olmsted Observatory"
      width={width}
      height={resolvedHeight}
      priority={priority}
      className={className}
    />
  )
}
