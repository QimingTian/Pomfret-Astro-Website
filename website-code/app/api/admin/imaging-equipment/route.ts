import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/member-auth'
import {
  isEquipmentValid,
  normalizeEquipment,
  type ImagingEquipment,
} from '@/lib/imaging/equipment/equipment'
import {
  deleteImagingRigAt,
  listImagingRigs,
  setImagingRigAt,
} from '@/lib/imaging/equipment/equipment-store'

export const runtime = 'nodejs'

export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request)
  if (!auth.ok) {
    return NextResponse.json(auth.body, { status: auth.status })
  }
  const rigs = await listImagingRigs()
  return NextResponse.json({ ok: true, rigs })
}

export async function PUT(request: NextRequest) {
  const auth = await requireAdmin(request)
  if (!auth.ok) {
    return NextResponse.json(auth.body, { status: auth.status })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON.' }, { status: 400 })
  }

  if (!body || typeof body !== 'object') {
    return NextResponse.json({ ok: false, error: 'Expected equipment payload.' }, { status: 400 })
  }

  const index = typeof (body as { index?: unknown }).index === 'number' ? (body as { index: number }).index : 0
  const equipmentRaw = (body as { equipment?: unknown }).equipment
  if (!equipmentRaw || typeof equipmentRaw !== 'object') {
    return NextResponse.json({ ok: false, error: 'Expected equipment object.' }, { status: 400 })
  }

  const parsed = normalizeEquipment(equipmentRaw as Partial<ImagingEquipment>)
  if (!parsed || !isEquipmentValid(parsed)) {
    return NextResponse.json({ ok: false, error: 'Invalid imaging equipment.' }, { status: 400 })
  }

  const rigs = await setImagingRigAt(index, parsed)
  if (!rigs) {
    return NextResponse.json({ ok: false, error: 'Could not save equipment.' }, { status: 500 })
  }

  return NextResponse.json({ ok: true, rigs, equipment: rigs[index] ?? parsed })
}

export async function DELETE(request: NextRequest) {
  const auth = await requireAdmin(request)
  if (!auth.ok) {
    return NextResponse.json(auth.body, { status: auth.status })
  }

  const indexParam = request.nextUrl.searchParams.get('index')
  const index = indexParam != null ? Number.parseInt(indexParam, 10) : 0
  if (!Number.isFinite(index) || index < 0) {
    return NextResponse.json({ ok: false, error: 'Invalid rig index.' }, { status: 400 })
  }

  const rigs = await deleteImagingRigAt(index)
  return NextResponse.json({ ok: true, rigs })
}
