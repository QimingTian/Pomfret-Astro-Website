'use client'

import Link from 'next/link'
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { usePathname } from 'next/navigation'
import { glassNavLink, glassNavLinkActive } from '@/lib/glass-ui'
import {
  OBSERVATORY_SITES,
  type ObservatorySiteId,
} from '@/lib/observatory-sites'
import { useObservatorySite } from '@/components/observatory-site-provider'

export const DASHBOARD_ABOUT_LINKS = [
  { href: '/dashboard/about', label: 'Overview' },
  { href: '/dashboard/gallery', label: 'Data' },
  { href: '/dashboard/contact', label: 'Team' },
] as const

export const DASHBOARD_TOOL_LINKS = [
  { href: '/dashboard/weather', label: 'Weather' },
  { href: '/dashboard/plan', label: 'Plan' },
  { href: '/dashboard/remote', label: 'Remote' },
] as const

type HeaderMenuId = 'about' | 'site' | 'tools'

type ObservatorySiteMenuContextValue = {
  active: HeaderMenuId | null
  selectedId: ObservatorySiteId | null
  selectedName: string
  aboutListId: string
  siteListId: string
  toolsListId: string
  aboutActive: boolean
  toolsActive: boolean
  hasSite: boolean
  openMenu: (id: HeaderMenuId) => void
  cancelClose: () => void
  scheduleClose: () => void
  toggleMenu: (id: HeaderMenuId) => void
  closeMenu: () => void
  selectSite: (id: ObservatorySiteId) => void
}

const ObservatorySiteMenuContext = createContext<ObservatorySiteMenuContextValue | null>(null)

function useObservatorySiteMenu(): ObservatorySiteMenuContextValue {
  const ctx = useContext(ObservatorySiteMenuContext)
  if (!ctx) throw new Error('ObservatorySiteMenu components require ObservatorySiteMenuProvider')
  return ctx
}

