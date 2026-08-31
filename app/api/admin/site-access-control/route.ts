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
  normalizeSiteAccessControlSettings,
} from '@/lib/site-access-control'
import { OBSERVATORY_SITES } from '@/lib/observatory-sites'

export const runtime = 'nodejs'

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
      otherObservatories: OBSERVATORY_SITES.filter((s) => s.id !== site.id).map((s) => ({
        id: s.id,
        name: s.name,
      })),
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

    const settings = normalizeSiteAccessControlSettings(body)
    // Don't allow selecting the current site in other-obs scope.
    if (Array.isArray(settings.otherObservatoryMemberScope)) {
      settings.otherObservatoryMemberScope = settings.otherObservatoryMemberScope.filter(
        (id) => id !== site.id
      )
      if (settings.otherObservatoryMemberScope.length === 0) {
        settings.otherObservatoryMemberScope = 'all'
      }
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
