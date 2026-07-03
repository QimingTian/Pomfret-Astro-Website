'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  isObservatoryOverlayStatus,
  type ObservatoryOverlayStatus,
} from '@/lib/observatory-overlay-status'
import { useSiteStream } from '@/lib/use-site-stream'

const OBSERVATORY_STATUS_POLL_MS = 60_000

type ObservatoryMode = 'manual' | 'auto'

function parseEnvelope(data: unknown): {
  mode: ObservatoryMode | null
  status: ObservatoryOverlayStatus | null
} {
  if (!data || typeof data !== 'object') return { mode: null, status: null }
  const rec = data as { mode?: unknown; status?: unknown; ok?: unknown }
  const mode = rec.mode === 'manual' || rec.mode === 'auto' ? rec.mode : null
  const status =
    typeof rec.status === 'string' && isObservatoryOverlayStatus(rec.status) ? rec.status : null
  if (rec.ok !== true && status == null) return { mode, status: null }
  return { mode, status }
}

/** Authoritative server Observatory Status (GET + SSE). Same value as NINA / Remote header. */
export function useObservatoryEnvelope(options?: {
  observatoryStatusUrl?: string
  siteStreamEnabled?: boolean
}) {
  const url = options?.observatoryStatusUrl ?? '/api/imaging/observatory-status'
  const siteStreamEnabled = options?.siteStreamEnabled ?? true
  const [mode, setMode] = useState<ObservatoryMode | null>(null)
  const [serverStatus, setServerStatus] = useState<ObservatoryOverlayStatus | null>(null)

  const applyEnvelope = useCallback((next: { mode: ObservatoryMode | null; status: ObservatoryOverlayStatus | null }) => {
    if (next.mode) setMode(next.mode)
    if (next.status) setServerStatus(next.status)
  }, [])

  const loadEnvelope = useCallback(async () => {
    try {
      const res = await fetch(url, { cache: 'no-store' })
      const data = (await res.json()) as unknown
      if (!res.ok) return
      applyEnvelope(parseEnvelope(data))
    } catch {
      // keep previous
    }
  }, [applyEnvelope, url])

  useEffect(() => {
    void loadEnvelope()
    if (!siteStreamEnabled) {
      const id = window.setInterval(() => void loadEnvelope(), OBSERVATORY_STATUS_POLL_MS)
      return () => window.clearInterval(id)
    }
    return undefined
  }, [loadEnvelope, siteStreamEnabled])

  useSiteStream(
    {
      onObservatoryStatus: (event) => {
        if (isObservatoryOverlayStatus(event.status)) {
          setServerStatus(event.status)
        }
      },
    },
    siteStreamEnabled
  )

  return { mode, serverStatus, reloadEnvelope: loadEnvelope }
}
