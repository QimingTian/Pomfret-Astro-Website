'use client'

import {
  glassPillToggleActive,
  glassPillToggleIdle,
} from '@/lib/glass-ui'
import { authSectionHeadingClass } from '@/components/auth-ui'
import { OBSERVATORY_SITES } from '@/lib/observatory-sites'

export type AffiliationChoice = 'guest' | string

export function SignupAffiliationPicker({
  value,
  onChange,
  idPrefix,
}: {
  value: AffiliationChoice | null
  onChange: (next: AffiliationChoice) => void
  idPrefix: string
}) {
  return (
    <fieldset>
      <legend className={authSectionHeadingClass}>Affiliation</legend>
      <div className="flex flex-wrap items-center justify-center gap-2">
        {OBSERVATORY_SITES.map((site) => {
          const selected = value === site.id
          return (
            <button
              key={site.id}
              id={`${idPrefix}-affil-${site.id}`}
              type="button"
              onClick={() => onChange(site.id)}
              className={selected ? glassPillToggleActive : glassPillToggleIdle}
            >
              {site.name}
            </button>
          )
        })}
        <button
          id={`${idPrefix}-affil-guest`}
          type="button"
          onClick={() => onChange('guest')}
          className={value === 'guest' ? glassPillToggleActive : glassPillToggleIdle}
        >
          Continue As Guest
        </button>
      </div>
    </fieldset>
  )
}
