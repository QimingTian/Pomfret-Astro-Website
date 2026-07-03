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

/** Poll interval — avoids 24/7 SSE Fluid memory on Vercel Hobby. */
const SITE_POLL_MS = 45_000

type PollBody = {
  ok?: boolean
  observatory?: SiteStreamObservatoryEvent
  estop?: SiteStreamEstopEvent
}

/**
 * Site-wide observatory / ESTOP updates via short HTTP polls (no long-lived SSE).
 * Session list changes still rely on explicit refresh or user actions.
 */
export function useSiteStream(handlers: SiteStreamHandlers, enabled = true): void {
  const handlersRef = useRef(handlers)
  handlersRef.current = handlers

  useEffect(() => {
    if (!enabled) return

    let stopped = false

    const poll = async () => {
      try {
        const res = await fetch('/api/imaging/site-poll', { cache: 'no-store', credentials: 'include' })
        if (!res.ok || stopped) return
        const body = (await res.json()) as PollBody
        if (body.ok !== true) return
        if (body.observatory?.type === 'observatory_status') {
          handlersRef.current.onObservatoryStatus?.(body.observatory)
        }
        if (body.estop?.type === 'estop') {
          handlersRef.current.onEstop?.(body.estop)
        }
      } catch {
        // ignore transient poll errors
      }
    }

    void poll()
    const id = window.setInterval(() => void poll(), SITE_POLL_MS)

    return () => {
      stopped = true
      window.clearInterval(id)
    }
  }, [enabled])
}
