import {
  observatorySiteFromRequest,
  type ObservatorySite,
} from '@/lib/observatory-sites'
import '@/lib/observatory-site-als'
import { withObservatorySiteAsync } from '@/lib/observatory-site-scope'

/**
 * Bind imaging Redis/Postgres stores to the site resolved from the request
 * (query / header / cookie; default pomfret).
 */
export function runWithRequestSite<T>(
  request: Request,
  fn: (site: ObservatorySite) => Promise<T> | T
): Promise<T> {
  const site = observatorySiteFromRequest(request)
  return withObservatorySiteAsync(site.id, () => Promise.resolve(fn(site)))
}

export function wrapImagingRoute<Req extends Request, Ctx = unknown>(
  handler: (request: Req, ctx: Ctx, site: ObservatorySite) => Promise<Response> | Response
): (request: Req, ctx: Ctx) => Promise<Response>
export function wrapImagingRoute<Req extends Request>(
  handler: (request: Req, site: ObservatorySite) => Promise<Response> | Response
): (request: Req) => Promise<Response>
export function wrapImagingRoute(handler: (...args: never[]) => unknown) {
  return async (request: Request, ctx?: unknown): Promise<Response> => {
    const site = observatorySiteFromRequest(request)
    return withObservatorySiteAsync(site.id, async () => {
      if (handler.length >= 3) {
        return (await (handler as (r: Request, c: unknown, s: ObservatorySite) => Promise<Response>)(
          request,
          ctx,
          site
        )) as Response
      }
      return (await (handler as (r: Request, s: ObservatorySite) => Promise<Response>)(
        request,
        site
      )) as Response
    })
  }
}
