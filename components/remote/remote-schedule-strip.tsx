'use client'

export type RemoteScheduleStripTonightSchedule = {
  start: Date
  end: Date
  hours: Array<{ label: string; hourKey: string; hourStartMs: number }>
  nowTopPct: number | null
  eventBlocks: Array<{ label: string; topPct: number }>
  adminClosedBlocks: Array<{ id: string; topPct: number; heightPct: number; label: string }>
}

export type RemoteScheduleStripWeatherBlock = {
  kind: 'permitted' | 'not_permitted'
  topPct: number
  heightPct: number
  reasons: string[]
}

export type RemoteScheduleStripSessionBlock = {
  topPct: number
  heightPct: number
  label: string
}

type Props = {
  tonightSchedule: RemoteScheduleStripTonightSchedule
  weatherBlocks: RemoteScheduleStripWeatherBlock[]
  sessionScheduleBlocks: RemoteScheduleStripSessionBlock[]
}

export function RemoteScheduleStrip({
  tonightSchedule,
  weatherBlocks,
  sessionScheduleBlocks,
}: Props) {
  return (
    <section className="max-w-2xl">
      <h1 className="text-2xl font-semibold text-apple-dark dark:text-white mb-4">Tonight&apos;s Schedule</h1>
      <div className="mt-9 relative">
        {(() => {
          const totalMs = tonightSchedule.end.getTime() - tonightSchedule.start.getTime()
          const hourLines = tonightSchedule.hours.map((slot) => ({
            ...slot,
            topPct: ((slot.hourStartMs - tonightSchedule.start.getTime()) / totalMs) * 100,
          }))
          return (
            <>
              <div className="absolute left-[4.75rem] top-0 bottom-0 w-px bg-black/10 dark:bg-white/10" />
              <div className="absolute right-0 lg:-right-16 top-0 bottom-0 w-px bg-black/10 dark:bg-white/10" />
              {hourLines.map((slot, index) => (
                <div key={`hour-line-${slot.hourKey}-${index}`}>
                  <div
                    className="absolute left-[4.75rem] right-0 lg:-right-16 h-px bg-black/10 dark:bg-white/10"
                    style={{ top: `${slot.topPct}%` }}
                  />
                  <p
                    className="absolute left-0 w-[4rem] -translate-y-1/2 text-right text-xs text-gray-500 dark:text-gray-500"
                    style={{ top: `${slot.topPct}%` }}
                  >
                    {slot.label}
                  </p>
                </div>
              ))}
              {tonightSchedule.nowTopPct !== null && (
                <div
                  className="absolute left-[4.75rem] right-0 lg:-right-16 h-0.5 bg-red-500/90 z-[1]"
                  style={{ top: `${tonightSchedule.nowTopPct}%` }}
                />
              )}
              <div className="space-y-0">
                {tonightSchedule.hours.slice(0, -1).map((slot, index) => (
                  <div key={`${slot.hourKey}-${index}`} className="grid grid-cols-[4rem_minmax(0,1fr)] items-stretch gap-3 h-14">
                    <div />
                    <div />
                  </div>
                ))}
              </div>
              <div className="pointer-events-none absolute left-[4.75rem] right-0 lg:-right-16 top-0 bottom-0">
                {weatherBlocks.map((block, idx) => (
                  <div
                    key={`weather-${block.kind}-${idx}`}
                    className="absolute left-[33.333%] right-[33.333%] rounded-md border border-white/25 bg-[#151616] px-2 py-0.5 flex items-center justify-center"
                    style={{
                      top: `${block.topPct}%`,
                      height: `${Math.max(block.heightPct, 4)}%`,
                    }}
                  >
                    <div className="text-center">
                      <p className="text-[10px] leading-4 text-white">
                        {block.kind === 'permitted' ? 'Weather Permitted' : 'Weather Not Permitted'}
                      </p>
                      {block.kind === 'not_permitted' && block.reasons.length > 0 ? (
                        <p className="text-[10px] leading-4 text-gray-400">{block.reasons.join(' / ')}</p>
                      ) : null}
                    </div>
                  </div>
                ))}
                {tonightSchedule.eventBlocks.map((marker) => (
                  <div
                    key={marker.label}
                    className="absolute left-0 right-[66.666%] -translate-y-1/2 rounded-md border border-white/25 bg-[#151616] px-2 py-0.5"
                    style={{ top: `${marker.topPct}%` }}
                  >
                    <p className="text-center text-[10px] leading-4 text-white">{marker.label}</p>
                  </div>
                ))}
                {sessionScheduleBlocks.map((block, idx) => (
                  <div
                    key={`session-${idx}`}
                    className="absolute left-[66.666%] right-0 rounded-md border border-white/25 bg-[#151616] px-2 py-0.5 flex items-center justify-center overflow-hidden"
                    style={{
                      top: `${block.topPct}%`,
                      height: `${block.heightPct}%`,
                    }}
                  >
                    <p className="text-center text-[10px] leading-4 text-white">{block.label}</p>
                  </div>
                ))}
                {tonightSchedule.adminClosedBlocks.map((block) => (
                  <div
                    key={`admin-closed-${block.id}`}
                    className="absolute left-[66.666%] right-0 rounded-md border border-red-300/60 bg-[#3a1c1c] px-2 py-0.5 flex items-center justify-center"
                    style={{ top: `${block.topPct}%`, height: `${Math.max(block.heightPct, 4)}%` }}
                  >
                    <p className="text-center text-[10px] leading-4 text-white break-words px-0.5">{block.label}</p>
                  </div>
                ))}
              </div>
            </>
          )
        })()}
      </div>
    </section>
  )
}
