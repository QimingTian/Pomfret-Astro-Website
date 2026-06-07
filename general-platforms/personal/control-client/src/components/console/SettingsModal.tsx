import { useState } from 'react'
import { probeHub, patchObservatoryMode } from '../../lib/hub-client'
import {
  DEFAULT_HUB_BASE_URL,
  DEFAULT_OBS_LAT,
  DEFAULT_OBS_LON,
  getHubBaseUrl,
  getObservatoryLocation,
  normalizeHubBaseUrl,
  setHubBaseUrl,
  setObservatoryLocation,
} from '../../lib/settings'
import type { ObservatoryMode } from '../../lib/types'

type SettingsModalProps = {
  open: boolean
  onClose: () => void
  onSaved: () => void
}

export function SettingsModal({ open, onClose, onSaved }: SettingsModalProps) {
  const loc = getObservatoryLocation()
  const [hubUrl, setHubUrl] = useState(getHubBaseUrl())
  const [lat, setLat] = useState(String(loc.lat))
  const [lon, setLon] = useState(String(loc.lon))
  const [label, setLabel] = useState(loc.label)
  const [mode, setMode] = useState<ObservatoryMode>('auto')
  const [testResult, setTestResult] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  if (!open) return null

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    const normalized = normalizeHubBaseUrl(hubUrl)
    setHubBaseUrl(normalized)
    setHubUrl(normalized)
    const latN = Number(lat)
    const lonN = Number(lon)
    if (Number.isFinite(latN) && Number.isFinite(lonN)) {
      setObservatoryLocation({ lat: latN, lon: lonN, label })
    }
    setBusy(true)
    try {
      const probe = await probeHub(normalized)
      if (probe.hubReachable) {
        await patchObservatoryMode(mode, normalized)
        setTestResult('Saved.')
      } else {
        setTestResult('Saved locally. Hub offline — mode not synced.')
      }
      onSaved()
    } catch (ex) {
      setTestResult(ex instanceof Error ? ex.message : 'Save failed')
    } finally {
      setBusy(false)
    }
  }

  async function handleTest() {
    setBusy(true)
    setTestResult(null)
    const base = normalizeHubBaseUrl(hubUrl)
    const result = await probeHub(base)
    if (result.hubReachable) {
      setMode(result.observatory?.mode ?? 'auto')
      setTestResult(
        `OK — ${result.observatory?.status ?? 'unknown'} (${result.observatory?.mode ?? '?'})`
      )
    } else {
      setTestResult(result.error ?? 'Hub unreachable')
    }
    setBusy(false)
  }

  return (
    <div className="modal-backdrop" onClick={onClose} role="presentation">
      <div
        className="modal console-panel"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-labelledby="settings-title"
      >
        <div className="panel-head">
          <h2 id="settings-title">Configuration</h2>
          <button type="button" className="btn console-btn" onClick={onClose}>
            CLOSE
          </button>
        </div>

        <form className="settings-form" onSubmit={(e) => void handleSave(e)}>
          <label className="settings-field">
            <span>Personal Hub URL</span>
            <input
              type="url"
              value={hubUrl}
              onChange={(e) => setHubUrl(e.target.value)}
              placeholder={DEFAULT_HUB_BASE_URL}
            />
          </label>

          <div className="settings-row">
            <label className="settings-field">
              <span>Latitude</span>
              <input type="text" value={lat} onChange={(e) => setLat(e.target.value)} />
            </label>
            <label className="settings-field">
              <span>Longitude</span>
              <input type="text" value={lon} onChange={(e) => setLon(e.target.value)} />
            </label>
          </div>

          <label className="settings-field">
            <span>Site label</span>
            <input type="text" value={label} onChange={(e) => setLabel(e.target.value)} />
          </label>

          <fieldset className="settings-field">
            <span>Observatory mode</span>
            <div className="segmented">
              {(['auto', 'manual'] as ObservatoryMode[]).map((m) => (
                <button
                  key={m}
                  type="button"
                  className={mode === m ? 'segment active' : 'segment'}
                  onClick={() => setMode(m)}
                >
                  {m}
                </button>
              ))}
            </div>
          </fieldset>

          <p className="panel-footnote">
            Weather uses lat/lon ({DEFAULT_OBS_LAT}, {DEFAULT_OBS_LON} = Pomfret default). Hub
            default {DEFAULT_HUB_BASE_URL}.
          </p>

          <div className="settings-actions">
            <button type="submit" className="btn launch-btn" disabled={busy}>
              SAVE
            </button>
            <button
              type="button"
              className="btn console-btn"
              disabled={busy}
              onClick={() => void handleTest()}
            >
              TEST HUB
            </button>
          </div>
        </form>

        {testResult && (
          <p className={testResult.startsWith('OK') || testResult === 'Saved.' ? 'panel-ok' : 'panel-error'}>
            {testResult}
          </p>
        )}
      </div>
    </div>
  )
}
