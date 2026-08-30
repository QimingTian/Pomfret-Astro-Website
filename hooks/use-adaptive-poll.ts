'use client'

import { useEffect, useRef } from 'react'

import {
  msUntilObservatoryPhaseChange,
  observatoryPollIntervalMs,
  type ObservatoryPollKind,
} from '@/lib/observatory-poll-schedule'

type Options = {
  enabled?: boolean
  imagingActive?: boolean
  /** When this changes (e.g. observatory site id), poll immediately with the new context. */
  resetKey?: string | number
}

/**
 * Run `callback` on an observatory-aware interval (slow by day, faster at night).
 * Reschedules at nautical dawn/dusk and when the tab visibility changes.
 */
export function useAdaptivePoll(
  kind: ObservatoryPollKind,
  callback: () => void | Promise<void>,
  options: Options = {}
): void {
  const { enabled = true, imagingActive = false, resetKey } = options
  const callbackRef = useRef(callback)
  callbackRef.current = callback
  const imagingRef = useRef(imagingActive)
  imagingRef.current = imagingActive

  useEffect(() => {
    if (!enabled) return

    let stopped = false
    let pollTimer: ReturnType<typeof setTimeout> | null = null
    let phaseTimer: ReturnType<typeof setTimeout> | null = null

    const clearTimers = () => {
      if (pollTimer) clearTimeout(pollTimer)
      if (phaseTimer) clearTimeout(phaseTimer)
      pollTimer = null
      phaseTimer = null
    }

    const schedulePoll = () => {
      if (stopped) return
      const hidden = typeof document !== 'undefined' && document.visibilityState === 'hidden'
      const ms = observatoryPollIntervalMs(kind, {
        imagingActive: imagingRef.current,
        pageHidden: hidden,
      })
      pollTimer = setTimeout(() => {
        void Promise.resolve(callbackRef.current()).finally(() => {
          schedulePoll()
        })
      }, ms)
    }

    const armPhaseFlip = () => {
      if (stopped) return
      const wait = msUntilObservatoryPhaseChange()
      phaseTimer = setTimeout(() => {
        clearTimers()
        if (!stopped) {
          schedulePoll()
          armPhaseFlip()
        }
      }, wait)
    }

    const onVisibility = () => {
      clearTimers()
      if (!stopped) {
        schedulePoll()
        armPhaseFlip()
      }
    }

    void Promise.resolve(callbackRef.current()).finally(() => {
      if (!stopped) schedulePoll()
    })
    armPhaseFlip()
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      stopped = true
      clearTimers()
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [kind, enabled, imagingActive, resetKey])
}
