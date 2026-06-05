import { NextRequest, NextResponse } from 'next/server'

import {
  appendAutoTuningSample,
  getAutoTuningHistory,
  type AutoTuningSample,
} from '@/lib/auto-tuning-history'
import { requireAdmin } from '@/lib/member-auth'
import { kvEnabled } from '@/lib/kv-rest'

export const runtime = 'nodejs'

function isSample(body: unknown): body is AutoTuningSample {
  if (!body || typeof body !== 'object') return false
  const s = body as Record<string, unknown>
  return (
    typeof s.frameIso === 'string' &&
    typeof s.recordedAt === 'string' &&
    typeof s.meanRgb === 'number' &&
    typeof s.meanR === 'number' &&
    typeof s.meanG === 'number' &&
    typeof s.meanB === 'number' &&
    typeof s.expError === 'number' &&
    typeof s.rDiff === 'number' &&
    typeof s.bDiff === 'number' &&
    typeof s.expAction === 'string' &&
    typeof s.wbAction === 'string' &&
    typeof s.photoExposureUs === 'number' &&
    typeof s.wbR === 'number' &&
    typeof s.wbB === 'number' &&
    typeof s.expDeltaUs === 'number' &&
    typeof s.wbRDelta === 'number' &&
    typeof s.wbBDelta === 'number'
  )
}

/** GET — last N auto tuning samples (admin, Vercel KV). */
export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request)
  if (!auth.ok) {
    return NextResponse.json(auth.body, { status: auth.status })
  }
  if (!kvEnabled()) {
    return NextResponse.json(
      { ok: false, error: 'KV not configured (KV_REST_API_URL / KV_REST_API_TOKEN)' },
      { status: 503 },
    )
  }
  const history = await getAutoTuningHistory()
  return NextResponse.json({ ok: true, ...history })
}

/** POST — append one sample after a new auto frame (admin). */
export async function POST(request: NextRequest) {
  const auth = await requireAdmin(request)
  if (!auth.ok) {
    return NextResponse.json(auth.body, { status: auth.status })
  }
  if (!kvEnabled()) {
    return NextResponse.json(
      { ok: false, error: 'KV not configured (KV_REST_API_URL / KV_REST_API_TOKEN)' },
      { status: 503 },
    )
  }
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON body' }, { status: 400 })
  }
  if (!isSample(body)) {
    return NextResponse.json({ ok: false, error: 'Invalid sample payload' }, { status: 400 })
  }
  const history = await appendAutoTuningSample(body)
  return NextResponse.json({ ok: true, ...history })
}
