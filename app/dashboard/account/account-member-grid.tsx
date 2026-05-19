'use client'

import { AccountTwoColRow } from '@/app/dashboard/account/account-two-col-row'
import { SavedSessionsSection } from '@/app/dashboard/account/saved-sessions-section'
import { SessionHistorySection } from '@/app/dashboard/account/session-history-section'

/** Saved Sessions | Session History — shared by member and admin account dashboards. */
export function AccountMemberGrid() {
  return (
    <AccountTwoColRow
      left={<SavedSessionsSection variant="panel" />}
      right={<SessionHistorySection variant="panel" />}
    />
  )
}
