'use client'

import { useCallback, useEffect, useState } from 'react'
import { DashboardPanel } from '@/app/account/dashboard-panel'
import type { ProductPlan } from '@/lib/site-config'

type OrderRow = {
  orderId: string
  plan: ProductPlan
  planName: string
  displayName: string
  tenantId: string
  promoCode: string | null
  createdAt: string
  tenantConfigUrl: string
  downloads: {
    controlWindows: string | null
    controlMac: string | null
    stationWindows: string | null
  }
}

type OrdersPayload = {
  ok?: boolean
  orders?: OrderRow[]
  total?: number
  error?: string
}

const actionButtonClass =
  'rounded-full border border-white/25 bg-surface px-3 py-1 text-xs font-medium text-fg hover:bg-[#1b1c1c] disabled:opacity-50'

const downloadLinkClass =
  'inline-flex items-center rounded-full border border-white/25 bg-surface px-3 py-1 text-xs font-medium text-fg hover:bg-[#1b1c1c]'

function formatDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function PurchaseHistorySection({ className = '' }: { className?: string }) {
  const [orders, setOrders] = useState<OrderRow[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/member/orders', { credentials: 'include', cache: 'no-store' })
      const data = (await res.json().catch(() => ({}))) as OrdersPayload
      if (!res.ok || data?.ok !== true || !Array.isArray(data.orders)) {
        setError(typeof data.error === 'string' ? data.error : 'Could not load purchase history.')
        return
      }
      setOrders(data.orders)
      setTotal(typeof data.total === 'number' ? data.total : data.orders.length)
    } catch {
      setError('Could not load purchase history.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const refreshButton = (
    <button type="button" onClick={() => void load()} disabled={loading} className={actionButtonClass}>
      {loading ? '…' : 'Refresh'}
    </button>
  )

  return (
    <DashboardPanel
      title={`Purchase history${total > 0 ? ` (${total})` : ''}`}
      action={refreshButton}
      compact
      className={className}
    >
      <p className="text-sm text-muted">
        Re-download your tenant credentials and installers anytime. Promotion codes are single-use, but your
        license stays on this account.
      </p>

      {error ? <p className="mt-4 text-sm text-red-400">{error}</p> : null}

      {orders.length === 0 && !loading ? (
        <p className="mt-4 text-sm text-muted">No purchases yet.</p>
      ) : (
        <ul className="mt-4 space-y-4">
          {orders.map((order) => (
            <li key={order.orderId} className="rounded-lg border border-white/15 p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="font-medium text-fg">{order.planName}</p>
                  <p className="mt-1 text-sm text-muted">{order.displayName}</p>
                  <p className="mt-1 font-mono text-xs text-muted/80">{order.tenantId}</p>
                  <p className="mt-2 text-xs text-muted">
                    Purchased {formatDate(order.createdAt)}
                    {order.promoCode ? (
                      <>
                        <span className="mx-2">·</span>
                        Code {order.promoCode}
                      </>
                    ) : null}
                  </p>
                </div>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                <a href={order.tenantConfigUrl} className={downloadLinkClass}>
                  tenant.json
                </a>
                {order.downloads.controlMac ? (
                  <a href={order.downloads.controlMac} className={downloadLinkClass}>
                    Control (macOS)
                  </a>
                ) : null}
                {order.downloads.controlWindows ? (
                  <a href={order.downloads.controlWindows} className={downloadLinkClass}>
                    Control (Windows)
                  </a>
                ) : null}
                {order.downloads.stationWindows ? (
                  <a href={order.downloads.stationWindows} className={downloadLinkClass}>
                    Station (Windows)
                  </a>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </DashboardPanel>
  )
}
