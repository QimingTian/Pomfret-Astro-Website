import { NextRequest, NextResponse } from 'next/server'
import { listMemberSessionHistory } from '@/lib/member-session-history'
import { listAll, toPublicImagingRequest } from '@/lib/imaging-queue-store'
import { requireUser } from '@/lib/member-auth'

export const runtime = 'nodejs'

export async function GET(request: NextRequest) {
  const auth = await requireUser(request)
  if (!auth.ok) {
    return NextResponse.json(auth.body, { status: auth.status })
  }

  const userId = auth.user.id
  const userEmail = auth.user.email
  const sessions = await listMemberSessionHistory(userId, userEmail)

  const pendingQueue = (await listAll())
    .filter((r) => r.userId === userId && (r.status === 'pending' || r.status === 'scheduled'))
    .map((r) => toPublicImagingRequest(r))

  return NextResponse.json({
    ok: true as const,
    sessions,
    pendingQueue,
  })
}
