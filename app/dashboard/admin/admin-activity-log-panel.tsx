'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  auditLogDetailFields,
  auditLogHeadline,
  auditLogLineFailed,
  type AuditLogRowLike,
} from '@/lib/admin-audit-log-display'
import type { AuditLogRow } from '@/app/dashboard/admin/use-admin-tools'

type Props = {
  entries: AuditLogRow[]
  loading: boolean
  error: string | null
}

export function AdminActivityLogPanel({ entries, loading, error }: Props) {
  const [selected, setSelected] = useState<AuditLogRow | null>(null)

  const closeDetail = useCallback(() => setSelected(null), [])

  useEffect(() => {
    if (!selected) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeDetail()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selected, closeDetail])

  return (
    <>
      {error ? <p className="mb-2 text-sm text-red-400">{error}</p> : null}
      <div className="admin-activity-log-scroll max-h-[28rem] min-h-[12rem] overflow-y-auto font-mono text-xs leading-relaxed">
        {entries.length === 0 && !loading ? (
          <p className="text-sm text-gray-500">No log entries yet.</p>
        ) : (
          <>
            {entries.map((row) => {
              const failed = auditLogLineFailed(row)
              const headline = auditLogHeadline(row)
              const timeLabel = Number.isFinite(Date.parse(row.at))
                ? new Date(row.at).toLocaleTimeString()
                : row.at
              return (
                <button
                  key={row.id}
                  type="button"
                  onClick={() => setSelected(row)}
                  className={`mb-2 block w-full text-left border-l-2 pl-2 pr-1 py-0.5 rounded-r hover:bg-white/5 focus:outline-none focus-visible:ring-1 focus-visible:ring-white/30 ${
                    failed ? 'border-red-600/60' : 'border-green-700/40'
                  }`}
                >
                  <span className="text-gray-500">[{timeLabel}]</span>{' '}
                  <span className={failed ? 'text-red-400 font-semibold' : 'text-green-400'}>
                    {headline}
                  </span>
                </button>
              )
            })}
          </>
        )}
      </div>

      {selected ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          role="presentation"
          onClick={closeDetail}
        >
          <div
            role="dialog"
            aria-labelledby="audit-log-detail-title"
            className="w-full max-w-2xl max-h-[85vh] flex flex-col rounded-xl border border-gray-700 bg-[#09090a] shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3 border-b border-gray-800 px-4 py-3">
              <div className="min-w-0">
                <h2 id="audit-log-detail-title" className="text-sm font-semibold text-white font-mono">
                  {auditLogHeadline(selected)}
                </h2>
                <p className="mt-1 text-xs text-gray-500">{selected.kind}</p>
              </div>
              <button
                type="button"
                onClick={closeDetail}
                className="shrink-0 rounded-lg border border-gray-600 px-3 py-1.5 text-xs text-gray-200 hover:bg-gray-800"
              >
                Close
              </button>
            </div>
            <div className="overflow-y-auto p-4 space-y-3 font-mono text-xs">
              {auditLogDetailFields(selected as AuditLogRowLike).map((field) => (
                <div key={field.label}>
                  <p className="text-gray-500 uppercase tracking-wide text-[10px] mb-0.5">
                    {field.label}
                  </p>
                  <p className="whitespace-pre-wrap break-words text-gray-100">{field.value}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </>
  )
}
