'use client'

import { AdminDashboardGrid } from '@/app/dashboard/admin/admin-dashboard-grid'
import { AccountFullBleedRule } from '@/app/dashboard/account/account-full-bleed-rule'
import { AccountPageHeader } from '@/app/dashboard/account/account-page-header'
import { AccountInfoSection } from '@/app/dashboard/account/account-info-section'
import type { PublicMemberUser } from '@/lib/member-store'

export function AdminAccountDashboard({ user }: { user: PublicMemberUser }) {
  return (
    <div className="pb-4 sm:pb-8">
      <AccountPageHeader username={user.username} />

      <AccountInfoSection user={user} variant="panel" className="min-h-0" />

      <AccountFullBleedRule />

      <AdminDashboardGrid />
    </div>
  )
}
