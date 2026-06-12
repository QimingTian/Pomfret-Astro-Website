import { useMemo } from 'react'
import type { SessionRow } from '../../lib/types'
import type { TonightWeatherSnapshot } from '../../lib/weather-client'

type TonightScheduleTimelineProps = {
  weather: TonightWeatherSnapshot | null
  sessions: SessionRow[]
}

export function TonightScheduleTimeline({ weather, sessions }: TonightScheduleTimelineProps) {
  const tonightSchedule = useMemo(() => {
    const start = new Date()
    start.setHours(16, 0, 0, 0)
    const end = new Date(start)
    end.setDate(end.getDate() + 1)
    end.setHours(8, 0, 0)
    const totalMs = end.getTime() - start.getTime()
    const hours: { label: string; hourStartMs: number; topPct: number }[] = []
    for (let h = 16; h <= 32; h += 1) {
      const slot = new Date(start)
      if (h >= 24) slot.setDate(slot.getDate() + 1)
      slot.setHours(h % 24, 0, 0, 0)
      if (slot.getTime() >= end.getTime()) break
      hours.push({
        label: slot.toLocaleTimeString([], { hour: 'numeric' }),
        hourStartMs: slot.getTime(),
        topPct: ((slot.getTime() - start.getTime()) / totalMs) * 100,
      })
    }
    const nowTopPct =
      Date.now() >= start.getTime() && Date.now() <= end.getTime()
        ? ((Date.now() - start.getTime()) / totalMs) * 100
        : null
    return { start, end, totalMs, hours, nowTopPct }
  }, [])

  const weatherBlocks = useMemo(() => {
    if (!weather?.hours.length) return []
    const startMs = tonightSchedule.start.getTime()
    const endMs = tonightSchedule.end.getTime()
    const span = endMs - startMs
    return weather.hours
      .filter((h) => h.hourStartSec * 1000 >= startMs && h.hourStartSec * 1000 < endMs)
      .map((h) => ({
        kind: h.permitted ? ('permitted' as const) : ('not_permitted' as const),
        topPct: ((h.hourStartSec * 1000 - startMs) / span) * 100,
        heightPct: (3600_000 / span) * 100,
        reasons: h.reasons,
      }))
  }, [weather, tonightSchedule])

  const queuedSessions = sessions.filter((s) => s.status !== 'completed' && s.status !== 'failed')

  return (
    <section className="console-panel timeline-panel">
      <div className="panel-head">
        <h2>Tonight</h2>
        <span className="panel-tag">SCHEDULE STRIP</span>
      </div>

      <div className="tonight-timeline">
        <div className="tonight-timeline-axis" aria-hidden />
        {tonightSchedule.hours.map((slot) => (
          <div key={slot.hourStartMs}>
            <div className="tonight-timeline-gridline" style={{ top: `${slot.topPct}%` }} />
            <p className="tonight-timeline-hour" style={{ top: `${slot.topPct}%` }}>
              {slot.label}
            </p>
          </div>
        ))}
        {tonightSchedule.nowTopPct !== null && (
          <div className="tonight-timeline-now" style={{ top: `${tonightSchedule.nowTopPct}%` }} />
        )}
        <div className="tonight-timeline-blocks">
          {weatherBlocks.map((block, idx) => (
            <div
              key={`weather-${idx}`}
              className={`tonight-block tonight-block-weather ${block.kind}`}
              style={{
                top: `${block.topPct}%`,
                height: `${Math.max(block.heightPct, 4)}%`,
              }}
              title={
                block.reasons.length > 0 ? block.reasons.join(', ') : block.kind === 'permitted' ? 'Clear' : 'Blocked'
              }
            >
              <p>{block.kind === 'permitted' ? 'WX OK' : 'WX NO-GO'}</p>
            </div>
          ))}
          {queuedSessions.slice(0, 8).map((s, idx) => (
            <div
              key={s.id}
              className={`tonight-block tonight-block-session ${s.status === 'in_progress' ? 'active' : ''}`}
              style={{ top: `${8 + idx * 11}%`, height: '9%' }}
            >
              <p>{s.target}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
