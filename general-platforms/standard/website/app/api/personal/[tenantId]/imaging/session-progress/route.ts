import { NextRequest } from 'next/server'
import {
  isPersonalEstopQueueId,
  personalGetEmergencyStopState,
  personalMarkEmergencyStopCompleted,
} from '@/lib/cloud/personal-emergency-stop'
import { personalJson, personalOptions } from '@/lib/cloud/route-helpers'

export const runtime = 'nodejs'

export function OPTIONS() {
  return personalOptions()
}

function progressLineText(detail: Record<string, unknown>): string {
  if (typeof detail.text === 'string') return detail.text
  if (typeof detail.message === 'string') return detail.message
  if (typeof detail.step === 'string') return detail.step
  return ''
}

function resolveQueueId(detail: Record<string, unknown>): string | null {
  const borean = detail.BoreanAstro
  if (borean && typeof borean === 'object' && !Array.isArray(borean)) {
    const queueId = (borean as Record<string, unknown>).QueueId
    if (typeof queueId === 'string' && queueId.trim()) return queueId.trim()
  }
  if (typeof detail.queueId === 'string' && detail.queueId.trim()) return detail.queueId.trim()
  return null
}

async function readBody(request: NextRequest): Promise<unknown> {
  const contentType = request.headers.get('content-type') ?? ''
  if (contentType.includes('application/json')) {
    return request.json().catch(() => null)
  }
  const raw = await request.text().catch(() => '')
  const trimmed = raw.trim()
  if (!trimmed) return null
  try {
    return JSON.parse(trimmed) as unknown
  } catch {
    return { text: raw }
  }
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ tenantId: string }> }
) {
  const { tenantId } = await context.params
  const body = await readBody(request)
  const detail =
    body && typeof body === 'object' && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : { text: typeof body === 'string' ? body : String(body ?? '') }

  const queueId = resolveQueueId(detail)
  if (queueId && isPersonalEstopQueueId(queueId)) {
    const line = progressLineText(detail).toLowerCase()
    if (line.includes('dome closed')) {
      await personalMarkEmergencyStopCompleted(tenantId, queueId)
      const estopState = await personalGetEmergencyStopState(tenantId)
      return personalJson({
        ok: true as const,
        queueId,
        phase: estopState?.phase ?? null,
      })
    }
  }

  return personalJson({ ok: true as const, queueId })
}
