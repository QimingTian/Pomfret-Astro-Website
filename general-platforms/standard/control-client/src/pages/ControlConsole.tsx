import { useCallback, useEffect, useState } from 'react'
import { ConsoleHeader } from '../components/console/ConsoleHeader'
import { RemoteGlassConsole } from '../components/console/RemoteGlassConsole'
import { fetchCurrentSessions, probeHub } from '../lib/hub-client'
import { pickActiveDashboardSession } from '../lib/imaging/queue-status'
import type { HubProbeResult, SessionRow } from '../lib/types'
import { fetchTonightWeather, type TonightWeatherSnapshot } from '../lib/weather-client'
import type { SessionPrefill } from '../components/console/new-session/types'
import type { RemotePrefill } from './AtlasPage'

type ControlConsoleProps = {
  embedded?: boolean
  prefill?: RemotePrefill | null
  onPrefillConsumed?: () => void
}

export function ControlConsole({
  embedded = false,
  prefill,
  onPrefillConsumed,
}: ControlConsoleProps) {
  const [probe, setProbe] = useState<HubProbeResult | null>(null)
  const [weather, setWeather] = useState<TonightWeatherSnapshot | null>(null)
  const [sessions, setSessions] = useState<SessionRow[]>([])
  const [sessionsError, setSessionsError] = useState<string | null>(null)
  const [loadingSessions, setLoadingSessions] = useState(true)
  const [sessionOpen, setSessionOpen] = useState(false)
  const [dashboardOpen, setDashboardOpen] = useState(false)
  const [dashboardSession, setDashboardSession] = useState<SessionRow | null>(null)
  const [editPrefill, setEditPrefill] = useState<SessionPrefill | null>(null)

  const toggleDashboard = useCallback(() => {
    if (dashboardOpen) {
      setDashboardOpen(false)
      return
    }
    setSessionOpen(false)
    setDashboardSession(pickActiveDashboardSession(sessions))
    setDashboardOpen(true)
  }, [dashboardOpen, sessions])

  const loadSessions = useCallback(async () => {
    setLoadingSessions(true)
    setSessionsError(null)
    try {
      const data = await fetchCurrentSessions()
      if (data.ok && Array.isArray(data.sessions)) {
        setSessions(
          data.sessions.map((s) => ({
            id: String(s.id ?? ''),
            target: String(s.target ?? '—'),
            status: String(s.status ?? 'unknown'),
            outputMode: typeof s.outputMode === 'string' ? s.outputMode : undefined,
            plannedStartIso: s.plannedStartIso ?? null,
            createdAt: s.createdAt,
            filter: s.filter ?? null,
            exposureSeconds: s.exposureSeconds ?? null,
            count: s.count ?? null,
            raHours: typeof s.raHours === 'number' ? s.raHours : null,
            decDeg: typeof s.decDeg === 'number' ? s.decDeg : null,
            sessionType: typeof s.sessionType === 'string' ? s.sessionType : 'dso',
            projectMode: s.projectMode === true,
          }))
        )
      } else {
        setSessions([])
        setSessionsError(typeof data.error === 'string' ? data.error : 'Unable to load queue')
      }
    } catch (ex) {
      setSessions([])
      setSessionsError(ex instanceof Error ? ex.message : 'Unable to load queue')
    } finally {
      setLoadingSessions(false)
    }
  }, [])

  const refreshAll = useCallback(async () => {
    const [probeResult, weatherResult] = await Promise.all([
      probeHub(),
      fetchTonightWeather(),
    ])
    setProbe(probeResult)
    setWeather(weatherResult)
    await loadSessions()
  }, [loadSessions])

  useEffect(() => {
    void refreshAll()
    const hubId = window.setInterval(() => void refreshAll(), 30_000)
    const weatherId = window.setInterval(() => {
      void fetchTonightWeather().then(setWeather)
    }, 10 * 60_000)
    return () => {
      window.clearInterval(hubId)
      window.clearInterval(weatherId)
    }
  }, [refreshAll])

  return (
    <div className={embedded ? 'control-console embedded' : 'control-console'}>
      <ConsoleHeader
        embedded={embedded}
        probe={probe}
        sessionOpen={embedded ? sessionOpen : undefined}
        onToggleSession={embedded ? () => setSessionOpen((prev) => !prev) : undefined}
        dashboardOpen={embedded ? dashboardOpen : undefined}
        onToggleDashboard={embedded ? toggleDashboard : undefined}
      />

      <div className="console-body">
        <RemoteGlassConsole
          probe={probe}
          weather={weather}
          sessions={sessions}
          loadingSessions={loadingSessions}
          sessionsError={sessionsError}
          prefill={editPrefill ?? prefill ?? null}
          onPrefillConsumed={() => {
            setEditPrefill(null)
            onPrefillConsumed?.()
          }}
          sessionOpen={sessionOpen}
          onSessionOpenChange={setSessionOpen}
          dashboardOpen={dashboardOpen}
          dashboardSession={dashboardSession}
          onDashboardOpenChange={setDashboardOpen}
          onDashboardSessionChange={setDashboardSession}
          onSubmitted={() => void loadSessions()}
          onRefreshSessions={() => void loadSessions()}
          onEditSession={(session) => {
            setEditPrefill({
              target: session.target,
              raHours: session.raHours ?? undefined,
              decDeg: session.decDeg ?? undefined,
            })
            setSessionOpen(true)
          }}
        />
      </div>
    </div>
  )
}
