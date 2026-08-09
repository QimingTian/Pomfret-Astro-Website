'use client'

import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { glassPillToggleIdleMd } from '@/lib/glass-ui'

/** When displayed hours equal BASE_SAFE_HOURS. */
const SAFE_HOURS_ANCHOR_MS = Date.parse('2026-07-13T03:00:00.000Z')
const BASE_SAFE_HOURS = 1296

const VIEWPORT_CSS = 'calc(100vh - 5rem)'
const SF_PRO =
  "'SF Pro Display', 'SF Pro Text', -apple-system, BlinkMacSystemFont, 'Helvetica Neue', Helvetica, Arial, sans-serif"
/** Shared band height for Astrophotography / Photometry / Discovery. */
const SECTION_PANEL =
  'relative z-10 flex min-h-[min(82vh,48rem)] flex-col justify-end px-4 sm:px-6 lg:px-8 pb-6 sm:pb-8 pt-24'

/** Long rest on each beat, short cinematic roll between. */
const HOLD_FRAC = 0.72
const SLIDE_COUNT = 2

function safeOperatingHours(nowMs = Date.now()): number {
  const elapsed = Math.max(0, nowMs - SAFE_HOURS_ANCHOR_MS)
  return BASE_SAFE_HOURS + Math.floor(elapsed / (60 * 60 * 1000))
}

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
 * Restores the old fade/roller scroll: Welcome → intro + stats over the video.
 */
