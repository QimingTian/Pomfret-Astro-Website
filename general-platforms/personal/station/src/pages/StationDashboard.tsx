import { useCallback, useEffect, useRef, useState } from 'react'
import { ChecklistRow } from '../components/ChecklistRow'
import {
  agentIsRunning,
  loadConfig,
  readAgentLogs,
  runDiagnostics,
  saveConfig,
  startAgent,
  stopAgent,
} from '../lib/station-api'
import type { CheckItem, StationConfig } from '../lib/types'

const emptyConfig: StationConfig = {
  hubBaseUrl: 'http://127.0.0.1:7841',
  ninaInstallDir: '',
  jobsDir: '',
  ninaOutputDir: '',
  imagingQueueSecret: '',
  r2Enabled: false,
  autostartEnabled: false,
  pythonPath: '',
}

export function StationDashboard() {
  const [config, setConfig] = useState<StationConfig>(emptyConfig)
  const [checks, setChecks] = useState<CheckItem[]>([])
  const [logs, setLogs] = useState('')
  const [running, setRunning] = useState(false)
  const [busy, setBusy] = useState(false)
  const [saveMsg, setSaveMsg] = useState<string | null>(null)
  const logRef = useRef<HTMLPreElement>(null)

  const refresh = useCallback(async () => {
    const [c, d, l, r] = await Promise.all([
      loadConfig(),
      runDiagnostics(),
      readAgentLogs(),
      agentIsRunning(),
    ])
    setConfig(c)
    setChecks(d)
    setLogs(l)
    setRunning(r)
  }, [])

  useEffect(() => {
    void refresh()
    const id = window.setInterval(() => void refresh(), 4000)
    return () => window.clearInterval(id)
  }, [refresh])

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight
    }
  }, [logs])

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setSaveMsg(null)
    try {
      await saveConfig(config)
      setSaveMsg('Saved.')
      await refresh()
    } catch (ex) {
      setSaveMsg(ex instanceof Error ? ex.message : 'Save failed')
    } finally {
      setBusy(false)
    }
  }

  async function handleStart() {
    setBusy(true)
    try {
      await startAgent()
      await refresh()
    } catch (ex) {
      setLogs((prev) => `${prev}\n[ui] ${ex instanceof Error ? ex.message : 'Start failed'}`.trim())
    } finally {
      setBusy(false)
    }
  }

  async function handleStop() {
    setBusy(true)
    try {
      await stopAgent()
      await refresh()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="station-shell">
      <header className="station-header">
        <div>
          <h1>Pomfret Astro Station</h1>
          <p className="station-sub">Personal Edition</p>
        </div>
        <div className="station-actions">
          <span className={`run-pill ${running ? 'run-on' : 'run-off'}`}>
            {running ? 'Agent Running' : 'Agent Stopped'}
          </span>
          <button type="button" className="btn" disabled={busy || running} onClick={() => void handleStart()}>
            Start
          </button>
          <button type="button" className="btn btn-muted" disabled={busy || !running} onClick={() => void handleStop()}>
            Stop
          </button>
        </div>
      </header>

      <div className="station-grid">
        <section className="panel panel-checks">
          <h2>System checks</h2>
          <ul className="check-list">
            {checks.map((item) => (
              <ChecklistRow key={item.id} label={item.label} status={item.status} detail={item.detail} />
            ))}
          </ul>
        </section>

        <section className="panel panel-logs">
          <h2>Agent log</h2>
          <pre ref={logRef} className="log-view">
            {logs.trim() || 'No log output yet. Start the agent to see activity.'}
          </pre>
        </section>

        <section className="panel panel-settings">
          <h2>Settings</h2>
          <form className="settings-form" onSubmit={(e) => void handleSave(e)}>
            <label>
              <span>Personal Hub URL</span>
              <input
                type="url"
                value={config.hubBaseUrl}
                onChange={(e) => setConfig({ ...config, hubBaseUrl: e.target.value })}
              />
            </label>
            <label>
              <span>NINA install directory</span>
              <input
                type="text"
                value={config.ninaInstallDir}
                onChange={(e) => setConfig({ ...config, ninaInstallDir: e.target.value })}
              />
            </label>
            <label>
              <span>Jobs directory</span>
              <input
                type="text"
                value={config.jobsDir}
                onChange={(e) => setConfig({ ...config, jobsDir: e.target.value })}
              />
            </label>
            <label>
              <span>NINA output directory</span>
              <input
                type="text"
                value={config.ninaOutputDir}
                onChange={(e) => setConfig({ ...config, ninaOutputDir: e.target.value })}
              />
            </label>
            <label>
              <span>Python path (optional)</span>
              <input
                type="text"
                value={config.pythonPath}
                onChange={(e) => setConfig({ ...config, pythonPath: e.target.value })}
                placeholder="python3"
              />
            </label>
            <label>
              <span>Imaging queue secret (optional)</span>
              <input
                type="password"
                value={config.imagingQueueSecret}
                onChange={(e) => setConfig({ ...config, imagingQueueSecret: e.target.value })}
                autoComplete="off"
              />
            </label>
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={config.r2Enabled}
                onChange={(e) => setConfig({ ...config, r2Enabled: e.target.checked })}
              />
              <span>Enable R2 upload (raw_zip) — set R2_* env on this PC</span>
            </label>
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={config.autostartEnabled}
                onChange={(e) => setConfig({ ...config, autostartEnabled: e.target.checked })}
              />
              <span>Start agent at login (Windows service — installer pending)</span>
            </label>
            <button type="submit" className="btn btn-primary" disabled={busy}>
              Save settings
            </button>
            {saveMsg && <p className="save-msg">{saveMsg}</p>}
          </form>
        </section>
      </div>
    </div>
  )
}
