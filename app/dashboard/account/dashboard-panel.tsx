import type { ReactNode } from 'react'

export function DashboardPanel({
  title,
  action,
  children,
  className = '',
  compact = false,
}: {
  title: string
  action?: ReactNode
  children: ReactNode
  className?: string
  compact?: boolean
}) {
  /** compact: no min panel height; same vertical rhythm as other dashboard rows. */
  const sizeClass = compact
    ? 'min-h-0 gap-3 py-3 sm:py-4'
    : 'min-h-[14rem] gap-3 py-3 sm:py-4'
  return (
    <section className={`flex min-w-0 flex-col ${sizeClass} ${className}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-lg font-semibold text-white">{title}</h3>
        {action}
      </div>
      <div className="min-h-0 flex-1">{children}</div>
    </section>
  )
}
