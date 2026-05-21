import { listProjects } from '@/lib/imaging-project-store'
import { listBoardEntries } from '@/lib/imaging-session-board'
import { listAll, type ImagingRequest } from '@/lib/imaging-queue-store'
import { syncMemberSessionHistoryArchive } from '@/lib/member-session-history-archive'
import { normalizeMemberEmail } from '@/lib/member-store'

export type MemberSessionHistoryRow = {
  id: string
  kind: 'queue' | 'board' | 'project'
  target: string
  status: string
  displayStatus: string
  createdAt: string
  updatedAt: string
  projectMode: boolean
  scheduleReasons?: string[]
  nights?: number
}

type Ownable = { userId?: string; email?: string | null }

function belongsToMember(row: Ownable, userId: string, userEmail: string): boolean {
  if (row.userId === userId) return true
  if (!row.userId && row.email) {
    return normalizeMemberEmail(row.email) === normalizeMemberEmail(userEmail)
  }
  return false
}

export function displayStatusForQueue(r: ImagingRequest): string {
  if (r.status === 'rejected') return 'rejected'
  if (r.status === 'pending' && r.scheduleReasons && r.scheduleReasons.length > 0) {
    return 'unscheduled'
  }
  return r.status
}

export function memberSessionHistoryRowFromQueue(r: ImagingRequest): MemberSessionHistoryRow {
  return {
    id: r.id,
    kind: r.projectMode ? 'project' : 'queue',
    target: r.target,
    status: r.status,
    displayStatus: displayStatusForQueue(r),
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    projectMode: r.projectMode ?? false,
    ...(r.scheduleReasons?.length ? { scheduleReasons: r.scheduleReasons } : {}),
  }
}

export async function listMemberSessionHistory(
  userId: string,
  userEmail: string
): Promise<MemberSessionHistoryRow[]> {
  const [queue, board, projects] = await Promise.all([listAll(), listBoardEntries(), listProjects()])
  const byId = new Map<string, MemberSessionHistoryRow>()

  for (const r of queue) {
    if (!belongsToMember(r, userId, userEmail)) continue
    const displayStatus = displayStatusForQueue(r)
    byId.set(r.id, {
      id: r.id,
      kind: 'queue',
      target: r.target,
      status: r.status,
      displayStatus,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      projectMode: r.projectMode ?? false,
      ...(r.scheduleReasons?.length ? { scheduleReasons: r.scheduleReasons } : {}),
    })
  }

  for (const e of board) {
    if (!belongsToMember(e, userId, userEmail)) continue
    byId.set(e.id, {
      id: e.id,
      kind: 'board',
      target: e.target,
      status: e.status,
      displayStatus: e.status,
      createdAt: e.createdAt,
      updatedAt: e.updatedAt,
      projectMode: e.projectMode ?? false,
    })
  }

  for (const p of projects) {
    if (!belongsToMember(p, userId, userEmail)) continue
    const existing = byId.get(p.id)
    if (existing) {
      byId.set(p.id, {
        ...existing,
        kind: 'project',
        status: p.status,
        displayStatus: p.status,
        projectMode: true,
        nights: p.nights.length,
        updatedAt: p.updatedAt,
      })
    } else {
      byId.set(p.id, {
        id: p.id,
        kind: 'project',
        target: p.target,
        status: p.status,
        displayStatus: p.status,
        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
        projectMode: true,
        nights: p.nights.length,
      })
    }
  }

  const live = Array.from(byId.values()).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  return syncMemberSessionHistoryArchive(userId, live)
}
