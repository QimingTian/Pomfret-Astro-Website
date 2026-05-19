import { authorizeImagingSession, resolveImagingSessionContext } from '@/lib/imaging-session-access'
import type { NextRequest } from 'next/server'
import { getPreviewImage } from '@/lib/imaging-preview-store'
import { subscribePreview } from '@/lib/imaging-preview-live'

export const runtime = 'nodejs'

function sseData(payload: unknown): string {
  return `data: ${JSON.stringify(payload)}\n\n`
}

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const id = params.id
  if (!id) {
    return new Response(JSON.stringify({ ok: false, error: 'Missing id' }), { status: 400 })
  }

  const requestUrl = new URL(request.url)
  const providedPassword =
    request.headers.get('x-session-password')?.trim() ||
    requestUrl.searchParams.get('password')?.trim() ||
    null
  const auth = await authorizeImagingSession(request, id, providedPassword)
  if (!auth.ok) {
    return new Response(JSON.stringify({ ok: false, error: auth.error }), { status: auth.status })
  }

  const session = await resolveImagingSessionContext(id)
  if (!session) {
    return new Response(JSON.stringify({ ok: false, error: 'Not found' }), { status: 404 })
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder()
      const enqueue = (payload: unknown) => controller.enqueue(encoder.encode(sseData(payload)))

      const current = await getPreviewImage(id)
      enqueue({ type: 'snapshot', updatedAt: current?.updatedAt ?? null })

      const unsubscribe = subscribePreview(id, (updatedAt) => {
        enqueue({ type: 'updated', updatedAt })
      })

      const keepAlive = setInterval(() => {
        enqueue({ type: 'ping' })
      }, 15000)

      request.signal.addEventListener('abort', () => {
        clearInterval(keepAlive)
        unsubscribe()
        controller.close()
      })
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  })
}
