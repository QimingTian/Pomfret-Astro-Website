import { useCallback, useEffect, useState } from 'react'
import { ConsoleHeader } from '../components/console/ConsoleHeader'
import { NewSessionSection } from '../components/console/NewSessionSection'
import { ScheduleSection } from '../components/console/ScheduleSection'
import { SettingsModal } from '../components/console/SettingsModal'
import { TelescopeStatusSection } from '../components/console/TelescopeStatusSection'
import { TonightScheduleTimeline } from '../components/console/TonightScheduleTimeline'
import { WeatherSection } from '../components/console/WeatherSection'
import { fetchCurrentSessions, probeHub } from '../lib/hub-client'
import type { HubProbeResult, SessionRow } from '../lib/types'
import { fetchTonightWeather, type TonightWeatherSnapshot } from '../lib/weather-client'
import type { RemotePrefill } from '../pages/AtlasPage'

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
  const [clock, setClock] = useState('')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [loadingSessions, setLoadingSessions] = useState(true)
  const [loadingWeather, setLoadingWeather] = useState(true)

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
    setRefreshing(true)
    setLoadingWeather(true)
    const [probeResult, weatherResult] = await Promise.all([
      probeHub(),
      fetchTonightWeather(),
    ])
    setProbe(probeResult)
    setWeather(weatherResult)
    setLoadingWeather(false)
    await loadSessions()
    setRefreshing(false)
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

  useEffect(() => {
    const tick = () => {
      setClock(
        new Date().toLocaleString(undefined, {
          weekday: 'short',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        })
      )
    }
    tick()
    const id = window.setInterval(tick, 1000)
    return () => window.clearInterval(id)
  }, [])

  return (
    <div className={embedded ? 'control-console embedded' : 'control-console'}>
      <div className="console-grid-bg" aria-hidden />
      <ConsoleHeader
        embedded={embedded}
        probe={probe}
        weatherPrediction={weather?.prediction ?? null}
        clock={clock}
        onRefresh={() => void refreshAll()}
        onOpenSettings={() => setSettingsOpen(true)}
        refreshing={refreshing}
      />

      <div className="console-body">
        <div className="console-upper">
          <WeatherSection weather={weather} loading={loadingWeather} />
          <NewSessionSection
            onSubmitted={() => void loadSessions()}
            disabled={!probe?.hubReachable}
            prefill={prefill}
            onPrefillConsumed={onPrefillConsumed}
          />
        </div>
        <div className="console-middle">
          <TonightScheduleTimeline weather={weather} sessions={sessions} />
          <TelescopeStatusSection probe={probe} />
        </div>
        <ScheduleSection sessions={sessions} loading={loadingSessions} error={sessionsError} />
      </div>

      <SettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onSaved={() => void refreshAll()}
      />
    </div>
  )
}
