import { useState, type ReactNode } from 'react'

export type DashboardTab = 'weather' | 'atlas' | 'remote' | 'settings'

type DashboardLayoutProps = {
  tab: DashboardTab
  onNavigate: (tab: DashboardTab) => void
  children: ReactNode
}

const NAV: { id: DashboardTab; label: string }[] = [
  { id: 'weather', label: 'Weather' },
  { id: 'atlas', label: 'Atlas' },
  { id: 'remote', label: 'Remote' },
  { id: 'settings', label: 'Settings' },
]

function NavPill({
  label,
  active,
  onClick,
  className = '',
}: {
  label: string
  active: boolean
  onClick: () => void
  className?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`btn ${active ? '' : 'btn-muted'} ${className}`.trim()}
      aria-current={active ? 'page' : undefined}
    >
      {label}
    </button>
  )
}

export function DashboardLayout({ tab, onNavigate, children }: DashboardLayoutProps) {
  const [menuOpen, setMenuOpen] = useState(false)

  return (
    <div className="client-shell">
      <header className="client-header">
        <div>
          <h1>Borean Astro</h1>
          <p className="client-sub">FRAOS Standard</p>
        </div>

        <div className="client-header-actions">
          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            className="btn btn-muted client-menu-toggle"
            aria-label="Toggle navigation"
            aria-expanded={menuOpen}
          >
            Menu
          </button>

          <nav className="client-tabs" aria-label="Main">
            {NAV.map((item) => (
              <NavPill
                key={item.id}
                label={item.label}
                active={tab === item.id}
                onClick={() => onNavigate(item.id)}
              />
            ))}
          </nav>
        </div>
      </header>

      {menuOpen && (
        <nav className="client-tabs-mobile" aria-label="Main mobile">
          {NAV.map((item) => (
            <NavPill
              key={item.id}
              label={item.label}
              active={tab === item.id}
              className="client-tab-mobile"
              onClick={() => {
                onNavigate(item.id)
                setMenuOpen(false)
              }}
            />
          ))}
        </nav>
      )}

      <main className={tab === 'remote' ? 'client-main client-main-flush' : 'client-main'}>
        {children}
      </main>
    </div>
  )
}
