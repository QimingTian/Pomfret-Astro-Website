import { computeSiteImagingActive } from '@/lib/imaging/site-imaging-active'
import { kvEnabled, kvGetJson, kvSetJson } from '@/lib/kv-rest'
import { currentObservatorySiteId, scopedKvKey } from '@/lib/observatory-site-scope'

const KEY_BASE = 'imaging-site-poll-snapshot'
/** If writers missed an emit, rebuild from source stores at most this often. */
const STALE_MS = 45_000

export type SitePollSnapshot = {
  v: 1
  sessionsTick: string
  imagingActive: boolean
  updatedAtMs: number
}

type GlobalWithSnapshot = typeof globalThis & {
  __pomfret_site_poll_snapshot__?: Record<string, SitePollSnapshot>
  __pomfret_site_poll_refreshing__?: Record<string, Promise<SitePollSnapshot>>
}

function snapshotKvKey(): string {
  return scopedKvKey(KEY_BASE)
}

function memorySnapshot(): SitePollSnapshot | undefined {
  return (globalThis as GlobalWithSnapshot).__pomfret_site_poll_snapshot__?.[
    currentObservatorySiteId()
  ]
}

function setMemorySnapshot(snap: SitePollSnapshot): void {
  const g = globalThis as GlobalWithSnapshot
  if (!g.__pomfret_site_poll_snapshot__) g.__pomfret_site_poll_snapshot__ = {}
  g.__pomfret_site_poll_snapshot__[currentObservatorySiteId()] = snap
}

function sessionsTickFrom(
  queue: Array<{ updatedAt: string }>,
  boardLength: number
): string {
  let maxUpdated = 0
  for (const row of queue) {
    const t = Date.parse(row.updatedAt)
    if (Number.isFinite(t)) maxUpdated = Math.max(maxUpdated, t)
  }
  return `${queue.length}:${boardLength}:${maxUpdated}`
}

/** Rebuild the tiny site-poll blob from queue / board / projects (infrequent write path). */
export async function refreshSitePollSnapshot(): Promise<SitePollSnapshot> {
  const g = globalThis as GlobalWithSnapshot
  if (!g.__pomfret_site_poll_refreshing__) g.__pomfret_site_poll_refreshing__ = {}
  const siteId = currentObservatorySiteId()
  const inFlight = g.__pomfret_site_poll_refreshing__[siteId]
  if (inFlight) return inFlight

  g.__pomfret_site_poll_refreshing__[siteId] = (async () => {
    const { listAll } = await import('@/lib/imaging-queue-store')
    const { listBoardEntries } = await import('@/lib/imaging-session-board')
    const { listProjects } = await import('@/lib/imaging/project/store')
    const { isNinaReportedRunningNow } = await import('@/lib/observatory-status-store')

    const [queue, board, projects, ninaRunning] = await Promise.all([
      listAll(),
      listBoardEntries(),
      listProjects(),
      isNinaReportedRunningNow(),
    ])

    const snap: SitePollSnapshot = {
      v: 1,
      sessionsTick: sessionsTickFrom(queue, board.length),
      imagingActive: computeSiteImagingActive({
        queueRows: queue,
        boardRows: board,
        projects,
        ninaRunning,
      }),
      updatedAtMs: Date.now(),
    }

    setMemorySnapshot(snap)
    if (kvEnabled()) await kvSetJson(snapshotKvKey(), snap)
    return snap
  })().finally(() => {
    delete g.__pomfret_site_poll_refreshing__?.[siteId]
  })

  return g.__pomfret_site_poll_refreshing__[siteId]!
}

/**
 * Fast path for /api/imaging/site-poll: ~100B read instead of full projects+queue blobs.
 * Rebuilds when missing or older than STALE_MS.
 */
export async function getSitePollSnapshot(nowMs = Date.now()): Promise<SitePollSnapshot> {
  const mem = memorySnapshot()
  if (mem && nowMs - mem.updatedAtMs < STALE_MS) return mem

  if (kvEnabled()) {
    const remote = await kvGetJson<SitePollSnapshot>(snapshotKvKey())
    if (
      remote &&
      remote.v === 1 &&
      typeof remote.sessionsTick === 'string' &&
      typeof remote.imagingActive === 'boolean' &&
      typeof remote.updatedAtMs === 'number' &&
      nowMs - remote.updatedAtMs < STALE_MS
    ) {
      setMemorySnapshot(remote)
      return remote
    }
  }

  return refreshSitePollSnapshot()
}
