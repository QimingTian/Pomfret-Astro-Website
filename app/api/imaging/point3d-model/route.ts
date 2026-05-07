import { NextRequest } from 'next/server'
import { promises as fs } from 'fs'
import path from 'path'
import { withImagingCors, imagingCorsOptions } from '@/lib/imaging-queue-auth'

export const runtime = 'nodejs'

const MODEL_ROOT = path.join(process.cwd(), 'Nina.Point3D', 'Point3D', 'Resources')
const ALLOWED_MODELS = new Set([
  'Default.obj',
  'Reflector.obj',
  'Refractor.obj',
  'SchmidtCassegrain.obj',
  'RitcheyChretien.obj',
  'RitcheyChretienTruss.obj',
])

export function OPTIONS() {
  return imagingCorsOptions()
}

export async function GET(request: NextRequest) {
  const model = request.nextUrl.searchParams.get('model') ?? 'Reflector.obj'
  if (!ALLOWED_MODELS.has(model)) {
    return withImagingCors({ ok: false as const, error: 'Unknown model' }, 400)
  }

  const fullPath = path.join(MODEL_ROOT, model)
  try {
    const content = await fs.readFile(fullPath, 'utf8')
    return new Response(content, {
      status: 200,
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'public, max-age=3600',
        'Access-Control-Allow-Origin': '*',
      },
    })
  } catch {
    return withImagingCors({ ok: false as const, error: 'Model file not found' }, 404)
  }
}

