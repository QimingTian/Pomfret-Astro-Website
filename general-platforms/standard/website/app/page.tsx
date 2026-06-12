import Link from 'next/link'
import { ClientLogoMarquee } from '@/components/ClientLogoMarquee'
import { ScrollReveal } from '@/components/motion/ScrollReveal'
import { StaggerEntrance } from '@/components/motion/StaggerEntrance'
import { Starfield } from '@/components/Starfield'
import { FEATURED_CLIENTS } from '@/lib/clients'
import { ASC, FRAOS } from '@/lib/site-config'

export default function AboutPage() {
  return (
    <>
      <Starfield />
      <section className="page-shell pb-16 pt-20 md:pt-28">
        <StaggerEntrance className="max-w-4xl">
          <h1 data-stagger className="section-heading">
            About Us
          </h1>
          <div data-stagger className="glass-panel mt-8 p-8 md:p-10">
            <p className="max-w-3xl text-xl leading-relaxed text-muted">
              We build software and hardware for astronomers who want their observatory to work as reliably
              at 2 a.m. from another continent as it does standing next to the pier.
            </p>
            <p className="mt-6 max-w-3xl text-lg leading-relaxed text-muted/90">
              Borean Astro is an independent product company focused on remote observatory operations —
              from fully automated imaging workflows to all-sky awareness. Our cloud platform gives every
              customer a dedicated hub; our desktop apps connect your gear to that hub without compromise.
            </p>
          </div>
        </StaggerEntrance>
      </section>

      <section className="border-t border-white/15 py-16 md:py-20">
        <div className="page-shell">
          <ScrollReveal>
            <h2 className="section-heading">What we make</h2>
          </ScrollReveal>
          <div className="mt-10 grid gap-6 md:grid-cols-2">
            <ScrollReveal delay={0.05}>
              <Link href="/fraos" className="glass-card group block p-8">
                <p className="label-caps">{FRAOS.name}</p>
                <p className="mt-2 text-xs text-muted/80">{FRAOS.fullName}</p>
                <p className="mt-4 text-muted transition group-hover:text-fg">{FRAOS.summary}</p>
                <span className="mt-6 inline-block text-sm text-fg">Explore FRAOS →</span>
              </Link>
            </ScrollReveal>
            <ScrollReveal delay={0.12}>
              <Link href="/asc" className="glass-card group block p-8">
                <p className="label-caps">{ASC.name}</p>
                <p className="mt-2 text-xs text-muted/80">{ASC.fullName}</p>
                <p className="mt-4 text-muted transition group-hover:text-fg">{ASC.summary}</p>
                <span className="mt-6 inline-block text-sm text-fg">Learn about ASC →</span>
              </Link>
            </ScrollReveal>
          </div>
        </div>
      </section>

      <section className="border-t border-white/15 py-16 md:py-20">
        <div className="page-shell">
          <ScrollReveal>
            <h2 className="section-heading">In service at</h2>
            <p className="mt-3 max-w-2xl text-muted">
              Observatories that rely on Borean Astro for remote operations, automation, and all-sky
              awareness.
            </p>
          </ScrollReveal>
        </div>
        <ClientLogoMarquee clients={FEATURED_CLIENTS} />
      </section>
    </>
  )
}
