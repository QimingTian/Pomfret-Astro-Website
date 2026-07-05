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

const LOCK_OPTIONS = [
  { value: 'lock' as const, label: 'Lock' },
  { value: 'unlock' as const, label: 'Unlock' },
]

type LockProps = {
  locked: boolean
  onChange: (locked: boolean) => void
  disabled?: boolean
  className?: string
}

export function PlanLockSwitch({ locked, onChange, disabled, className }: LockProps) {
  return (
    <PlanGlassSegmentSwitch
      options={LOCK_OPTIONS}
      value={locked ? 'lock' : 'unlock'}
      onChange={(v) => onChange(v === 'lock')}
      disabled={disabled}
      ariaLabel="Sky lock"
      minWidthRem={5}
      className={className}
    />
  )
}
