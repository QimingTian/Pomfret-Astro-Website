import type { NextRequest } from 'next/server'
import { getCurrentUser } from '@/lib/member-auth'
import { isAdminUser, normalizeMemberEmail } from '@/lib/member-store'
import { getProjectById, getProjectByNightSubId } from '@/lib/imaging-project-store'
import { getBoardEntry } from '@/lib/imaging-session-board'
import { getRequestById, type ImagingRequest } from '@/lib/imaging-queue-store'
import { verifySessionPasswordHash } from '@/lib/session-password'

export type ImagingSessionRefs = {
  req: ImagingRequest | null
  board: Awaited<ReturnType<typeof getBoardEntry>>
  project: Awaited<ReturnType<typeof getProjectById>>
  nightMatch: Awaited<ReturnType<typeof getProjectByNightSubId>>
  userId: string | null | undefined
  sessionPasswordHash: string | null | undefined
}

export async function resolveImagingSessionRefs(sessionId: string): Promise<ImagingSessionRefs | null> {
  const req = await getRequestById(sessionId)
  const board = await getBoardEntry(sessionId)
  const project = await getProjectById(sessionId)
  const nightMatch = await getProjectByNightSubId(sessionId)
  if (!req && !board && !project && !nightMatch) return null

  const userId =
    req?.userId ??
    board?.userId ??
    project?.userId ??
    nightMatch?.project.userId ??
    undefined

  const sessionPasswordHash =
    req?.sessionPasswordHash ??
    board?.sessionPasswordHash ??
    project?.sessionPasswordHash ??
    nightMatch?.project.sessionPasswordHash ??
    null

  return { req: req ?? null, board, project, nightMatch, userId, sessionPasswordHash }
}

/** Queue row, board row, project root, or project sub-session night id. */
export async function resolveImagingSessionContext(sessionId: string): Promise<{
  queueStatus: string
  req: ImagingRequest | null
} | null> {
  const refs = await resolveImagingSessionRefs(sessionId)
  if (!refs) return null
  return {
    req: refs.req,
    queueStatus:
      refs.req?.status ??
      refs.board?.status ??
      refs.nightMatch?.night.status ??
      refs.nightMatch?.project.status ??
      refs.project?.status ??
      'pending',
  }
}

function isLegacySessionPasswordAccess(hash: string | null | undefined): boolean {
  return typeof hash === 'string' && hash.length > 0
}

export async function authorizeImagingSession(
  request: NextRequest,
  sessionId: string,
  providedPassword: string | null
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const refs = await resolveImagingSessionRefs(sessionId)
  if (!refs) {
    return { ok: false, status: 404, error: 'Session not found' }
  }

  const user = await getCurrentUser(request)
  if (user && isAdminUser(user)) {
    return { ok: true }
  }
  if (user && refs.userId && refs.userId === user.id) {
    return { ok: true }
  }
  if (user && !refs.userId) {
    const sessionEmail =
      refs.req?.email ??
      refs.board?.email ??
      refs.project?.email ??
      refs.nightMatch?.project.email ??
      null
    if (sessionEmail && normalizeMemberEmail(sessionEmail) === user.email) {
      return { ok: true }
    }
  }

  if (!isLegacySessionPasswordAccess(refs.sessionPasswordHash)) {
    return { ok: false, status: 401, error: 'Authentication required.' }
  }

  if (!providedPassword || providedPassword.trim() === '') {
    return { ok: false, status: 401, error: 'Session password required' }
  }
  const isValid = await verifySessionPasswordHash(providedPassword, refs.sessionPasswordHash!)
  if (!isValid) {
    return { ok: false, status: 403, error: 'Invalid session password' }
  }
  return { ok: true }
}
