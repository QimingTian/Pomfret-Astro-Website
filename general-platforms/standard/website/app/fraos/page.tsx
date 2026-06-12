import { FraosEditionPanel } from '@/components/FraosEditionPanel'
import { ScrollReveal } from '@/components/motion/ScrollReveal'
import { StaggerEntrance } from '@/components/motion/StaggerEntrance'
import { FRAOS, PRODUCT_PLANS } from '@/lib/site-config'

export const metadata = {
  title: 'FRAOS — Borean Astro',
  description: FRAOS.fullName,
}

export default function FraosPage() {
  return (
    <>
      <section className="page-shell pb-8 pt-20 text-center md:pt-28">
        <StaggerEntrance>
          <h1
            data-stagger
            className="font-display text-5xl font-bold tracking-tight text-fg md:text-6xl"
          >
            {FRAOS.name}
          </h1>
          <p data-stagger className="mx-auto mt-4 max-w-2xl text-lg text-muted">
            {FRAOS.fullName}
          </p>
          <p data-stagger className="mx-auto mt-6 max-w-xl text-base text-muted/90">
            {FRAOS.summary}
          </p>
          <p data-stagger className="mx-auto mt-4 max-w-2xl text-sm text-muted/80">
            {FRAOS.tierTagline}
          </p>
        </StaggerEntrance>
      </section>
      {PRODUCT_PLANS.map((plan, index) => (
        <div key={plan}>
          {index > 0 ? (
            <ScrollReveal>
              <div aria-hidden className="page-shell h-px bg-white/10" />
            </ScrollReveal>
          ) : null}
          <FraosEditionPanel plan={plan} />
        </div>
      ))}
    </>
  )
}
