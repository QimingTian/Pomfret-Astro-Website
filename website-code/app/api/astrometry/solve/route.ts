import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const maxDuration = 60

const NOVA_BASE = 'https://nova.astrometry.net/api'
const MAX_IMAGE_UPLOAD_BYTES = 4 * 1024 * 1024
const MAX_FITS_UPLOAD_BYTES = 20 * 1024 * 1024

function isFitsFilename(filename: string): boolean {
  return /\.(fit|fits|fts)$/i.test(filename)
}

function uploadMimeType(filename: string): string {
  const lower = filename.toLowerCase()
  if (lower.endsWith('.png')) return 'image/png'
  if (/\.jpe?g$/.test(lower)) return 'image/jpeg'
  if (isFitsFilename(lower)) return 'application/fits'
  return 'application/octet-stream'
}

type NovaSubmission = {
  jobs?: Array<number | null>
  processing_finished?: string | null
  error_message?: string | null
}

function novaProcessingFinished(value: unknown): boolean {
  if (value == null || value === false) return false
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed || trimmed.toLowerCase() === 'none' || trimmed.toLowerCase() === 'null') return false
    return true
  }
  return Boolean(value)
}

async function novaLogin(apiKey: string): Promise<string | null> {
  const body = new URLSearchParams({ 'request-json': JSON.stringify({ apikey: apiKey }) })
  try {
    const res = await fetch(`${NOVA_BASE}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      cache: 'no-store',
    })
    const data = (await res.json()) as { status?: string; session?: string }
    return data.status === 'success' && data.session ? data.session : null
  } catch {
    return null
  }
}

export async function POST(request: NextRequest) {
  const apiKey = process.env.ASTROMETRY_API_KEY
  if (!apiKey) {
    return NextResponse.json(
      { error: 'Plate solving is not configured on the server (missing ASTROMETRY_API_KEY).' },
      { status: 503 },
    )
  }

  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return NextResponse.json({ error: 'Expected a multipart form upload.' }, { status: 400 })
  }
  const file = form.get('file')
  if (!(file instanceof Blob)) {
    return NextResponse.json({ error: 'Missing image file.' }, { status: 400 })
  }
  const filename = file instanceof File && file.name ? file.name : 'upload.jpg'
  const maxBytes = isFitsFilename(filename) ? MAX_FITS_UPLOAD_BYTES : MAX_IMAGE_UPLOAD_BYTES
  if (file.size > maxBytes) {
    return NextResponse.json(
      {
        error: `File is too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Maximum upload is ${maxBytes / 1024 / 1024} MB.`,
      },
      { status: 413 },
    )
  }

  const session = await novaLogin(apiKey)
  if (!session) {
    return NextResponse.json({ error: 'astrometry.net authentication failed. Check the API key.' }, { status: 502 })
  }

  const upload = new FormData()
  upload.append(
    'request-json',
    JSON.stringify({
      session,
      publicly_visible: 'n',
      allow_modifications: 'n',
      allow_commercial_use: 'n',
    }),
  )
  const bytes = Buffer.from(await file.arrayBuffer())
  upload.append('file', new Blob([bytes], { type: uploadMimeType(filename) }), filename)

  try {
    const res = await fetch(`${NOVA_BASE}/upload`, { method: 'POST', body: upload, cache: 'no-store' })
    const data = (await res.json()) as { status?: string; subid?: number }
    if (data.status !== 'success' || data.subid == null) {
      return NextResponse.json({ error: 'astrometry.net upload was rejected.' }, { status: 502 })
    }
    return NextResponse.json({ ok: true, subid: data.subid })
  } catch {
    return NextResponse.json({ error: 'astrometry.net upload failed.' }, { status: 502 })
  }
}

export async function GET(request: NextRequest) {
  const subid = request.nextUrl.searchParams.get('subid')
  if (!subid) return NextResponse.json({ error: 'Missing subid.' }, { status: 400 })

  let sub: NovaSubmission | null = null
  try {
    sub = await fetch(`${NOVA_BASE}/submissions/${subid}`, { cache: 'no-store' }).then((r) => r.json())
  } catch {
    return NextResponse.json({ status: 'processing' })
  }

  const jobs = Array.isArray(sub?.jobs) ? sub!.jobs.filter((j): j is number => j != null) : []
  if (jobs.length === 0) {
    if (!novaProcessingFinished(sub?.processing_finished)) {
      return NextResponse.json({ status: 'processing' })
    }
    const error =
      typeof sub?.error_message === 'string' && sub.error_message.trim()
        ? sub.error_message.trim()
        : null
    if (error) {
      return NextResponse.json({ status: 'no-job', error })
    }
    return NextResponse.json({ status: 'solving' })
  }

  const jobId = jobs[0]
  let job: { status?: string } | null = null
  try {
    job = await fetch(`${NOVA_BASE}/jobs/${jobId}`, { cache: 'no-store' }).then((r) => r.json())
  } catch {
    return NextResponse.json({ status: 'solving' })
  }

  if (job?.status === 'failure') return NextResponse.json({ status: 'failure' })
  if (job?.status !== 'success') return NextResponse.json({ status: 'solving' })

  try {
    const cal = (await fetch(`${NOVA_BASE}/jobs/${jobId}/calibration/`, { cache: 'no-store' }).then((r) =>
      r.json(),
    )) as {
      pixscale?: number
      orientation?: number
      parity?: number
      radius?: number
      ra?: number
      dec?: number
    }
    return NextResponse.json({
      status: 'success',
      calibration: {
        arcsecPerPixel: cal.pixscale ?? null,
        orientationDeg: cal.orientation ?? null,
        parity: cal.parity ?? null,
        radiusDeg: cal.radius ?? null,
        ra: cal.ra ?? null,
        dec: cal.dec ?? null,
      },
    })
  } catch {
    return NextResponse.json({ status: 'solving' })
  }
}
