'use client'

import { AccountWorkspacePanels } from '@/app/dashboard/account/account-workspace-panels'
import { AccountFullBleedRule } from '@/app/dashboard/account/account-full-bleed-rule'
import { AccountPageHeader } from '@/app/dashboard/account/account-page-header'
import { AccountInfoSection } from '@/app/dashboard/account/account-info-section'
import type { PublicMemberUser } from '@/lib/member-store'

export function MemberAccountDashboard({ user }: { user: PublicMemberUser }) {
  return (
    <div className="pb-4 sm:pb-8">
      <AccountPageHeader username={user.username} />

      <AccountInfoSection user={user} variant="panel" className="min-h-0" />

      <AccountFullBleedRule />

      <AccountWorkspacePanels isAdmin={false} />
    </div>
  )
}
