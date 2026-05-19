export type RemoteSessionTypeV1 = 'dso' | 'variable_star'

export type RemoteSavedSessionFormV1 = {
  sessionType: RemoteSessionTypeV1
  requestName: string
  raHourPart: string
  raMinutePart: string
  raSecondPart: string
  decSign: string
  decDegreePart: string
  decMinutePart: string
  decSecondPart: string
  sessionPassword: string
  outputMode: 'raw_zip' | 'stacked_master' | 'none'
  filterPlans: Array<{ filterName: string; count: string; exposureSeconds: string }>
  variableStarBlockHours: number
  variableStarListSelection: string
  variableStarFilterSelection: string[]
  catalogQuery: string
}

export type MemberSavedSessionApiEntry = {
  id: string
  name: string
  savedAt: string
  updatedAt: string
  form: RemoteSavedSessionFormV1
}

/** Query param on /dashboard/remote to load a cloud-saved session by id. */
export const SAVED_SESSION_ID_QUERY = 'savedSessionId'

export function buildRemoteRunSavedSessionUrl(sessionId: string): string {
  return `/dashboard/remote?${SAVED_SESSION_ID_QUERY}=${encodeURIComponent(sessionId)}`
}

export async function fetchMemberSavedSessions(): Promise<MemberSavedSessionApiEntry[]> {
  const res = await fetch('/api/member/saved-sessions', { credentials: 'include', cache: 'no-store' })
  const data = await res.json().catch(() => ({}))
  if (!res.ok || data?.ok !== true || !Array.isArray(data.sessions)) return []
  return data.sessions as MemberSavedSessionApiEntry[]
}

export async function saveMemberSavedSession(input: {
  name: string
  form: RemoteSavedSessionFormV1
}): Promise<{ ok: true; session: MemberSavedSessionApiEntry } | { ok: false; error: string }> {
  const res = await fetch('/api/member/saved-sessions', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok || data?.ok !== true) {
    return { ok: false, error: typeof data.error === 'string' ? data.error : 'Save failed' }
  }
  return { ok: true, session: data.session as MemberSavedSessionApiEntry }
}

export async function loadMemberSavedSessionByName(
  name: string
): Promise<MemberSavedSessionApiEntry | null> {
  const sessions = await fetchMemberSavedSessions()
  const key = name.trim().toLowerCase()
  return sessions.find((s) => s.name.toLowerCase() === key) ?? null
}

export async function loadMemberSavedSessionById(
  id: string
): Promise<MemberSavedSessionApiEntry | null> {
  const trimmed = id.trim()
  if (!trimmed) return null
  const res = await fetch(`/api/member/saved-sessions?id=${encodeURIComponent(trimmed)}`, {
    credentials: 'include',
    cache: 'no-store',
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok || data?.ok !== true || !data.session) return null
  return data.session as MemberSavedSessionApiEntry
}
