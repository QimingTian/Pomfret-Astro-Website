'use client'

import { useObservatorySite } from '@/components/observatory-site-provider'

/** Gate Tools pages until Site Switcher has a real selection. */
export function RequireObservatorySite({ children }: { children: React.ReactNode }) {
  const { hasSite } = useObservatorySite()
  if (!hasSite) {
    return (
      <p className="py-16 text-center text-sm tracking-wide text-apple-dark/70 dark:text-[#eee9dc]/70">
        Please Choose An Observatory First.
      </p>
    )
  }
  return <>{children}</>
}
