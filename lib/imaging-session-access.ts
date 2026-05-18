import { getProjectById, getProjectByNightSubId } from '@/lib/imaging-project-store'
import { getBoardEntry } from '@/lib/imaging-session-board'
import { getRequestById, type ImagingRequest } from '@/lib/imaging-queue-store'
import { verifySessionPasswordHash } from '@/lib/session-password'

/** Queue row, board row, project root, or project sub-session night id. */
export async function resolveImagingSessionContext(sessionId: string): Promise<{
  queueStatus: string
  req: ImagingRequest | null
} | null> {
  const req = await getRequestById(sessionId)
  const board = await getBoardEntry(sessionId)
  const project = await getProjectById(sessionId)
  const nightMatch = await getProjectByNightSubId(sessionId)
  if (!req && !board && !project && !nightMatch) return null
  return {
    req: req ?? null,
    queueStatus:
      req?.status ??
      board?.status ??
      nightMatch?.night.status ??
      nightMatch?.project.status ??
      project?.status ??
      'pending',
  }
}

export async function validateSessionPassword(
  sessionId: string,
  providedPassword: string | null
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const req = await getRequestById(sessionId)
  const board = await getBoardEntry(sessionId)
  const project = await getProjectById(sessionId)
  const nightMatch = await getProjectByNightSubId(sessionId)
  const hash =
    req?.sessionPasswordHash ??
    board?.sessionPasswordHash ??
    project?.sessionPasswordHash ??
    nightMatch?.project.sessionPasswordHash ??
    null

  if (!req && !board && !project && !nightMatch) {
    return { ok: false, status: 404, error: 'Session not found' }
  }
  if (!hash) {
    return { ok: true }
  }
  if (!providedPassword || providedPassword.trim() === '') {
    return { ok: false, status: 401, error: 'Session password required' }
  }
  const isValid = await verifySessionPasswordHash(providedPassword, hash)
  if (!isValid) {
    return { ok: false, status: 403, error: 'Invalid session password' }
  }
  return { ok: true }
}
