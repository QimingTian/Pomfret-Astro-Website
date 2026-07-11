'use client'

import { createContext, useCallback, useContext, useEffect, useState } from 'react'

const STORAGE_KEY = 'pomfret-astro-night-mode'

type NightModeContextValue = {
  nightMode: boolean
  toggleNightMode: () => void
  setNightMode: (on: boolean) => void
}

const NightModeContext = createContext<NightModeContextValue | undefined>(undefined)

function readStoredNightMode(): boolean {
  if (typeof window === 'undefined') return false
  try {
    return window.localStorage.getItem(STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

export function NightModeProvider({ children }: { children: React.ReactNode }) {
  const [nightMode, setNightModeState] = useState(false)
  const [hydrated, setHydrated] = useState(false)

  useEffect(() => {
    setNightModeState(readStoredNightMode())
    setHydrated(true)
  }, [])

  useEffect(() => {
    if (!hydrated) return
    try {
      window.localStorage.setItem(STORAGE_KEY, nightMode ? '1' : '0')
    } catch {
      // ignore quota / private mode
    }
  }, [nightMode, hydrated])

  const setNightMode = useCallback((on: boolean) => {
    setNightModeState(on)
  }, [])

  const toggleNightMode = useCallback(() => {
    setNightModeState((v) => !v)
  }, [])

  return (
    <NightModeContext.Provider value={{ nightMode, toggleNightMode, setNightMode }}>
      {children}
      {nightMode ? (
        <div
          aria-hidden="true"
          className="pointer-events-none fixed inset-0 z-[1000]"
          style={{ background: '#ff2200', mixBlendMode: 'multiply' }}
        />
      ) : null}
    </NightModeContext.Provider>
  )
}

export function useNightMode(): NightModeContextValue {
  const ctx = useContext(NightModeContext)
  if (!ctx) {
    throw new Error('useNightMode must be used within NightModeProvider')
  }
  return ctx
}
