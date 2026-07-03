import {
  imagingCorsHeadersResolved,
  imagingCorsOptions,
} from '@/lib/imaging-queue-auth'
import type { NextRequest } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export function OPTIONS() {
  return imagingCorsOptions()
}

/**
 * Long-lived SSE burned Vercel Fluid GB-Hrs on Hobby (agent held 300s × 24/7).
 * Agent should use nina-sequence polling instead; see observatory/nina_agent.py.
 */
export async function GET(request: NextRequest) {
  void request
  return new Response(
    JSON.stringify({
      ok: false,
      error: 'Agent events SSE disabled; use nina-sequence polling.',
      code: 'sse_disabled',
    }),
    {
      status: 410,
      headers: {
        ...imagingCorsHeadersResolved(),
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
      },
    }
  )
}
