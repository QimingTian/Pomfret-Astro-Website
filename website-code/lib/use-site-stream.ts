'use client'

import { useRef } from 'react'

import { useAdaptivePoll } from '@/hooks/use-adaptive-poll'

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

type PollBody = {
  ok?: boolean
  observatory?: SiteStreamObservatoryEvent
  estop?: SiteStreamEstopEvent
}

/**
 * Site-wide observatory / ESTOP via adaptive HTTP polls (slow by day, faster at night).
 */
export function useSiteStream(handlers: SiteStreamHandlers, enabled = true): void {
  const handlersRef = useRef(handlers)
  handlersRef.current = handlers

  const poll = async () => {
    try {
      const res = await fetch('/api/imaging/site-poll', { cache: 'no-store', credentials: 'include' })
      if (!res.ok) return
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

  useAdaptivePoll('site', poll, { enabled })
}
