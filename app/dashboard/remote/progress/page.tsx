'use client'

import { Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { RequireObservatorySite } from '@/components/require-observatory-site'
import { SessionProgressMonitor } from '@/components/remote/session-progress-monitor'

function MonitorFallback() {
  return <div className="h-dvh bg-[#08090a]" />
}

function GatedMonitor() {
  const demo = useSearchParams().get('demo')
  const inner = <SessionProgressMonitor />
  if (demo === '1' || demo === 'weather') return inner
  return <RequireObservatorySite>{inner}</RequireObservatorySite>
}

export default function Page() {
  return (
    <Suspense fallback={<MonitorFallback />}>
      <GatedMonitor />
    </Suspense>
  )
}
