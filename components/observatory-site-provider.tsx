'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import {
  DEFAULT_OBSERVATORY_SITE_ID,
  isObservatorySiteId,
  OBSERVATORY_SITE_COOKIE,
  OBSERVATORY_SITES,
  resolveObservatorySite,
  type ObservatorySite,
  type ObservatorySiteId,
} from '@/lib/observatory-sites'
import { setClientObservatorySiteId } from '@/lib/observatory-site-scope'

const STORAGE_KEY = 'pomfret_observatory_site'

type ObservatorySiteContextValue = {
  siteId: ObservatorySiteId
  site: ObservatorySite
  setSiteId: (id: ObservatorySiteId) => void
}

const ObservatorySiteContext = createContext<ObservatorySiteContextValue | null>(null)

function readStoredSiteId(): ObservatorySiteId {
  if (typeof window === 'undefined') return DEFAULT_OBSERVATORY_SITE_ID
  try {
    const fromStorage = window.localStorage.getItem(STORAGE_KEY)
    if (fromStorage && isObservatorySiteId(fromStorage)) return fromStorage
  } catch {
    // ignore
  }
  const match = document.cookie.match(/(?:^|;\s*)pomfret_site=([^;]*)/)
  if (match?.[1]) {
    try {
      const decoded = decodeURIComponent(match[1].trim())
      if (isObservatorySiteId(decoded)) return decoded
    } catch {
      if (isObservatorySiteId(match[1].trim())) return match[1].trim() as ObservatorySiteId
    }
  }
  return DEFAULT_OBSERVATORY_SITE_ID
}

function persistSiteId(id: ObservatorySiteId): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, id)
  } catch {
    // ignore
  }
  const maxAge = 60 * 60 * 24 * 365
  document.cookie = `${OBSERVATORY_SITE_COOKIE}=${encodeURIComponent(id)}; path=/; max-age=${maxAge}; SameSite=Lax`
}

export function ObservatorySiteProvider({ children }: { children: ReactNode }) {
  const [siteId, setSiteIdState] = useState<ObservatorySiteId>(DEFAULT_OBSERVATORY_SITE_ID)
  const [hydrated, setHydrated] = useState(false)

  useEffect(() => {
    const id = readStoredSiteId()
    setSiteIdState(id)
    setClientObservatorySiteId(id)
    setHydrated(true)
  }, [])

  useEffect(() => {
    if (!hydrated) return
    setClientObservatorySiteId(siteId)
    persistSiteId(siteId)
  }, [siteId, hydrated])

  const setSiteId = useCallback((id: ObservatorySiteId) => {
    setSiteIdState(id)
  }, [])

  const value = useMemo(
    () => ({
      siteId,
      site: resolveObservatorySite(siteId),
      setSiteId,
    }),
    [siteId, setSiteId]
  )

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
      setSiteId: () => undefined,
    }
  }
  return ctx
}

/** Append `?site=` / `&site=` for Weather / Plan / Remote imaging fetches. */
export function withObservatorySiteQuery(url: string, siteId: ObservatorySiteId): string {
  const join = url.includes('?') ? '&' : '?'
  if (/[?&]site=/.test(url)) {
    return url.replace(/([?&])site=[^&]*/, `$1site=${encodeURIComponent(siteId)}`)
  }
  return `${url}${join}site=${encodeURIComponent(siteId)}`
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

export { OBSERVATORY_SITES }
