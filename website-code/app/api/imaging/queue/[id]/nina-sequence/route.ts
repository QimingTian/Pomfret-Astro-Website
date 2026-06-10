import { NextRequest, NextResponse } from 'next/server'
import {
  imagingCorsHeadersResolved,
  imagingCorsOptions,
  imagingQueueOrMemberAuthorized,
  imagingUnauthorized,
} from '@/lib/imaging-queue-auth'
import { getRequestById, VARIABLE_STAR_SESSION_OVERHEAD_SEC } from '@/lib/imaging-queue-store'
import { buildNinaSequenceJson } from '@/lib/build-nina-sequence-json'

export const runtime = 'nodejs'

export function OPTIONS() {
  return imagingCorsOptions()
}

/** Returns NINA sequence JSON for this queue item (member or observatory Bearer). */
export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  if (!(await imagingQueueOrMemberAuthorized(request))) {
    return imagingUnauthorized()
  }

  const id = params.id
  if (!id) {
    return NextResponse.json({ error: 'Missing id' }, { status: 400, headers: imagingCorsHeadersResolved() })
  }

  const row = await getRequestById(id)
  if (!row) {
    return NextResponse.json(
      { error: 'Session not found' },
      { status: 404, headers: imagingCorsHeadersResolved() }
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
        templateKind: row.sequenceTemplate === 'variable_star' ? 'variable_star' : 'dso',
        outputMode: row.outputMode,
        cameraCoolingTempC: row.cameraCoolingTempC,
        targetName: row.target ?? undefined,
        variableStarObservingSeconds:
          row.sequenceTemplate === 'variable_star' &&
          typeof row.estimatedDurationSeconds === 'number' &&
          Number.isFinite(row.estimatedDurationSeconds)
            ? Math.max(0, row.estimatedDurationSeconds - VARIABLE_STAR_SESSION_OVERHEAD_SEC)
            : undefined,
      })
    } catch {
      sequenceJson = undefined
    }
  }

  if (!sequenceJson) {
    return NextResponse.json(
      { error: 'NINA sequence not available for this session' },
      { status: 404, headers: imagingCorsHeadersResolved() }
    )
  }

  return new NextResponse(sequenceJson, {
    status: 200,
    headers: {
      ...imagingCorsHeadersResolved(),
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  })
}
