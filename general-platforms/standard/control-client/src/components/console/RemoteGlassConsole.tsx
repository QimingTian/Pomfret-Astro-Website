import { useEffect } from 'react'
import type { HubProbeResult, SessionRow } from '../../lib/types'
import type { TonightWeatherSnapshot, WeatherPrediction } from '../../lib/weather-client'
import { MotionOverlay } from '../motion'
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
  editingSession?: SessionRow | null
  onEditingSessionClear?: () => void
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
  editingSession,
  onEditingSessionClear,
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
      <MotionOverlay open={sessionOpen} className="session-form-layer">
        <NewImagingSessionForm
          hubReachable={hubReachable}
          observatoryStatus={observatoryStatus}
          weatherPrediction={weatherPrediction}
          prefill={prefill}
          onPrefillConsumed={onPrefillConsumed}
          editingSession={editingSession}
          onEditingSessionClear={onEditingSessionClear}
          onSubmitted={() => {
            onEditingSessionClear?.()
            onSubmitted?.()
            window.setTimeout(() => onSessionOpenChange(false), 1200)
          }}
        />
      </MotionOverlay>

      <MotionOverlay open={dashboardOpen} className="session-form-layer">
        <ImagingDashboardPanel session={dashboardSession} />
      </MotionOverlay>

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
            onDashboardSessionChange(session)
            onDashboardOpenChange(true)
          }}
        />
        <TelescopeStatusSection />
      </div>
    </div>
  )
}
