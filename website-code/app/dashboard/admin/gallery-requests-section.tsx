'use client'

import {
  glassPillDangerSm,
  glassPillLg,
  glassPillLgWide,
  glassPillMd,
  glassPillSm,
  glassPillSuccessSm,
  glassPillXs,
} from '@/lib/glass-ui'
import { useCallback, useEffect, useState } from 'react'
import { DashboardPanel } from '@/app/dashboard/account/dashboard-panel'

type Row = {
  id: string
  userId: string
  submitterLabel: string
  description: string
  fileName: string
  createdAt: string
  previewSrc: string
}

export function GalleryRequestsSection({ className = '' }: { className?: string }) {
  const [submissions, setSubmissions] = useState<Row[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [actingId, setActingId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/gallery-submissions', { credentials: 'include', cache: 'no-store' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || data?.ok !== true || !Array.isArray(data.submissions)) {
        setError(typeof data.error === 'string' ? data.error : 'Could not load gallery requests.')
        return
      }
      setSubmissions(data.submissions as Row[])
    } catch {
      setError('Could not load gallery requests.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function downloadRow(row: Row) {
    setActingId(row.id)
    setError(null)
    try {
      const res = await fetch(
        `/api/admin/gallery-submissions/${encodeURIComponent(row.id)}/download`,
        { credentials: 'include' }
      )
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(typeof data.error === 'string' ? data.error : 'Download failed.')
        return
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = row.fileName || 'gallery-submission.png'
      a.click()
      URL.revokeObjectURL(url)
      await load()
    } catch {
      setError('Download failed.')
    } finally {
      setActingId(null)
    }
  }

  async function dismissRow(row: Row) {
    if (!window.confirm(`Dismiss submission from ${row.submitterLabel}?`)) return
    setActingId(row.id)
    setError(null)
    try {
      const res = await fetch(
        `/api/admin/gallery-submissions/${encodeURIComponent(row.id)}/dismiss`,
        { method: 'POST', credentials: 'include' }
      )
      const data = await res.json().catch(() => ({}))
      if (!res.ok || data?.ok !== true) {
        setError(typeof data.error === 'string' ? data.error : 'Dismiss failed.')
        return
      }
      await load()
    } catch {
      setError('Dismiss failed.')
    } finally {
      setActingId(null)
    }
  }

  return (
    <DashboardPanel
      title="Gallery Request"
      action={
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className={`${glassPillXs} disabled:opacity-50`}
        >
          {loading ? '…' : 'Refresh'}
        </button>
      }
      className={className}
    >
      {error ? <p className="mb-2 text-sm text-red-400">{error}</p> : null}
      {submissions.length === 0 && !loading ? (
        <p className="text-sm text-gray-500">No pending gallery submissions.</p>
      ) : (
        <ul className="max-h-[24rem] space-y-3 overflow-y-auto">
          {submissions.map((row) => {
            const busy = actingId === row.id
            return (
              <li
                key={row.id}
                className="flex flex-wrap gap-3 rounded-lg border border-gray-700 p-3 sm:flex-nowrap"
              >
                <div className="aspect-[4/3] w-28 shrink-0 overflow-hidden rounded bg-black">
                  <img src={row.previewSrc} alt="" className="h-full w-full object-cover" />
                </div>
                <div className="min-w-0 flex-1 text-sm">
                  <p className="font-medium text-white">{row.submitterLabel}</p>
                  <p className="mt-1 break-words text-gray-300">{row.description}</p>
                  <p className="mt-1 text-xs text-gray-500">{row.fileName}</p>
                  <p className="mt-1 text-xs text-gray-500">{new Date(row.createdAt).toLocaleString()}</p>
                </div>
                <div className="flex shrink-0 flex-wrap items-start gap-2 self-start">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void downloadRow(row)}
                    className={`${glassPillSuccessSm} disabled:opacity-40`}
                  >
                    Download
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void dismissRow(row)}
                    className={`${glassPillDangerSm} disabled:opacity-40`}
                  >
                    Dismiss
                  </button>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </DashboardPanel>
  )
}