export function AboutHome() {
  const [hours, setHours] = useState(() => safeOperatingHours())
  const [progress, setProgress] = useState(0)
  const [stageOpacity, setStageOpacity] = useState(1)
  const storyRef = useRef<HTMLDivElement>(null)
  const targetRef = useRef(0)
  const currentRef = useRef(0)
  const rafRef = useRef(0)

  useEffect(() => {
    const tick = () => setHours(safeOperatingHours())
    tick()
    const id = window.setInterval(tick, 30_000)
    return () => window.clearInterval(id)
  }, [])

  useEffect(() => {
    const readScroll = () => {
      const el = storyRef.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      const top = window.scrollY + rect.top
      const scrollable = Math.max(1, el.offsetHeight - window.innerHeight + 80)
      const t = Math.min(1, Math.max(0, (window.scrollY - top) / scrollable))
      targetRef.current = scrollTToProgress(t)

      // Fade the fixed video out as projects cover it
      const past = -rect.bottom
      setStageOpacity(past <= 0 ? 1 : Math.max(0, 1 - past / 160))
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

  const hoursLabel = hours.toLocaleString('en-US')
  // One sticky viewport + runway for hold + roll between 2 slides
  const pageHeightFactor = SLIDE_COUNT * 1.65

  return (
    <div className="bg-black text-white">
      <div
        ref={storyRef}
        className="relative"
        style={{ height: `calc(${pageHeightFactor} * (${VIEWPORT_CSS}))` }}
      >
        {/* Fixed cinematic stage — original video framing */}
        <div
          className="pointer-events-none fixed inset-x-0 bottom-0 top-20 z-0 overflow-hidden transition-opacity duration-200"
          style={{ opacity: stageOpacity }}
          aria-hidden={stageOpacity < 0.05}
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
          <div className="absolute inset-0 bg-black/30" />
          <div
            className="absolute inset-0"
            style={{
              background:
                'radial-gradient(ellipse 75% 65% at 50% 48%, transparent 0%, rgba(0,0,0,0.28) 55%, rgba(0,0,0,0.62) 100%)',
            }}
          />
        </div>

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
            <div className="absolute inset-0 flex items-center">
              <div
                className="w-full will-change-transform"
                style={{
                  ...rollerStyle(progress - 0),
                  transformStyle: 'preserve-3d',
                }}
                aria-hidden={progress >= 0.5}
              >
                <div
                  style={{
                    letterSpacing: '-0.025em',
                    fontFamily: SF_PRO,
                    textRendering: 'optimizeLegibility',
                    WebkitFontSmoothing: 'antialiased',
                  }}
                >
                  <p className="text-[clamp(2.25rem,5vw,3.75rem)] font-medium leading-[1.12] text-white sm:whitespace-nowrap">
                    Welcome To Pomfret Olmsted Observatory
                  </p>
                </div>
              </div>
            </div>

            {/* Slide 1 — intro + stats */}
            <div className="absolute inset-0 flex items-center">
              <div
                className="w-full will-change-transform"
                style={{
                  ...rollerStyle(progress - 1),
                  transformStyle: 'preserve-3d',
                }}
                aria-hidden={progress < 0.5}
              >
                <div className="mx-auto w-full">
                  <div
                    className="max-w-4xl space-y-3 text-[18px] sm:text-[20px] leading-[1.4] font-normal text-white"
                    style={{ fontFamily: SF_PRO, letterSpacing: '-0.01em' }}
                  >
                    <p>Pomfret Olmsted Observatory is Pomfret School&apos;s state-of-the-art astronomical facility.</p>
                    <p className="text-white/90">
                      The observatory runs on Pomfret Astro — an in-house platform developed at Pomfret
                      to operate the dome from weather monitoring and safety checks through automated
                      scheduling and remote control. On clear nights the telescope can observe
                      autonomously, without staff at the site, while students and faculty plan programs,
                      follow the night&apos;s schedule, and access finished data from anywhere in the
                      world.
                    </p>
                  </div>

                  <div className="mt-8 sm:mt-10 grid grid-cols-1 sm:grid-cols-3 gap-7 sm:gap-6 border-t border-white/25 pt-7 sm:pt-8">
                    <div>
                      <p
                        className="tabular-nums text-[clamp(2.5rem,4.5vw,3.5rem)] font-semibold leading-none tracking-tight text-white"
                        style={{ fontFamily: SF_PRO, letterSpacing: '-0.03em' }}
                      >
                        {hoursLabel}
                      </p>
                      <p className="mt-2 text-[16px] leading-snug text-white" style={{ fontFamily: SF_PRO }}>
                        Hours safely operating autonomously
                      </p>
                    </div>
                    <div>
                      <p
                        className="text-[clamp(2.5rem,4.5vw,3.5rem)] font-semibold leading-none tracking-tight text-white"
                        style={{ fontFamily: SF_PRO, letterSpacing: '-0.03em' }}
                      >
                        50+
                      </p>
                      <p className="mt-2 text-[16px] leading-snug text-white" style={{ fontFamily: SF_PRO }}>
                        Hours of imaging every month
                      </p>
                    </div>
                    <div>
                      <p
                        className="text-[clamp(2.5rem,4.5vw,3.5rem)] font-semibold leading-none tracking-tight text-white"
                        style={{ fontFamily: SF_PRO, letterSpacing: '-0.03em' }}
                      >
                        End to end
                      </p>
                      <p className="mt-2 text-[16px] leading-snug text-white" style={{ fontFamily: SF_PRO }}>
                        Weather, schedule, observe, deliver
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <section className="relative z-10">
        <article>
          <div className="relative w-full bg-black">
            <div className="absolute inset-0">
              <img
                src="/about/ngc7000-complex-mosaic.webp"
                alt="NGC7000 North America Nebula mosaic from Pomfret"
                className="h-full w-full object-cover"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black via-black/45 to-transparent" />
            </div>
            <div className={SECTION_PANEL}>
              <div className="mx-auto w-full max-w-6xl">
                <h3
                  className="text-[clamp(1.6rem,3.2vw,2.5rem)] font-semibold tracking-tight text-white leading-[1.1]"
                  style={{ fontFamily: SF_PRO, letterSpacing: '-0.025em' }}
                >
                  Astrophotography
                </h3>
                <div
                  className="mt-3 max-w-4xl space-y-3 text-[16px] sm:text-[18px] leading-snug text-white"
                  style={{ fontFamily: SF_PRO }}
                >
                  <p>Professional deep-sky imaging. Delivered.</p>
                  <p className="text-white/90">
                    A Takahashi FSQ-106 and ZWO ASI2600MM Pro on a Software Bisque Paramount ME. LRGB and
                    SHO. Off-axis guiding with a ZWO ASI174MM on an OAG-L. Single fields and multi-panel
                    mosaics — broadband and narrowband — at the scale of a wide-field apo.
                  </p>
                </div>
                <div className="mt-4">
                  <a href="/dashboard/gallery?category=deep_sky" className={glassPillToggleIdleMd}>
                    Check Out Our Data
                  </a>
                </div>
              </div>
            </div>
          </div>
        </article>

        <article>
          <div className="relative w-full bg-black">
            <div className="absolute inset-0">
              <img
                src="/about/photometry-bg.jpg"
                alt="Differential photometry light curve from Pomfret"
                className="h-full w-full object-cover object-top"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black via-black/55 to-black/25" />
            </div>
            <div className={SECTION_PANEL}>
              <div className="mx-auto w-full max-w-6xl">
                <h3
                  className="text-[clamp(1.6rem,3.2vw,2.5rem)] font-semibold tracking-tight text-white leading-[1.1]"
                  style={{ fontFamily: SF_PRO, letterSpacing: '-0.025em' }}
                >
                  Photometry
                </h3>
                <div
                  className="mt-3 max-w-4xl space-y-3 text-[16px] sm:text-[18px] leading-snug text-white"
                  style={{ fontFamily: SF_PRO }}
                >
                  <p>Precision photometry of variable stars.</p>
                  <p className="text-white/90">
                    Differential light curves against check stars. Extinction corrected. Periods when the
                    baseline earns them — contact binaries, pulsators, and other variables from Pomfret
                    skies.
                  </p>
                </div>
                <div className="mt-4">
                  <a href="/dashboard/gallery?category=photometry" className={glassPillToggleIdleMd}>
                    Check Out Our Data
                  </a>
                </div>
              </div>
            </div>
          </div>
        </article>

        <article>
          <div className="relative w-full bg-black">
            <div className="absolute inset-0">
              <img
                src="/about/oiii-survey-bg.jpg"
                alt="Deep [O III] nebulosity — survey science preview"
                className="h-full w-full object-cover"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black via-black/55 to-black/20" />
            </div>
            <div className={SECTION_PANEL}>
              <div className="mx-auto w-full max-w-6xl">
                <h3
                  className="text-[clamp(1.5rem,3vw,2.4rem)] font-semibold tracking-tight text-white leading-[1.15]"
                  style={{ fontFamily: SF_PRO, letterSpacing: '-0.025em' }}
                >
                  Discovery Project
                </h3>
                <div
                  className="mt-3 max-w-4xl space-y-4 text-[16px] sm:text-[18px] leading-snug text-white"
                  style={{ fontFamily: SF_PRO }}
                >
                  <p>Find what has not been deeply imaged.</p>
                  <p className="text-white/90">
                    A survey for previously unrecorded low-surface-brightness [O III] emission — faint
                    shells, arcs, and filaments near energetic stars and under-observed structure. Not
                    another pass over famous H II cores.
                  </p>
                  <p className="text-white/90">
                    Targets are ranked across the Pomfret-visible sky for discovery promise — energetic
                    under-imaged fields first, tourist cores last. We invest nights in short [O III]
                    pilots, then go deep only where structure appears.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </article>
      </section>
    </div>
  )
}
