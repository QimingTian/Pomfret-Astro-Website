'use client'

import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import Link from 'next/link'
import { MemberProvider, useMember } from '@/hooks/use-member'
import { NightModeToggle } from '@/components/night-mode-toggle'
import { ObservatorySiteProvider } from '@/components/observatory-site-provider'
import {
  ObservatorySiteHeaderShell,
  ObservatorySiteMenuProvider,
  ObservatorySitePanel,
  ObservatorySiteTrigger,
} from '@/components/observatory-site-switcher'
import { glassNavLink, glassNavLinkActive, glassNavLinkMobile, glassPillIcon } from '@/lib/glass-ui'

function accountNavLabel(member: ReturnType<typeof useMember>): string {
  if (member.status !== 'authenticated') return 'Log In'
  const user = member.user
  return user.username?.trim() || user.email.split('@')[0] || user.email
}

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <MemberProvider>
      <ObservatorySiteProvider>
        <DashboardChrome>{children}</DashboardChrome>
      </ObservatorySiteProvider>
    </MemberProvider>
  )
}

function DashboardChrome({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const isHomePage = pathname === '/dashboard' || pathname === '/dashboard/about'
  const [menuOpen, setMenuOpen] = useState(false)
  const member = useMember()

  useEffect(() => {
    void member.refresh()
  }, [pathname, member.refresh])

  const navItems = [
    { href: '/dashboard/about', label: 'About' },
    { href: '/dashboard/weather', label: 'Weather' },
    { href: '/dashboard/plan', label: 'Plan' },
    { href: '/dashboard/remote', label: 'Remote' },
    { href: '/dashboard/gallery', label: 'Data' },
    { href: '/dashboard/contact', label: 'Team' },
    { href: '/dashboard/account', label: accountNavLabel(member) },
  ]

  const navItemActive = (href: string) => {
    if (href === '/dashboard/about') return isHomePage
    return pathname === href
  }

  return (
    <div className="dashboard-surface min-h-screen text-apple-dark dark:text-[#eee9dc]">
      <ObservatorySiteMenuProvider>
        <ObservatorySiteHeaderShell className="sticky top-0 z-50 relative bg-white/75 dark:bg-[#09090a] backdrop-blur-xl">
          <div className="mx-auto max-w-[1400px] px-4 sm:px-6 lg:px-10">
            <div className="h-20 flex items-center justify-between gap-4">
              <div className="flex items-center gap-2 sm:gap-3">
                <button
                  type="button"
                  onClick={() => setMenuOpen((v) => !v)}
                  className={`md:hidden ${glassPillIcon}`}
                  aria-label="Toggle navigation"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M4 7h16M4 12h16M4 17h16" />
                  </svg>
                </button>
                <Link href="/dashboard/about" className="text-lg sm:text-xl leading-none tracking-wide font-semibold text-white">
                  Pomfret Astro
                </Link>
              </div>

              <div className="flex items-center gap-2">
                <nav className="hidden md:flex items-center gap-2">
                  {navItems.map((item) => {
                    const isActive = navItemActive(item.href)
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        className={isActive ? glassNavLinkActive : glassNavLink}
                      >
                        <span>{item.label}</span>
                      </Link>
                    )
                  })}
                </nav>
                <ObservatorySiteTrigger />
                <NightModeToggle />
              </div>
            </div>
          </div>

          <ObservatorySitePanel />

          {menuOpen && (
            <div className="md:hidden border-t border-black/10 dark:border-white/10 bg-white/90 dark:bg-[#12151b]/95">
              <nav className="px-4 py-3 space-y-1.5">
                {navItems.map((item) => {
                  const isActive = navItemActive(item.href)
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={() => setMenuOpen(false)}
                      className={isActive ? `${glassNavLinkMobile} glass-pill-ghost-active` : glassNavLinkMobile}
                    >
                      <span>{item.label}</span>
                    </Link>
                  )
                })}
              </nav>
            </div>
          )}
        </ObservatorySiteHeaderShell>
      </ObservatorySiteMenuProvider>

      <main
        className={
          isHomePage
            ? 'min-h-[calc(100vh-5rem)]'
            : 'mx-auto max-w-[1400px] px-4 sm:px-6 lg:px-10 py-8'
        }
      >
        {children}
      </main>
    </div>
  )
}
