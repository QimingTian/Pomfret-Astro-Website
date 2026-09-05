'use client'

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'

const VIEWPORT_CSS = 'calc(100vh - 5rem)'
const SF_PRO =
  "'SF Pro Display', 'SF Pro Text', -apple-system, BlinkMacSystemFont, 'Helvetica Neue', Helvetica, Arial, sans-serif"

function AboutEditorialSection({
  title,
  children,
  titleAlign = 'left',
}: {
  title: string
  children: ReactNode
  titleAlign?: 'left' | 'right'
}) {
  const titleOnRight = titleAlign === 'right'

  const titleClass = titleOnRight
    ? 'order-1 lg:order-2 lg:col-span-4 lg:col-start-9 lg:self-center lg:justify-self-end lg:text-right'
    : 'order-1 lg:order-1 lg:col-span-4 lg:col-start-1 lg:self-center lg:justify-self-start lg:text-left'
  const bodyClass = titleOnRight
    ? 'order-2 lg:order-1 lg:col-span-8 lg:col-start-1 lg:self-center'
    : 'order-2 lg:order-2 lg:col-span-8 lg:col-start-5 lg:self-center'

  return (
    <article className="px-4 py-16 sm:px-6 sm:py-20 lg:px-8 lg:py-24">
      <div className="mx-auto max-w-6xl">
        <div className="grid grid-cols-1 gap-10 lg:grid-cols-12 lg:items-center lg:gap-12 xl:gap-16">
          <h2
            className={`${titleClass} text-[clamp(2rem,4vw,2.75rem)] font-semibold leading-[1.08] tracking-tight text-white`}
            style={{ fontFamily: SF_PRO, letterSpacing: '-0.03em' }}
          >
            {title}
          </h2>
          <div
            className={`${bodyClass} space-y-4 text-[17px] leading-[1.55] text-white/90 sm:text-[18px] sm:leading-[1.5]`}
            style={{ fontFamily: SF_PRO }}
          >
            {children}
          </div>
        </div>
      </div>
    </article>
  )
}

/** Long rest on each beat, short cinematic roll between. */
const HOLD_FRAC = 0.72
const SLIDE_COUNT = 2

function easeInOutCubic(u: number): number {
  return u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2
}

/** Scroll 0..1 → slide index with Apple-like holds + eased transitions. */
function scrollTToProgress(t: number): number {
  const max = SLIDE_COUNT - 1
  if (max <= 0) return 0
  const x = Math.min(1, Math.max(0, t)) * max
  const i = Math.min(max - 1, Math.floor(x))
  const local = x - i
  if (local <= HOLD_FRAC) return i
  return i + easeInOutCubic((local - HOLD_FRAC) / (1 - HOLD_FRAC))
}

/**
 * Soft rise/fall, light perspective, blur — same roller as the old welcome story.
 */
function rollerStyle(distance: number): CSSProperties {
  const abs = Math.abs(distance)
  if (abs >= 0.98) {
    return { opacity: 0, visibility: 'hidden', pointerEvents: 'none' }
  }

  let opacity: number
  if (abs < 0.06) opacity = 1
  else if (abs < 0.35) opacity = 1 - ((abs - 0.06) / 0.29) * 0.35
  else opacity = Math.max(0, 0.65 * (1 - (abs - 0.35) / 0.63))

  const translateY = -distance * 220
  const rotateX = distance * 42
  const blur = abs < 0.12 ? 0 : Math.min(14, (abs - 0.12) * 18)

  return {
    opacity,
    visibility: opacity < 0.02 ? 'hidden' : 'visible',
    filter: blur > 0.15 ? `blur(${blur.toFixed(2)}px)` : undefined,
    transform: `translate3d(0, ${translateY.toFixed(2)}px, ${(-abs * 60).toFixed(2)}px) rotateX(${rotateX.toFixed(2)}deg)`,
    zIndex: Math.round(40 - abs * 20),
    pointerEvents: opacity > 0.45 ? 'auto' : 'none',
  }
}

