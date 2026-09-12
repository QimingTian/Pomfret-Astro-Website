'use client'

import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import Link from 'next/link'
import { MemberProvider, useMember } from '@/hooks/use-member'
import { NightModeToggle } from '@/components/night-mode-toggle'
import { ObservatorySiteProvider, useObservatorySite } from '@/components/observatory-site-provider'
import {
  DASHBOARD_ABOUT_LINKS,
  DASHBOARD_TOOL_LINKS,
  DashboardAboutTrigger,
  DashboardToolsTrigger,
  ObservatorySiteHeaderShell,
  ObservatorySiteMenuProvider,
  ObservatorySiteTrigger,
} from '@/components/observatory-site-switcher'
import { SiteCopyrightFooter } from '@/components/site-copyright-footer'
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
  const { hasSite } = useObservatorySite()
  const accountHref = '/dashboard/account'
  const accountLabel = accountNavLabel(member)

  useEffect(() => {
    void member.refresh()
  }, [pathname, member.refresh])

  const mobileNavItems = [
    ...DASHBOARD_ABOUT_LINKS,
    ...(hasSite ? [...DASHBOARD_TOOL_LINKS] : []),
    { href: accountHref, label: accountLabel },
  ]

  const navItemActive = (href: string) => {
    if (href === '/dashboard/about') return isHomePage
    return pathname === href
  }

  return (
    <div className="dashboard-surface flex min-h-screen flex-col text-apple-dark dark:text-[#eee9dc]">
      <ObservatorySiteMenuProvider>
        <ObservatorySiteHeaderShell className="sticky top-0 z-50 relative overflow-visible border-b border-black/10 bg-white/75 backdrop-blur-xl dark:border-white/10 dark:bg-[#09090a]">
          <div className="mx-auto max-w-[1400px] overflow-visible px-4 sm:px-6 lg:px-10">
            <div className="flex h-20 items-center justify-between gap-4 overflow-visible">
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

              <div className="flex h-full items-stretch gap-2">
                <nav className="hidden md:flex items-stretch gap-2">
                  <DashboardAboutTrigger />
                  <DashboardToolsTrigger />
                  <Link
                    href={accountHref}
                    className={`${navItemActive(accountHref) ? glassNavLinkActive : glassNavLink} self-center`}
                  >
                    <span>{accountLabel}</span>
                  </Link>
                </nav>
                <ObservatorySiteTrigger />
                <div className="flex items-center">
                  <NightModeToggle />
                </div>
              </div>
            </div>
          </div>

          {menuOpen && (
            <div className="md:hidden border-t border-black/10 dark:border-white/10 bg-white/90 dark:bg-[#12151b]/95">
              <nav className="px-4 py-3 space-y-1.5">
                {mobileNavItems.map((item) => {
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
                {!hasSite && (
                  <p className="px-3 py-2 text-sm text-apple-dark/70 dark:text-[#eee9dc]/70">
                    Please Choose An Observatory First.
                  </p>
                )}
              </nav>
            </div>
          )}
        </ObservatorySiteHeaderShell>
      </ObservatorySiteMenuProvider>

      <main
        className={
          isHomePage
            ? 'flex-1'
            : 'mx-auto w-full max-w-[1400px] flex-1 px-4 py-8 sm:px-6 lg:px-10'
        }
      >
        {children}
      </main>
      {/* About embeds its own copyright above the fixed video layer. */}
      {!isHomePage ? <SiteCopyrightFooter /> : null}
    </div>
  )
}
