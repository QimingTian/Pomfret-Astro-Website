'use client'

import RemotePage from '@/components/remote/remote-page'
import { RequireObservatorySite } from '@/components/require-observatory-site'

export default function Page() {
  return (
    <RequireObservatorySite>
      <RemotePage />
    </RequireObservatorySite>
  )
}
