'use client'

import Link from 'next/link'
import { useRef } from 'react'
import { useGSAP } from '@gsap/react'
import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import type { ProductPlan } from '@/lib/site-config'
import { PLANS, planIsPurchasable } from '@/lib/site-config'

gsap.registerPlugin(ScrollTrigger, useGSAP)

type FraosEditionPanelProps = {
  plan: ProductPlan
}

export function FraosEditionPanel({ plan }: FraosEditionPanelProps) {
  const product = PLANS[plan]
  const learnHref = `/fraos/${plan}`
  const buyHref = `/checkout?plan=${plan}`
  const purchasable = planIsPurchasable(plan)
  const sectionRef = useRef<HTMLElement>(null)

  useGSAP(
    () => {
      const section = sectionRef.current
      if (!section) return
      const tl = gsap.timeline({
        scrollTrigger: {
          trigger: section,
          start: 'top 82%',
          toggleActions: 'play none none none',
        },
      })
      tl.from(section.querySelectorAll('[data-edition]'), {
        y: 32,
        autoAlpha: 0,
        duration: 0.7,
        stagger: 0.1,
        ease: 'power2.out',
      })
    },
    { scope: sectionRef }
  )

  return (
    <section ref={sectionRef} className="border-b border-white/15 py-20 md:py-28">
      <div className="page-shell">
        <div className="mx-auto max-w-4xl text-center">
          <p data-edition className="label-caps">
            {product.shortName}
            {product.availability === 'coming-soon' ? (
              <span className="ml-2 rounded-full border border-amber-400/40 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-amber-200/90">
                Coming soon
              </span>
            ) : null}
          </p>
          <h2
            data-edition
            className="mt-3 font-display text-4xl font-semibold tracking-tight text-fg md:text-5xl"
          >
            {product.name}
          </h2>
          <p data-edition className="mt-4 text-lg text-muted">
            {product.tagline}
          </p>
          <p data-edition className="mt-2 text-sm text-muted/80">
            {product.sites} · {product.seats}
          </p>
          <p data-edition className="mt-2 font-display text-2xl text-fg">
            {product.price === 'Custom'
              ? 'Custom pricing'
              : product.availability === 'available'
                ? product.price
                : `From ${product.price}`}
            <span className="ml-2 text-base font-sans font-normal text-muted">{product.period}</span>
          </p>
          <div data-edition className="mt-10 flex flex-wrap items-center justify-center gap-4">
            <Link href={learnHref} className="text-link text-base">
              Learn more
            </Link>
            <span className="hidden text-muted/40 sm:inline" aria-hidden>
              |
            </span>
            {purchasable ? (
              <Link href={buyHref} className="btn-primary px-7 py-2.5 text-sm">
                Buy
              </Link>
            ) : (
              <span className="rounded-full border border-white/20 px-7 py-2.5 text-sm text-muted">
                Coming soon
              </span>
            )}
          </div>
        </div>
        <div
          data-edition
          className="panel-placeholder mx-auto mt-16 aspect-[21/9] max-w-4xl rounded-3xl"
        />
      </div>
    </section>
  )
}
