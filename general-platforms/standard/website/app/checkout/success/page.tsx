'use client'

import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { Suspense, useEffect, useState } from 'react'

type SuccessPayload = {
  ok: boolean
  orderId: string
  tenantId: string
  displayName: string
  tenantConfigUrl: string
  downloads: {
    controlWindows: string | null
    controlMac: string | null
    stationWindows: string | null
  }
}

function SuccessContent() {
  const searchParams = useSearchParams()
  const orderId = searchParams.get('order') ?? ''
  const token = searchParams.get('token') ?? ''
  const [payload, setPayload] = useState<SuccessPayload | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!orderId || !token) {
      setError('Missing order information.')
      return
    }
    void (async () => {
      try {
        const res = await fetch(`/api/checkout/order/${orderId}/summary?token=${encodeURIComponent(token)}`)
        const data = (await res.json()) as SuccessPayload & { error?: string }
        if (!res.ok || !data.ok) {
          setError(data.error ?? 'Could not load order.')
          return
        }
        setPayload(data)
      } catch (ex) {
        setError(ex instanceof Error ? ex.message : 'Could not load order.')
      }
    })()
  }, [orderId, token])

  const tenantUrl =
    payload?.tenantConfigUrl ??
    (orderId && token ? `/api/checkout/order/${orderId}/tenant?token=${encodeURIComponent(token)}` : '#')

  return (
    <section className="page-shell-form py-16 md:py-20">
      <Link href="/fraos" className="text-sm text-muted hover:text-fg">
        ← Back to FRAOS
      </Link>
      <h1 className="mt-8 font-display text-3xl font-bold text-fg">You&apos;re ready to install</h1>
      <p className="mt-2 max-w-xl text-muted">
        Install the apps below, then sign in with your Borean Astro account inside each app to
        activate your license automatically.
      </p>

      {error ? <p className="mt-8 text-sm text-red-300">{error}</p> : null}

      {payload ? (
        <div className="glass-card mt-10 space-y-6 p-8">
          <div>
            <p className="text-sm text-muted">License</p>
            <p className="mt-1 text-lg font-semibold text-fg">{payload.displayName}</p>
            <p className="mt-1 font-mono text-xs text-muted/80">{payload.tenantId}</p>
          </div>

          <div className="space-y-3 border-t border-white/15 pt-6">
            <h2 className="font-display text-lg font-semibold text-fg">1. Install apps</h2>
            <p className="text-sm text-muted">
              Download Control Client (remote UI) and Station (observatory PC). These are shared
              installers — they stay the same for every customer.
            </p>
            <div className="flex flex-wrap gap-3">
              {payload.downloads.controlMac ? (
                <a
                  href={payload.downloads.controlMac}
                  className="btn-primary px-5 py-2.5 text-sm"
                >
                  Control Client (macOS)
                </a>
              ) : null}
              {payload.downloads.controlWindows ? (
                <a
                  href={payload.downloads.controlWindows}
                  className="btn-primary px-5 py-2.5 text-sm"
                >
                  Control Client (Windows)
                </a>
              ) : null}
              {payload.downloads.stationWindows ? (
                <a
                  href={payload.downloads.stationWindows}
                  className="btn-secondary px-5 py-2.5 text-sm"
                >
                  Station (Windows)
                </a>
              ) : null}
            </div>
            {!payload.downloads.controlMac &&
            !payload.downloads.controlWindows &&
            !payload.downloads.stationWindows ? (
              <p className="text-sm text-amber-200/90">
                Installer URLs are not configured yet on the server. Build locally with{' '}
                <code className="text-fg">npm run tauri build</code>, or run{' '}
                <code className="text-fg">node general-platforms/standard/scripts/stage-release-installers.mjs</code>{' '}
                and redeploy the website.
              </p>
            ) : null}
            {payload.downloads.controlMac ? (
              <div className="rounded-lg border border-white/10 bg-white/[0.03] p-4 text-sm text-muted">
                <p className="font-medium text-fg">macOS first launch</p>
                <p className="mt-1">
                  Apple may block the app because it is not notarized. If you see a security prompt,
                  open <strong className="font-medium text-fg">System Settings → Privacy &amp; Security</strong>{' '}
                  and click <strong className="font-medium text-fg">Open Anyway</strong>, or run in
                  Terminal:
                </p>
                <code className="mt-2 block overflow-x-auto rounded bg-black/30 px-3 py-2 text-xs text-fg">
                  xattr -cr &quot;/Applications/Borean Astro Control.app&quot;
                </code>
              </div>
            ) : null}
          </div>

          <div className="space-y-3 border-t border-white/15 pt-6">
            <h2 className="font-display text-lg font-semibold text-fg">2. Activate license</h2>
            <p className="text-sm text-muted">
              Open Control Client or Station → Settings and sign in with your Borean Astro account
              (same email/password as checkout). Your license is installed automatically — you do
              not need to download <code className="text-fg">tenant.json</code> separately.
            </p>
            <details className="text-sm text-muted">
              <summary className="cursor-pointer text-fg/80">Optional: manual tenant.json</summary>
              <p className="mt-2">
                If you prefer, you can still download the JSON file and import it in Settings, or
                save it to{' '}
                <code className="text-fg">%LOCALAPPDATA%/BoreanAstro/tenant.json</code> (Windows) or{' '}
                <code className="text-fg">~/.boreanastro/tenant.json</code> (macOS).
              </p>
              <a
                href={tenantUrl}
                className="btn-secondary mt-3 inline-flex px-5 py-2.5 text-sm"
              >
                Download tenant.json
              </a>
            </details>
          </div>

          <div className="space-y-2 border-t border-white/15 pt-6">
            <h2 className="font-display text-lg font-semibold text-fg">3. OTA updates</h2>
            <p className="text-sm text-muted">
              After install, use <strong className="font-medium text-fg">Update</strong> in Station and
              Settings → Updates in Control Client. The apps poll your cloud hub for the latest version and
              download URL automatically.
            </p>
          </div>
        </div>
      ) : !error ? (
        <p className="mt-10 text-muted">Loading your downloads…</p>
      ) : null}
    </section>
  )
}

export default function CheckoutSuccessPage() {
  return (
    <Suspense fallback={<div className="px-6 py-20 text-muted">Loading…</div>}>
      <SuccessContent />
    </Suspense>
  )
}
