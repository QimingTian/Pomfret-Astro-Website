'use client'

import PlanPage from '@/components/plan/plan-page'
import { RequireObservatorySite } from '@/components/require-observatory-site'

export default function Page() {
  return (
    <RequireObservatorySite>
      <PlanPage />
    </RequireObservatorySite>
  )
}
