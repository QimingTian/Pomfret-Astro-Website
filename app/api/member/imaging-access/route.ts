import { NextRequest, NextResponse } from 'next/server'

import { runWithRequestSite } from '@/lib/imaging/run-with-request-site'
import { canSubmitImagingForSite } from '@/lib/member-access'
import { getCurrentUser } from '@/lib/member-auth'

export const runtime = 'nodejs'

/** Site-scoped imaging submit eligibility for the signed-in member. */
export async function GET(request: NextRequest) {
  return runWithRequestSite(request, async (site) => {
    const user = await getCurrentUser(request)
    if (!user) {
      return NextResponse.json({ ok: false, error: 'Sign in to submit a session.' }, { status: 401 })
    }
    const access = await canSubmitImagingForSite(user, site.id)
    return NextResponse.json({
      ok: true as const,
      siteId: site.id,
      canSubmit: access.ok,
      error: access.ok ? null : access.error,
    })
  })
}
