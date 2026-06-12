'use client'

import Link from 'next/link'
import { useRef } from 'react'
import { useGSAP } from '@gsap/react'
import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import type { ProductPlan } from '@/lib/site-config'
import { FRAOS, PLANS, planIsPurchasable } from '@/lib/site-config'

gsap.registerPlugin(ScrollTrigger, useGSAP)

type ProductStoryPageProps = {
  plan: ProductPlan
}

export function ProductStoryPage({ plan }: ProductStoryPageProps) {
  const product = PLANS[plan]
  const buyHref = `/checkout?plan=${plan}`
  const purchasable = planIsPurchasable(plan)
  const rootRef = useRef<HTMLDivElement>(null)

  useGSAP(
    () => {
      const root = rootRef.current
      if (!root) return
      gsap.from(root.querySelectorAll('[data-hero]'), {
        y: 28,
        autoAlpha: 0,
        duration: 0.75,
        stagger: 0.1,
        ease: 'power2.out',
      })
      root.querySelectorAll('[data-highlight]').forEach((block) => {
        gsap.from(block.querySelectorAll('[data-highlight-item]'), {
          y: 36,
          autoAlpha: 0,
          duration: 0.7,
          stagger: 0.12,
          ease: 'power2.out',
          scrollTrigger: {
            trigger: block,
            start: 'top 80%',
            toggleActions: 'play none none none',
          },
        })
      })
    },
    { scope: rootRef }
  )

  return (
    <div ref={rootRef}>
      <section className="page-shell pb-12 pt-20 text-center md:pt-28">
        <p data-hero className="label-caps">
          {FRAOS.name} · {product.shortName}
        </p>
        <h1
          data-hero
          className="mt-4 font-display text-5xl font-bold tracking-tight text-fg md:text-6xl"
        >
          {product.name}
        </h1>
        <p data-hero className="mx-auto mt-6 max-w-2xl text-xl leading-relaxed text-muted">
          {product.headline}
        </p>
        <p data-hero className="mt-3 text-sm text-muted/80">
          {product.sites} · {product.seats}
        </p>
        <p data-hero className="mt-4 font-display text-2xl text-fg">
          {product.price}
          <span className="ml-2 text-base font-sans font-normal text-muted">{product.period}</span>
        </p>
        {product.availability === 'coming-soon' ? (
          <p data-hero className="mt-3 text-sm text-amber-200/90">
            In development — checkout opens when this tier launches.
          </p>
        ) : null}
        <div data-hero className="mt-10 flex flex-wrap justify-center gap-4">
          {purchasable ? (
            <Link href={buyHref} className="btn-primary">
              Buy
            </Link>
          ) : (
            <span className="btn-secondary cursor-default opacity-70">Coming soon</span>
          )}
          <Link href="/fraos" className="btn-secondary">
            Compare tiers
          </Link>
        </div>
        <div
          data-hero
          className="panel-placeholder mx-auto mt-16 aspect-[16/9] max-w-4xl rounded-3xl"
        />
      </section>

      {product.highlights.map((block, index) => (
        <section
          key={block.title}
          data-highlight
          className={`py-20 md:py-28 ${index % 2 === 1 ? 'bg-surface/40' : ''}`}
        >
          <div className="page-shell grid items-center gap-10 md:grid-cols-2">
            <div data-highlight-item className={index % 2 === 1 ? 'md:order-2' : ''}>
              <h2 className="font-display text-3xl font-semibold tracking-tight text-fg md:text-4xl">
                {block.title}
              </h2>
              <p className="mt-5 text-lg leading-relaxed text-muted">{block.body}</p>
            </div>
            <div
              data-highlight-item
              className={`panel-placeholder aspect-[4/3] rounded-2xl ${
                index % 2 === 1 ? 'md:order-1' : ''
              }`}
            />
          </div>
        </section>
      ))}

      <section className="border-t border-white/15 py-20">
        <div className="page-shell-narrow text-center">
          <h2 className="section-heading">What&apos;s included</h2>
          <ul className="mt-10 space-y-4 text-left text-muted">
            {product.features.map((feature) => (
              <li key={feature} className="flex gap-3 border-b border-white/10 pb-4">
                <span className="text-fg">✦</span>
                {feature}
              </li>
            ))}
          </ul>
          {purchasable ? (
            <Link href={buyHref} className="btn-primary mt-12 px-10 py-3.5">
              Buy {product.shortName}
            </Link>
          ) : (
            <Link href="/fraos" className="btn-secondary mt-12 px-10 py-3.5">
              Compare all tiers
            </Link>
          )}
        </div>
      </section>
    </div>
  )
}
