'use client'

import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { Suspense, useMemo, useState } from 'react'
import { MemberAuthPanel } from '@/components/member-auth-panel'
import { useMember } from '@/hooks/use-member'
import { PLANS, planIsPurchasable } from '@/lib/site-config'
import { normalizeProductPlan } from '@/lib/plan-utils'

type PromoPreview = {
  code: string
  finalPriceLabel: string
  label: string | null
}

function CheckoutContent() {
  const searchParams = useSearchParams()
  const rawPlan = searchParams.get('plan')
  const plan = normalizeProductPlan(rawPlan)
  const product = PLANS[plan]
  const purchasable = planIsPurchasable(plan)
  const member = useMember()

  const [promoCode, setPromoCode] = useState('')
  const [promoPreview, setPromoPreview] = useState<PromoPreview | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const displayTotal = useMemo(() => {
    if (promoPreview?.finalPriceLabel === 'Free') return 'Free'
    return product.price
  }, [product.price, promoPreview])

  async function handleValidatePromo() {
    setError(null)
    setBusy(true)
    try {
      const res = await fetch('/api/checkout/validate-promo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan, promoCode }),
      })
      const data = (await res.json()) as {
        ok?: boolean
        error?: string
        code?: string
        finalPriceLabel?: string
        label?: string | null
      }
      if (!res.ok || !data.ok || !data.code || !data.finalPriceLabel) {
        setPromoPreview(null)
        setError(data.error ?? 'Promotion code could not be applied.')
        return
      }
      setPromoPreview({
        code: data.code,
        finalPriceLabel: data.finalPriceLabel,
        label: data.label ?? null,
      })
    } catch (ex) {
      setPromoPreview(null)
      setError(ex instanceof Error ? ex.message : 'Could not validate promotion code.')
    } finally {
      setBusy(false)
    }
  }

  async function handleRedeem() {
    setError(null)
    setBusy(true)
    try {
      const res = await fetch('/api/checkout/redeem', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          plan,
          promoCode: promoPreview?.code ?? promoCode,
        }),
      })
      const data = (await res.json()) as {
        ok?: boolean
        error?: string
        successUrl?: string
      }
      if (!res.ok || !data.ok || !data.successUrl) {
        setError(data.error ?? 'Checkout failed.')
        return
      }
      window.location.href = data.successUrl
    } catch (ex) {
      setError(ex instanceof Error ? ex.message : 'Checkout failed.')
    } finally {
      setBusy(false)
    }
  }

  if (member.status === 'loading') {
    return (
      <section className="page-shell-form py-16 md:py-20">
        <p className="text-muted">Loading…</p>
      </section>
    )
  }

  if (!purchasable) {
    return (
      <section className="page-shell-narrow py-16 md:py-20">
        <Link href="/fraos" className="text-sm text-muted hover:text-fg">
          ← Back to FRAOS
        </Link>
        <h1 className="mt-8 font-display text-3xl font-bold text-fg">Checkout</h1>
        <p className="mt-4 text-muted">
          {product.name} is not available for purchase yet. Explore other tiers or check back when this
          edition launches.
        </p>
        <Link href={`/fraos/${plan}`} className="btn-secondary mt-8 inline-flex px-6 py-2.5 text-sm">
          View {product.shortName}
        </Link>
      </section>
    )
  }

  if (member.status === 'guest') {
    return (
      <section className="page-shell-narrow py-16 md:py-20">
        <Link href="/fraos" className="text-sm text-muted hover:text-fg">
          ← Back to FRAOS
        </Link>
        <h1 className="mt-8 font-display text-3xl font-bold text-fg">Checkout</h1>
        <p className="mt-2 text-muted">Log in or create an account to complete your purchase.</p>
        <MemberAuthPanel
          onSignedIn={(user) => {
            if (user) member.completeSignIn(user)
            else void member.refresh()
          }}
        />
      </section>
    )
  }

  return (
    <section className="page-shell-form py-16 md:py-20">
      <Link href="/fraos" className="text-sm text-muted hover:text-fg">
        ← Back to FRAOS
      </Link>
      <h1 className="mt-8 font-display text-3xl font-bold text-fg">Checkout</h1>
      <p className="mt-2 text-muted">
        Signed in as <span className="text-fg">{member.user.email}</span>
      </p>

      <div className="glass-card mt-10 p-8">
        <h2 className="font-display text-xl font-semibold text-fg">{product.name}</h2>
        <p className="mt-2 text-sm text-muted">{product.tagline}</p>

        <label className="mt-8 block">
          <span className="text-sm text-muted">Promotion code</span>
          <div className="mt-2 flex gap-2">
            <input
              type="text"
              value={promoCode}
              onChange={(e) => {
                setPromoCode(e.target.value)
                setPromoPreview(null)
              }}
              placeholder="Enter promotion code"
              className="min-w-0 flex-1 rounded-xl border border-white/15 bg-surface px-4 py-2.5 text-sm text-fg placeholder:text-muted/60"
              autoComplete="off"
              disabled={busy}
            />
            <button
              type="button"
              onClick={() => void handleValidatePromo()}
              disabled={busy || !promoCode.trim()}
              className="btn-secondary px-4 py-2.5 text-sm disabled:opacity-50"
            >
              Apply
            </button>
          </div>
          {promoPreview ? (
            <p className="mt-2 text-sm text-fg">
              {promoPreview.label ? `${promoPreview.label} · ` : ''}
              {promoPreview.code} applied — {promoPreview.finalPriceLabel}
            </p>
          ) : (
            <p className="mt-2 text-xs text-muted/80">
              Enter a promotion code from your admin for a free license and instant download.
            </p>
          )}
        </label>

        <div className="mt-6 flex items-baseline justify-between border-t border-white/15 pt-6">
          <span className="text-muted">Total</span>
          <div className="text-right">
            <span className="font-display text-3xl font-bold text-fg">{displayTotal}</span>
            <p className="text-xs text-muted">
              {displayTotal === 'Free' ? 'promotion applied' : product.period}
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => void handleRedeem()}
          disabled={busy || !promoPreview || promoPreview.finalPriceLabel !== 'Free'}
          className="btn-primary mt-8 w-full py-3.5 disabled:cursor-not-allowed disabled:opacity-45"
        >
          {busy ? 'Provisioning license…' : 'Complete purchase'}
        </button>
        {!promoPreview ? (
          <p className="mt-3 text-center text-xs text-muted/80">
            Apply a 100% promotion code to enable checkout. Paid card checkout is coming soon.
          </p>
        ) : null}
        {error ? <p className="mt-4 text-center text-sm text-red-300">{error}</p> : null}
      </div>

      <p className="mt-6 text-center text-xs text-muted/80">
        Your order provisions a dedicated cloud hub on www.boreanastro.com. You download the same
        Control Client and Station apps as everyone else, plus a personal{' '}
        <code className="text-fg/90">tenant.json</code> file that connects your install to your hub.
      </p>
    </section>
  )
}

export default function CheckoutPage() {
  return (
    <Suspense fallback={<div className="px-6 py-20 text-muted">Loading checkout…</div>}>
      <CheckoutContent />
    </Suspense>
  )
}
