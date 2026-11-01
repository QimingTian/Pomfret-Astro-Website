'use client'

import { PlanGlassSegmentSwitch } from './plan-glass-segment-switch'

export type SurveyMode = 'dss' | 'halpha' | 'hbr' | 'ohs'

const SURVEY_OPTIONS: { value: SurveyMode; label: string; title: string }[] = [
  { value: 'dss', label: 'Classic', title: 'Classic DSS color imagery' },
  { value: 'halpha', label: 'Hα only', title: 'Northern Sky Narrowband Survey Hα emission' },
  { value: 'hbr', label: 'HBR', title: 'Hα emission with blue and red continuum' },
  { value: 'ohs', label: 'OHS', title: '[OIII], Hα, and [SII] emission' },
]

type Props = {
  mode: SurveyMode
  onChange: (mode: SurveyMode) => void
  disabled?: boolean
}

export function PlanSurveySwitch({ mode, onChange, disabled }: Props) {
  return (
    <PlanGlassSegmentSwitch
      options={SURVEY_OPTIONS}
      value={mode}
      onChange={onChange}
      disabled={disabled}
      ariaLabel="Sky imagery"
    />
  )
}
