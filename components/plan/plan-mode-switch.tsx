'use client'

import { PlanGlassSegmentSwitch } from './plan-glass-segment-switch'

export type PlanMode = 'atlas' | 'framing'

const MODE_OPTIONS: { value: PlanMode; label: string }[] = [
  { value: 'atlas', label: 'Atlas' },
  { value: 'framing', label: 'Framing' },
]

type ModeProps = {
  mode: PlanMode
  onChange: (mode: PlanMode) => void
  disabled?: boolean
}

export function PlanModeSwitch({ mode, onChange, disabled }: ModeProps) {
  return (
    <PlanGlassSegmentSwitch
      options={MODE_OPTIONS}
      value={mode}
      onChange={onChange}
      disabled={disabled}
      ariaLabel="Plan mode"
    />
  )
}
