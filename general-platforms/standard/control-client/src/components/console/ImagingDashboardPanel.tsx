import { useEffect, useRef, useState } from 'react'
import { personalTenantApiUrl } from '@shared/tenant-config'
import { formatDurationShort } from '../../lib/imaging/coords'
import { queueStatusBadgeClass, queueStatusLabel } from '../../lib/imaging/queue-status'
import { fetchSessionPreviewJson } from '../../lib/hub-client'
import { loadRuntimeTenant } from '../../lib/tenant'
import type { SessionRow } from '../../lib/types'

export type SessionProgressLine = { at: string; text: string }

type ProgressStreamEvent =
  | { type: 'snapshot'; queueStatus: string; lines: SessionProgressLine[] }
  | { type: 'line'; at: string; text: string }
  | { type: 'status'; queueStatus: string }
  | { type: 'ping' }

type PreviewStreamEvent =
  | { type: 'snapshot'; updatedAt: string | null }
  | { type: 'updated'; updatedAt?: string }
  | { type: 'ping' }

const NO_ACTIVE = 'No active session.'

function isFailedTerminalLine(text: string): boolean {
  const lower = text.toLowerCase()
  return lower.includes('failed') || lower.includes('error') || lower.includes('abort')
}

function terminalEmptyCopy(queueStatus: string | null): string {
  if (queueStatus === 'pending' || queueStatus == null) return 'Waiting for observatory signal.'
  if (queueStatus === 'completed') return 'Session completed. No further live updates.'
  if (queueStatus === 'failed') return 'Session marked failed.'
  return 'Waiting for observatory POSTs…'
}

type ImagingDashboardPanelProps = {
  session: SessionRow | null
}

