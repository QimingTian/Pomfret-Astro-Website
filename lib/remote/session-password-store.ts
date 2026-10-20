const STORAGE_KEY = 'pomfret:session-passwords'

function readMap(): Record<string, string> {
  if (typeof window === 'undefined') return {}
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object') return {}
    const out: Record<string, string> = {}
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === 'string' && v.trim()) out[k] = v
    }
    return out
  } catch {
    return {}
  }
}

export function rememberSessionPassword(sessionId: string, password: string): void {
  const id = sessionId.trim()
  const pwd = password.trim()
  if (!id || !pwd || typeof window === 'undefined') return
  const next = { ...readMap(), [id]: pwd }
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(next))
}

export function recalledSessionPassword(sessionId: string): string {
  const id = sessionId.trim()
  if (!id) return ''
  return readMap()[id] ?? ''
}

export function progressMonitorHref(sessionId: string): string {
  return `/dashboard/remote/progress?session=${encodeURIComponent(sessionId.trim())}`
}
