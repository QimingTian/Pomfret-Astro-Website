'use client'

import { useState } from 'react'
import { usePathname } from 'next/navigation'
import Link from 'next/link'

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const pathname = usePathname()
  const isWelcomePage = pathname === '/dashboard'
  const [menuOpen, setMenuOpen] = useState(false)

  const navItems = [
    { href: '/dashboard/camera', label: 'Camera' },
    { href: '/dashboard/gallery', label: 'Gallery' },
    { href: '/dashboard/weather', label: 'Weather' },
    { href: '/dashboard/remote', label: 'Remote' },
    { href: '/dashboard/admin', label: 'Admin' },
  ]

  return (
    <div className="dashboard-surface min-h-screen text-apple-dark dark:text-[#eee9dc]">
      <header className="sticky top-0 z-50 border-b border-black/10 dark:border-white/10 bg-white/75 dark:bg-[#09090a] backdrop-blur-xl">
        <div className="mx-auto max-w-[1400px] px-4 sm:px-6 lg:px-10">
          <div className="h-20 flex items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <button
                type="button"
                onClick={() => setMenuOpen((v) => !v)}
                className="md:hidden p-2.5 rounded-full border border-black/10 dark:border-white/15 bg-white/70 dark:bg-white/5"
                aria-label="Toggle navigation"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M4 7h16M4 12h16M4 17h16" />
                </svg>
              </button>
              <Link href="/dashboard" className="text-lg sm:text-xl leading-none tracking-wide font-semibold text-white">
                Pomfret Astro
              </Link>
            </div>

            <nav className="hidden md:flex items-center gap-2">
              {navItems.map((item) => {
                const isActive = pathname === item.href
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`inline-flex items-center px-4 py-2 rounded-full text-sm transition-all ${
                      isActive
                        ? 'text-black dark:text-white'
                        : 'text-black/70 dark:text-gray-400 hover:bg-black/5 dark:hover:bg-white/10 hover:text-black dark:hover:text-white'
                    }`}
                  >
                    <span className="font-medium">{item.label}</span>
                  </Link>
                )
              })}
            </nav>

          </div>
        </div>

        {menuOpen && (
          <div className="md:hidden border-t border-black/10 dark:border-white/10 bg-white/90 dark:bg-[#12151b]/95">
            <nav className="px-4 py-3 space-y-1.5">
              {navItems.map((item) => {
                const isActive = pathname === item.href
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setMenuOpen(false)}
                    className={`flex items-center px-3 py-2.5 rounded-xl ${
                      isActive
                        ? 'text-black dark:text-white'
                        : 'text-black/75 dark:text-gray-400 hover:bg-black/5 dark:hover:bg-white/10 hover:text-black dark:hover:text-white'
                    }`}
                  >
                    <span>{item.label}</span>
                  </Link>
                )
              })}
            </nav>
          </div>
        )}
      </header>

      <main className={isWelcomePage ? 'min-h-[calc(100vh-5rem)]' : 'mx-auto max-w-[1400px] px-4 sm:px-6 lg:px-10 py-8'}>
        {children}
      </main>
    </div>
  )
}

