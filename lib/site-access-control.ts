import type { GuestAccessMode } from '@/lib/member-roles'

export const DEFAULT_MEMBER_PROJECT_DURATION_LIMIT_HOURS = 30

export type SiteAccessControlSettings = {
  openToGuest: boolean
  guestSessionRequiresApproval: boolean
  memberProjectDurationLimitHours: number
}

export function guestAccessModeFromSettings(
  settings: Pick<SiteAccessControlSettings, 'openToGuest' | 'guestSessionRequiresApproval'>
): GuestAccessMode {
  if (!settings.openToGuest) return 'closed'
  return settings.guestSessionRequiresApproval ? 'open_approval' : 'open_direct'
}

export function settingsFromPolicy(
  guestAccess: GuestAccessMode,
  memberProjectDurationLimitHours: number
): SiteAccessControlSettings {
  return {
    openToGuest: guestAccess !== 'closed',
    guestSessionRequiresApproval: guestAccess === 'open_approval',
    memberProjectDurationLimitHours: normalizeProjectDurationLimitHours(memberProjectDurationLimitHours),
  }
}

export function normalizeProjectDurationLimitHours(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_MEMBER_PROJECT_DURATION_LIMIT_HOURS
  return Math.round(n * 10) / 10
}

export function projectDurationLimitSeconds(limitHours: number): number {
  return normalizeProjectDurationLimitHours(limitHours) * 3600
}
