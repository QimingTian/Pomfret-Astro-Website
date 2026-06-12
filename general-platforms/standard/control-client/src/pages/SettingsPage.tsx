import { useCallback, useEffect, useState } from 'react'
import {
  activateAccount,
  appVersion,
  applyUpdate,
  checkForUpdate,
  getLicensePath,
  hasUserLicense,
  importTenantLicense,
  loadAppTenant,
  type PersonalTenantInfo,
  type UpdateStatus,
} from '../lib/control-app-api'
import { getCloudHubLabel } from '../lib/hub-client'

const DEFAULT_HUB_URL = 'https://www.boreanastro.com'

export function SettingsPage() {
  const [tenant, setTenant] = useState<PersonalTenantInfo | null>(null)
  const [licensePath, setLicensePath] = useState<string | null>(null)
  const [licensed, setLicensed] = useState(false)
  const [version, setVersion] = useState<string | null>(null)
  const [update, setUpdate] = useState<UpdateStatus | null>(null)
  const [login, setLogin] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    const [t, path, hasLicense, v, u] = await Promise.all([
      loadAppTenant(),
      getLicensePath(),
      hasUserLicense(),
      appVersion(),
      checkForUpdate(),
    ])
    setTenant(t)
    setLicensePath(path)
    setLicensed(hasLicense)
    setVersion(v)
    setUpdate(u)
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  async function handleActivate() {
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      const next = await activateAccount({
        apiBaseUrl: DEFAULT_HUB_URL,
        login: login.trim(),
        password,
      })
      setTenant(next)
      setLicensed(true)
      setPassword('')
      setMessage(`License activated for ${next.displayName}.`)
      await refresh()
    } catch (ex) {
      setError(ex instanceof Error ? ex.message : 'Activation failed.')
    } finally {
      setBusy(false)
    }
  }

  async function handleImportLicense() {
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      const next = await importTenantLicense()
      setTenant(next)
      setLicensed(true)
      setMessage(`License installed for ${next.displayName}. Restart the app if hub calls fail.`)
      await refresh()
    } catch (ex) {
      setError(ex instanceof Error ? ex.message : 'Import failed.')
    } finally {
      setBusy(false)
    }
  }

  async function handleUpdate() {
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      await applyUpdate()
      setMessage('Opening update download in your browser…')
    } catch (ex) {
      setError(ex instanceof Error ? ex.message : 'Update failed.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="pb-8 max-w-2xl">
      <h1 className="text-2xl font-semibold text-white mb-4">Settings</h1>

      <section className="rounded-xl border border-white/15 bg-[#151616] p-5 mb-5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-white/70">License</h2>
        <p className="mt-2 text-sm text-white/60">
          Cloud hub: {getCloudHubLabel()} · Tenant:{' '}
          <span className="text-white">{tenant?.displayName ?? '—'}</span>
        </p>
        {tenant ? (
          <p className="mt-1 font-mono text-xs text-white/45">{tenant.tenantId}</p>
        ) : null}
        {licensePath ? (
          <p className="mt-3 text-xs text-white/45 break-all">License file: {licensePath}</p>
        ) : null}

        {!licensed ? (
          <div className="mt-4 space-y-3">
            <p className="text-sm text-white/60">
              Sign in with the same Borean Astro account you used at checkout. Your license is
              fetched automatically — no separate tenant.json download required.
            </p>
            <label className="block text-sm text-white/70">
              Email or username
              <input
                type="text"
                value={login}
                onChange={(e) => setLogin(e.target.value)}
                autoComplete="username"
                className="mt-1 w-full rounded-lg border border-white/15 bg-black/30 px-3 py-2 text-white"
              />
            </label>
            <label className="block text-sm text-white/70">
              Password
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                className="mt-1 w-full rounded-lg border border-white/15 bg-black/30 px-3 py-2 text-white"
              />
            </label>
            <button
              type="button"
              onClick={() => void handleActivate()}
              disabled={busy || !login.trim() || !password}
              className="btn"
            >
              {busy ? 'Signing in…' : 'Sign in & activate license'}
            </button>
          </div>
        ) : (
          <p className="mt-4 text-sm text-green-400/90">License is active on this device.</p>
        )}

        <details className="mt-4 text-sm text-white/50">
          <summary className="cursor-pointer text-white/70">Advanced: import tenant.json</summary>
          <p className="mt-2 text-xs text-white/45">
            Optional fallback if you already downloaded the JSON file from the website.
          </p>
          <button
            type="button"
            onClick={() => void handleImportLicense()}
            disabled={busy}
            className="btn mt-3"
          >
            Import tenant.json
          </button>
        </details>
      </section>

      <section className="rounded-xl border border-white/15 bg-[#151616] p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-white/70">Updates</h2>
        <p className="mt-2 text-sm text-white/60">
          Installed: <span className="text-white">{version ?? '—'}</span>
          {update ? (
            <>
              {' '}
              · Latest: <span className="text-white">{update.latestVersion}</span>
            </>
          ) : null}
        </p>
        {update?.updateAvailable ? (
          <p className="mt-2 text-sm text-aurora-cyan">A newer Control Client build is available.</p>
        ) : update ? (
          <p className="mt-2 text-sm text-white/50">You are up to date.</p>
        ) : null}
        <button
          type="button"
          onClick={() => void handleUpdate()}
          disabled={busy || !update?.updateAvailable}
          className="btn mt-4"
        >
          {busy ? 'Checking…' : 'Download update'}
        </button>
      </section>

      {message ? <p className="mt-4 text-sm text-green-400">{message}</p> : null}
      {error ? <p className="mt-4 text-sm text-red-400">{error}</p> : null}
    </div>
  )
}
