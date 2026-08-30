'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { AccountFullBleedRule } from '@/app/dashboard/account/account-full-bleed-rule'
import { AccountMemberGrid } from '@/app/dashboard/account/account-member-grid'
import { GallerySubmissionSection } from '@/app/dashboard/account/gallery-submission-section'
import {
  AccountWorkspaceHint,
  AccountWorkspaceNav,
  accountSectionsForUser,
  defaultAccountSection,
  readAccountSectionFromHash,
  writeAccountSectionToHash,
  type AccountWorkspaceSectionId,
} from '@/app/dashboard/account/account-workspace-sections'

/** Member account: section nav for My Sessions / Gallery. Admins use AdminDashboardGrid. */
export function MemberWorkspacePanels() {
  const sections = useMemo(() => accountSectionsForUser(false), [])
  const [active, setActive] = useState<AccountWorkspaceSectionId>(() => defaultAccountSection(false))

  useEffect(() => {
    const allowed = sections.map((s) => s.id)
    const fromHash = readAccountSectionFromHash(allowed)
    if (fromHash) setActive(fromHash)
  }, [sections])

  const selectSection = useCallback((id: AccountWorkspaceSectionId) => {
    setActive(id)
    writeAccountSectionToHash(id)
  }, [])

  return (
    <>
      <AccountWorkspaceHint className="mb-3" />
      <AccountWorkspaceNav sections={sections} active={active} onChange={selectSection} />
      <AccountFullBleedRule className="my-4" />
      {active === 'my-sessions' ? <AccountMemberGrid /> : null}
      {active === 'gallery' ? <GallerySubmissionSection /> : null}
    </>
  )
}
