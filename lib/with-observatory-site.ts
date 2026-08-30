import { NextResponse } from 'next/server'
import {
  observatorySiteFromRequest,
  type ObservatorySite,
  type ObservatorySiteId,
} from '@/lib/observatory-sites'
import '@/lib/observatory-site-als'
import { withObservatorySiteAsync } from '@/lib/observatory-site-scope'

type Handler = (
  request: Request,
  site: ObservatorySite
) => Promise<Response> | Response

/**
 * Resolve site from the request and run the handler inside site ALS scope
 * so Redis/Postgres imaging stores hit the correct namespace.
 */
export function withRequestObservatorySite(handler: Handler) {
  return async (request: Request, ..._rest: unknown[]): Promise<Response> => {
    const site = observatorySiteFromRequest(request)
    return withObservatorySiteAsync(site.id, () => Promise.resolve(handler(request, site)))
  }
}

/** Same as {@link withRequestObservatorySite} but preserves Next.js route context. */
export function withRequestObservatorySiteCtx<Ctx>(
  handler: (request: Request, ctx: Ctx, site: ObservatorySite) => Promise<Response> | Response
) {
  return async (request: Request, ctx: Ctx): Promise<Response> => {
    const site = observatorySiteFromRequest(request)
    return withObservatorySiteAsync(site.id, () => Promise.resolve(handler(request, ctx, site)))
  }
}

export function jsonWithSite(
  body: unknown,
  siteId: ObservatorySiteId,
  init?: ResponseInit
): NextResponse {
  const res = NextResponse.json(body, init)
  res.headers.set('X-Observatory-Site', siteId)
  return res
}