export function ObservatorySiteMenuProvider({ children }: { children: ReactNode }) {
  const aboutListId = useId()
  const siteListId = useId()
  const toolsListId = useId()
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [active, setActive] = useState<HeaderMenuId | null>(null)
  const pathname = usePathname()
  const { siteId, site, hasSite, setSiteId } = useObservatorySite()
  const aboutActive =
    pathname === '/dashboard' ||
    DASHBOARD_ABOUT_LINKS.some((item) => pathname === item.href)
  const toolsActive = hasSite && DASHBOARD_TOOL_LINKS.some((item) => pathname === item.href)

  const cancelClose = useCallback(() => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current)
      closeTimer.current = null
    }
  }, [])

  const closeMenu = useCallback(() => {
    cancelClose()
    setActive(null)
  }, [cancelClose])

  const openMenu = useCallback(
    (id: HeaderMenuId) => {
      cancelClose()
      setActive(id)
    },
    [cancelClose]
  )

  const scheduleClose = useCallback(() => {
    cancelClose()
    closeTimer.current = setTimeout(() => setActive(null), 120)
  }, [cancelClose])

  const toggleMenu = useCallback(
    (id: HeaderMenuId) => {
      cancelClose()
      setActive((prev) => (prev === id ? null : id))
    },
    [cancelClose]
  )

  const selectSite = useCallback(
    (id: ObservatorySiteId) => {
      setSiteId(id)
      closeMenu()
    },
    [closeMenu, setSiteId]
  )

  useEffect(() => () => cancelClose(), [cancelClose])

  useEffect(() => {
    if (!active) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setActive(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [active])

  const value = useMemo(
    () => ({
      active,
      selectedId: hasSite ? siteId : null,
      selectedName: hasSite ? site.name : 'Observatories',
      aboutListId,
      siteListId,
      toolsListId,
      aboutActive,
      toolsActive,
      hasSite,
      openMenu,
      cancelClose,
      scheduleClose,
      toggleMenu,
      closeMenu,
      selectSite,
    }),
    [
      active,
      hasSite,
      siteId,
      site.name,
      aboutListId,
      siteListId,
      toolsListId,
      aboutActive,
      toolsActive,
      openMenu,
      cancelClose,
      scheduleClose,
      toggleMenu,
      closeMenu,
      selectSite,
    ]
  )

  return (
    <ObservatorySiteMenuContext.Provider value={value}>{children}</ObservatorySiteMenuContext.Provider>
  )
}

/**
 * Sticky header shell: flyouts stay open while the pointer remains on the
 * trigger or its header extension (both live inside the header).
 */
export function ObservatorySiteHeaderShell({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  const { cancelClose, scheduleClose } = useObservatorySiteMenu()

  return (
    <header className={className} onMouseEnter={cancelClose} onMouseLeave={scheduleClose}>
      {children}
    </header>
  )
}

/**
 * Header tongue under a trigger: same surface and 1px edge as the bar,
 * flush to the bottom hairline — reads as an extension, not a floating card.
 */
function HeaderFlyoutPanel({
  open,
  listId,
  label,
  role,
  children,
}: {
  open: boolean
  listId: string
  label: string
  role: 'menu' | 'listbox'
  children: ReactNode
}) {
  return (
    <div
      className={`absolute left-1/2 top-full z-50 w-max min-w-[calc(100%+1.75rem)] -translate-x-1/2 transition-opacity duration-200 ease-[cubic-bezier(0.25,0.1,0.25,1)] ${
        open ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0'
      }`}
      aria-hidden={!open}
    >
      <div className="relative border-x border-b border-black/10 bg-white/75 px-1.5 pb-2 pt-1 backdrop-blur-xl dark:border-white/10 dark:bg-[#09090a]">
        {/* Cover the header border-b across this span so L/R edges meet one continuous hairline. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-px bg-white/75 dark:bg-[#09090a]"
        />
        <div id={listId} role={role} aria-label={label}>
          {children}
        </div>
      </div>
    </div>
  )
}

function HeaderFlyoutList({ children }: { children: ReactNode }) {
  return <ul className="flex min-w-[7.5rem] flex-col gap-0.5">{children}</ul>
}

function HeaderFlyoutAnchor({ children }: { children: ReactNode }) {
  return <div className="relative flex h-full items-center">{children}</div>
}

/** Site switcher trigger + header-extension flyout. */
export function ObservatorySiteTrigger() {
  const { active, selectedId, selectedName, siteListId, openMenu, toggleMenu, selectSite } =
    useObservatorySiteMenu()
  const open = active === 'site'

  return (
    <HeaderFlyoutAnchor>
      <button
        type="button"
        className={`${glassNavLink} max-w-[10.5rem] sm:max-w-[14rem]`}
        aria-expanded={open}
        aria-controls={siteListId}
        aria-haspopup="listbox"
        onMouseEnter={() => openMenu('site')}
        onClick={() => toggleMenu('site')}
      >
        <span className="truncate">{selectedName}</span>
      </button>
      <HeaderFlyoutPanel open={open} listId={siteListId} label="Observatories" role="listbox">
        <HeaderFlyoutList>
          {OBSERVATORY_SITES.map((site) => {
            const selected = site.id === selectedId
            return (
              <li key={site.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={selected}
                  onClick={() => selectSite(site.id)}
                  className={`${selected ? glassNavLinkActive : glassNavLink} w-full justify-start whitespace-nowrap`}
                >
                  <span>{site.name}</span>
                </button>
              </li>
            )
          })}
        </HeaderFlyoutList>
      </HeaderFlyoutPanel>
    </HeaderFlyoutAnchor>
  )
}

/** @deprecated Panel is rendered by ObservatorySiteTrigger. */
export function ObservatorySitePanel() {
  return null
}

/** About trigger + header-extension flyout (Overview / Data / Team). */
export function DashboardAboutTrigger() {
  const pathname = usePathname()
  const { active, aboutListId, aboutActive, openMenu, toggleMenu, closeMenu } = useObservatorySiteMenu()
  const open = active === 'about'

  return (
    <HeaderFlyoutAnchor>
      <button
        type="button"
        className={aboutActive ? glassNavLinkActive : glassNavLink}
        aria-expanded={open}
        aria-controls={aboutListId}
        aria-haspopup="true"
        onMouseEnter={() => openMenu('about')}
        onClick={() => toggleMenu('about')}
      >
        <span>About</span>
      </button>
      <HeaderFlyoutPanel open={open} listId={aboutListId} label="About" role="menu">
        <HeaderFlyoutList>
          {DASHBOARD_ABOUT_LINKS.map((item) => {
            const selected =
              item.href === '/dashboard/about'
                ? pathname === '/dashboard' || pathname === '/dashboard/about'
                : pathname === item.href
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  role="menuitem"
                  onClick={closeMenu}
                  className={`${selected ? glassNavLinkActive : glassNavLink} w-full justify-start whitespace-nowrap`}
                >
                  <span>{item.label}</span>
                </Link>
              </li>
            )
          })}
        </HeaderFlyoutList>
      </HeaderFlyoutPanel>
    </HeaderFlyoutAnchor>
  )
}

/** @deprecated Panel is rendered by DashboardAboutTrigger. */
export function DashboardAboutPanel() {
  return null
}

/** Tools trigger + header-extension flyout (Weather / Plan / Remote). */
export function DashboardToolsTrigger() {
  const pathname = usePathname()
  const { active, toolsListId, toolsActive, hasSite, openMenu, toggleMenu, closeMenu } =
    useObservatorySiteMenu()
  const open = active === 'tools'

  return (
    <HeaderFlyoutAnchor>
      <button
        type="button"
        className={toolsActive ? glassNavLinkActive : glassNavLink}
        aria-expanded={open}
        aria-controls={toolsListId}
        aria-haspopup="true"
        onMouseEnter={() => openMenu('tools')}
        onClick={() => toggleMenu('tools')}
      >
        <span>Tools</span>
      </button>
      <HeaderFlyoutPanel open={open} listId={toolsListId} label="Tools" role="menu">
        {hasSite ? (
          <HeaderFlyoutList>
            {DASHBOARD_TOOL_LINKS.map((item) => {
              const selected = pathname === item.href
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    role="menuitem"
                    onClick={closeMenu}
                    className={`${selected ? glassNavLinkActive : glassNavLink} w-full justify-start whitespace-nowrap`}
                  >
                    <span>{item.label}</span>
                  </Link>
                </li>
              )
            })}
          </HeaderFlyoutList>
        ) : (
          <p className="max-w-[12rem] px-3 py-2 text-left text-sm leading-snug tracking-wide text-apple-dark/70 dark:text-[#eee9dc]/70">
            Please Choose An Observatory First.
          </p>
        )}
      </HeaderFlyoutPanel>
    </HeaderFlyoutAnchor>
  )
}

/** @deprecated Panel is rendered by DashboardToolsTrigger. */
export function DashboardToolsPanel() {
  return null
}
