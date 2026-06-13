'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import type { StoryNavItem } from '@/lib/fraos-product-story'

type ProductStickyNavProps = {
  items: StoryNavItem[]
  productName: string
  shortName: string
  buyHref: string
  purchasable: boolean
}

export function ProductStickyNav({
  items,
  productName,
  shortName,
  buyHref,
  purchasable,
}: ProductStickyNavProps) {
  const [activeId, setActiveId] = useState(items[0]?.id ?? 'overview')

  useEffect(() => {
    const sections = items
      .map((item) => document.getElementById(item.id))
      .filter((el): el is HTMLElement => el != null)
    if (sections.length === 0) return

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)
        if (visible[0]?.target.id) setActiveId(visible[0].target.id)
      },
      { rootMargin: '-45% 0px -50% 0px', threshold: [0, 0.25, 0.5] }
    )

    sections.forEach((section) => observer.observe(section))
    return () => observer.disconnect()
  }, [items])

  return (
    <nav
      className="sticky top-16 z-40 border-b border-white/10 bg-bg/80 backdrop-blur-xl"
      aria-label={`${productName} sections`}
    >
      <div className="page-shell flex items-center gap-4">
        <span className="hidden shrink-0 font-display text-sm font-semibold text-fg lg:block">
          {productName}
        </span>
        <div className="-mx-1 flex-1 overflow-x-auto">
          <ul className="flex min-w-max items-center gap-1 py-3">
            {items.map((item) => {
              const active = activeId === item.id
              return (
                <li key={item.id}>
                  <a
                    href={`#${item.id}`}
                    className={`whitespace-nowrap rounded-full px-3 py-1.5 text-sm transition ${
                      active ? 'bg-surface text-fg' : 'text-muted hover:bg-surface/60 hover:text-fg'
                    }`}
                    onClick={() => setActiveId(item.id)}
                  >
                    {item.label}
                  </a>
                </li>
              )
            })}
          </ul>
        </div>
        {purchasable ? (
          <Link
            href={buyHref}
            className="hidden shrink-0 rounded-full bg-fg px-5 py-1.5 text-sm font-semibold text-bg transition hover:opacity-90 sm:inline-flex"
          >
            Buy
          </Link>
        ) : (
          <span className="hidden shrink-0 rounded-full border border-white/20 px-5 py-1.5 text-sm text-muted sm:inline-flex">
            Soon
          </span>
        )}
      </div>
    </nav>
  )
}
