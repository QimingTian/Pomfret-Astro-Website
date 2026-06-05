'use client'

import type { ReactNode } from 'react'
import { AccountFullBleedRule } from '@/app/dashboard/account/account-full-bleed-rule'
import {
  accountTwoColGrid,
  accountTwoColLeft,
  accountTwoColRight,
} from '@/app/dashboard/account/account-two-col-layout'

/** Stacks on mobile (with full-bleed rule); two columns + vertical rule on left column edge (lg+). */
export function AccountTwoColRow({
  left,
  right,
  desktopGrid = accountTwoColGrid,
}: {
  left: ReactNode
  right: ReactNode
  desktopGrid?: string
}) {
  return (
    <>
      <div className="lg:hidden">
        {left}
        <AccountFullBleedRule />
        {right}
      </div>
      <div className={`hidden lg:grid ${desktopGrid} items-stretch`}>
        <div className={`${accountTwoColLeft} h-full min-h-0`}>{left}</div>
        <div className={`${accountTwoColRight} h-full min-h-0`}>{right}</div>
      </div>
    </>
  )
}