export function ImagingDashboardPanel({ session }: ImagingDashboardPanelProps) {
  const [lines, setLines] = useState<SessionProgressLine[]>([])
  const [queueStatus, setQueueStatus] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [terminalError, setTerminalError] = useState<string | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [previewUpdatedAt, setPreviewUpdatedAt] = useState<string | null>(null)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const terminalEndRef = useRef<HTMLDivElement>(null)
  const previewFingerprintRef = useRef<string | null>(null)

  const sessionId = session?.id ?? null
  const displayStatus = session ? (session.status === 'claimed' ? 'in_progress' : session.status) : null

  useEffect(() => {
    if (!sessionId) {
      setLines([])
      setQueueStatus(null)
      setLoading(false)
      setTerminalError(null)
      setPreviewUrl(null)
      setPreviewUpdatedAt(null)
      setPreviewError(null)
      previewFingerprintRef.current = null
      return
    }

    setLines([])
    setQueueStatus(displayStatus)
    setLoading(true)
    setTerminalError(null)
    setPreviewUrl(null)
    setPreviewUpdatedAt(null)
    setPreviewError(null)
    previewFingerprintRef.current = null

    let progressSource: EventSource | null = null
    let previewSource: EventSource | null = null
    let cancelled = false

    const loadPreview = async () => {
      try {
        const data = await fetchSessionPreviewJson(sessionId)
        if (cancelled) return
        if (!data.ok || typeof data.dataBase64 !== 'string') {
          if (data.error && !data.error.includes('not found')) {
            setPreviewError(data.error)
          }
          return
        }
        const updatedAt = typeof data.updatedAt === 'string' ? data.updatedAt : null
        const fingerprint = `${updatedAt ?? ''}|${data.dataBase64.length}`
        if (fingerprint === previewFingerprintRef.current) return
        previewFingerprintRef.current = fingerprint
        const contentType = typeof data.contentType === 'string' ? data.contentType : 'image/jpeg'
        setPreviewError(null)
        setPreviewUpdatedAt(updatedAt)
        setPreviewUrl(`data:${contentType};base64,${data.dataBase64}`)
      } catch {
        if (!cancelled) setPreviewError('Preview unavailable.')
      }
    }

    void loadPreview()

    void loadRuntimeTenant().then((tenant) => {
      if (cancelled) return
      const token = encodeURIComponent(tenant.apiSecret)
      const progressUrl = `${personalTenantApiUrl(tenant, `/imaging/queue/${encodeURIComponent(sessionId)}/progress-stream`)}?access_token=${token}`
      const previewUrlStream = `${personalTenantApiUrl(tenant, `/imaging/queue/${encodeURIComponent(sessionId)}/preview-stream`)}?access_token=${token}`

      progressSource = new EventSource(progressUrl)
      progressSource.onopen = () => {
        if (!cancelled) setTerminalError(null)
      }
      progressSource.onmessage = (evt) => {
        let payload: ProgressStreamEvent | null = null
        try {
          payload = JSON.parse(evt.data) as ProgressStreamEvent
        } catch {
          return
        }
        if (!payload || typeof payload !== 'object' || !('type' in payload)) return
        if (payload.type === 'ping') return
        if (payload.type === 'snapshot') {
          setLines(Array.isArray(payload.lines) ? payload.lines : [])
          setQueueStatus(typeof payload.queueStatus === 'string' ? payload.queueStatus : displayStatus)
          setLoading(false)
          return
        }
        if (payload.type === 'status') {
          setQueueStatus(payload.queueStatus)
          setLoading(false)
          return
        }
        if (payload.type === 'line') {
          setLoading(false)
          setLines((prev) => {
            if (prev.some((line) => line.at === payload?.at && line.text === payload?.text)) return prev
            return [...prev, { at: payload.at, text: payload.text }]
          })
        }
      }
      progressSource.onerror = () => {
        if (!cancelled) setLoading(false)
      }

      previewSource = new EventSource(previewUrlStream)
      previewSource.onmessage = (evt) => {
        let payload: PreviewStreamEvent | null = null
        try {
          payload = JSON.parse(evt.data) as PreviewStreamEvent
        } catch {
          return
        }
        if (!payload || typeof payload !== 'object' || !('type' in payload)) return
        if (payload.type === 'ping') return
        if (payload.type === 'snapshot' || payload.type === 'updated') {
          void loadPreview()
        }
      }
    })

    return () => {
      cancelled = true
      progressSource?.close()
      previewSource?.close()
    }
  }, [sessionId, displayStatus])

  useEffect(() => {
    terminalEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [lines, sessionId])

  if (!session) {
    return (
      <div className="imaging-dashboard-shell">
        <section className="remote-glass-pane imaging-dashboard-pane imaging-dashboard-pane-terminal">
          <div className="remote-pane-head">
            <h2>Terminal</h2>
          </div>
          <div className="imaging-dashboard-pane-body imaging-dashboard-pane-body-fill">
            <p className="imaging-dashboard-empty-copy">{NO_ACTIVE}</p>
          </div>
        </section>
        <section className="remote-glass-pane imaging-dashboard-pane imaging-dashboard-pane-preview">
          <div className="remote-pane-head">
            <h2>Preview</h2>
          </div>
          <div className="imaging-dashboard-pane-body imaging-dashboard-pane-body-fill">
            <p className="imaging-dashboard-empty-copy">{NO_ACTIVE}</p>
          </div>
        </section>
        <section className="remote-glass-pane imaging-dashboard-pane imaging-dashboard-pane-detail">
          <div className="remote-pane-head">
            <h2>Session Detail</h2>
          </div>
          <div className="imaging-dashboard-pane-body">
            <p className="imaging-dashboard-empty-copy">{NO_ACTIVE}</p>
          </div>
        </section>
      </div>
    )
  }

  const statusForBadge = queueStatus ?? displayStatus ?? session.status

  return (
    <div className="imaging-dashboard-shell">
      <div className="imaging-dashboard-head">
        <div>
          <h2 className="imaging-dashboard-title">Session progress</h2>
          <p className="imaging-dashboard-session-id">{session.id}</p>
        </div>
        <div className="imaging-dashboard-head-meta">
          <span className={`queue-status-badge ${queueStatusBadgeClass(statusForBadge)}`}>
            {queueStatusLabel(statusForBadge)}
          </span>
          {loading && <span className="imaging-dashboard-updating">Updating…</span>}
        </div>
      </div>

      <section className="remote-glass-pane imaging-dashboard-pane imaging-dashboard-pane-terminal">
        <div className="remote-pane-head">
          <h2>Terminal</h2>
        </div>
        <div className="imaging-dashboard-pane-body imaging-dashboard-pane-body-fill">
          {terminalError && <p className="imaging-dashboard-terminal-error">{terminalError}</p>}
          {lines.length === 0 && !terminalError ? (
            <p className="imaging-dashboard-empty-copy">{terminalEmptyCopy(queueStatus ?? displayStatus)}</p>
          ) : (
            <div className="imaging-dashboard-terminal-log">
              {lines.map((line, i) => {
                const failed = isFailedTerminalLine(line.text)
                return (
                  <div
                    key={`${line.at}-${i}-${line.text.slice(0, 24)}`}
                    className={`imaging-dashboard-terminal-line${failed ? ' failed' : ''}`}
                  >
                    <span className="imaging-dashboard-terminal-time">
                      [{new Date(line.at).toLocaleTimeString()}]
                    </span>{' '}
                    <span className="imaging-dashboard-terminal-text">{line.text}</span>
                  </div>
                )
              })}
              <div ref={terminalEndRef} />
            </div>
          )}
        </div>
      </section>

      <section className="remote-glass-pane imaging-dashboard-pane imaging-dashboard-pane-preview">
        <div className="remote-pane-head">
          <h2>Preview</h2>
        </div>
        <div className="imaging-dashboard-pane-body imaging-dashboard-pane-body-fill">
          {previewUrl ? (
            <>
              <img src={previewUrl} alt="Latest session preview" className="imaging-dashboard-preview-img" />
              <p className="imaging-dashboard-preview-meta">
                Updated {previewUpdatedAt ? new Date(previewUpdatedAt).toLocaleString() : '—'}
              </p>
            </>
          ) : (
            <p className="imaging-dashboard-empty-copy">No image.</p>
          )}
          {previewError && <p className="imaging-dashboard-preview-error">{previewError}</p>}
        </div>
      </section>

      <section className="remote-glass-pane imaging-dashboard-pane imaging-dashboard-pane-detail">
        <div className="remote-pane-head">
          <h2>Session Detail</h2>
        </div>
        <div className="imaging-dashboard-pane-body imaging-dashboard-detail-wrap">
          <div className="imaging-dashboard-detail-grid">
            <p>
              <span className="session-detail-label">Session Name: </span>
              {session.target}
            </p>
            <p>
              <span className="session-detail-label">Output Mode: </span>
              {session.outputMode ?? 'none'}
            </p>
            <p>
              <span className="session-detail-label">Submitted At: </span>
              {session.createdAt ? new Date(session.createdAt).toLocaleString() : '—'}
            </p>
            <p>
              <span className="session-detail-label">RA / Dec: </span>
              {typeof session.raHours === 'number' && typeof session.decDeg === 'number'
                ? `${session.raHours.toFixed(5)}h / ${session.decDeg.toFixed(5)}°`
                : '—'}
            </p>
            <p>
              <span className="session-detail-label">Estimated Duration: </span>
              {formatDurationShort(session.estimatedDurationSeconds ?? undefined)}
            </p>
            <p className="imaging-dashboard-detail-span">
              <span className="session-detail-label">Imaging Plan: </span>
              {Array.isArray(session.filterPlans) && session.filterPlans.length > 0
                ? session.filterPlans
                    .map((p) => `${p.filterName} (${p.count} × ${p.exposureSeconds}s)`)
                    .join(' | ')
                : '—'}
            </p>
          </div>
        </div>
      </section>
    </div>
  )
}
