import { getBoardEntry } from '@/lib/imaging-session-board'
import { getRequestById } from '@/lib/imaging-queue-store'
import { verifySessionPasswordHash } from '@/lib/session-password'

export async function validateSessionPassword(
  sessionId: string,
  providedPassword: string | null
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const req = await getRequestById(sessionId)
  const board = await getBoardEntry(sessionId)
  const hash = req?.sessionPasswordHash ?? board?.sessionPasswordHash ?? null

  if (!req && !board) {
    return { ok: false, status: 404, error: 'Session not found' }
  }
  if (!hash) {
    // Backward compatibility for sessions created before password support.
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
