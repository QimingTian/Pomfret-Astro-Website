import type { SessionRow } from '../../lib/types'

type ScheduleSectionProps = {
  sessions: SessionRow[]
  loading: boolean
  error: string | null
}

function formatWhen(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isFinite(d.getTime())
    ? d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
    : iso
}

function statusClass(status: string): string {
  switch (status) {
    case 'in_progress':
      return 'status-active'
    case 'scheduled':
      return 'status-scheduled'
    case 'completed':
      return 'status-done'
    case 'failed':
      return 'status-failed'
    default:
      return 'status-pending'
  }
}

function exposureSummary(row: SessionRow): string {
  const parts: string[] = []
  if (row.filter) parts.push(row.filter)
  if (row.exposureSeconds) parts.push(`${row.exposureSeconds}s`)
  if (row.count) parts.push(`×${row.count}`)
  return parts.length > 0 ? parts.join(' · ') : '—'
}

export function ScheduleSection({ sessions, loading, error }: ScheduleSectionProps) {
  const active = sessions.find((s) => s.status === 'in_progress')
  const upcoming = sessions.filter((s) => s.status !== 'completed' && s.status !== 'failed')

  return (
    <section className="console-panel schedule-panel">
      <div className="panel-head">
        <h2>Schedule</h2>
        <span className="panel-tag">{sessions.length} IN QUEUE</span>
      </div>

      {active && (
        <div className="active-run">
          <span className="active-run-label">ACTIVE RUN</span>
          <span className="active-run-target">{active.target}</span>
          <span className="active-run-meta">{exposureSummary(active)}</span>
        </div>
      )}

      {error && <p className="panel-error">{error}</p>}

      {loading && sessions.length === 0 ? (
        <p className="muted-inline">Loading queue…</p>
      ) : sessions.length === 0 ? (
        <p className="muted-inline">Queue empty — add a target above.</p>
      ) : (
        <div className="schedule-table-wrap">
          <table className="schedule-table">
            <thead>
              <tr>
                <th>Target</th>
                <th>Status</th>
                <th>Plan</th>
                <th>Sequence</th>
                <th>Output</th>
              </tr>
            </thead>
            <tbody>
              {upcoming.map((row) => (
                <tr key={row.id}>
                  <td className="cell-target">{row.target}</td>
                  <td>
                    <span className={`status-pill ${statusClass(row.status)}`}>{row.status}</span>
                  </td>
                  <td>{formatWhen(row.plannedStartIso)}</td>
                  <td>{exposureSummary(row)}</td>
                  <td className="cell-mono">{row.outputMode ?? 'none'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="schedule-rail">
        {upcoming.slice(0, 8).map((row, i) => (
          <div key={row.id} className={`rail-slot ${statusClass(row.status)}`}>
            <span className="rail-index">{String(i + 1).padStart(2, '0')}</span>
            <span className="rail-target">{row.target}</span>
          </div>
        ))}
        {upcoming.length === 0 && <span className="muted-inline">No upcoming slots</span>}
      </div>
    </section>
  )
}
