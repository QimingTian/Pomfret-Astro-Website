'use client'

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
import { glassNavLink, glassNavLinkActive } from '@/lib/glass-ui'
import {
  OBSERVATORY_SITES,
  type ObservatorySiteId,
} from '@/lib/observatory-sites'
import { useObservatorySite } from '@/components/observatory-site-provider'

type ObservatorySiteMenuContextValue = {
  open: boolean
  selectedId: ObservatorySiteId
  selectedName: string
  listId: string
  openMenu: () => void
  cancelClose: () => void
  scheduleClose: () => void
  toggleMenu: () => void
  selectSite: (id: ObservatorySiteId) => void
}

const ObservatorySiteMenuContext = createContext<ObservatorySiteMenuContextValue | null>(null)

function useObservatorySiteMenu(): ObservatorySiteMenuContextValue {
  const ctx = useContext(ObservatorySiteMenuContext)
  if (!ctx) throw new Error('ObservatorySiteMenu components require ObservatorySiteMenuProvider')
  return ctx
}

export function ObservatorySiteMenuProvider({ children }: { children: ReactNode }) {
  const listId = useId()
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [open, setOpen] = useState(false)
  const { siteId, site, setSiteId } = useObservatorySite()

  const cancelClose = useCallback(() => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current)
      closeTimer.current = null
    }
  }, [])

  const openMenu = useCallback(() => {
    cancelClose()
    setOpen(true)
  }, [cancelClose])

  const scheduleClose = useCallback(() => {
    cancelClose()
    closeTimer.current = setTimeout(() => setOpen(false), 120)
  }, [cancelClose])

  const toggleMenu = useCallback(() => {
    cancelClose()
    setOpen((v) => !v)
  }, [cancelClose])

  const selectSite = useCallback(
    (id: ObservatorySiteId) => {
      setSiteId(id)
      cancelClose()
      setOpen(false)
    },
    [cancelClose, setSiteId]
  )

  useEffect(() => () => cancelClose(), [cancelClose])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  const value = useMemo(
    () => ({
      open,
      selectedId: siteId,
      selectedName: site.name,
      listId,
      openMenu,
      cancelClose,
      scheduleClose,
      toggleMenu,
      selectSite,
    }),
    [open, siteId, site.name, listId, openMenu, cancelClose, scheduleClose, toggleMenu, selectSite]
  )

  return (
    <ObservatorySiteMenuContext.Provider value={value}>{children}</ObservatorySiteMenuContext.Provider>
  )
}

/**
 * Wrap the sticky `<header>` so the flyout stays open while the pointer is
 * anywhere in the header (including the expanded overlay).
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

/** Compact label in the top nav row (between account and night mode). */
export function ObservatorySiteTrigger() {
  const { open, selectedName, listId, openMenu, toggleMenu } = useObservatorySiteMenu()

  return (
    <button
      type="button"
      className={`${glassNavLink} max-w-[10.5rem] sm:max-w-[14rem]`}
      aria-expanded={open}
      aria-controls={listId}
      aria-haspopup="listbox"
      onMouseEnter={openMenu}
      onClick={toggleMenu}
    >
      <span className="truncate">{selectedName}</span>
    </button>
  )
}

/**
 * Full-width flyout under the top nav. Absolutely positioned so it overlays
 * page content. The bottom border lives on this expanding surface so it
 * slides down with the panel instead of vanishing from the nav row.
 */
export function ObservatorySitePanel() {
  const { open, selectedId, listId, selectSite } = useObservatorySiteMenu()

  return (
    <div className="absolute left-0 right-0 top-full z-50" aria-hidden={!open}>
      <div className="border-b border-black/10 bg-white/75 backdrop-blur-xl dark:border-white/10 dark:bg-[#09090a]">
        <div
          className={`grid transition-[grid-template-rows] duration-300 ease-[cubic-bezier(0.25,0.1,0.25,1)] ${
            open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
          }`}
        >
          <div className="overflow-hidden">
            <div
              id={listId}
              role="listbox"
              aria-label="Observatories"
              className={`transition-opacity duration-300 ${
                open ? 'opacity-100' : 'pointer-events-none opacity-0'
              }`}
            >
              <div className="mx-auto flex max-w-[1400px] justify-center px-4 pt-1 pb-3.5 sm:px-6 sm:pt-1.5 sm:pb-4 lg:px-10">
                <ul className="flex flex-col items-center gap-1 sm:flex-row sm:flex-wrap sm:justify-center sm:gap-2">
                  {OBSERVATORY_SITES.map((site) => {
                    const active = site.id === selectedId
                    return (
                      <li key={site.id}>
                        <button
                          type="button"
                          role="option"
                          aria-selected={active}
                          onClick={() => selectSite(site.id)}
                          className={active ? glassNavLinkActive : glassNavLink}
                        >
                          <span>{site.name}</span>
                        </button>
                      </li>
                    )
                  })}
                </ul>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
