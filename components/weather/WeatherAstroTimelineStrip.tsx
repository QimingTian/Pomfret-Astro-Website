'use client'

import {
  astroForecastMetricColor,
  type AstroTimelineBlock,
  type AstroTimelineHour,
} from '@/lib/weather/astro-forecast'

type Props = {
  hours: AstroTimelineHour[]
  astroBlocks: AstroTimelineBlock[]
}

type HourlyRow = {
  key: keyof Pick<AstroTimelineHour, 'cloudCover' | 'windKmh' | 'precipProb'>
  label: string
  metric: 'cloud' | 'wind' | 'precip'
  format: (v: number | null) => string
}

const HOURLY_ROWS: HourlyRow[] = [
  { key: 'cloudCover', label: 'Cloud', metric: 'cloud', format: (v) => (v == null ? '—' : `${Math.round(v)}%`) },
  { key: 'windKmh', label: 'Wind', metric: 'wind', format: (v) => (v == null ? '—' : `${Math.round(v)} km/h`) },
  { key: 'precipProb', label: 'Precip', metric: 'precip', format: (v) => (v == null ? '—' : `${Math.round(v)}%`) },
]

const COL_LABEL = '8.5rem'

/** Metric cells — true pill; project Tailwind remaps `rounded-*` to 1rem surfaces. */
const METRIC_PILL =
  'h-7 rounded-[9999px] flex items-center justify-center text-[9px] font-medium text-black/80'

function cellText(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return ''
  return String(Math.round(value))
}

function gridColumns(count: number): string {
  return `${COL_LABEL} repeat(${count}, minmax(2.4rem, 1fr))`
}

export default function WeatherAstroTimelineStrip({ hours, astroBlocks }: Props) {
  if (hours.length === 0) {
    return (
      <div className="weather-glass-panel px-4 py-4 text-sm text-white/50 sm:px-5">
        No hourly forecast for tonight&apos;s window.
      </div>
    )
  }

  const colCount = hours.length

  return (
    <div className="weather-glass-panel px-4 py-4 overflow-x-auto sm:px-5 sm:py-4">
      <div className="flex items-center justify-between gap-3 mb-3 min-w-max">
        <h2 className="text-sm font-semibold tracking-wide text-white">Tonight</h2>
        <div className="flex items-center gap-3 text-[10px] text-white/45">
          <span className="inline-flex items-center gap-1">
            <span className="inline-block h-2.5 w-2.5 rounded-[9999px] bg-[#22c55e]" /> Good
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="inline-block h-2.5 w-2.5 rounded-[9999px] bg-[#eab308]" /> Fair
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="inline-block h-2.5 w-2.5 rounded-[9999px] bg-[#ef4444]" /> Poor
          </span>
        </div>
      </div>

      <div className="min-w-max flex flex-col gap-1.5">
        <div className="grid gap-x-1" style={{ gridTemplateColumns: gridColumns(colCount) }}>
          <div />
          {hours.map((h) => (
            <div key={h.hourStartSec} className="pb-1 text-center text-[10px] text-white/45">
              {h.label}
            </div>
          ))}
        </div>

        {HOURLY_ROWS.map((row) => (
          <div
            key={row.key}
            className="grid gap-x-1"
            style={{ gridTemplateColumns: gridColumns(colCount) }}
          >
            <div className="flex min-h-[1.75rem] items-center justify-center pr-2 text-center text-[11px] font-medium text-white">
              {row.label}
            </div>
            {hours.map((h) => {
              const value = h[row.key] as number | null
              return (
                <div
                  key={`${row.key}-${h.hourStartSec}`}
                  className={METRIC_PILL}
                  style={{ backgroundColor: astroForecastMetricColor(row.metric, value) }}
                  title={`${row.label}: ${row.format(value)}`}
                >
                  {cellText(value)}
                </div>
              )
            })}
          </div>
        ))}

        {(
          [
            { label: 'Transparency', metric: 'transparency' as const, pick: (b: AstroTimelineBlock) => b.transparencyScale },
            { label: 'Seeing', metric: 'seeing' as const, pick: (b: AstroTimelineBlock) => b.seeingScale },
          ] as const
        ).map((row) => (
          <div
            key={row.label}
            className="grid gap-x-1"
            style={{ gridTemplateColumns: gridColumns(colCount) }}
          >
            <div className="flex min-h-[1.75rem] items-center justify-center pr-2 text-center text-[11px] font-medium text-white">
              {row.label}
            </div>
            {astroBlocks.map((block) => {
              const value = row.pick(block)
              return (
                <div
                  key={`${row.label}-${block.startIndex}-${block.span}`}
                  className={METRIC_PILL}
                  style={{
                    gridColumn: `${2 + block.startIndex} / span ${block.span}`,
                    backgroundColor: astroForecastMetricColor(row.metric, value),
                  }}
                  title={`${row.label}: ${value == null ? '—' : value}`}
                >
                  {cellText(value)}
                </div>
              )
            })}
          </div>
        ))}
      </div>
    </div>
  )
}
