import { useEffect } from 'react'
import { isActiveImagingSession } from '../../lib/imaging/queue-status'
import type { HubProbeResult, SessionRow } from '../../lib/types'
import type { TonightWeatherSnapshot, WeatherPrediction } from '../../lib/weather-client'
import { ImagingDashboardPanel } from './ImagingDashboardPanel'
import { NewImagingSessionForm } from './new-session/NewImagingSessionForm'
import type { SessionPrefill } from './new-session/types'
import { ScheduleSection } from './ScheduleSection'
import { TelescopeStatusSection } from './TelescopeStatusSection'
import { TonightScheduleTimeline } from './TonightScheduleTimeline'

type RemoteGlassConsoleProps = {
  probe: HubProbeResult | null
  weather: TonightWeatherSnapshot | null
  sessions: SessionRow[]
  loadingSessions: boolean
  sessionsError: string | null
  prefill?: SessionPrefill | null
  onPrefillConsumed?: () => void
  onSubmitted?: () => void
  onRefreshSessions?: () => void
  onEditSession?: (session: SessionRow) => void
  sessionOpen: boolean
  onSessionOpenChange: (open: boolean) => void
  dashboardOpen: boolean
  dashboardSession: SessionRow | null
  onDashboardOpenChange: (open: boolean) => void
  onDashboardSessionChange: (session: SessionRow | null) => void
}

export function RemoteGlassConsole({
  probe,
  weather,
  sessions,
  loadingSessions,
  sessionsError,
  prefill,
  onPrefillConsumed,
  onSubmitted,
  onRefreshSessions,
  onEditSession,
  sessionOpen,
  onSessionOpenChange,
  dashboardOpen,
  dashboardSession,
  onDashboardOpenChange,
  onDashboardSessionChange,
}: RemoteGlassConsoleProps) {
  const overlayOpen = sessionOpen || dashboardOpen

  useEffect(() => {
    if (prefill) onSessionOpenChange(true)
  }, [prefill, onSessionOpenChange])

  useEffect(() => {
    if (sessionOpen) onDashboardOpenChange(false)
  }, [sessionOpen, onDashboardOpenChange])

  const weatherPrediction: WeatherPrediction = weather?.prediction ?? 'not_permitted'
  const observatoryStatus = probe?.observatory?.status
  const hubReachable = probe?.hubReachable === true

  return (
    <div className="remote-console-shell">
      <div className={sessionOpen ? 'session-form-layer open' : 'session-form-layer'} aria-hidden={!sessionOpen}>
        <NewImagingSessionForm
          hubReachable={hubReachable}
          observatoryStatus={observatoryStatus}
          weatherPrediction={weatherPrediction}
          prefill={prefill}
          onPrefillConsumed={onPrefillConsumed}
          onSubmitted={() => {
            onSubmitted?.()
            window.setTimeout(() => onSessionOpenChange(false), 1200)
          }}
        />
      </div>

      <div
        className={dashboardOpen ? 'session-form-layer open' : 'session-form-layer'}
        aria-hidden={!dashboardOpen}
      >
        <ImagingDashboardPanel session={dashboardSession} />
      </div>

      <div className={`remote-glass-grid${overlayOpen ? ' remote-glass-grid-hidden' : ''}`} aria-hidden={overlayOpen}>
        <TonightScheduleTimeline weather={weather} sessions={sessions} />
        <ScheduleSection
          sessions={sessions}
          loading={loadingSessions}
          error={sessionsError}
          hubReachable={hubReachable}
          onRefresh={onRefreshSessions}
          onEditSession={onEditSession}
          onCheckProgress={(session) => {
            onSessionOpenChange(false)
            onDashboardSessionChange(isActiveImagingSession(session) ? session : null)
            onDashboardOpenChange(true)
          }}
        />
        <TelescopeStatusSection />
      </div>
    </div>
  )
}
