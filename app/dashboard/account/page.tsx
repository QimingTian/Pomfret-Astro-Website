'use client'

import { AdminAccountDashboard } from '@/app/dashboard/account/admin-dashboard'
import { MemberAccountDashboard } from '@/app/dashboard/account/member-account-dashboard'
import { MemberAuthPanel } from '@/components/member-auth-panel'
import { useMember } from '@/hooks/use-member'

export default function AccountPage() {
  const member = useMember()

  if (member.status === 'loading') {
    return <p className="text-gray-400">Loading…</p>
  }

  if (member.status === 'guest') {
    return (
      <MemberAuthPanel
        onSignedIn={(user) => {
          if (user) member.completeSignIn(user)
          else void member.refresh()
        }}
      />
    )
  }

  const { user } = member
  if (member.isAdmin) {
    return <AdminAccountDashboard user={user} />
  }

  return <MemberAccountDashboard user={user} />
}
