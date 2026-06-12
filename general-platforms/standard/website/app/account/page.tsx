'use client'

import { AdminAccountDashboard } from '@/app/account/admin-account-dashboard'
import { MemberAccountDashboard } from '@/app/account/member-account-dashboard'
import { MemberAuthPanel } from '@/components/member-auth-panel'
import { useMember } from '@/hooks/use-member'

export default function AccountPage() {
  const member = useMember()

  if (member.status === 'loading') {
    return (
      <section className="page-shell py-16 md:py-20">
        <p className="text-muted">Loading…</p>
      </section>
    )
  }

  if (member.status === 'guest') {
    return (
      <section className="page-shell-narrow py-16 md:py-20">
        <MemberAuthPanel
          onSignedIn={(user) => {
            if (user) member.completeSignIn(user)
            else void member.refresh()
          }}
        />
      </section>
    )
  }

  const { user } = member
  if (member.isAdmin) {
    return (
      <section className="page-shell py-8">
        <AdminAccountDashboard user={user} />
      </section>
    )
  }

  return (
    <section className="page-shell py-8">
      <MemberAccountDashboard user={user} />
    </section>
  )
}