/**
 * Shared home for `/dashboard` and `/dashboard/about`.
 * Restores the old fade/roller scroll: Welcome → intro over the video.
 */
export function AboutHome() {
  const [progress, setProgress] = useState(0)
  const storyRef = useRef<HTMLDivElement>(null)
  const targetRef = useRef(0)
  const currentRef = useRef(0)
  const rafRef = useRef(0)

  useEffect(() => {
    const readScroll = () => {
      const el = storyRef.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      const top = window.scrollY + rect.top
      const scrollable = Math.max(1, el.offsetHeight - window.innerHeight + 80)
      const t = Math.min(1, Math.max(0, (window.scrollY - top) / scrollable))
      targetRef.current = scrollTToProgress(t)
    }

    const animate = () => {
      const cur = currentRef.current
      const target = targetRef.current
      const next = cur + (target - cur) * 0.14
      currentRef.current = Math.abs(target - next) < 0.0008 ? target : next
      setProgress(currentRef.current)
      rafRef.current = requestAnimationFrame(animate)
    }

    readScroll()
    currentRef.current = targetRef.current
    setProgress(targetRef.current)
    rafRef.current = requestAnimationFrame(animate)

    window.addEventListener('scroll', readScroll, { passive: true })
    window.addEventListener('resize', readScroll)
    return () => {
      cancelAnimationFrame(rafRef.current)
      window.removeEventListener('scroll', readScroll)
      window.removeEventListener('resize', readScroll)
    }
  }, [])

  // One sticky viewport + runway for hold + roll between 2 slides
  const pageHeightFactor = SLIDE_COUNT * 1.65

  return (
    <div className="bg-black text-white">
      {/* Fixed video — stays behind hero + editorial; frosted sections blur over it */}
      <div
        className="pointer-events-none fixed inset-x-0 bottom-0 top-20 z-0 overflow-hidden"
        aria-hidden
      >
        <video
          className="absolute inset-0 h-full w-full scale-[1.02] object-cover"
          src="/welcome-background.mp4"
          autoPlay
          muted
          loop
          playsInline
          preload="auto"
        />
        <div className="absolute inset-0 bg-black/25" />
        <div
          className="absolute inset-0"
          style={{
            background:
              'radial-gradient(ellipse 75% 65% at 50% 48%, transparent 0%, rgba(0,0,0,0.22) 55%, rgba(0,0,0,0.5) 100%)',
          }}
        />
      </div>

      <div
        ref={storyRef}
        className="relative"
        style={{ height: `calc(${pageHeightFactor} * (${VIEWPORT_CSS}))` }}
      >
        <div
          className="sticky top-20 z-10 flex items-center overflow-hidden px-4 sm:px-6 lg:px-8"
          style={{ height: VIEWPORT_CSS }}
        >
          <div
            className="relative mx-auto h-full w-full max-w-6xl"
            style={{ perspective: '1600px', perspectiveOrigin: '50% 50%' }}
            aria-live="polite"
          >
            {/* Slide 0 — Welcome */}
            <div className="absolute inset-0 flex items-center justify-center">
              <div
                className="w-full will-change-transform"
                style={{
                  ...rollerStyle(progress - 0),
                  transformStyle: 'preserve-3d',
                }}
                aria-hidden={progress >= 0.5}
              >
                <div
                  className="w-full text-center"
                  style={{
                    letterSpacing: '-0.025em',
                    fontFamily: SF_PRO,
                    textRendering: 'optimizeLegibility',
                    WebkitFontSmoothing: 'antialiased',
                  }}
                >
                  <h1 className="text-[clamp(2.25rem,5vw,3.75rem)] font-medium leading-[1.12] text-white sm:whitespace-nowrap">
                    Welcome To Pomfret Astro Network
                  </h1>
                </div>
              </div>
            </div>

            {/* Slide 1 — intro */}
            <div className="absolute inset-0 flex items-center justify-center">
              <div
                className="w-full will-change-transform"
                style={{
                  ...rollerStyle(progress - 1),
                  transformStyle: 'preserve-3d',
                }}
                aria-hidden={progress < 0.5}
              >
                <p
                  className="mx-auto max-w-5xl px-2 text-center text-[clamp(1.375rem,2.85vw,2.125rem)] font-normal leading-[1.38] tracking-[-0.02em] text-white sm:px-4"
                  style={{ fontFamily: SF_PRO }}
                >
                  Pomfret Astro Network is redefining what an observatory network can be. For
                  independent observatories around the world, it unlocks two new possibilities:
                  unprecedented automation, and the freedom to connect.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      <section
        className="relative z-10 border-t border-white/[0.08] bg-black/15 backdrop-blur-[28px] backdrop-saturate-150"
        style={{ WebkitBackdropFilter: 'blur(28px) saturate(150%)' }}
      >
        <div className="divide-y divide-white/[0.08]">
          <AboutEditorialSection title="Automation">
          <p className="text-white">
            Have you ever worked on an imaging project that requires dozens of hours of exposure?
            Traditionally, that means checking the weather and Moon phase, setting up your NINA sequence
            each night, remotely connecting to the observatory computer, and starting everything again
            and again.
          </p>
          <p>
            With Pomfret Astro Network, you submit the entire Session once. From there, the system takes
            over. Intelligent scheduling continuously evaluates weather, target altitude, Moon
            conditions, and other factors, automatically returning to your project on every suitable night
            until the total exposure is complete—making precise use of every available clear window.
          </p>
          <p>
            And automation becomes even more powerful when multiple people share the same observatory.
            Designed for multi-user operation from the beginning, Pomfret Astro Network coordinates
            Sessions intelligently rather than simply placing them in a queue.
          </p>
          <p>
            If one user&apos;s broadband target is poorly suited for a bright Moon while another
            user&apos;s narrowband observation can continue, the scheduler can adapt. If one target does
            not rise until later in the night while another is already well positioned, the system can
            make use of the earlier hours instead.
          </p>
          <p>
            The result is an observatory that continuously works toward the most effective use of every
            clear night. And this is only part of what automation can become—with more to come.
          </p>
        </AboutEditorialSection>

        <AboutEditorialSection title="Network" titleAlign="right">
          <p className="text-white">
            Pomfret Astro Network brings more than powerful automation. It introduces another
            possibility: sharing. Think of it as something like Airbnb for observatories.
          </p>
          <p>
            Of course, participation is entirely up to you. You can choose to make your observatory
            available to other members of the Pomfret Astro Network, while maintaining full control over
            how and when it is used—including observing time, who can access it, and whether access comes
            with a cost.
          </p>
          <p>
            By allowing independently operated observatories to share capacity when they choose, the
            Network can help make better use of existing facilities while giving observers access to a
            wider range of instruments. When a project calls for a different wavelength, focal length,
            or optical system, another observatory in the Network may provide exactly what is needed.
          </p>
        </AboutEditorialSection>

        <AboutEditorialSection title="Join">
          <p className="text-white">
            Pomfret Astro Network welcomes people from around the world—whether you operate an observatory
            or are simply passionate about astronomy.
          </p>
          <p>
            For observatory operators, we provide customized support to help ensure a smooth and
            successful integration with the platform. If you are interested in joining, connecting an
            observatory, or simply have questions about Pomfret Astro Network, feel free to reach out to
            James Tian at{' '}
            <a
              href="mailto:qtian.28@pomfret.org"
              className="text-white underline decoration-white/35 underline-offset-[3px] transition-colors hover:decoration-white/70"
            >
              qtian.28@pomfret.org
            </a>
            .
          </p>
        </AboutEditorialSection>
        </div>
      </section>
    </div>
  )
}
