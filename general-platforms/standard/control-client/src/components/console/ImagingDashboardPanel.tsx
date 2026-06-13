import { isActiveImagingSession } from '../../lib/imaging/queue-status'
import type { SessionRow } from '../../lib/types'

type ImagingDashboardPanelProps = {
  session: SessionRow | null
}

const NO_ACTIVE = 'No active session.'

export function ImagingDashboardPanel({ session }: ImagingDashboardPanelProps) {
  const active = session != null && isActiveImagingSession(session)

  return (
    <div className="imaging-dashboard-shell">
      <section className="remote-glass-pane imaging-dashboard-pane">
        <div className="remote-pane-head">
          <h2>Terminal</h2>
        </div>
        <div className="imaging-dashboard-pane-body">
          {active ? (
            <p className="imaging-dashboard-live-copy">Waiting for observatory POSTs…</p>
          ) : (
            <p className="imaging-dashboard-empty-copy">{NO_ACTIVE}</p>
          )}
        </div>
      </section>

      <section className="remote-glass-pane imaging-dashboard-pane">
        <div className="remote-pane-head">
          <h2>Preview</h2>
        </div>
        <div className="imaging-dashboard-pane-body">
          {active ? (
            <p className="imaging-dashboard-empty-copy">No image.</p>
          ) : (
            <p className="imaging-dashboard-empty-copy">{NO_ACTIVE}</p>
          )}
        </div>
      </section>

      <section className="remote-glass-pane imaging-dashboard-pane imaging-dashboard-pane-detail">
        <div className="remote-pane-head">
          <h2>Session Detail</h2>
        </div>
        <div className="imaging-dashboard-pane-body">
          {active && session ? (
            <div className="imaging-dashboard-detail-grid">
              <p>
                <span className="session-detail-label">Session Name: </span>
                {session.target}
              </p>
              <p>
                <span className="session-detail-label">Session ID: </span>
                <span className="imaging-dashboard-mono">{session.id}</span>
              </p>
              <p>
                <span className="session-detail-label">Output: </span>
                {session.outputMode ?? 'none'}
              </p>
            </div>
          ) : (
            <p className="imaging-dashboard-empty-copy">{NO_ACTIVE}</p>
          )}
        </div>
      </section>
    </div>
  )
}
