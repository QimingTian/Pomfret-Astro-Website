import { NextRequest, NextResponse } from 'next/server'
import { isSameSiteMutation } from '@/lib/csrf-origin'
import { runWithRequestSite } from '@/lib/imaging/run-with-request-site'
import { requireImagingAdmin } from '@/lib/imaging/core/admin-auth'
import {
  getSiteAccessControlSettings,
  setSiteAccessControlSettings,
} from '@/lib/site-policies'
import {
  guestAccessModeFromSettings,
  normalizeProjectDurationLimitHours,
  type SiteAccessControlSettings,
} from '@/lib/site-access-control'

export const runtime = 'nodejs'

function parseSettings(body: unknown): SiteAccessControlSettings | null {
  if (!body || typeof body !== 'object') return null
  const rec = body as Record<string, unknown>
  const openToGuest = rec.openToGuest === true
  const guestSessionRequiresApproval = rec.guestSessionRequiresApproval === true
  const memberProjectDurationLimitHours = normalizeProjectDurationLimitHours(
    rec.memberProjectDurationLimitHours
  )
  return {
    openToGuest,
    guestSessionRequiresApproval: openToGuest ? guestSessionRequiresApproval : false,
    memberProjectDurationLimitHours,
  }
}

/** GET — per-site access control settings for the active observatory. */
export async function GET(request: NextRequest) {
  return runWithRequestSite(request, async (site) => {
    const auth = await requireImagingAdmin(request, site.id)
    if (!auth.ok) {
      return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status })
    }

    const settings = await getSiteAccessControlSettings(site.id)
    return NextResponse.json({
      ok: true as const,
      siteId: site.id,
      siteName: site.name,
      settings,
      guestAccessMode: guestAccessModeFromSettings(settings),
    })
  })
}

/** PATCH — update per-site access control settings. */
export async function PATCH(request: NextRequest) {
  return runWithRequestSite(request, async (site) => {
    const auth = await requireImagingAdmin(request, site.id)
    if (!auth.ok) {
      return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status })
    }
    if (!isSameSiteMutation(request)) {
      return NextResponse.json({ ok: false, error: 'Invalid request origin.' }, { status: 403 })
    }

    let body: unknown
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ ok: false, error: 'Invalid JSON body' }, { status: 400 })
    }

    const settings = parseSettings(body)
    if (!settings) {
      return NextResponse.json({ ok: false, error: 'Invalid access control settings.' }, { status: 400 })
    }

    await setSiteAccessControlSettings(site.id, settings)
    return NextResponse.json({
      ok: true as const,
      siteId: site.id,
      settings,
      guestAccessMode: guestAccessModeFromSettings(settings),
    })
  })
}
