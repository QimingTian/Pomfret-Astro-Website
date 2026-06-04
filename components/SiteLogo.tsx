import Image from 'next/image'

type SiteLogoProps = {
  className?: string
  width?: number
  height?: number
  priority?: boolean
}

export function SiteLogo({
  className = '',
  width = 160,
  height,
  priority = false,
}: SiteLogoProps) {
  const resolvedHeight = height ?? width

  return (
    <Image
      src="/olmsted-logo-transparent.png"
      alt="Olmsted Observatory"
      width={width}
      height={resolvedHeight}
      priority={priority}
      className={className}
    />
  )
}
