import { useCallback, useEffect, useRef, useState } from 'react'
import { StatusRow, type StatusAction } from '../components/StatusRow'
import {
  activateAccount,
  agentIsRunning,
  applyUpdate,
  clearAgentLogs,
  hasUserLicense,
  installPython,
  loadConfig,
  loadTenant,
  readAgentLogs,
  runDiagnostics,
  saveConfig,
  scanNina,
  setupAutostart,
  startAgent,
  stopAgent,
} from '../lib/station-api'
import { getPersonalTenant } from '../lib/tenant'
import type { CheckItem, PersonalTenantInfo, StationConfig } from '../lib/types'

const emptyConfig: StationConfig = {
  ninaInstallDir: '',
  jobsDir: '',
  ninaOutputDir: '',
  r2Enabled: false,
  autostartEnabled: false,
  pythonPath: '',
}

const DEFAULT_HUB_URL = 'https://www.boreanastro.com'

export function StationDashboard() {
  const [config, setConfig] = useState<StationConfig>(emptyConfig)
  const [tenant, setTenant] = useState<PersonalTenantInfo | null>(null)
  const [licensed, setLicensed] = useState(false)
  const [login, setLogin] = useState('')
  const [password, setPassword] = useState('')
  const [licenseMsg, setLicenseMsg] = useState<string | null>(null)
  const [licenseErr, setLicenseErr] = useState<string | null>(null)
  const [checks, setChecks] = useState<CheckItem[]>([])
  const [logs, setLogs] = useState('')
  const [running, setRunning] = useState(false)
  const [busy, setBusy] = useState(false)
  const [actionId, setActionId] = useState<string | null>(null)
  const [saveMsg, setSaveMsg] = useState<string | null>(null)
  const logRef = useRef<HTMLPreElement>(null)

  const [checksLoading, setChecksLoading] = useState(true)
  const refreshInFlight = useRef(false)

  const refreshChecks = useCallback(async () => {
    if (refreshInFlight.current) return
    refreshInFlight.current = true
    try {
      const [d, l, r] = await Promise.all([runDiagnostics(), readAgentLogs(), agentIsRunning()])
      setChecks(d)
      setLogs(l)
      setRunning(r)
    } finally {
      setChecksLoading(false)
      refreshInFlight.current = false
    }
  }, [])

  const refresh = useCallback(async () => {
    const [c, t, hasLicense] = await Promise.all([loadConfig(), loadTenant(), hasUserLicense()])
    setConfig(c)
    setTenant(t)
    setLicensed(hasLicense)
    await refreshChecks()
  }, [refreshChecks])

  useEffect(() => {
    void (async () => {
      const [c, t, hasLicense] = await Promise.all([loadConfig(), loadTenant(), hasUserLicense()])
      setConfig(c)
      setTenant(t)
      setLicensed(hasLicense)
      await refreshChecks()
    })()
    const id = window.setInterval(() => void refreshChecks(), 8000)
    return () => window.clearInterval(id)
  }, [refreshChecks])

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight
    }
  }, [logs])

  function appendUiLog(message: string) {
    setLogs((prev) => `${prev}\n[ui] ${message}`.trim())
  }

  async function handleActivateLicense() {
    setBusy(true)
    setLicenseErr(null)
    setLicenseMsg(null)
    try {
      const next = await activateAccount({
        apiBaseUrl: DEFAULT_HUB_URL,
        login: login.trim(),
        password,
      })
      setTenant(next)
      setLicensed(true)
      setPassword('')
      setLicenseMsg(`License activated for ${next.displayName}.`)
      await refresh()
    } catch (ex) {
      setLicenseErr(ex instanceof Error ? ex.message : 'Activation failed.')
    } finally {
      setBusy(false)
    }
  }

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
      appendUiLog(ex instanceof Error ? ex.message : 'Start failed')
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

  async function handleClearLogs() {
    setBusy(true)
    try {
      await clearAgentLogs()
      setLogs('')
    } catch (ex) {
      appendUiLog(ex instanceof Error ? ex.message : 'Clear failed')
    } finally {
      setBusy(false)
    }
  }

  async function handleScanNina() {
    setActionId('nina_installed')
    try {
      const next = await scanNina()
      setConfig(next)
      await refreshChecks()
    } catch (ex) {
      appendUiLog(ex instanceof Error ? ex.message : 'NINA scan failed')
    } finally {
      setActionId(null)
    }
  }

  async function handleInstallPython() {
    setActionId('python')
    try {
      await installPython()
      await refreshChecks()
    } catch (ex) {
      appendUiLog(ex instanceof Error ? ex.message : 'Python install failed')
    } finally {
      setActionId(null)
    }
  }

  async function handleSetupAutostart() {
    setActionId('autostart')
    try {
      const next = await setupAutostart()
      setConfig(next)
      await refreshChecks()
    } catch (ex) {
      appendUiLog(ex instanceof Error ? ex.message : 'Autostart setup failed')
    } finally {
      setActionId(null)
    }
  }

  async function handleUpdate() {
    setActionId('station_version')
    try {
      await applyUpdate()
      await refreshChecks()
    } catch (ex) {
      appendUiLog(ex instanceof Error ? ex.message : 'Update failed')
    } finally {
      setActionId(null)
    }
  }

  function statusAction(item: CheckItem): StatusAction | undefined {
    const isOk = item.status === 'ok'
    const isBusy = actionId === item.id

    switch (item.id) {
      case 'nina_installed':
        return {
          label: 'Scan',
          disabled: isOk,
          busy: isBusy,
          onClick: () => void handleScanNina(),
        }
      case 'python':
        return {
          label: 'Install',
          disabled: isOk,
          busy: isBusy,
          onClick: () => void handleInstallPython(),
        }
      case 'autostart':
        return {
          label: 'Set up',
          disabled: isOk,
          busy: isBusy,
          onClick: () => void handleSetupAutostart(),
        }
      case 'station_version':
        return {
          label: 'Update',
          disabled: isOk,
          busy: isBusy,
          onClick: () => void handleUpdate(),
        }
      default:
        return undefined
    }
  }

  return (
    <div className="station-shell">
      <header className="station-header">
        <div>
          <h1>Borean Astro Station</h1>
          <p className="station-sub">FRAOS Standard</p>
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
          <div className="panel-heading">
            <h2>System status</h2>
          </div>
          <ul className="check-list">
            {checksLoading && checks.length === 0 ? (
              <li className="check-row check-row-loading">Running system checks…</li>
            ) : (
              checks.map((item) => (
                <StatusRow
                  key={item.id}
                  label={item.label}
                  status={item.status}
                  detail={item.id === 'station_version' ? item.detail : undefined}
                  action={statusAction(item)}
                />
              ))
            )}
          </ul>
        </section>

        <section className="panel panel-logs">
          <div className="panel-heading panel-heading-split">
            <h2>Agent log</h2>
            <button
              type="button"
              className="btn btn-muted"
              disabled={busy || !logs.trim()}
              onClick={() => void handleClearLogs()}
            >
              Clear
            </button>
          </div>
          <pre ref={logRef} className="log-view">
            {logs.trim()}
          </pre>
        </section>

        <section className="panel panel-settings">
          <div className="panel-heading">
            <h2>Settings</h2>
          </div>
          <p className="settings-license">
            License / cloud hub:{' '}
            <strong>{tenant?.displayName ?? getPersonalTenant().displayName ?? getPersonalTenant().tenantId}</strong>
            {' · '}
            tenant <code>{tenant?.tenantId ?? getPersonalTenant().tenantId}</code>
          </p>
          {!licensed ? (
            <div className="license-activate">
              <p className="settings-license">
                Sign in with your Borean Astro account to activate this install (same credentials as
                checkout).
              </p>
              <label>
                <span>Email or username</span>
                <input
                  type="text"
                  value={login}
                  onChange={(e) => setLogin(e.target.value)}
                  autoComplete="username"
                />
              </label>
              <label>
                <span>Password</span>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                />
              </label>
              <button
                type="button"
                className="btn btn-primary"
                disabled={busy || !login.trim() || !password}
                onClick={() => void handleActivateLicense()}
              >
                {busy ? 'Signing in…' : 'Sign in & activate license'}
              </button>
              {licenseMsg ? <p className="save-msg">{licenseMsg}</p> : null}
              {licenseErr ? <p className="save-msg save-msg-error">{licenseErr}</p> : null}
            </div>
          ) : (
            <p className="settings-license">License is active on this PC.</p>
          )}
          <form className="settings-form" onSubmit={(e) => void handleSave(e)}>
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
                placeholder="py"
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
              <span>Start Station at login (use Set up in System status)</span>
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
