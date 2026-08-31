import type { GuestAccessMode } from '@/lib/member-roles'
import { isObservatorySiteId, type ObservatorySiteId } from '@/lib/observatory-sites'

export const DEFAULT_MEMBER_PROJECT_DURATION_LIMIT_HOURS = 30
export const DEFAULT_SESSION_DURATION_LIMIT_HOURS = 8

/** How sessions are gated after access is allowed. */
export type SessionGateMode = 'direct' | 'always_approve' | 'duration_limit'

export type SessionGatePolicy = {
  mode: SessionGateMode
  /** Used when mode === 'duration_limit' (hours). */
  durationLimitHours: number
}

export type SiteAccessControlSettings = {
  /** Own affiliated members: project duration over this → Imaging Request. */
  memberProjectDurationLimitHours: number

  openToGuest: boolean
  guestSessionPolicy: SessionGatePolicy

  openToOtherObservatoryMembers: boolean
  /** Which other observatories' members are allowed. */
  otherObservatoryMemberScope: 'all' | ObservatorySiteId[]
  otherMemberSessionPolicy: SessionGatePolicy

  /**
   * Email suffixes that may join this observatory as Member without approval
   * (e.g. "@pomfret.org"). Case-insensitive; leading @ optional.
   */
  memberEmailAutoJoinSuffixes: string[]
}

export function defaultSessionGatePolicy(mode: SessionGateMode = 'direct'): SessionGatePolicy {
  return {
    mode,
    durationLimitHours: DEFAULT_SESSION_DURATION_LIMIT_HOURS,
  }
}

export function defaultSiteAccessControlSettings(): SiteAccessControlSettings {
  return {
    memberProjectDurationLimitHours: DEFAULT_MEMBER_PROJECT_DURATION_LIMIT_HOURS,
    openToGuest: false,
    guestSessionPolicy: defaultSessionGatePolicy('direct'),
    openToOtherObservatoryMembers: false,
    otherObservatoryMemberScope: 'all',
    otherMemberSessionPolicy: defaultSessionGatePolicy('direct'),
    memberEmailAutoJoinSuffixes: [],
  }
}

export function guestAccessModeFromSettings(
  settings: Pick<SiteAccessControlSettings, 'openToGuest'>
): GuestAccessMode {
  // Account-level guest approval (`open_approval` + guest_site_access) is reserved for a
  // future admin UI. Today, guest session gating uses guestSessionPolicy at submit time.
  // When guests are allowed, access column stays open_direct.
  if (!settings.openToGuest) return 'closed'
  return 'open_direct'
}

export function settingsFromPolicy(
  guestAccess: GuestAccessMode,
  memberProjectDurationLimitHours: number,
  extras?: Partial<SiteAccessControlSettings>
): SiteAccessControlSettings {
  const base = defaultSiteAccessControlSettings()
  return normalizeSiteAccessControlSettings({
    ...base,
    ...extras,
    openToGuest: guestAccess !== 'closed',
    guestSessionPolicy:
      guestAccess === 'open_approval'
        ? defaultSessionGatePolicy('always_approve')
        : guestAccess === 'open_direct'
          ? defaultSessionGatePolicy('direct')
          : defaultSessionGatePolicy('direct'),
    memberProjectDurationLimitHours: normalizeProjectDurationLimitHours(memberProjectDurationLimitHours),
  })
}

export function normalizeProjectDurationLimitHours(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(String(value ?? '').trim())
  if (!Number.isFinite(n) || n < 0) return DEFAULT_MEMBER_PROJECT_DURATION_LIMIT_HOURS
  return n
}

export function projectDurationLimitSeconds(limitHours: number): number {
  if (!Number.isFinite(limitHours) || limitHours <= 0) return 0
  return limitHours * 3600
}

function normalizeSessionGatePolicy(raw: unknown): SessionGatePolicy {
  const fallback = defaultSessionGatePolicy('direct')
  if (!raw || typeof raw !== 'object') return fallback
  const rec = raw as Record<string, unknown>
  const mode =
    rec.mode === 'always_approve' || rec.mode === 'duration_limit' || rec.mode === 'direct'
      ? rec.mode
      : 'direct'
  const hours = normalizeProjectDurationLimitHours(
    rec.durationLimitHours ?? DEFAULT_SESSION_DURATION_LIMIT_HOURS
  )
  return { mode, durationLimitHours: hours > 0 ? hours : DEFAULT_SESSION_DURATION_LIMIT_HOURS }
}

