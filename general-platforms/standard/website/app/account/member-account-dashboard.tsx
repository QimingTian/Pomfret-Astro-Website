'use client'

import { AccountFullBleedRule } from '@/app/account/account-full-bleed-rule'
import { AccountInfoSection } from '@/app/account/account-info-section'
import { AccountPageHeader } from '@/app/account/account-page-header'
import { PurchaseHistorySection } from '@/app/account/purchase-history-section'
import type { PublicMemberUser } from '@/lib/member/member-store'

export function MemberAccountDashboard({ user }: { user: PublicMemberUser }) {
  return (
    <div className="pb-4 sm:pb-8">
      <AccountPageHeader username={user.username} />
      <AccountInfoSection user={user} className="min-h-0" />
      <AccountFullBleedRule />
      <PurchaseHistorySection />
    </div>
  )
}
