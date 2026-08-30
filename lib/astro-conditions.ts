import { currentObservatorySite } from '@/lib/observatory-site-scope'

/** 7Timer ASTRO scale 1–8 (lower = better). */
export type AstroConditionScale = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8

export type AstroConditions = {
  transparency: AstroConditionScale | null
  seeing: AstroConditionScale | null
  init: string | null
  timepointHours: number | null
}

const SCALE_LABELS: Record<AstroConditionScale, string> = {
  1: 'Excellent',
  2: 'Very Good',
  3: 'Good',
  4: 'Average',
  5: 'Below Average',
  6: 'Poor',
  7: 'Very Poor',
  8: 'Bad',
}

export function sevenTimerAstroUrl(): string {
  const site = currentObservatorySite()
  return (
    `https://www.7timer.info/bin/astro.php?lon=${site.observerLonDeg}&lat=${site.observerLatDeg}` +
    '&ac=0&unit=metric&output=json&tzshift=0'
  )
}

export function parseSevenTimerInitUtc(init: string): Date | null {
  if (!/^\d{10}$/.test(init)) return null
  const y = Number(init.slice(0, 4))
  const m = Number(init.slice(4, 6)) - 1
  const d = Number(init.slice(6, 8))
  const h = Number(init.slice(8, 10))
  const date = new Date(Date.UTC(y, m, d, h))
  return Number.isNaN(date.getTime()) ? null : date
}

function asScale(n: unknown): AstroConditionScale | null {
  if (typeof n !== 'number' || !Number.isFinite(n)) return null
  const v = Math.round(n)
  if (v < 1 || v > 8) return null
  return v as AstroConditionScale
}

/** Pick the forecast step whose center is closest to `now` (3-hour steps after init). */
export function pickCurrentAstroSeriesEntry<T extends { timepoint?: number }>(
  init: string,
  dataseries: T[],
  now: Date = new Date()
): T | null {
  const initUtc = parseSevenTimerInitUtc(init)
  if (!initUtc || !Array.isArray(dataseries) || dataseries.length === 0) return null

  let best: T | null = null
  let bestDist = Number.POSITIVE_INFINITY
  for (const entry of dataseries) {
    const tp = entry.timepoint
    if (typeof tp !== 'number' || !Number.isFinite(tp)) continue
    const validAt = initUtc.getTime() + tp * 3_600_000
    const dist = Math.abs(validAt - now.getTime())
    if (dist < bestDist) {
      bestDist = dist
      best = entry
    }
  }
  return best
}

export function formatAstroConditionLabel(scale: AstroConditionScale | null): string {
  if (scale == null) return '—'
  return `${SCALE_LABELS[scale]} (${scale})`
}

/** Red when worse than Average (5–8). */
export function astroConditionIsRed(scale: AstroConditionScale | null): boolean {
  return scale != null && scale >= 5
}

/** Observatory Ready gate: Average (4) or better; null fails closed. */
export const OBSERVATORY_READY_MAX_ASTRO_CONDITION = 4

export function astroConditionIsReady(scale: AstroConditionScale | null | undefined): boolean {
  return scale != null && scale <= OBSERVATORY_READY_MAX_ASTRO_CONDITION
}

export type SevenTimerAstroSeries = {
  init: string
  dataseries: Array<{ timepoint?: number; seeing?: number; transparency?: number }>
}

export async function fetchSevenTimerAstroSeries(): Promise<SevenTimerAstroSeries | null> {
  try {
    const res = await fetch(sevenTimerAstroUrl(), {
      cache: 'no-store',
      headers: { Accept: 'application/json' },
    })
    if (!res.ok) return null
    const data = (await res.json()) as {
      init?: string
      dataseries?: Array<{ timepoint?: number; seeing?: number; transparency?: number }>
    }
    const init = typeof data.init === 'string' ? data.init : null
    if (!init || !Array.isArray(data.dataseries) || data.dataseries.length === 0) return null
    return { init, dataseries: data.dataseries }
  } catch {
    return null
  }
}

export function astroConditionsForInstant(
  series: SevenTimerAstroSeries,
  instant: Date
): Pick<AstroConditions, 'transparency' | 'seeing'> {
  const entry = pickCurrentAstroSeriesEntry(series.init, series.dataseries, instant)
  if (!entry) return { transparency: null, seeing: null }
  return {
    transparency: asScale(entry.transparency),
    seeing: asScale(entry.seeing),
  }
}

export async function fetchAstroConditions(now: Date = new Date()): Promise<AstroConditions> {
  const empty: AstroConditions = {
    transparency: null,
    seeing: null,
    init: null,
    timepointHours: null,
  }
  const series = await fetchSevenTimerAstroSeries()
  if (!series) return empty
  const entry = pickCurrentAstroSeriesEntry(series.init, series.dataseries, now)
  if (!entry) return empty
  return {
    transparency: asScale(entry.transparency),
    seeing: asScale(entry.seeing),
    init: series.init,
    timepointHours:
      typeof entry.timepoint === 'number' && Number.isFinite(entry.timepoint)
        ? entry.timepoint
        : null,
  }
}
