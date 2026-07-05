'use client'

type SelectionRow = { label: string; value: string }

type Props = {
  id: string
  rows: SelectionRow[]
}

export function PlanSelectionOverlay({ id, rows }: Props) {
  const compactRows = rows.filter((r) => !r.label.includes('JSON')).slice(0, 8)
  if (!id && compactRows.length === 0) return null

  return (
    <div
      className="pointer-events-auto rounded-lg border border-white/15 bg-black/75 px-3 py-2.5 text-white shadow-lg backdrop-blur-sm"
      aria-label="Selected object"
    >
      <p className="break-words text-sm font-medium leading-snug">{id || '—'}</p>
      {compactRows.length > 0 ? (
        <dl className="mt-2 space-y-1">
          {compactRows.map((row) => (
            <div key={row.label} className="flex gap-2 text-xs leading-snug">
              <dt className="shrink-0 text-white/55">{row.label}</dt>
              <dd className="min-w-0 break-words font-mono tabular-nums text-white/90">{row.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </div>
  )
}
