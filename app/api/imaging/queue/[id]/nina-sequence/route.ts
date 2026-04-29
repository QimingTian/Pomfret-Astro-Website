import { NextRequest, NextResponse } from 'next/server'
import {
  imagingCorsHeaders,
  imagingCorsOptions,
} from '@/lib/imaging-queue-auth'
import { getRequestById } from '@/lib/imaging-queue-store'
import { buildNinaSequenceJson } from '@/lib/build-nina-sequence-json'

export const runtime = 'nodejs'

export function OPTIONS() {
  return imagingCorsOptions()
}

/** Returns the generated NINA sequence JSON for this queue item (same auth as the queue API). */
export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const id = params.id
  if (!id) {
    return NextResponse.json({ error: 'Missing id' }, { status: 400, headers: imagingCorsHeaders })
  }

  const row = await getRequestById(id)
  if (!row) {
    return NextResponse.json(
      { error: 'Session not found' },
      { status: 404, headers: imagingCorsHeaders }
    )
  }

  let sequenceJson = row.ninaSequenceJson
  if (!sequenceJson && row.raHours != null && row.decDeg != null && row.filter) {
    try {
      sequenceJson = buildNinaSequenceJson({
        raHoursDecimal: row.raHours,
        decDegDecimal: row.decDeg,
        filterName: row.filter,
        exposureSeconds: row.exposureSeconds,
        exposureCount: row.count,
        pomfretQueueId: row.id,
      })
    } catch {
      sequenceJson = undefined
    }
  }

  if (!sequenceJson) {
    return NextResponse.json(
      { error: 'NINA sequence not available for this session' },
      { status: 404, headers: imagingCorsHeaders }
    )
  }

  return new NextResponse(sequenceJson, {
    status: 200,
    headers: {
      ...imagingCorsHeaders,
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  })
}
