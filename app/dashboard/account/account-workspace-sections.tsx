'use client'

import { glassPillMd, glassPillToggleActive, glassPillToggleIdle } from '@/lib/glass-ui'

export type AccountWorkspaceSectionId =
  | 'observatory'
  | 'log'
  | 'schedule'
  | 'session-control'
  | 'my-sessions'
  | 'imaging'
  | 'equipment'
  | 'members'

export type AccountWorkspaceSection = {
  id: AccountWorkspaceSectionId
  label: string
  /** Shown only on admin account dashboard. */
  adminOnly?: boolean
}

export const ACCOUNT_WORKSPACE_SECTIONS: AccountWorkspaceSection[] = [
  { id: 'observatory', label: 'Obs Status', adminOnly: true },
  { id: 'log', label: 'Log', adminOnly: true },
  { id: 'schedule', label: 'Schedule', adminOnly: true },
  { id: 'session-control', label: 'Session Control', adminOnly: true },
  { id: 'my-sessions', label: 'My Sessions' },
  { id: 'imaging', label: 'Imaging Queue', adminOnly: true },
  { id: 'equipment', label: 'Equipment', adminOnly: true },
  { id: 'members', label: 'Members', adminOnly: true },
]

export function accountSectionsForUser(isAdmin: boolean): AccountWorkspaceSection[] {
  return ACCOUNT_WORKSPACE_SECTIONS.filter((s) => !s.adminOnly || isAdmin)
}

export function defaultAccountSection(isAdmin: boolean): AccountWorkspaceSectionId {
  return isAdmin ? 'observatory' : 'my-sessions'
}

export function AccountWorkspaceNav({
  sections,
  active,
  onChange,
  className = '',
}: {
  sections: AccountWorkspaceSection[]
  active: AccountWorkspaceSectionId
  onChange: (id: AccountWorkspaceSectionId) => void
  className?: string
}) {
  if (sections.length === 0) return null
  return (
    <nav
      className={`flex flex-wrap gap-2 ${className}`}
      aria-label="Account sections"
    >
      {sections.map((section) => {
        const selected = section.id === active
        return (
          <button
            key={section.id}
            type="button"
            onClick={() => onChange(section.id)}
            className={selected ? glassPillToggleActive : glassPillToggleIdle}
            aria-current={selected ? 'page' : undefined}
          >
            {section.label}
          </button>
        )
      })}
    </nav>
  )
}

/** Optional hash sync: #section=log */
export function readAccountSectionFromHash(
  allowed: AccountWorkspaceSectionId[]
): AccountWorkspaceSectionId | null {
  if (typeof window === 'undefined') return null
  const raw = window.location.hash.replace(/^#/, '').trim()
  if (!raw.startsWith('section=')) return null
  const id = raw.slice('section='.length) as AccountWorkspaceSectionId
  return allowed.includes(id) ? id : null
}

export function writeAccountSectionToHash(id: AccountWorkspaceSectionId): void {
  if (typeof window === 'undefined') return
  const next = `#section=${id}`
  if (window.location.hash === next) return
  window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}${next}`)
}

export function AccountWorkspaceHint({ className = '' }: { className?: string }) {
  return (
    <p className={`text-xs text-gray-500 ${className}`}>
      Choose a section below — only the active panel is loaded in view.
    </p>
  )
}

export { glassPillMd }
