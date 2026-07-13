'use client'

import { useEffect, useRef, useState, type CSSProperties } from 'react'

/** When displayed hours equal BASE_SAFE_HOURS. */
const SAFE_HOURS_ANCHOR_MS = Date.parse('2026-07-13T03:00:00.000Z')
const BASE_SAFE_HOURS = 1296

const VIEWPORT_CSS = 'calc(100vh - 5rem)'
const SF_PRO =
  "'SF Pro Display', 'SF Pro Text', -apple-system, BlinkMacSystemFont, 'Helvetica Neue', Helvetica, Arial, sans-serif"

/** Long rest on each line, short cinematic roll between. */
const HOLD_FRAC = 0.72

type Slide =
  | { kind: 'static'; lines: string[]; nowrap?: boolean }
  | { kind: 'hours'; afterHours: string; lines: string[] }

const SLIDES: Slide[] = [
  { kind: 'static', nowrap: true, lines: ['Welcome To Pomfret Olmsted Observatory'] },
  {
    kind: 'hours',
    afterHours: 'hours.',
    lines: ['Safely operating autonomously.'],
  },
  {
    kind: 'static',
    lines: [
      '50+ hours every month.',
      'Collecting astronomical data under Pomfret’s night skies.',
    ],
  },
  {
    kind: 'static',
    lines: ['Fully autonomous.', 'From weather decisions to scientific observations.'],
  },
  {
    kind: 'static',
    lines: ['Built for students.', 'Designed for real research.'],
  },
]

const LINE_CLASS =
  'text-[clamp(2.25rem,5vw,3.75rem)] font-medium leading-[1.12] text-white'

function safeOperatingHours(nowMs = Date.now()): number {
  const elapsed = Math.max(0, nowMs - SAFE_HOURS_ANCHOR_MS)
  return BASE_SAFE_HOURS + Math.floor(elapsed / (60 * 60 * 1000))
}

function easeInOutCubic(u: number): number {
  return u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2
}

/** Scroll 0..1 → slide index with Apple-like holds + eased transitions. */
function scrollTToProgress(t: number): number {
  const max = SLIDES.length - 1
  if (max <= 0) return 0
  const x = Math.min(1, Math.max(0, t)) * max
  const i = Math.min(max - 1, Math.floor(x))
  const local = x - i
  if (local <= HOLD_FRAC) return i
  return i + easeInOutCubic((local - HOLD_FRAC) / (1 - HOLD_FRAC))
}

/**
 * Restrained roller: soft rise/fall, light perspective, blur — not a hard flip.
 * Only one slide readable while centered.
 */
function rollerStyle(distance: number): CSSProperties {
  const abs = Math.abs(distance)
  if (abs >= 0.98) {
    return { opacity: 0, visibility: 'hidden', pointerEvents: 'none' }
  }

  // Hold crystal-clear near center, then dissolve
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
    transform: `translate3d(0, ${translateY.toFixed(2)}px, ${( -abs * 60).toFixed(2)}px) rotateX(${rotateX.toFixed(2)}deg)`,
    zIndex: Math.round(40 - abs * 20),
  }
}

function SlideBody({ slide, hours }: { slide: Slide; hours: number }) {
  const style: CSSProperties = {
    letterSpacing: '-0.025em',
    fontFamily: SF_PRO,
    textRendering: 'optimizeLegibility',
    WebkitFontSmoothing: 'antialiased',
  }

  if (slide.kind === 'hours') {
    return (
      <div style={style}>
        <p className={LINE_CLASS}>
          <span className="tabular-nums">{hours.toLocaleString('en-US')}</span> {slide.afterHours}
        </p>
        {slide.lines.map((line) => (
          <p key={line} className={`mt-5 ${LINE_CLASS}`}>
            {line}
          </p>
        ))}
      </div>
    )
  }

  return (
    <div style={style}>
      {slide.lines.map((line, i) => (
        <p
          key={line}
          className={`${i === 0 ? LINE_CLASS : `mt-5 ${LINE_CLASS}`}${slide.nowrap ? ' whitespace-nowrap' : ''}`}
        >
          {line}
        </p>
      ))}
    </div>
  )
}

export function WelcomeStory() {
  const [progress, setProgress] = useState(0)
  const [hours, setHours] = useState(() => safeOperatingHours())
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
      const scrollRange = Math.max(1, document.documentElement.scrollHeight - window.innerHeight)
      const t = Math.min(1, Math.max(0, window.scrollY / scrollRange))
      targetRef.current = scrollTToProgress(t)
    }

    const animate = () => {
      const cur = currentRef.current
      const target = targetRef.current
      // Soft follow — Apple product pages feel eased, not 1:1 sticky to the wheel
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

  const activeIndex = Math.min(SLIDES.length - 1, Math.max(0, Math.round(progress)))
  const pageHeightFactor = Math.max(SLIDES.length * 2.05, 7)

  return (
    <div className="relative" style={{ height: `calc(${pageHeightFactor} * (${VIEWPORT_CSS}))` }}>
      {/* Fixed cinematic stage */}
      <div className="pointer-events-none fixed inset-x-0 bottom-0 top-20 z-0 overflow-hidden">
        <video
          className="absolute inset-0 h-full w-full scale-[1.02] object-cover"
          src="/welcome-background.mp4"
          autoPlay
          muted
          loop
          playsInline
          preload="auto"
        />
        {/* Layered wash — softer than a flat slab */}
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
        className="sticky top-20 z-10 flex items-center justify-center overflow-hidden px-5 text-center sm:px-10"
        style={{ height: VIEWPORT_CSS }}
      >
        <div
          className="relative w-full max-w-[min(98vw,82rem)]"
          style={{ perspective: '1600px', perspectiveOrigin: '50% 45%' }}
          aria-live="polite"
          aria-atomic="true"
        >
          <span className="sr-only">
            {SLIDES[activeIndex]?.kind === 'hours'
              ? `${hours.toLocaleString('en-US')} hours. ${SLIDES[activeIndex].lines.join(' ')}`
              : SLIDES[activeIndex]?.lines.join(' ')}
          </span>

          <div
            className="relative mx-auto flex h-[min(32rem,62vh)] w-full items-center justify-center"
            style={{
              transformStyle: 'preserve-3d',
              WebkitMaskImage:
                'linear-gradient(to bottom, transparent 0%, #000 18%, #000 82%, transparent 100%)',
              maskImage:
                'linear-gradient(to bottom, transparent 0%, #000 18%, #000 82%, transparent 100%)',
            }}
          >
            {SLIDES.map((slide, i) => (
              <div
                key={i}
                className="absolute inset-0 flex flex-col items-center justify-center will-change-transform"
                style={{
                  ...rollerStyle(progress - i),
                  transformStyle: 'preserve-3d',
                }}
                aria-hidden={activeIndex !== i}
              >
                <SlideBody slide={slide} hours={hours} />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
