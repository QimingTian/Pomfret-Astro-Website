import { NextRequest } from 'next/server'
import { imagingCorsOptions, withImagingCors } from '@/lib/imaging-queue-auth'

export const runtime = 'nodejs'

type ParsedResolvedObject = {
  canonicalName: string
  aliases: string[]
  raHours: number
  decDeg: number
}

function degreesToRaParts(raDeg: number) {
  const totalSeconds = (raDeg / 15) * 3600
  const hour = Math.floor(totalSeconds / 3600)
  const minute = Math.floor((totalSeconds - hour * 3600) / 60)
  const second = Number((totalSeconds - hour * 3600 - minute * 60).toFixed(2))
  return { hour, minute, second }
}

function degreesToDecParts(decDeg: number) {
  const sign: '+' | '-' = decDeg >= 0 ? '+' : '-'
  const abs = Math.abs(decDeg)
  const totalSeconds = abs * 3600
  const degree = Math.floor(totalSeconds / 3600)
  const minute = Math.floor((totalSeconds - degree * 3600) / 60)
  const second = Number((totalSeconds - degree * 3600 - minute * 60).toFixed(2))
  return { sign, degree, minute, second }
}

function parseSesameXml(xml: string): ParsedResolvedObject | null {
  const raMatch = xml.match(/<jradeg>([^<]+)<\/jradeg>/i)
  const decMatch = xml.match(/<jdedeg>([^<]+)<\/jdedeg>/i)
  if (!raMatch || !decMatch) return null

  const raDeg = Number(raMatch[1])
  const decDeg = Number(decMatch[1])
  if (!Number.isFinite(raDeg) || !Number.isFinite(decDeg)) return null

  const canonicalName =
    xml.match(/<oname>([^<]+)<\/oname>/i)?.[1]?.trim() ??
    xml.match(/<name>([^<]+)<\/name>/i)?.[1]?.trim() ??
    'Unknown target'

  const aliases = Array.from(xml.matchAll(/<alias>([^<]+)<\/alias>/gi))
    .map((m) => m[1]?.trim())
    .filter((v): v is string => Boolean(v))
    .slice(0, 12)

  return {
    canonicalName,
    aliases,
    raHours: Number((raDeg / 15).toFixed(8)),
    decDeg: Number(decDeg.toFixed(8)),
  }
}

export function OPTIONS() {
  return imagingCorsOptions()
}

const SESAME_MIRRORS: Array<{ url: (q: string) => string; label: string }> = [
  {
    label: 'Strasbourg (CDS)',
    url: (q) =>
      `https://cdsweb.u-strasbg.fr/cgi-bin/nph-sesame/-oxp/~SNV?${encodeURIComponent(q)}`,
  },
  {
    label: 'Harvard CfA (VizieR mirror)',
    url: (q) =>
      `https://vizier.cfa.harvard.edu/viz-bin/nph-sesame/-oxp/~SNV?${encodeURIComponent(q)}`,
  },
]

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get('query')?.trim() ?? ''
  if (!query) {
    return withImagingCors({ ok: false as const, error: 'query is required' }, 400)
  }
  if (query.length > 120) {
    return withImagingCors({ ok: false as const, error: 'query is too long' }, 400)
  }

  let lastError = 'Catalog lookup unavailable right now.'
  let sawHttpOk = false

  for (let i = 0; i < SESAME_MIRRORS.length; i++) {
    const mirror = SESAME_MIRRORS[i]!
    try {
      const res = await fetch(mirror.url(query), {
        method: 'GET',
        headers: { Accept: 'application/xml,text/xml;q=0.9,*/*;q=0.8' },
        cache: 'no-store',
      })
      if (!res.ok) {
        lastError =
          i < SESAME_MIRRORS.length - 1
            ? `Name resolver (${mirror.label}) returned ${res.status}; trying backup…`
            : `Name resolver (${mirror.label}) failed (${res.status}).`
        continue
      }
      sawHttpOk = true
      const xml = await res.text()
      const parsed = parseSesameXml(xml)
      if (parsed) {
        return withImagingCors({
          ok: true as const,
          object: {
            query,
            canonicalName: parsed.canonicalName,
            aliases: parsed.aliases,
            raHours: parsed.raHours,
            decDeg: parsed.decDeg,
            ra: degreesToRaParts(parsed.raHours * 15),
            dec: degreesToDecParts(parsed.decDeg),
          },
        })
      }
      lastError =
        i < SESAME_MIRRORS.length - 1
          ? `No coordinates from ${mirror.label}; trying Harvard CfA mirror…`
          : 'Target not found. Try a name like M31, NGC 7000, or IC 434.'
    } catch {
      lastError =
        i < SESAME_MIRRORS.length - 1
          ? `${mirror.label} unreachable; trying Harvard CfA mirror…`
          : 'Catalog lookup unavailable right now.'
    }
  }

  const status = sawHttpOk ? 404 : 502
  return withImagingCors({ ok: false as const, error: lastError }, status)
}
