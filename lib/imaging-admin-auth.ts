import type { NextRequest } from 'next/server'
import { getCurrentUser } from '@/lib/member-auth'
import { isAdminUser, type MemberUser } from '@/lib/member-store'

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
