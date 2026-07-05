import { NextRequest, NextResponse } from 'next/server'
import { requireUser } from '@/lib/member-auth'
import { listImagingRigs } from '@/lib/imaging/equipment/equipment-store'
import { isEquipmentValid } from '@/lib/imaging/equipment/equipment'

export const runtime = 'nodejs'

export async function GET(request: NextRequest) {
  const auth = await requireUser(request)
  if (!auth.ok) {
    return NextResponse.json(auth.body, { status: auth.status })
  }
  const allRigs = await listImagingRigs()
  const rigs = allRigs.flatMap((equipment, index) =>
    isEquipmentValid(equipment) ? [{ index, equipment }] : [],
  )
  const equipment = rigs[0]?.equipment ?? null
  return NextResponse.json({ ok: true, equipment, rigs })
}
