'use client'

import { AccountFullBleedRule } from '@/app/dashboard/account/account-full-bleed-rule'
import { AccountMemberGrid } from '@/app/dashboard/account/account-member-grid'
import { AccountPageHeader } from '@/app/dashboard/account/account-page-header'
import { AccountInfoSection } from '@/app/dashboard/account/account-info-section'
import type { PublicMemberUser } from '@/lib/member-store'

export function MemberAccountDashboard({ user }: { user: PublicMemberUser }) {
  return (
    <div className="pb-4 sm:pb-8">
      <AccountPageHeader username={user.username} />

      <AccountInfoSection user={user} variant="panel" className="min-h-0" />

      <AccountFullBleedRule />

      <AccountMemberGrid />

      <AccountFullBleedRule />
    </div>
  )
}
