'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { useMember } from '@/components/member-provider'
import { isPomfretAstroAdmin } from '@/lib/member-roles'
import {
  DEFAULT_OBSERVATORY_SITE_ID,
  isObservatorySiteId,
  OBSERVATORY_SITE_COOKIE,
  OBSERVATORY_SITES,
  resolveObservatorySite,
  withObservatorySiteQuery,
  type ObservatorySite,
  type ObservatorySiteId,
} from '@/lib/observatory-sites'
import { setClientObservatorySiteId } from '@/lib/observatory-site-scope'

const STORAGE_KEY = 'pomfret_observatory_site'
const CHOSEN_KEY = 'pomfret_observatory_site_chosen'

type ObservatorySiteContextValue = {
  /** Effective site for tools/API. Meaningful only when `hasSite` is true. */
  siteId: ObservatorySiteId
  site: ObservatorySite
  /** False until the visitor chooses (or a member is defaulted to their home). */
  hasSite: boolean
  setSiteId: (id: ObservatorySiteId) => void
}

const ObservatorySiteContext = createContext<ObservatorySiteContextValue | null>(null)

/** Only returns a site the user explicitly chose (not a legacy implicit Pomfret default). */
function readExplicitStoredSiteId(): ObservatorySiteId | null {
  if (typeof window === 'undefined') return null
  try {
    if (window.localStorage.getItem(CHOSEN_KEY) !== '1') return null
    const fromStorage = window.localStorage.getItem(STORAGE_KEY)
    if (fromStorage && isObservatorySiteId(fromStorage)) return fromStorage
  } catch {
    // ignore
  }
  return null
}

function writeSiteCookie(id: ObservatorySiteId): void {
  const maxAge = 60 * 60 * 24 * 365
  document.cookie = `${OBSERVATORY_SITE_COOKIE}=${encodeURIComponent(id)}; path=/; max-age=${maxAge}; SameSite=Lax`
}

function persistExplicitSiteId(id: ObservatorySiteId): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, id)
    window.localStorage.setItem(CHOSEN_KEY, '1')
  } catch {
    // ignore
  }
  writeSiteCookie(id)
}

function clearPersistedSiteId(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEY)
    window.localStorage.removeItem(CHOSEN_KEY)
  } catch {
    // ignore
  }
  document.cookie = `${OBSERVATORY_SITE_COOKIE}=; path=/; max-age=0; SameSite=Lax`
}

/** Home observatory for affiliated members / PA admins; null for guests. */
function homeSiteForUser(user: {
  systemRole: string
  memberships: Array<{ siteId: string }>
}): ObservatorySiteId | null {
  if (isPomfretAstroAdmin(user.systemRole)) return DEFAULT_OBSERVATORY_SITE_ID
  for (const m of user.memberships) {
    if (isObservatorySiteId(m.siteId)) return m.siteId
  }
  return null
}

export function ObservatorySiteProvider({ children }: { children: ReactNode }) {
  const member = useMember()
  const [selectionId, setSelectionId] = useState<ObservatorySiteId | null>(null)
  const [hydrated, setHydrated] = useState(false)
  const userChosenRef = useRef(false)
  const prevMemberStatus = useRef(member.status)

  useEffect(() => {
    if (member.status === 'loading') return

    // Logging out: guests start from Observatories again (no inherited member default).
    if (prevMemberStatus.current === 'authenticated' && member.status === 'guest') {
      userChosenRef.current = false
      clearPersistedSiteId()
      setSelectionId(null)
      prevMemberStatus.current = member.status
      setHydrated(true)
      return
    }
    prevMemberStatus.current = member.status

    const explicit = readExplicitStoredSiteId()
    userChosenRef.current = explicit !== null

    if (member.status === 'authenticated') {
      const home = homeSiteForUser(member.user)
      if (home) {
        // Member: keep an explicit switch if present; otherwise default to home observatory.
        setSelectionId(explicit ?? home)
      } else {
        // Logged-in Guest — no affiliation; do not invent Pomfret.
        setSelectionId(explicit)
      }
    } else {
      // Signed-out visitor — Observatories until they choose.
      setSelectionId(explicit)
    }

    setHydrated(true)
  }, [member])

  useEffect(() => {
    if (!hydrated) return
    setClientObservatorySiteId(selectionId)
    if (!selectionId) {
      clearPersistedSiteId()
      return
    }
    if (userChosenRef.current) persistExplicitSiteId(selectionId)
    else writeSiteCookie(selectionId)
  }, [selectionId, hydrated])

  const setSiteId = useCallback((id: ObservatorySiteId) => {
    userChosenRef.current = true
    setSelectionId(id)
  }, [])

  const value = useMemo(() => {
    const siteId = selectionId ?? DEFAULT_OBSERVATORY_SITE_ID
    return {
      siteId,
      site: resolveObservatorySite(siteId),
      hasSite: selectionId !== null,
      setSiteId,
    }
  }, [selectionId, setSiteId])

  return (
    <ObservatorySiteContext.Provider value={value}>{children}</ObservatorySiteContext.Provider>
  )
}

export function useObservatorySite(): ObservatorySiteContextValue {
  const ctx = useContext(ObservatorySiteContext)
  if (!ctx) {
    return {
      siteId: DEFAULT_OBSERVATORY_SITE_ID,
      site: resolveObservatorySite(DEFAULT_OBSERVATORY_SITE_ID),
      hasSite: true,
      setSiteId: () => undefined,
    }
  }
  return ctx
}

export function observatorySiteFetch(
  input: string,
  siteId: ObservatorySiteId,
  init?: RequestInit
): Promise<Response> {
  const headers = new Headers(init?.headers)
  headers.set('X-Observatory-Site', siteId)
  return fetch(withObservatorySiteQuery(input, siteId), { ...init, headers })
}

export { OBSERVATORY_SITES, withObservatorySiteQuery }
