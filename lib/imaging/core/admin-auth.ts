import type { NextRequest } from 'next/server'
import { getCurrentUser } from '@/lib/member-auth'
import { isAdminUser, type MemberUser } from '@/lib/member-store'

export type ImagingAdminActor = {
  displayName: string
  userId: string
  username: string
  email: string
}

/** Human-readable label for audit logs (prefer legal name over username/role). */
export function formatImagingAdminActor(
  user: Pick<MemberUser, 'id' | 'firstName' | 'lastName' | 'username' | 'email'>
): string {
  const display = `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim()
  if (display) return display
  const username = user.username?.trim()
  if (username && username.toLowerCase() !== 'admin') return username
  const email = user.email?.trim()
  if (email) return email
  return user.id
}

export function imagingAdminActorFromUser(user: MemberUser): ImagingAdminActor {
  return {
    displayName: formatImagingAdminActor(user),
    userId: user.id,
    username: user.username,
    email: user.email,
  }
}

export async function getAdminFromRequest(request: NextRequest): Promise<MemberUser | null> {
  const user = await getCurrentUser(request)
  if (user && isAdminUser(user)) return user
  return null
}

export async function requireImagingAdmin(
  request: NextRequest
): Promise<{ ok: true; user: MemberUser } | { ok: false; status: number; error: string }> {
  const user = await getCurrentUser(request)
  if (user && isAdminUser(user)) {
    return { ok: true, user }
  }
  return { ok: false, status: 403, error: 'Admin access required.' }
}
