'use client'

import { PlanGlassSegmentSwitch } from '@/components/plan/plan-glass-segment-switch'
import { useNightMode } from '@/components/night-mode-provider'

function sunIcon(className: string) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
    </svg>
  )
}

function moonIcon(className: string) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={`${className} translate-y-px`}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M12 3a7.5 7.5 0 1 0 0 15 9.5 9.5 0 0 1 0-15z" />
    </svg>
  )
}

/** Global night-vision toggle — same glass segment switch as Atlas / Framing. */
export function NightModeToggle({
  compact = false,
  className,
}: {
  compact?: boolean
  className?: string
}) {
  const { nightMode, setNightMode } = useNightMode()
  const iconClass = compact ? 'block h-3.5 w-3.5 shrink-0' : 'block h-[1.125rem] w-[1.125rem] shrink-0'

  return (
    <PlanGlassSegmentSwitch
      options={[
        { value: 'day', icon: sunIcon(iconClass), title: 'Day mode' },
        { value: 'night', icon: moonIcon(iconClass), title: 'Night mode' },
      ]}
      value={nightMode ? 'night' : 'day'}
      onChange={(v) => setNightMode(v === 'night')}
      ariaLabel="Night mode"
      minWidthRem={compact ? 1.85 : 2.75}
      compact={compact}
      className={className}
    />
  )
}
