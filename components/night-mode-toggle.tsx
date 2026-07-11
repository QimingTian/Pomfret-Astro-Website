'use client'

import { PlanGlassSegmentSwitch } from '@/components/plan/plan-glass-segment-switch'
import { useNightMode } from '@/components/night-mode-provider'

const iconClass = 'block h-[1.125rem] w-[1.125rem] shrink-0'

const SUN_ICON = (
  <svg
    viewBox="0 0 24 24"
    className={iconClass}
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

/** Crescent centered in viewBox; slight downward nudge offsets visual mass (bulge reads high). */
const MOON_ICON = (
  <svg
    viewBox="0 0 24 24"
    className={`${iconClass} translate-y-px`}
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

const NIGHT_MODE_OPTIONS = [
  { value: 'day' as const, icon: SUN_ICON, title: 'Day mode' },
  { value: 'night' as const, icon: MOON_ICON, title: 'Night mode' },
]

/** Global night-vision toggle — same glass segment switch as Atlas / Framing. */
export function NightModeToggle() {
  const { nightMode, setNightMode } = useNightMode()

  return (
    <PlanGlassSegmentSwitch
      options={NIGHT_MODE_OPTIONS}
      value={nightMode ? 'night' : 'day'}
      onChange={(v) => setNightMode(v === 'night')}
      ariaLabel="Night mode"
      minWidthRem={2.75}
    />
  )
}
