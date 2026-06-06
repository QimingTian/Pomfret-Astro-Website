'use client'

import { useEffect, useRef } from 'react'

export type SiteStreamObservatoryEvent = {
  type: 'observatory_status'
  mode: string
  status: string
}

export type SiteStreamSessionsEvent = {
  type: 'sessions_changed'
  reason: string
}

export type SiteStreamEstopEvent = {
  type: 'estop'
  agentConnected: boolean
  phase: 'idle' | 'stopping' | 'stopped'
  progress: number
  label: string
  queueId: string | null
  canArm: boolean
  blocking: boolean
  stopped: boolean
}

export type SiteStreamHandlers = {
  onObservatoryStatus?: (event: SiteStreamObservatoryEvent) => void
  onSessionsChanged?: (event: SiteStreamSessionsEvent) => void
  onEstop?: (event: SiteStreamEstopEvent) => void
}

/**
 * Single EventSource for site-wide push events (observatory status, session list, ESTOP).
 * Requires a logged-in session cookie. ESTOP events are only sent to admins by the server.
 */
export function useSiteStream(handlers: SiteStreamHandlers, enabled = true): void {
  const handlersRef = useRef(handlers)
  handlersRef.current = handlers

  useEffect(() => {
    if (!enabled) return

    const source = new EventSource('/api/imaging/site-stream')

    source.onmessage = (evt) => {
      let payload: Record<string, unknown> | null = null
      try {
        payload = JSON.parse(evt.data) as Record<string, unknown>
      } catch {
        return
      }
      if (!payload || payload.type === 'ping') return

      if (payload.type === 'observatory_status') {
        handlersRef.current.onObservatoryStatus?.(payload as SiteStreamObservatoryEvent)
        return
      }
      if (payload.type === 'sessions_changed') {
        handlersRef.current.onSessionsChanged?.(payload as SiteStreamSessionsEvent)
        return
      }
      if (payload.type === 'estop') {
        handlersRef.current.onEstop?.(payload as SiteStreamEstopEvent)
      }
    }

    return () => {
      source.close()
    }
  }, [enabled])
}
