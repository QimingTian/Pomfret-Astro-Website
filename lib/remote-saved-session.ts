export type RemoteSessionTypeV1 = 'dso' | 'variable_star'

export type RemoteSavedSessionFormV1 = {
  sessionType: RemoteSessionTypeV1
  requestName: string
  firstName: string
  lastName: string
  email: string
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

export type RemoteSavedSessionEntryV1 = {
  name: string
  password: string
  savedAt: string
  form: RemoteSavedSessionFormV1
}

const STORAGE_KEY = 'pomfret-remote-saved-sessions-v1'
const MAX_SESSIONS = 40

function readRaw(): RemoteSavedSessionEntryV1[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (x): x is RemoteSavedSessionEntryV1 =>
        x != null &&
        typeof x === 'object' &&
        typeof (x as RemoteSavedSessionEntryV1).name === 'string' &&
        typeof (x as RemoteSavedSessionEntryV1).password === 'string' &&
        typeof (x as RemoteSavedSessionEntryV1).savedAt === 'string' &&
        (x as RemoteSavedSessionEntryV1).form != null &&
        typeof (x as RemoteSavedSessionEntryV1).form === 'object'
    )
  } catch {
    return []
  }
}

export function upsertRemoteSavedSession(entry: {
  name: string
  password: string
  form: RemoteSavedSessionFormV1
}): void {
  if (typeof window === 'undefined') return
  const nameKey = entry.name.trim().toLowerCase()
  if (!nameKey) return
  const next: RemoteSavedSessionEntryV1 = {
    name: entry.name.trim(),
    password: entry.password,
    savedAt: new Date().toISOString(),
    form: entry.form,
  }
  const prev = readRaw().filter((e) => e.name.trim().toLowerCase() !== nameKey)
  prev.unshift(next)
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(prev.slice(0, MAX_SESSIONS)))
}

export function findRemoteSavedSession(name: string, password: string): RemoteSavedSessionEntryV1 | null {
  const key = name.trim().toLowerCase()
  if (!key) return null
  for (const e of readRaw()) {
    if (e.name.trim().toLowerCase() === key && e.password === password) return e
  }
  return null
}
