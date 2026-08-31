import { NextRequest, NextResponse } from 'next/server'
import { listMemberSessionHistory } from '@/lib/member-session-history'
import { listAll, toPublicImagingRequest } from '@/lib/imaging-queue-store'
import { requireUser } from '@/lib/member-auth'
import { withObservatorySiteAsync } from '@/lib/observatory-site-scope'
import { OBSERVATORY_SITES } from '@/lib/observatory-sites'

export const runtime = 'nodejs'

/** GET — member session history across all observatories (not header-scoped). */
export async function GET(request: NextRequest) {
  void request
  const auth = await requireUser(request)
  if (!auth.ok) {
    return NextResponse.json(auth.body, { status: auth.status })
  }

  const userId = auth.user.id
  const userEmail = auth.user.email
  const sessions = await listMemberSessionHistory(userId, userEmail)

  const pendingQueue = (
    await Promise.all(
      OBSERVATORY_SITES.map((site) =>
        withObservatorySiteAsync(site.id, async () =>
          (await listAll())
            .filter((r) => r.userId === userId && (r.status === 'pending' || r.status === 'scheduled'))
            .map((r) => toPublicImagingRequest(r))
        )
      )
    )
  ).flat()

  return NextResponse.json({
    ok: true as const,
    sessions,
    pendingQueue,
  })
}
