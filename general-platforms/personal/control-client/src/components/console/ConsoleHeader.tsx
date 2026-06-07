import type { HubProbeResult } from '../../lib/types'
import type { WeatherPrediction } from '../../lib/weather-client'
import { observatoryStatusLabel } from '../../lib/hub-client'

type ConsoleHeaderProps = {
  probe: HubProbeResult | null
  weatherPrediction: WeatherPrediction | null
  clock: string
  onRefresh: () => void
  onOpenSettings: () => void
  refreshing: boolean
}

function lampTone(
  ok: boolean | null,
  warn = false
): 'ok' | 'warn' | 'error' | 'off' {
  if (ok === null) return 'off'
  if (ok && !warn) return 'ok'
  if (ok && warn) return 'warn'
  return 'error'
}

function weatherLamp(prediction: WeatherPrediction | null): 'ok' | 'warn' | 'error' | 'off' {
  if (!prediction) return 'off'
  if (prediction === 'permitted') return 'ok'
  if (prediction === 'unavailable') return 'warn'
  return 'error'
}

function StatusLamp({
  label,
  tone,
  detail,
}: {
  label: string
  tone: 'ok' | 'warn' | 'error' | 'off'
  detail: string
}) {
  return (
    <div className="status-lamp" title={detail}>
      <span className={`lamp lamp-${tone}`} aria-hidden />
      <span className="lamp-label">{label}</span>
      <span className="lamp-detail">{detail}</span>
    </div>
  )
}

export function ConsoleHeader({
  probe,
  weatherPrediction,
  clock,
  onRefresh,
  onOpenSettings,
  refreshing,
}: ConsoleHeaderProps) {
  const obsStatus = probe?.observatory?.status
  const agentUp = probe?.hubReachable && obsStatus !== 'disconnected'
  const obsReady = obsStatus === 'ready'

  return (
    <header className="console-header">
      <div className="console-brand">
        <span className="console-brand-mark">◆</span>
        <div>
          <div className="console-brand-title">Pomfret Astro</div>
          <div className="console-brand-sub">Personal Mission Control</div>
        </div>
      </div>

      <div className="status-rail">
        <StatusLamp
          label="HUB"
          tone={lampTone(probe?.hubReachable ?? null)}
          detail={probe?.hubReachable ? 'Online' : probe?.error ?? 'Offline'}
        />
        <StatusLamp
          label="AGENT"
          tone={lampTone(agentUp ? true : probe?.hubReachable ? false : null, obsStatus === 'busy_in_use')}
          detail={
            agentUp
              ? observatoryStatusLabel(obsStatus)
              : probe?.hubReachable
                ? 'Not connected'
                : '—'
          }
        />
        <StatusLamp
          label="OBS"
          tone={lampTone(obsReady ? true : agentUp ? false : null)}
          detail={probe?.observatory?.mode?.toUpperCase() ?? '—'}
        />
        <StatusLamp
          label="WX"
          tone={weatherLamp(weatherPrediction)}
          detail={
            weatherPrediction === 'permitted'
              ? 'Clear tonight'
              : weatherPrediction === 'unavailable'
                ? 'Live night'
                : weatherPrediction === 'not_permitted'
                  ? 'Blocked'
                  : '—'
          }
        />
      </div>

      <div className="console-header-actions">
        <time className="console-clock">{clock}</time>
        <button
          type="button"
          className="btn console-btn"
          onClick={onRefresh}
          disabled={refreshing}
        >
          {refreshing ? 'SYNC…' : 'SYNC'}
        </button>
        <button type="button" className="btn console-btn" onClick={onOpenSettings}>
          CONFIG
        </button>
      </div>
    </header>
  )
}
