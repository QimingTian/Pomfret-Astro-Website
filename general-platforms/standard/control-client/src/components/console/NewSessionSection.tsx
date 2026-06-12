import { useEffect, useState, type FormEvent } from 'react'
import {
  OUTPUT_MODE_LABELS,
  PERSONAL_DEFAULT_OUTPUT_MODE,
  type SessionOutputMode,
} from '@shared/output-mode'
import { submitSession } from '../../lib/submit-session'

const FILTER_PRESETS = ['L', 'R', 'G', 'B', 'Ha', 'OIII', 'SII']

export type SessionPrefill = {
  target: string
  raHours?: number
  decDeg?: number
}

type NewSessionSectionProps = {
  onSubmitted: () => void
  disabled?: boolean
  prefill?: SessionPrefill | null
  onPrefillConsumed?: () => void
}

export function NewSessionSection({
  onSubmitted,
  disabled,
  prefill,
  onPrefillConsumed,
}: NewSessionSectionProps) {
  const [target, setTarget] = useState('')
  const [raHours, setRaHours] = useState<number | null>(null)
  const [decDeg, setDecDeg] = useState<number | null>(null)
  const [outputMode, setOutputMode] = useState<SessionOutputMode>(PERSONAL_DEFAULT_OUTPUT_MODE)
  const [filter, setFilter] = useState('L')
  const [exposureSeconds, setExposureSeconds] = useState(600)
  const [count, setCount] = useState(10)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!prefill) return
    setTarget(prefill.target)
    setRaHours(prefill.raHours ?? null)
    setDecDeg(prefill.decDeg ?? null)
    onPrefillConsumed?.()
  }, [prefill, onPrefillConsumed])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (disabled) return
    setBusy(true)
    setMessage(null)
    setError(null)
    const trimmed = target.trim()
    if (!trimmed) {
      setError('Enter a target name.')
      setBusy(false)
      return
    }
    const result = await submitSession({
      target: trimmed,
      outputMode,
      raHours,
      decDeg,
      filter: filter.trim() || null,
      exposureSeconds,
      count,
    })
    setBusy(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setMessage(`Queued · ${result.id.slice(0, 8).toUpperCase()}`)
    setTarget('')
    setRaHours(null)
    setDecDeg(null)
    onSubmitted()
  }

  return (
    <section className="console-panel session-panel">
      <div className="panel-head">
        <h2>New Session</h2>
        <span className="panel-tag">IMAGING QUEUE</span>
      </div>

      <form className="session-form" onSubmit={(e) => void handleSubmit(e)}>
        <label className="target-field">
          <span className="field-label">Target designation</span>
          <input
            className="target-input"
            type="text"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            placeholder="M42 · NGC 2244 · Custom"
            autoComplete="off"
            disabled={busy || disabled}
          />
          {raHours != null && decDeg != null && (
            <span className="coord-hint">
              RA {raHours.toFixed(3)}h · Dec {decDeg >= 0 ? '+' : ''}
              {decDeg.toFixed(2)}°
            </span>
          )}
        </label>

        <div className="session-params">
          <label className="param-field">
            <span>Filter</span>
            <div className="filter-row">
              <input
                type="text"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                disabled={busy || disabled}
              />
              <div className="filter-chips">
                {FILTER_PRESETS.map((f) => (
                  <button
                    key={f}
                    type="button"
                    className={filter === f ? 'chip active' : 'chip'}
                    onClick={() => setFilter(f)}
                    disabled={busy || disabled}
                  >
                    {f}
                  </button>
                ))}
              </div>
            </div>
          </label>

          <label className="param-field">
            <span>Exposure (s)</span>
            <input
              type="number"
              min={1}
              value={exposureSeconds}
              onChange={(e) => setExposureSeconds(Number(e.target.value))}
              disabled={busy || disabled}
            />
          </label>

          <label className="param-field">
            <span>Frames</span>
            <input
              type="number"
              min={1}
              value={count}
              onChange={(e) => setCount(Number(e.target.value))}
              disabled={busy || disabled}
            />
          </label>
        </div>

        <div className="output-mode-row">
          <span className="field-label">Output</span>
          <div className="segmented">
            {(Object.keys(OUTPUT_MODE_LABELS) as SessionOutputMode[]).map((mode) => (
              <button
                key={mode}
                type="button"
                className={outputMode === mode ? 'segment active' : 'segment'}
                onClick={() => setOutputMode(mode)}
                disabled={busy || disabled}
                title={OUTPUT_MODE_LABELS[mode]}
              >
                {mode}
              </button>
            ))}
          </div>
        </div>

        <button
          type="submit"
          className="btn launch-btn"
          disabled={busy || disabled}
        >
          {busy ? 'ARMING…' : 'ADD TO QUEUE'}
        </button>
      </form>

      {disabled && (
        <p className="panel-error">Hub offline — start Personal Hub or check CONFIG.</p>
      )}
      {error && <p className="panel-error">{error}</p>}
      {message && <p className="panel-ok">{message}</p>}
    </section>
  )
}