function normalizeOtherScope(raw: unknown): 'all' | ObservatorySiteId[] {
  if (raw === 'all' || raw == null) return 'all'
  if (!Array.isArray(raw)) return 'all'
  const ids = raw.filter((x): x is ObservatorySiteId => typeof x === 'string' && isObservatorySiteId(x))
  return ids.length > 0 ? Array.from(new Set(ids)) : 'all'
}

export function normalizeEmailSuffixes(raw: unknown): string[] {
  const items = Array.isArray(raw)
    ? raw
    : typeof raw === 'string'
      ? raw.split(/[,;\s]+/)
      : []
  const out: string[] = []
  const seen = new Set<string>()
  for (const item of items) {
    if (typeof item !== 'string') continue
    let s = item.trim().toLowerCase()
    if (!s) continue
    if (!s.startsWith('@')) s = `@${s}`
    if (s.length < 3 || !s.includes('.')) continue
    if (seen.has(s)) continue
    seen.add(s)
    out.push(s)
  }
  return out
}

export function emailMatchesAutoJoinSuffixes(email: string, suffixes: string[]): boolean {
  const normalized = email.trim().toLowerCase()
  if (!normalized.includes('@')) return false
  return suffixes.some((suffix) => {
    const s = suffix.trim().toLowerCase()
    const withAt = s.startsWith('@') ? s : `@${s}`
    return withAt.length >= 3 && normalized.endsWith(withAt)
  })
}

export function normalizeSiteAccessControlSettings(raw: unknown): SiteAccessControlSettings {
  const base = defaultSiteAccessControlSettings()
  if (!raw || typeof raw !== 'object') return base
  const rec = raw as Record<string, unknown>

  // Legacy shape: openToGuest + guestSessionRequiresApproval
  const legacyGuestRequires =
    typeof rec.guestSessionRequiresApproval === 'boolean' ? rec.guestSessionRequiresApproval : null

  let guestSessionPolicy = normalizeSessionGatePolicy(rec.guestSessionPolicy)
  if (!rec.guestSessionPolicy && legacyGuestRequires != null) {
    guestSessionPolicy = defaultSessionGatePolicy(legacyGuestRequires ? 'always_approve' : 'direct')
  }

  return {
    memberProjectDurationLimitHours: normalizeProjectDurationLimitHours(
      rec.memberProjectDurationLimitHours ?? base.memberProjectDurationLimitHours
    ),
    openToGuest: rec.openToGuest === true,
    guestSessionPolicy,
    openToOtherObservatoryMembers: rec.openToOtherObservatoryMembers === true,
    otherObservatoryMemberScope: normalizeOtherScope(rec.otherObservatoryMemberScope),
    otherMemberSessionPolicy: normalizeSessionGatePolicy(rec.otherMemberSessionPolicy),
    memberEmailAutoJoinSuffixes: normalizeEmailSuffixes(rec.memberEmailAutoJoinSuffixes),
  }
}

/** Whether a session of `estimatedDurationSeconds` needs admin approval under this gate. */
export function sessionNeedsAdminApproval(
  policy: SessionGatePolicy,
  estimatedDurationSeconds: number | undefined | null
): boolean {
  if (policy.mode === 'direct') return false
  if (policy.mode === 'always_approve') return true
  const limitSec = projectDurationLimitSeconds(policy.durationLimitHours)
  if (limitSec <= 0) return false
  return (
    typeof estimatedDurationSeconds === 'number' &&
    Number.isFinite(estimatedDurationSeconds) &&
    estimatedDurationSeconds > limitSec
  )
}

/** True if user has membership at any site listed in the other-obs scope (excluding `currentSiteId`). */
export function isAllowedOtherObservatoryMember(input: {
  memberships: Array<{ siteId: string }>
  currentSiteId: string
  scope: 'all' | ObservatorySiteId[]
}): boolean {
  const otherMemberships = input.memberships.filter((m) => m.siteId !== input.currentSiteId)
  if (otherMemberships.length === 0) return false
  if (input.scope === 'all') return true
  const allowed = new Set(input.scope)
  return otherMemberships.some((m) => allowed.has(m.siteId as ObservatorySiteId))
}
