import { postgresReadsEnabled } from '@/lib/db'
import { REDIS_LIVE_KEYS } from '@/lib/db/data-plane'
import { kvEnabled, kvGetString, kvSetJson } from '@/lib/kv-rest'
import { currentObservatorySiteId, scopedKvKey } from '@/lib/observatory-site-scope'

export type AdminClosedWindow = {
  id: string
  startIso: string
  endIso: string
  createdAtIso: string
  /** Shown on Remote schedule and in NINA errors when this window is active. */
  description?: string
}

type Payload = { windows?: AdminClosedWindow[] }
type GlobalState = typeof globalThis & {
  __pomfret_admin_closed_windows_by_site__?: Record<string, AdminClosedWindow[]>
}
function closedWindowsKvKey(): string {
  return scopedKvKey(REDIS_LIVE_KEYS.closedWindows)
}

function memoryWindows(): AdminClosedWindow[] {
  const g = globalThis as GlobalState
  if (!g.__pomfret_admin_closed_windows_by_site__) g.__pomfret_admin_closed_windows_by_site__ = {}
  const sid = currentObservatorySiteId()
  if (!g.__pomfret_admin_closed_windows_by_site__[sid]) g.__pomfret_admin_closed_windows_by_site__[sid] = []
  return g.__pomfret_admin_closed_windows_by_site__[sid]!
}

function normalize(w: AdminClosedWindow): AdminClosedWindow | null {
  const startMs = Date.parse(w.startIso)
  const endMs = Date.parse(w.endIso)
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return null
  if (!w.id || typeof w.id !== 'string') return null
  const description =
    typeof w.description === 'string' && w.description.trim()
      ? w.description.trim().slice(0, 200)
      : undefined
  return {
    id: w.id,
    startIso: w.startIso,
    endIso: w.endIso,
    createdAtIso:
      typeof w.createdAtIso === 'string' && Number.isFinite(Date.parse(w.createdAtIso))
        ? w.createdAtIso
        : w.startIso,
    ...(description ? { description } : {}),
  }
}

async function readAll(): Promise<AdminClosedWindow[]> {
  if (kvEnabled()) {
    const raw = await kvGetString(closedWindowsKvKey())
    if (raw !== undefined) {
      try {
        const remote = JSON.parse(raw) as Payload
        const windows = Array.isArray(remote?.windows) ? remote.windows : []
        return windows.map(normalize).filter((x): x is AdminClosedWindow => x != null)
      } catch {
        return []
      }
    }
  }
  if (postgresReadsEnabled()) {
    try {
      const { loadJsonDocumentsFromPostgres } = await import('@/lib/db/read')
      const pg = await loadJsonDocumentsFromPostgres<AdminClosedWindow>('windows')
      if (pg) {
        if (kvEnabled() && pg.length > 0) await kvSetJson(closedWindowsKvKey(), { windows: pg })
        return pg
      }
    } catch (error) {
      console.error('[pg-read] closed windows failed; using memory', error)
    }
  }
  return [...memoryWindows()]
}

async function writeAll(windows: AdminClosedWindow[]): Promise<void> {
  const sorted = [...windows].sort((a, b) => a.startIso.localeCompare(b.startIso))
  if (kvEnabled()) {
    const ok = await kvSetJson(closedWindowsKvKey(), { windows: sorted })
    if (ok) {
      const { mirrorAdminClosedWindows } = await import('@/lib/db/mirror')
      await mirrorAdminClosedWindows(sorted)
      return
    }
  }
  if (postgresReadsEnabled()) {
    const { mirrorAdminClosedWindows } = await import('@/lib/db/mirror')
    await mirrorAdminClosedWindows(sorted)
    return
  }
  const mem = memoryWindows()
  mem.splice(0, mem.length, ...sorted)
}

export async function listAdminClosedWindows(): Promise<AdminClosedWindow[]> {
  return readAll()
}

export async function addAdminClosedWindow(
  startIso: string,
  endIso: string,
  description: string
): Promise<AdminClosedWindow | { error: string }> {
  const startMs = Date.parse(startIso)
  const endMs = Date.parse(endIso)
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
    return { error: 'Invalid time range' }
  }
  const desc = description.trim().slice(0, 200)
  if (!desc) {
    return { error: 'description is required' }
  }
  const next: AdminClosedWindow = {
    id: crypto.randomUUID(),
    startIso: new Date(startMs).toISOString(),
    endIso: new Date(endMs).toISOString(),
    createdAtIso: new Date().toISOString(),
    description: desc,
  }
  const all = await readAll()
  all.push(next)
  await writeAll(all)
  return next
}

export async function removeAdminClosedWindow(id: string): Promise<boolean> {
  const all = await readAll()
  const next = all.filter((x) => x.id !== id)
  if (next.length === all.length) return false
  await writeAll(next)
  return true
}

export async function getAdminClosedWindowsInRange(startMs: number, endMs: number): Promise<Array<{ startMs: number; endMs: number }>> {
  const all = await readAll()
  const out: Array<{ startMs: number; endMs: number }> = []
  for (const w of all) {
    const s = Date.parse(w.startIso)
    const e = Date.parse(w.endIso)
    if (!Number.isFinite(s) || !Number.isFinite(e) || e <= s) continue
    const overlapStart = Math.max(startMs, s)
    const overlapEnd = Math.min(endMs, e)
    if (overlapEnd > overlapStart) out.push({ startMs: overlapStart, endMs: overlapEnd })
  }
  return out.sort((a, b) => a.startMs - b.startMs)
}

export async function isWithinAdminClosedWindow(atMs: number): Promise<boolean> {
  const w = await getAdminClosedWindowAt(atMs)
  return w != null
}

/** First admin closed window covering `atMs` (start inclusive, end exclusive). */
export async function getAdminClosedWindowAt(atMs: number): Promise<AdminClosedWindow | null> {
  const all = await readAll()
  for (const w of all) {
    const s = Date.parse(w.startIso)
    const e = Date.parse(w.endIso)
    if (!Number.isFinite(s) || !Number.isFinite(e) || e <= s) continue
    if (atMs >= s && atMs < e) return w
  }
  return null
}

