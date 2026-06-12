import { observatoryStatusLabel } from '../../lib/hub-client'
import type { HubProbeResult } from '../../lib/types'

type TelescopeStatusSectionProps = {
  probe: HubProbeResult | null
}

export function TelescopeStatusSection({ probe }: TelescopeStatusSectionProps) {
  const status = probe?.observatory?.status ?? 'disconnected'
  const agentUp = probe?.hubReachable && status !== 'disconnected'
  const mode = probe?.observatory?.mode ?? '—'

  return (
    <section className="console-panel telescope-panel">
      <div className="panel-head">
        <h2>Telescope</h2>
        <span className="panel-tag">MOUNT TELEMETRY</span>
      </div>

      <div className="telescope-status-grid">
        <div className="telescope-stat">
          <span className="telescope-stat-label">Agent</span>
          <span className={`telescope-stat-value ${agentUp ? 'ok' : 'error'}`}>
            {probe?.hubReachable ? (agentUp ? 'Connected' : 'Disconnected') : 'Hub offline'}
          </span>
        </div>
        <div className="telescope-stat">
          <span className="telescope-stat-label">Observatory</span>
          <span className={`telescope-stat-value ${status === 'ready' ? 'ok' : status === 'disconnected' ? 'error' : 'warn'}`}>
            {probe?.hubReachable ? observatoryStatusLabel(status) : '—'}
          </span>
        </div>
        <div className="telescope-stat">
          <span className="telescope-stat-label">Mode</span>
          <span className="telescope-stat-value mono">{mode}</span>
        </div>
      </div>

      <p className="panel-footnote">
        Mount position, tracking, and dome state appear when Personal Station Agent is connected and reporting.
      </p>
    </section>
  )
}
