'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { VariableStarRow } from '@/lib/variable-star-catalog'
import {
  MIN_ALTITUDE_DEG,
  OBS_LAT_DEG,
  OBS_LON_DEG,
  TONIGHT_OBSERVABLE_MIN_COVERAGE_MS,
} from '@/lib/target-altitude'
import { getTonightAstronomicalNightWindow } from '@/lib/sunrise-window'
import { VariableStarPreviewCharts, type VariableStarChartStar } from './variable-star-preview-charts'

const jsonHeaders: HeadersInit = { 'Content-Type': 'application/json' }
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const STACKED_MASTER_REQUIRED_EXPOSURE_SECONDS = 600

type SessionProgressLine = { at: string; text: string }
type ProgressStreamEvent =
  | { type: 'snapshot'; queueStatus: string; lines: SessionProgressLine[] }
  | { type: 'line'; at: string; text: string }
  | { type: 'status'; queueStatus: string }
  | { type: 'ping' }
type PreviewStreamEvent =
  | { type: 'snapshot'; updatedAt: string | null }
  | { type: 'updated'; updatedAt: string }
  | { type: 'ping' }

const TERMINAL_POLL_MS = 10_000
const STATUS_POLL_MS = 10 * 60 * 1000
const FILTER_OPTIONS = [
  { value: 'L', label: 'Luminance' },
  { value: 'R', label: 'Red' },
  { value: 'G', label: 'Green' },
  { value: 'B', label: 'Blue' },
  { value: 'S', label: 'Sulfur' },
  { value: 'H', label: 'Hydrogen' },
  { value: 'O', label: 'Oxygen' },
] as const

type ResolvedCatalogObject = {
  query: string
  canonicalName: string
  aliases: string[]
  raHours: number
  decDeg: number
  ra: { hour: number; minute: number; second: number }
  dec: { sign: '+' | '-'; degree: number; minute: number; second: number }
}

type ImagingSessionTypeUi = 'dso' | 'variable_star'
type VariableStarLookupSource = 'catalog' | 'simbad'
type VariableStarFilterUi =
  | 'tonight_observable'
  | 'high_priority'
  | 'short_period'
  | 'mid_period'
  | 'long_period'

function sexagesimalPartsFromRadec(raHours: number, decDeg: number) {
  const totalRaSec = raHours * 3600
  const raH = Math.floor(totalRaSec / 3600)
  const raM = Math.floor((totalRaSec - raH * 3600) / 60)
  const raS = totalRaSec - raH * 3600 - raM * 60
  const sign: '+' | '-' = decDeg < 0 ? '-' : '+'
  const absDec = Math.abs(decDeg)
  const decD = Math.floor(absDec)
  const decM = Math.floor((absDec - decD) * 60)
  const decS = (absDec - decD - decM / 60) * 3600
  return {
    raHourPart: String(raH),
    raMinutePart: String(raM),
    raSecondPart: String(Number(raS.toFixed(3))),
    decSign: sign,
    decDegreePart: String(decD),
    decMinutePart: String(decM),
    decSecondPart: String(Number(decS.toFixed(3))),
  }
}

function applySexagesimalPartsFromRadec(
  raHours: number,
  decDeg: number,
  setRaHourPart: (v: string) => void,
  setRaMinutePart: (v: string) => void,
  setRaSecondPart: (v: string) => void,
  setDecSign: (v: string) => void,
  setDecDegreePart: (v: string) => void,
  setDecMinutePart: (v: string) => void,
  setDecSecondPart: (v: string) => void
) {
  const p = sexagesimalPartsFromRadec(raHours, decDeg)
  setRaHourPart(p.raHourPart)
  setRaMinutePart(p.raMinutePart)
  setRaSecondPart(p.raSecondPart)
  setDecSign(p.decSign)
  setDecDegreePart(p.decDegreePart)
  setDecMinutePart(p.decMinutePart)
  setDecSecondPart(p.decSecondPart)
}

function rowToVariableChartStar(row: VariableStarRow): VariableStarChartStar {
  return {
    name: row.name,
    raHours: row.raHours,
    decDeg: row.decDeg,
    periodDays: row.periodDays,
    minMag: row.minMag,
    maxMag: row.maxMag,
  }
}

function pickVariableStarRow(
  catalog: VariableStarRow[],
  query: string
): { ok: true; row: VariableStarRow } | { ok: false; error: string } {
  const q = query.trim().toLowerCase()
  if (!q) return { ok: false, error: 'Enter a variable star name.' }
  const exact = catalog.filter((s) => s.name.toLowerCase() === q)
  if (exact.length === 1) return { ok: true, row: exact[0]! }
  if (exact.length > 1) {
    return {
      ok: false,
      error: `Multiple catalog entries match "${query}" exactly. Use a more specific designation.`,
    }
  }
  const partial = catalog.filter((s) => s.name.toLowerCase().includes(q))
  if (partial.length === 1) return { ok: true, row: partial[0]! }
  if (partial.length === 0) {
    return { ok: false, error: `No variable star in the catalog matches "${query}".` }
  }
  if (partial.length > 20) {
    return {
      ok: false,
      error: `Too many matches (${partial.length}). Type a longer or more specific name.`,
    }
  }
  return {
    ok: false,
    error: `Multiple matches (${partial.length}). Examples: ${partial
      .slice(0, 8)
      .map((s) => s.name)
      .join(', ')}`,
  }
}

function queueStatusLabel(status: string): string {
  switch (status) {
    case 'pending':
      return 'Pending'
    case 'scheduled':
      return 'Scheduled'
    case 'in_progress':
      return 'In progress'
    case 'completed':
      return 'Completed'
    case 'claimed':
      return 'Claimed'
    case 'failed':
      return 'Failed'
    default:
      return status
  }
}

function queueStatusBadgeClass(status: string): string {
  if (status === 'pending') return 'text-amber-700 dark:text-amber-400'
  if (status === 'scheduled') return 'text-cyan-700 dark:text-cyan-400'
  if (status === 'in_progress') return 'text-blue-700 dark:text-blue-400'
  if (status === 'completed') return 'text-green-700 dark:text-green-400'
  if (status === 'failed') return 'text-red-700 dark:text-red-400'
  return 'text-gray-500 dark:text-gray-500'
}

function formatDurationShort(totalSeconds: number | undefined): string {
  if (typeof totalSeconds !== 'number' || !Number.isFinite(totalSeconds) || totalSeconds <= 0) return '--'
  const sec = Math.round(totalSeconds)
  const hours = Math.floor(sec / 3600)
  const minutes = Math.floor((sec % 3600) / 60)
  if (hours > 0) return `${hours}h ${minutes}m`
  return `${minutes}m`
}

type ObservatoryStatus =
  | 'loading'
  | 'ready'
  | 'busy_in_use'
  | 'closed_weather_not_permitted'
  | 'closed_daytime'
  | 'closed_observatory_maintenance'

function statusLabel(status: ObservatoryStatus): string {
  if (status === 'loading') return '...'
  if (status === 'ready') return 'Ready'
  if (status === 'busy_in_use') return 'Busy -- In Use'
  if (status === 'closed_weather_not_permitted') return 'Closed -- Weather Not Permitted'
  if (status === 'closed_daytime') return 'Closed -- Daytime'
  return 'Closed -- Observatory Maintenance'
}

function degToRad(deg: number): number {
  return (deg * Math.PI) / 180
}

function radToDeg(rad: number): number {
  return (rad * 180) / Math.PI
}

function dayOfYearUTC(date: Date): number {
  const start = Date.UTC(date.getUTCFullYear(), 0, 1)
  const current = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
  return Math.floor((current - start) / 86400000) + 1
}

function solarEventUtcForDate(date: Date, zenithDeg: number, isSunrise: boolean): Date {
  const n = dayOfYearUTC(date)
  const gamma = (2 * Math.PI / 365) * (n - 1)
  const eqTime =
    229.18 *
    (0.000075 +
      0.001868 * Math.cos(gamma) -
      0.032077 * Math.sin(gamma) -
      0.014615 * Math.cos(2 * gamma) -
      0.040849 * Math.sin(2 * gamma))
  const decl =
    0.006918 -
    0.399912 * Math.cos(gamma) +
    0.070257 * Math.sin(gamma) -
    0.006758 * Math.cos(2 * gamma) +
    0.000907 * Math.sin(2 * gamma) -
    0.002697 * Math.cos(3 * gamma) +
    0.00148 * Math.sin(3 * gamma)
  const latRad = degToRad(OBS_LAT_DEG)
  const zenithRad = degToRad(zenithDeg)
  const cosH =
    (Math.cos(zenithRad) - Math.sin(latRad) * Math.sin(decl)) /
    (Math.cos(latRad) * Math.cos(decl))
  const clamped = Math.max(-1, Math.min(1, cosH))
  const hourAngleDeg = radToDeg(Math.acos(clamped))
  const solarNoonMin = 720 - 4 * OBS_LON_DEG - eqTime
  const eventMin = isSunrise ? solarNoonMin - 4 * hourAngleDeg : solarNoonMin + 4 * hourAngleDeg
  const midnightUtc = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
  return new Date(midnightUtc + eventMin * 60000)
}

function buildHourKey(at: Date): string {
  return `${at.getFullYear()}-${at.getMonth()}-${at.getDate()}-${at.getHours()}`
}

function parseHourKeyToMs(key: string): number | null {
  const parts = key.split('-').map((x) => Number(x))
  if (parts.length !== 4) return null
  const [year, month, day, hour] = parts
  if (![year, month, day, hour].every((x) => Number.isFinite(x))) return null
  return new Date(year, month, day, hour, 0, 0, 0).getTime()
}

function computeTonightWindow(now: Date): { startMs: number; endMs: number } {
  const nowUtcMidnight = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()))
  const todaySunrise = solarEventUtcForDate(nowUtcMidnight, 90.833, true)
  const scheduleStart = new Date(now)
  scheduleStart.setHours(16, 0, 0, 0)
  if (now.getTime() < todaySunrise.getTime()) {
    scheduleStart.setDate(scheduleStart.getDate() - 1)
  }
  const scheduleEnd = new Date(scheduleStart)
  scheduleEnd.setDate(scheduleEnd.getDate() + 1)
  scheduleEnd.setHours(8, 0, 0, 0)
  return { startMs: scheduleStart.getTime(), endMs: scheduleEnd.getTime() }
}

function mergeWithFrozenPastHours(previous: string[], incoming: string[], now: Date): string[] {
  const { startMs, endMs } = computeTonightWindow(now)
  const nowMs = now.getTime()
  const merged = new Set<string>()

  for (const key of previous) {
    const ms = parseHourKeyToMs(key)
    if (ms == null) continue
    if (ms >= startMs && ms < endMs && ms <= nowMs) {
      merged.add(key)
    }
  }
  for (const key of incoming) {
    const ms = parseHourKeyToMs(key)
    if (ms == null) continue
    if (ms >= startMs && ms < endMs) {
      merged.add(key)
    }
  }

  return Array.from(merged).sort((a, b) => (parseHourKeyToMs(a) ?? 0) - (parseHourKeyToMs(b) ?? 0))
}

function estimateDurationSecondsFromPlans(
  plans: Array<{ filterName: string; exposureSeconds: number; count: number }> | undefined
): number {
  if (!Array.isArray(plans) || plans.length === 0) return 15 * 60
  const imagingSeconds = plans.reduce((sum, p) => sum + p.count * p.exposureSeconds, 0)
  return Math.max(imagingSeconds + 15 * 60, 15 * 60)
}

function currentAltitudeDegAt(raHours: number, decDeg: number, now: Date): number {
  const raDeg = raHours * 15
  const jd = now.getTime() / 86400000 + 2440587.5
  const t = (jd - 2451545.0) / 36525
  const gmst =
    280.46061837 +
    360.98564736629 * (jd - 2451545.0) +
    0.000387933 * t * t -
    (t * t * t) / 38710000
  let lstDeg = (gmst + OBS_LON_DEG) % 360
  if (lstDeg < 0) lstDeg += 360
  let hourAngleDeg = (lstDeg - raDeg) % 360
  if (hourAngleDeg < 0) hourAngleDeg += 360

  const latRad = degToRad(OBS_LAT_DEG)
  const decRad = degToRad(decDeg)
  const haRad = degToRad(hourAngleDeg > 180 ? hourAngleDeg - 360 : hourAngleDeg)
  const sinAlt =
    Math.sin(decRad) * Math.sin(latRad) +
    Math.cos(decRad) * Math.cos(latRad) * Math.cos(haRad)
  const clamped = Math.max(-1, Math.min(1, sinAlt))
  return radToDeg(Math.asin(clamped))
}

function firstAltitudeAllowedTimeMs(raHours: number, decDeg: number, startMs: number, endMs: number): number | null {
  const STEP_MS = 5 * 60 * 1000
  for (let t = startMs; t <= endMs; t += STEP_MS) {
    if (currentAltitudeDegAt(raHours, decDeg, new Date(t)) >= 30) return t
  }
  return null
}

function altitudeAllowedCoverageMsForInterval(
  raHours: number,
  decDeg: number,
  startMs: number,
  endMs: number,
  minAltitudeDeg = 30
): number {
  if (endMs <= startMs) return 0
  const STEP_MS = 5 * 60 * 1000
  let covered = 0
  for (let t = startMs; t < endMs; t += STEP_MS) {
    const segEnd = Math.min(t + STEP_MS, endMs)
    const mid = t + (segEnd - t) / 2
    if (currentAltitudeDegAt(raHours, decDeg, new Date(mid)) >= minAltitudeDeg) {
      covered += segEnd - t
    }
  }
  return covered
}

export default function RemotePage() {
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [submitSuccess, setSubmitSuccess] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [status, setStatus] = useState<ObservatoryStatus>('loading')
  const [tonightWeatherPrediction, setTonightWeatherPrediction] = useState<
    'permitted' | 'not_permitted' | 'unavailable' | 'loading'
  >('loading')
  const [readyWeatherHourKeys, setReadyWeatherHourKeys] = useState<string[]>([])
  const [nightWeatherHourKeys, setNightWeatherHourKeys] = useState<string[]>([])
  const [notPermittedReasonByHourKey, setNotPermittedReasonByHourKey] = useState<
    Record<string, Array<'cloud' | 'rain' | 'wind'>>
  >({})
  const [scheduleNowMs, setScheduleNowMs] = useState(() => Date.now())
  const [hasAnyPrecipitationTonight, setHasAnyPrecipitationTonight] = useState(false)
  const [adminClosedWindows, setAdminClosedWindows] = useState<
    Array<{ id: string; startIso: string; endIso: string; description?: string }>
  >([])
  const [statusLoadError, setStatusLoadError] = useState<string | null>(null)
  const [showClosedModal, setShowClosedModal] = useState(false)
  const [showAltitudeModal, setShowAltitudeModal] = useState(false)
  const [lastComputedAltitude, setLastComputedAltitude] = useState<number | null>(null)
  const [queueItems, setQueueItems] = useState<
    Array<{
      id: string
      target: string
      createdAt: string
      status: string
      firstName?: string | null
      lastName?: string | null
      email?: string | null
      raHours?: number | null
      decDeg?: number | null
      filter?: string | null
      exposureSeconds?: number
      count?: number
      outputMode?: 'raw_zip' | 'stacked_master' | 'none'
      estimatedDurationSeconds?: number
      filterPlans?: Array<{ filterName: string; exposureSeconds: number; count: number }>
      scheduleStatus?: 'scheduled' | 'unscheduled'
      plannedStartIso?: string | null
      scheduleReasons?: string[]
      hasDownload?: boolean
      downloadPath?: string
      hasPreview?: boolean
      previewPath?: string
      sessionType?: 'dso' | 'variable_star'
    }>
  >([])
  const [lockedSessionSchedule, setLockedSessionSchedule] = useState<Record<string, { startMs: number; endMs: number }>>(
    {}
  )
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [showDeleteModal, setShowDeleteModal] = useState(false)
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null)
  const [deletePassword, setDeletePassword] = useState('')
  const [deleteSubmitting, setDeleteSubmitting] = useState(false)

  const [filterPlans, setFilterPlans] = useState<Array<{ filterName: string; count: string; exposureSeconds: string }>>([])
  const [requestName, setRequestName] = useState('')
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [email, setEmail] = useState('')
  const [raHourPart, setRaHourPart] = useState('')
  const [raMinutePart, setRaMinutePart] = useState('')
  const [raSecondPart, setRaSecondPart] = useState('')
  const [decSign, setDecSign] = useState('+')
  const [decDegreePart, setDecDegreePart] = useState('')
  const [decMinutePart, setDecMinutePart] = useState('')
  const [decSecondPart, setDecSecondPart] = useState('')
  const [sessionPassword, setSessionPassword] = useState('')
  const [outputMode, setOutputMode] = useState<'raw_zip' | 'stacked_master' | 'none'>('raw_zip')
  const [sessionPasswords, setSessionPasswords] = useState<Record<string, string>>({})
  const [catalogQuery, setCatalogQuery] = useState('')
  const [catalogLookupLoading, setCatalogLookupLoading] = useState(false)
  const [catalogLookupError, setCatalogLookupError] = useState<string | null>(null)
  const [catalogLookupResult, setCatalogLookupResult] = useState<ResolvedCatalogObject | null>(null)
  const [sessionType, setSessionType] = useState<ImagingSessionTypeUi>('dso')
  const [variableStarCatalog, setVariableStarCatalog] = useState<VariableStarRow[]>([])
  const [variableStarCatalogLoading, setVariableStarCatalogLoading] = useState(false)
  const [variableStarCatalogError, setVariableStarCatalogError] = useState<string | null>(null)
  const [variableStarPreviewStar, setVariableStarPreviewStar] = useState<VariableStarChartStar | null>(null)
  const [variableStarLastFoundName, setVariableStarLastFoundName] = useState<string | null>(null)
  const [variableStarLastFoundSource, setVariableStarLastFoundSource] = useState<VariableStarLookupSource | null>(null)
  const [variableStarSimbadSearching, setVariableStarSimbadSearching] = useState(false)
  const [variableStarListSelection, setVariableStarListSelection] = useState('')
  const [variableStarFilterSelection, setVariableStarFilterSelection] = useState<VariableStarFilterUi[]>([])
  const [variableStarFilterDropdownOpen, setVariableStarFilterDropdownOpen] = useState(false)
  const variableStarFilterDropdownRef = useRef<HTMLDivElement>(null)

  const [editingSessionId, setEditingSessionId] = useState<string | null>(null)
  const [terminalSessionId, setTerminalSessionId] = useState<string | null>(null)
  const [terminalLines, setTerminalLines] = useState<SessionProgressLine[]>([])
  const [terminalQueueStatus, setTerminalQueueStatus] = useState<string | null>(null)
  const [terminalLoading, setTerminalLoading] = useState(false)
  const [terminalError, setTerminalError] = useState<string | null>(null)
  const [terminalPreviewUrl, setTerminalPreviewUrl] = useState<string | null>(null)
  const [terminalPreviewError, setTerminalPreviewError] = useState<string | null>(null)
  const [terminalPreviewUpdatedAt, setTerminalPreviewUpdatedAt] = useState<string | null>(null)
  const terminalPreviewUpdatedAtRef = useRef<string | null>(null)
  const terminalEndRef = useRef<HTMLDivElement>(null)
  const [authModalSessionId, setAuthModalSessionId] = useState<string | null>(null)
  const [authModalAction, setAuthModalAction] = useState<'progress' | 'download' | 'edit' | null>(null)
  const [authPassword, setAuthPassword] = useState('')
  const [authError, setAuthError] = useState<string | null>(null)
  const [authSubmitting, setAuthSubmitting] = useState(false)

  const sortedVariableStars = useMemo(
    () =>
      [...variableStarCatalog].sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
      ),
    [variableStarCatalog]
  )
  const displayedVariableStars = useMemo(() => {
    const selected = new Set(variableStarFilterSelection)
    if (selected.size === 0) return sortedVariableStars

    const hasShortPeriod = selected.has('short_period')
    const hasMidPeriod = selected.has('mid_period')
    const hasLongPeriod = selected.has('long_period')
    const hasAnyPeriodFilter = hasShortPeriod || hasMidPeriod || hasLongPeriod
    const wantsTonightObservable = selected.has('tonight_observable')

    let filtered = sortedVariableStars
    if (selected.has('high_priority')) {
      filtered = filtered.filter((s) => s.highPriority)
    }

    // Period filters are OR within the period group, then AND with other groups.
    if (hasAnyPeriodFilter) {
      filtered = filtered.filter((s) => {
        const p = s.periodDays
        if (p == null) return false
        if (hasShortPeriod && p < 1) return true
        if (hasMidPeriod && p >= 1 && p < 100) return true
        if (hasLongPeriod && p >= 100) return true
        return false
      })
    }

    if (!wantsTonightObservable && !hasAnyPeriodFilter) return filtered

    const { astronomicalDuskUtc, astronomicalDawnUtc } = getTonightAstronomicalNightWindow(new Date())
    const startMs = astronomicalDuskUtc.getTime()
    const endMs = astronomicalDawnUtc.getTime()
    const withCoverage = filtered
      .map((s) => ({
        star: s,
        coverageMs: altitudeAllowedCoverageMsForInterval(
          s.raHours,
          s.decDeg,
          startMs,
          endMs,
          MIN_ALTITUDE_DEG
        ),
      }))
      .sort((a, b) => b.coverageMs - a.coverageMs || a.star.name.localeCompare(b.star.name))

    if (wantsTonightObservable) {
      return withCoverage
        .filter((x) => x.coverageMs >= TONIGHT_OBSERVABLE_MIN_COVERAGE_MS)
        .map((x) => x.star)
    }

    return withCoverage.map((x) => x.star)
  }, [sortedVariableStars, variableStarFilterSelection])

  const variableStarFilterKey = useMemo(
    () => [...variableStarFilterSelection].sort().join('|'),
    [variableStarFilterSelection]
  )

  useEffect(() => {
    setVariableStarListSelection('')
  }, [variableStarFilterKey])

  useEffect(() => {
    if (!variableStarListSelection) return
    const stillVisible = displayedVariableStars.some((s) => s.name === variableStarListSelection)
    if (stillVisible) return
    setVariableStarListSelection('')
  }, [displayedVariableStars, variableStarListSelection])

  useEffect(() => {
    let mounted = true
    const loadStatus = async () => {
      const res = await fetch('/api/imaging/observatory-status')
      const data = await res.json().catch(() => ({}))
      if (!mounted) return
      if (
        res.ok &&
        (data.status === 'ready' ||
          data.status === 'busy_in_use' ||
          data.status === 'closed_weather_not_permitted' ||
          data.status === 'closed_daytime' ||
          data.status === 'closed_observatory_maintenance')
      ) {
        setStatus(data.status)
      } else {
        setStatusLoadError('Unable to load observatory status.')
      }
    }

    void loadStatus()
    const intervalId = window.setInterval(() => {
      void loadStatus()
    }, STATUS_POLL_MS)

    return () => {
      mounted = false
      window.clearInterval(intervalId)
    }
  }, [])

  useEffect(() => {
    let mounted = true
    const loadAdminWindows = async () => {
      try {
        const res = await fetch('/api/imaging/schedule-control')
        const data = await res.json().catch(() => ({}))
        if (!mounted) return
        if (res.ok && data?.ok === true && Array.isArray(data.windows)) {
          const normalized = data.windows
            .filter((w: unknown) => w && typeof w === 'object')
            .map((w: unknown) => {
              const rec = w as Record<string, unknown>
              return {
                id: typeof rec.id === 'string' ? rec.id : '',
                startIso: typeof rec.startIso === 'string' ? rec.startIso : '',
                endIso: typeof rec.endIso === 'string' ? rec.endIso : '',
                description: typeof rec.description === 'string' ? rec.description : undefined,
              }
            })
            .filter((w: { id: string; startIso: string; endIso: string }) => w.id && w.startIso && w.endIso)
          setAdminClosedWindows(normalized)
        } else {
          setAdminClosedWindows([])
        }
      } catch {
        if (!mounted) return
        setAdminClosedWindows([])
      }
    }
    void loadAdminWindows()
    const intervalId = window.setInterval(() => {
      void loadAdminWindows()
    }, 60 * 1000)
    return () => {
      mounted = false
      window.clearInterval(intervalId)
    }
  }, [])

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setScheduleNowMs(Date.now())
    }, 60 * 1000)
    return () => window.clearInterval(intervalId)
  }, [])

  useEffect(() => {
    setVariableStarListSelection('')
    if (sessionType === 'dso') {
      setVariableStarPreviewStar(null)
      setVariableStarLastFoundName(null)
      setVariableStarFilterSelection([])
      setVariableStarFilterDropdownOpen(false)
    } else {
      setCatalogLookupResult(null)
      setCatalogLookupError(null)
    }
  }, [sessionType])

  useEffect(() => {
    if (!variableStarFilterDropdownOpen) return
    const handlePointerDown = (event: MouseEvent) => {
      const root = variableStarFilterDropdownRef.current
      if (!root) return
      if (root.contains(event.target as Node)) return
      setVariableStarFilterDropdownOpen(false)
    }
    document.addEventListener('mousedown', handlePointerDown)
    return () => document.removeEventListener('mousedown', handlePointerDown)
  }, [variableStarFilterDropdownOpen])

  useEffect(() => {
    if (sessionType !== 'variable_star') return
    let cancelled = false
    setVariableStarCatalogLoading(true)
    setVariableStarCatalogError(null)
    void (async () => {
      try {
        const res = await fetch('/api/imaging/variable-stars')
        const data = await res.json().catch(() => ({}))
        if (cancelled) return
        if (!res.ok || data?.ok !== true || !Array.isArray(data.stars)) {
          setVariableStarCatalog([])
          setVariableStarCatalogError(
            typeof data.error === 'string' ? data.error : 'Failed to load variable star catalog.'
          )
          return
        }
        setVariableStarCatalog(data.stars as VariableStarRow[])
      } catch {
        if (!cancelled) {
          setVariableStarCatalog([])
          setVariableStarCatalogError('Failed to load variable star catalog.')
        }
      } finally {
        if (!cancelled) setVariableStarCatalogLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [sessionType])

  useEffect(() => {
    let mounted = true
    const loadPrediction = async () => {
      const now = new Date()
      const nowUtcMidnight = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()))
      const todaySunrise = solarEventUtcForDate(nowUtcMidnight, 90.833, true)
      const scheduleStart = new Date(now)
      scheduleStart.setHours(16, 0, 0, 0)
      if (now.getTime() < todaySunrise.getTime()) {
        scheduleStart.setDate(scheduleStart.getDate() - 1)
      }
      const scheduleEnd = new Date(scheduleStart)
      scheduleEnd.setDate(scheduleEnd.getDate() + 1)
      scheduleEnd.setHours(8, 0, 0, 0)
      const scheduleStartSec = Math.floor(scheduleStart.getTime() / 1000)
      const scheduleEndSec = Math.floor(scheduleEnd.getTime() / 1000)

      try {
        const res = await fetch(
          `/api/imaging/tonight-weather-prediction?startSec=${scheduleStartSec}&endSec=${scheduleEndSec}`
        )
        const data = await res.json().catch(() => ({}))
        if (!mounted) return
        if (
          res.ok &&
          data?.ok === true &&
          (data.prediction === 'permitted' ||
            data.prediction === 'not_permitted' ||
            data.prediction === 'unavailable')
        ) {
          setTonightWeatherPrediction(data.prediction)
          setHasAnyPrecipitationTonight(data.hasAnyPrecipitationTonight === true)
          if (Array.isArray(data.readyHourStartsSec)) {
            const keys = data.readyHourStartsSec
              .filter((v: unknown) => typeof v === 'number' && Number.isFinite(v))
              .map((sec: number) => buildHourKey(new Date(sec * 1000)))
            const nowForMerge = new Date()
            setReadyWeatherHourKeys((prev) => mergeWithFrozenPastHours(prev, keys, nowForMerge))
          } else {
            const nowForMerge = new Date()
            setReadyWeatherHourKeys((prev) => mergeWithFrozenPastHours(prev, [], nowForMerge))
          }
          if (Array.isArray(data.notPermittedHourReasons)) {
            const mapped: Record<string, Array<'cloud' | 'rain' | 'wind'>> = {}
            for (const row of data.notPermittedHourReasons) {
              if (!row || typeof row !== 'object') continue
              const hourStartSec =
                typeof (row as { hourStartSec?: unknown }).hourStartSec === 'number'
                  ? (row as { hourStartSec: number }).hourStartSec
                  : null
              const reasonsRaw = (row as { reasons?: unknown }).reasons
              if (hourStartSec == null || !Array.isArray(reasonsRaw)) continue
              const reasons = reasonsRaw.filter(
                (r): r is 'cloud' | 'rain' | 'wind' => r === 'cloud' || r === 'rain' || r === 'wind'
              )
              if (reasons.length === 0) continue
              mapped[buildHourKey(new Date(hourStartSec * 1000))] = reasons
            }
            setNotPermittedReasonByHourKey(mapped)
          } else {
            setNotPermittedReasonByHourKey({})
          }
          if (Array.isArray(data.nightHourStartsSec)) {
            const keys = data.nightHourStartsSec
              .filter((v: unknown) => typeof v === 'number' && Number.isFinite(v))
              .map((sec: number) => buildHourKey(new Date(sec * 1000)))
            const nowForMerge = new Date()
            setNightWeatherHourKeys((prev) => mergeWithFrozenPastHours(prev, keys, nowForMerge))
          } else {
            const nowForMerge = new Date()
            setNightWeatherHourKeys((prev) => mergeWithFrozenPastHours(prev, [], nowForMerge))
          }
          return
        }
        setTonightWeatherPrediction('not_permitted')
        setHasAnyPrecipitationTonight(false)
        setNotPermittedReasonByHourKey({})
        const nowForMerge = new Date()
        setReadyWeatherHourKeys((prev) => mergeWithFrozenPastHours(prev, [], nowForMerge))
        setNightWeatherHourKeys((prev) => mergeWithFrozenPastHours(prev, [], nowForMerge))
      } catch {
        if (!mounted) return
        setTonightWeatherPrediction('not_permitted')
        setHasAnyPrecipitationTonight(false)
        setNotPermittedReasonByHourKey({})
        const nowForMerge = new Date()
        setReadyWeatherHourKeys((prev) => mergeWithFrozenPastHours(prev, [], nowForMerge))
        setNightWeatherHourKeys((prev) => mergeWithFrozenPastHours(prev, [], nowForMerge))
      }
    }

    void loadPrediction()
    const intervalId = window.setInterval(() => {
      void loadPrediction()
    }, 10 * 60 * 1000)

    return () => {
      mounted = false
      window.clearInterval(intervalId)
    }
  }, [])

  const refreshQueue = useCallback(async () => {
    const res = await fetch('/api/imaging/current-sessions')
    const data = await res.json().catch(() => ({}))
    if (res.ok && data?.ok && Array.isArray(data.sessions)) {
      const items = data.sessions as Array<{
        id?: unknown
        target?: unknown
        createdAt?: unknown
        status?: unknown
        firstName?: unknown
        lastName?: unknown
        email?: unknown
        raHours?: unknown
        decDeg?: unknown
        outputMode?: unknown
        sessionType?: unknown
        estimatedDurationSeconds?: unknown
        filterPlans?: unknown
        scheduleStatus?: unknown
        plannedStartIso?: unknown
        scheduleReasons?: unknown
        hasDownload?: unknown
        downloadPath?: unknown
        hasPreview?: unknown
        previewPath?: unknown
      }>
      const normalized = items
        .filter((x) => typeof x.id === 'string')
        .map((x) => {
          const sessionType: 'dso' | 'variable_star' = x.sessionType === 'variable_star' ? 'variable_star' : 'dso'
          return {
            id: String(x.id),
            target: typeof x.target === 'string' ? x.target : 'Unknown target',
            createdAt: typeof x.createdAt === 'string' ? x.createdAt : new Date().toISOString(),
            status: typeof x.status === 'string' ? x.status : 'pending',
            firstName: typeof x.firstName === 'string' ? x.firstName : null,
            lastName: typeof x.lastName === 'string' ? x.lastName : null,
            email: typeof x.email === 'string' ? x.email : null,
            raHours:
              typeof x.raHours === 'number' && Number.isFinite(x.raHours) ? x.raHours : null,
            decDeg:
              typeof x.decDeg === 'number' && Number.isFinite(x.decDeg) ? x.decDeg : null,
            outputMode: (() => {
              if (x.outputMode === 'raw_zip' || x.outputMode === 'stacked_master' || x.outputMode === 'none') {
                return x.outputMode as 'raw_zip' | 'stacked_master' | 'none'
              }
              return undefined
            })(),
            sessionType,
            estimatedDurationSeconds:
              typeof x.estimatedDurationSeconds === 'number' && Number.isFinite(x.estimatedDurationSeconds)
                ? x.estimatedDurationSeconds
                : undefined,
            scheduleStatus:
              x.scheduleStatus === 'scheduled' || x.scheduleStatus === 'unscheduled'
                ? (x.scheduleStatus as 'scheduled' | 'unscheduled')
                : undefined,
            plannedStartIso: typeof x.plannedStartIso === 'string' ? x.plannedStartIso : null,
            scheduleReasons: Array.isArray(x.scheduleReasons)
              ? x.scheduleReasons.filter((r): r is string => typeof r === 'string')
              : undefined,
            filterPlans: Array.isArray(x.filterPlans)
              ? x.filterPlans
                  .map((p) => {
                    if (!p || typeof p !== 'object') return null
                    const rec = p as Record<string, unknown>
                    const filterName = typeof rec.filterName === 'string' ? rec.filterName : ''
                    const exposureSeconds = Number(rec.exposureSeconds)
                    const count = Number(rec.count)
                    if (!filterName || !Number.isFinite(exposureSeconds) || !Number.isFinite(count)) return null
                    return { filterName, exposureSeconds, count }
                  })
                  .filter((p): p is { filterName: string; exposureSeconds: number; count: number } => p !== null)
              : undefined,
            hasDownload: x.hasDownload === true,
            downloadPath: typeof x.downloadPath === 'string' ? x.downloadPath : undefined,
            hasPreview: x.hasPreview === true,
            previewPath: typeof x.previewPath === 'string' ? x.previewPath : undefined,
          }
        })
      setQueueItems(normalized)
    } else {
      setQueueItems([])
    }
  }, [])

  useEffect(() => {
    void refreshQueue()
  }, [refreshQueue])

  const sessionListNeedsLivePoll = useMemo(
    () =>
      queueItems.some(
        (i) =>
          i.status === 'pending' ||
          i.status === 'in_progress' ||
          (i.status === 'completed' && i.hasDownload !== true)
      ),
    [queueItems]
  )

  const tonightSchedule = useMemo(() => {
    const now = new Date(scheduleNowMs)
    const nowUtcMidnight = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()))
    const todaySunrise = solarEventUtcForDate(nowUtcMidnight, 90.833, true)
    const start = new Date(now)
    start.setHours(16, 0, 0, 0)
    // Switch to "new tonight" as soon as current time passes local sunrise.
    if (now.getTime() < todaySunrise.getTime()) {
      start.setDate(start.getDate() - 1)
    }
    const end = new Date(start)
    end.setDate(end.getDate() + 1)
    end.setHours(8, 0, 0, 0)

    const points: Array<{ label: string; hourKey: string; hourStartMs: number }> = []
    const cursor = new Date(start)
    while (cursor <= end) {
      points.push({
        label: cursor.toLocaleTimeString([], { hour: 'numeric' }),
        hourKey: buildHourKey(cursor),
        hourStartMs: cursor.getTime(),
      })
      cursor.setHours(cursor.getHours() + 1)
    }

    const baseUtc = new Date(Date.UTC(start.getFullYear(), start.getMonth(), start.getDate()))
    const nextUtc = new Date(Date.UTC(end.getFullYear(), end.getMonth(), end.getDate()))
    const sunset = solarEventUtcForDate(baseUtc, 90.833, false)
    const civilDusk = solarEventUtcForDate(baseUtc, 96, false)
    const nauticalDusk = solarEventUtcForDate(baseUtc, 102, false)
    const astronomicalDark = solarEventUtcForDate(baseUtc, 108, false)
    const astronomicalDawn = solarEventUtcForDate(nextUtc, 108, true)
    const nauticalDawn = solarEventUtcForDate(nextUtc, 102, true)
    const civilDawn = solarEventUtcForDate(nextUtc, 96, true)
    const sunrise = solarEventUtcForDate(nextUtc, 90.833, true)

    const eventBlocks = [
      { label: 'Sunset', startTime: sunset },
      { label: 'Civil Dusk', startTime: civilDusk },
      { label: 'Nautical Dusk', startTime: nauticalDusk },
      { label: 'Astronomical Dark', startTime: astronomicalDark },
      { label: 'Astronomical Dawn', startTime: astronomicalDawn },
      { label: 'Nautical Dawn', startTime: nauticalDawn },
      { label: 'Civil Dawn', startTime: civilDawn },
      { label: 'Sunrise', startTime: sunrise },
    ]
      .filter((m) => m.startTime >= start && m.startTime <= end)
      .sort((a, b) => a.startTime.getTime() - b.startTime.getTime())
      .map((m) => ({
        ...m,
        topPct: ((m.startTime.getTime() - start.getTime()) / (end.getTime() - start.getTime())) * 100,
      }))

    const nowInWindow = now.getTime() >= start.getTime() && now.getTime() <= end.getTime()
    const nowTopPct = nowInWindow
      ? ((now.getTime() - start.getTime()) / (end.getTime() - start.getTime())) * 100
      : null

    const adminClosedBlocks = adminClosedWindows
      .map((w) => {
        const startMs = Date.parse(w.startIso)
        const endMs = Date.parse(w.endIso)
        if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return null
        const overlapStart = Math.max(start.getTime(), startMs)
        const overlapEnd = Math.min(end.getTime(), endMs)
        if (overlapEnd <= overlapStart) return null
        const topPct = ((overlapStart - start.getTime()) / (end.getTime() - start.getTime())) * 100
        const heightPct = ((overlapEnd - overlapStart) / (end.getTime() - start.getTime())) * 100
        const label =
          typeof w.description === 'string' && w.description.trim()
            ? w.description.trim()
            : 'Closed window'
        return { id: w.id, topPct, heightPct, label }
      })
      .filter((x): x is { id: string; topPct: number; heightPct: number; label: string } => x != null)

    return { start, end, hours: points, eventBlocks, adminClosedBlocks, nowTopPct, nauticalDawn, nauticalDusk, astronomicalDawn }
  }, [scheduleNowMs, adminClosedWindows])

  const weatherBlocks = useMemo(() => {
    const effectiveNightHourKeys =
      nightWeatherHourKeys.length > 0
        ? nightWeatherHourKeys
        : tonightWeatherPrediction === 'not_permitted'
          ? tonightSchedule.hours.map((h) => h.hourKey)
          : []

    if (effectiveNightHourKeys.length === 0) {
      return [] as Array<{
        topPct: number
        heightPct: number
        kind: 'permitted' | 'not_permitted'
        reasons: Array<'cloud' | 'rain' | 'wind'>
      }>
    }
    const readyKeySet = new Set(readyWeatherHourKeys)
    const nightKeySet = new Set(effectiveNightHourKeys)
    const blocks: Array<{
      topPct: number
      heightPct: number
      kind: 'permitted' | 'not_permitted'
      reasons: Array<'cloud' | 'rain' | 'wind'>
    }> = []
    let runStartMs: number | null = null
    let runEndMsExclusive: number | null = null
    let runKind: 'permitted' | 'not_permitted' | null = null
    let runReasons = new Set<'cloud' | 'rain' | 'wind'>()

    for (const slot of tonightSchedule.hours) {
      if (!nightKeySet.has(slot.hourKey)) {
        if (runStartMs != null && runEndMsExclusive != null && runKind) {
          const clampedEnd = Math.min(runEndMsExclusive, tonightSchedule.end.getTime())
          const topPct =
            ((runStartMs - tonightSchedule.start.getTime()) /
              (tonightSchedule.end.getTime() - tonightSchedule.start.getTime())) *
            100
          const heightPct =
            ((clampedEnd - runStartMs) / (tonightSchedule.end.getTime() - tonightSchedule.start.getTime())) * 100
          if (heightPct > 0) blocks.push({ topPct, heightPct, kind: runKind, reasons: Array.from(runReasons) })
        }
        runStartMs = null
        runEndMsExclusive = null
        runKind = null
        runReasons = new Set<'cloud' | 'rain' | 'wind'>()
        continue
      }

      const kind: 'permitted' | 'not_permitted' = readyKeySet.has(slot.hourKey) ? 'permitted' : 'not_permitted'
      const reasonsForHour = kind === 'not_permitted' ? (notPermittedReasonByHourKey[slot.hourKey] ?? []) : []
      if (runStartMs == null) {
        if (runStartMs == null) runStartMs = slot.hourStartMs
        runEndMsExclusive = slot.hourStartMs + 60 * 60 * 1000
        runKind = kind
        runReasons = new Set<'cloud' | 'rain' | 'wind'>(reasonsForHour)
      } else if (runKind === kind) {
        runEndMsExclusive = slot.hourStartMs + 60 * 60 * 1000
        for (const reason of reasonsForHour) runReasons.add(reason)
      } else if (runEndMsExclusive != null && runKind) {
        const clampedEnd = Math.min(runEndMsExclusive, tonightSchedule.end.getTime())
        const topPct =
          ((runStartMs - tonightSchedule.start.getTime()) /
            (tonightSchedule.end.getTime() - tonightSchedule.start.getTime())) *
          100
        const heightPct = ((clampedEnd - runStartMs) / (tonightSchedule.end.getTime() - tonightSchedule.start.getTime())) * 100
        if (heightPct > 0) blocks.push({ topPct, heightPct, kind: runKind, reasons: Array.from(runReasons) })
        runStartMs = slot.hourStartMs
        runEndMsExclusive = slot.hourStartMs + 60 * 60 * 1000
        runKind = kind
        runReasons = new Set<'cloud' | 'rain' | 'wind'>(reasonsForHour)
      }
    }

    if (runStartMs != null && runEndMsExclusive != null && runKind) {
      const clampedEnd = Math.min(runEndMsExclusive, tonightSchedule.end.getTime())
      const topPct =
        ((runStartMs - tonightSchedule.start.getTime()) / (tonightSchedule.end.getTime() - tonightSchedule.start.getTime())) *
        100
      const heightPct = ((clampedEnd - runStartMs) / (tonightSchedule.end.getTime() - tonightSchedule.start.getTime())) * 100
      if (heightPct > 0) blocks.push({ topPct, heightPct, kind: runKind, reasons: Array.from(runReasons) })
    }

    return blocks
  }, [readyWeatherHourKeys, nightWeatherHourKeys, tonightSchedule, tonightWeatherPrediction, notPermittedReasonByHourKey])

  const sessionSchedulePlan = useMemo(() => {
    if (tonightWeatherPrediction === 'not_permitted' || hasAnyPrecipitationTonight) {
      return {
        blocks: [] as Array<{ id: string; startMs: number; endMs: number; topPct: number; heightPct: number; label: string }>,
        newlyLocked: {} as Record<string, { startMs: number; endMs: number }>,
      }
    }

    const windowStartMs = tonightSchedule.start.getTime()
    const windowEndMs = tonightSchedule.end.getTime()
    const schedulingDeadlineMs = Math.min(windowEndMs, tonightSchedule.astronomicalDawn.getTime())
    const nauticalDuskMs = tonightSchedule.nauticalDusk.getTime()
    const readyHourKeySet = new Set(readyWeatherHourKeys)
    const readyHourStartsMs = tonightSchedule.hours
      .filter((h) => readyWeatherHourKeys.includes(h.hourKey))
      .map((h) => h.hourStartMs)
      .sort((a, b) => a - b)

    const blocks: Array<{ id: string; startMs: number; endMs: number; topPct: number; heightPct: number; label: string }> = []
    type Interval = { startMs: number; endMs: number }
    let freeIntervals: Interval[] = [{ startMs: Math.max(windowStartMs, nauticalDuskMs), endMs: schedulingDeadlineMs }]
    const adminClosedIntervals = adminClosedWindows
      .map((w) => {
        const startMs = Date.parse(w.startIso)
        const endMs = Date.parse(w.endIso)
        if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return null
        const overlapStart = Math.max(startMs, windowStartMs)
        const overlapEnd = Math.min(endMs, schedulingDeadlineMs)
        if (overlapEnd <= overlapStart) return null
        return { startMs: overlapStart, endMs: overlapEnd }
      })
      .filter((x): x is { startMs: number; endMs: number } => x != null)
    const isPermittedAtMs = (ms: number): boolean => {
      if (readyHourKeySet.size === 0) return true
      return readyHourKeySet.has(buildHourKey(new Date(ms)))
    }
    const nextPermittedStartAtOrAfter = (ms: number): number | null => {
      if (readyHourStartsMs.length === 0) return ms
      const atOrAfter = readyHourStartsMs.find((start) => start >= ms)
      return atOrAfter ?? null
    }
    const permittedCoverageMs = (startMs: number, endMs: number): number => {
      if (readyHourKeySet.size === 0) return Math.max(0, endMs - startMs)
      if (endMs <= startMs) return 0

      let covered = 0
      const cursor = new Date(startMs)
      cursor.setMinutes(0, 0, 0)
      while (cursor.getTime() < endMs) {
        const hourStart = cursor.getTime()
        const hourEnd = hourStart + 60 * 60 * 1000
        const overlapStart = Math.max(startMs, hourStart)
        const overlapEnd = Math.min(endMs, hourEnd)
        if (overlapEnd > overlapStart && readyHourKeySet.has(buildHourKey(cursor))) {
          covered += overlapEnd - overlapStart
        }
        cursor.setHours(cursor.getHours() + 1)
      }
      return covered
    }

    const subtractInterval = (source: Interval[], occupied: Interval): Interval[] => {
      const next: Interval[] = []
      for (const interval of source) {
        if (occupied.endMs <= interval.startMs || occupied.startMs >= interval.endMs) {
          next.push(interval)
          continue
        }
        if (occupied.startMs > interval.startMs) {
          next.push({ startMs: interval.startMs, endMs: occupied.startMs })
        }
        if (occupied.endMs < interval.endMs) {
          next.push({ startMs: occupied.endMs, endMs: interval.endMs })
        }
      }
      return next
        .filter((x) => x.endMs - x.startMs > 0)
        .sort((a, b) => a.startMs - b.startMs)
    }
    if (adminClosedIntervals.length > 0) {
      for (const c of adminClosedIntervals) {
        freeIntervals = subtractInterval(freeIntervals, c)
      }
    }

    const placeInFreeIntervals = (
      item: (typeof queueItems)[number],
      minStartMs: number
    ): { startMs: number; endMs: number } | null => {
      const createdMs = Number.isFinite(Date.parse(item.createdAt)) ? Date.parse(item.createdAt) : windowStartMs
      const estimatedSeconds =
        typeof item.estimatedDurationSeconds === 'number' && Number.isFinite(item.estimatedDurationSeconds)
          ? item.estimatedDurationSeconds
          : estimateDurationSecondsFromPlans(item.filterPlans)
      const durationMs = Math.max(estimatedSeconds, 60) * 1000

      for (const interval of freeIntervals) {
        if (interval.endMs <= interval.startMs) continue
        let startMs = Math.max(interval.startMs, createdMs, nauticalDuskMs, minStartMs)

        // Anchor to altitude rise when available (time indicator, not only boolean gate).
        if (
          typeof item.raHours === 'number' &&
          Number.isFinite(item.raHours) &&
          typeof item.decDeg === 'number' &&
          Number.isFinite(item.decDeg) &&
          currentAltitudeDegAt(item.raHours, item.decDeg, new Date(startMs)) < 30
        ) {
          const riseStartMs = firstAltitudeAllowedTimeMs(item.raHours, item.decDeg, startMs, interval.endMs)
          if (riseStartMs == null) continue
          startMs = riseStartMs
        }

        if (!isPermittedAtMs(startMs)) {
          const permittedStart = nextPermittedStartAtOrAfter(startMs)
          if (permittedStart == null || permittedStart >= interval.endMs) continue
          startMs = permittedStart
        }

        const endMs = startMs + durationMs
        if (endMs > interval.endMs || endMs > schedulingDeadlineMs) continue

        if (permittedCoverageMs(startMs, endMs) < durationMs * 0.8) continue
        if (
          typeof item.raHours === 'number' &&
          Number.isFinite(item.raHours) &&
          typeof item.decDeg === 'number' &&
          Number.isFinite(item.decDeg)
        ) {
          const altitudeCoveredMs = altitudeAllowedCoverageMsForInterval(item.raHours, item.decDeg, startMs, endMs)
          if (altitudeCoveredMs < durationMs * 0.8) continue
        }

        return { startMs, endMs }
      }

      return null
    }

    const newlyLocked: Record<string, { startMs: number; endMs: number }> = {}
    const lockable = queueItems
      .filter((item) => item.status === 'in_progress' || item.status === 'completed')
      .filter((item) => {
        if (lockedSessionSchedule[item.id]) return true
        const createdMs = Date.parse(item.createdAt)
        if (!Number.isFinite(createdMs)) return false
        return createdMs >= windowStartMs && createdMs < windowEndMs
      })
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))

    for (const item of lockable) {
      let placed = lockedSessionSchedule[item.id]
      if (!placed) {
        const computed = placeInFreeIntervals(item, Math.max(windowStartMs, nauticalDuskMs))
        if (!computed) continue
        placed = computed
        newlyLocked[item.id] = placed
      }

      const startMs = Math.max(placed.startMs, windowStartMs)
      const endMs = Math.min(placed.endMs, schedulingDeadlineMs)
      if (endMs <= startMs) continue

      freeIntervals = subtractInterval(freeIntervals, { startMs, endMs })

      const topPct = ((startMs - windowStartMs) / (windowEndMs - windowStartMs)) * 100
      const heightPct = ((endMs - startMs) / (windowEndMs - windowStartMs)) * 100
      blocks.push({ id: item.id, startMs, endMs, topPct, heightPct, label: item.target })
    }

    const scheduledPending = queueItems
      .filter((item) => item.status === 'pending' && item.scheduleStatus === 'scheduled')
      .map((item) => {
        const startMsRaw = item.plannedStartIso ? Date.parse(item.plannedStartIso) : Number.NaN
        if (!Number.isFinite(startMsRaw)) return null
        const estimatedSeconds =
          typeof item.estimatedDurationSeconds === 'number' && Number.isFinite(item.estimatedDurationSeconds)
            ? item.estimatedDurationSeconds
            : estimateDurationSecondsFromPlans(item.filterPlans)
        const durationMs = Math.max(estimatedSeconds, 60) * 1000
        const startMs = Math.max(startMsRaw, windowStartMs)
        const endMs = Math.min(startMs + durationMs, schedulingDeadlineMs)
        if (endMs <= startMs) return null
        return { item, startMs, endMs }
      })
      .filter(
        (x): x is { item: (typeof queueItems)[number]; startMs: number; endMs: number } =>
          x != null
      )
      .sort((a, b) => a.startMs - b.startMs)

    for (const scheduled of scheduledPending) {
      freeIntervals = subtractInterval(freeIntervals, {
        startMs: scheduled.startMs,
        endMs: scheduled.endMs,
      })
      const topPct = ((scheduled.startMs - windowStartMs) / (windowEndMs - windowStartMs)) * 100
      const heightPct = ((scheduled.endMs - scheduled.startMs) / (windowEndMs - windowStartMs)) * 100
      blocks.push({
        id: scheduled.item.id,
        startMs: scheduled.startMs,
        endMs: scheduled.endMs,
        topPct,
        heightPct,
        label: scheduled.item.target,
      })
    }

    blocks.sort((a, b) => a.startMs - b.startMs)
    return { blocks, newlyLocked }
  }, [
    queueItems,
    readyWeatherHourKeys,
    tonightSchedule,
    lockedSessionSchedule,
    tonightWeatherPrediction,
    hasAnyPrecipitationTonight,
    adminClosedWindows,
  ])

  useEffect(() => {
    setLockedSessionSchedule((prev) => {
      const activeLockableIds = new Set(
        queueItems.filter((x) => x.status === 'in_progress' || x.status === 'completed').map((x) => x.id)
      )

      const next: Record<string, { startMs: number; endMs: number }> = {}
      let changed = false

      for (const [id, placement] of Object.entries(prev)) {
        if (activeLockableIds.has(id)) {
          next[id] = placement
        } else {
          changed = true
        }
      }

      for (const [id, placement] of Object.entries(sessionSchedulePlan.newlyLocked)) {
        if (!next[id]) {
          next[id] = placement
          changed = true
        }
      }

      return changed ? next : prev
    })
  }, [queueItems, sessionSchedulePlan.newlyLocked])

  const sessionScheduleBlocks = useMemo(() => {
    const baseBlocks = [...sessionSchedulePlan.blocks]
    if (baseBlocks.length === 0) return baseBlocks
    if (!tonightSchedule) return baseBlocks

    const windowStartMs = tonightSchedule.start.getTime()
    const windowEndMs = tonightSchedule.end.getTime()
    if (!Number.isFinite(windowStartMs) || !Number.isFinite(windowEndMs) || windowEndMs <= windowStartMs) {
      return baseBlocks
    }

    const lastEndMs = baseBlocks.reduce((latest, block) => Math.max(latest, block.endMs), windowStartMs)
    const tailStartMs = Math.min(Math.max(lastEndMs, windowStartMs), windowEndMs)
    const tailEndMs = Math.min(tailStartMs + 15 * 60 * 1000, windowEndMs)
    if (tailEndMs <= tailStartMs) return baseBlocks

    const topPct = ((tailStartMs - windowStartMs) / (windowEndMs - windowStartMs)) * 100
    const heightPct = ((tailEndMs - tailStartMs) / (windowEndMs - windowStartMs)) * 100

    baseBlocks.push({
      id: '__end_night_tail__',
      startMs: tailStartMs,
      endMs: tailEndMs,
      topPct,
      heightPct,
      label: 'Close Dome',
    })

    return baseBlocks
  }, [sessionSchedulePlan.blocks, tonightSchedule])
  const terminalSessionDetail = useMemo(
    () => queueItems.find((item) => item.id === terminalSessionId) ?? null,
    [queueItems, terminalSessionId]
  )

  useEffect(() => {
    if (!sessionListNeedsLivePoll) return
    const id = window.setInterval(() => {
      void refreshQueue()
    }, TERMINAL_POLL_MS)
    return () => window.clearInterval(id)
  }, [sessionListNeedsLivePoll, refreshQueue])

  const loadTerminalProgress = useCallback(
    async (id: string, passwordOverride?: string) => {
      const password = passwordOverride ?? sessionPasswords[id] ?? ''
      if (!password) {
        setTerminalError('Session password required.')
        setTerminalLoading(false)
        return
      }
      setTerminalLoading(true)
      setTerminalError(null)
      try {
        const res = await fetch(`/api/imaging/queue/${encodeURIComponent(id)}/progress`, {
          headers: { 'x-session-password': password },
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok || data?.ok !== true) {
          setTerminalError(typeof data.error === 'string' ? data.error : 'Could not load progress.')
          return
        }
        setTerminalLines(Array.isArray(data.lines) ? (data.lines as SessionProgressLine[]) : [])
        const qs = typeof data.queueStatus === 'string' ? data.queueStatus : null
        setTerminalQueueStatus(qs)
        if (qs === 'completed') await refreshQueue()
      } finally {
        setTerminalLoading(false)
      }
    },
    [refreshQueue, sessionPasswords]
  )

  const loadTerminalPreview = useCallback(
    async (id: string, passwordOverride?: string) => {
      const password = passwordOverride ?? sessionPasswords[id] ?? ''
      if (!password) return
      try {
        const res = await fetch(`/api/imaging/preview?queueId=${encodeURIComponent(id)}&mode=json`, {
          headers: { 'x-session-password': password },
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok || data?.ok !== true || typeof data.dataBase64 !== 'string') {
          if (res.status === 404) {
            setTerminalPreviewUrl(null)
            setTerminalPreviewError(null)
            setTerminalPreviewUpdatedAt(null)
            terminalPreviewUpdatedAtRef.current = null
            return
          }
          setTerminalPreviewError(typeof data.error === 'string' ? data.error : 'Preview unavailable.')
          return
        }
        const updatedAt = typeof data.updatedAt === 'string' ? data.updatedAt : null
        if (updatedAt && updatedAt === terminalPreviewUpdatedAtRef.current) {
          setTerminalPreviewError(null)
          return
        }
        const contentType = typeof data.contentType === 'string' ? data.contentType : 'image/jpeg'
        const nextPreviewUrl = `data:${contentType};base64,${data.dataBase64}`
        await new Promise<void>((resolve) => {
          const image = new window.Image()
          image.onload = () => resolve()
          image.onerror = () => resolve()
          image.src = nextPreviewUrl
        })
        setTerminalPreviewError(null)
        setTerminalPreviewUpdatedAt(updatedAt)
        terminalPreviewUpdatedAtRef.current = updatedAt
        setTerminalPreviewUrl(nextPreviewUrl)
      } catch {
        setTerminalPreviewError('Preview unavailable.')
      }
    },
    [sessionPasswords]
  )

  useEffect(() => {
    if (!terminalSessionId) return
    setTerminalLines([])
    setTerminalQueueStatus(null)
    setTerminalError(null)
    setTerminalPreviewUrl(null)
    setTerminalPreviewError(null)
    setTerminalPreviewUpdatedAt(null)
    terminalPreviewUpdatedAtRef.current = null
    void loadTerminalProgress(terminalSessionId, sessionPasswords[terminalSessionId])
    void loadTerminalPreview(terminalSessionId, sessionPasswords[terminalSessionId])
  }, [terminalSessionId, loadTerminalPreview, loadTerminalProgress, sessionPasswords])

  useEffect(() => {
    if (!terminalSessionId) return
    const password = sessionPasswords[terminalSessionId] ?? ''
    if (!password) return

    const params = new URLSearchParams({ password })
    const streamUrl = `/api/imaging/queue/${encodeURIComponent(terminalSessionId)}/preview-stream?${params.toString()}`
    const source = new EventSource(streamUrl)

    source.onmessage = (evt) => {
      let payload: PreviewStreamEvent | null = null
      try {
        payload = JSON.parse(evt.data) as PreviewStreamEvent
      } catch {
        return
      }
      if (!payload || typeof payload !== 'object' || !('type' in payload)) return
      if (payload.type === 'ping') return
      if (payload.type === 'snapshot' || payload.type === 'updated') {
        void loadTerminalPreview(terminalSessionId, password)
      }
    }

    source.onerror = () => {}

    return () => {
      source.close()
    }
  }, [terminalSessionId, loadTerminalPreview, sessionPasswords])

  useEffect(() => {
    if (!terminalSessionId) return
    const password = sessionPasswords[terminalSessionId] ?? ''
    if (!password) return

    const params = new URLSearchParams({ password })
    const streamUrl = `/api/imaging/queue/${encodeURIComponent(terminalSessionId)}/progress-stream?${params.toString()}`
    const source = new EventSource(streamUrl)

    source.onopen = () => {
      setTerminalError(null)
    }

    source.onmessage = (evt) => {
      let payload: ProgressStreamEvent | null = null
      try {
        payload = JSON.parse(evt.data) as ProgressStreamEvent
      } catch {
        return
      }
      if (!payload || typeof payload !== 'object' || !('type' in payload)) return
      if (payload.type === 'ping') return
      if (payload.type === 'snapshot') {
        setTerminalLines(Array.isArray(payload.lines) ? payload.lines : [])
        setTerminalQueueStatus(typeof payload.queueStatus === 'string' ? payload.queueStatus : null)
        return
      }
      if (payload.type === 'status') {
        setTerminalQueueStatus(payload.queueStatus)
        if (payload.queueStatus === 'completed') void refreshQueue()
        return
      }
      if (payload.type === 'line') {
        setTerminalLines((prev) => {
          if (prev.some((line) => line.at === payload?.at && line.text === payload?.text)) return prev
          return [...prev, { at: payload.at, text: payload.text }]
        })
      }
    }

    source.onerror = () => {}

    return () => {
      source.close()
    }
  }, [terminalSessionId, refreshQueue, sessionPasswords])

  useEffect(() => {
    terminalEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [terminalLines, terminalSessionId])

  async function parseCoordinates(): Promise<{ raHours: number; decDeg: number } | null> {
    const h = Number(raHourPart)
    const m = Number(raMinutePart)
    const s = Number(raSecondPart)
    if (!Number.isFinite(h) || !Number.isFinite(m) || !Number.isFinite(s)) {
      setSubmitError('RA requires numeric Hour, Min, and Sec.')
      return null
    }
    if (h < 0 || h > 23 || m < 0 || m > 59 || s < 0 || s >= 60) {
      setSubmitError('RA range: Hour 0-23, Min 0-59, Sec 0-59.999.')
      return null
    }
    const raHours = h + m / 60 + s / 3600

    const dd = Number(decDegreePart)
    const dm = Number(decMinutePart)
    const ds = Number(decSecondPart)
    if (!Number.isFinite(dd) || !Number.isFinite(dm) || !Number.isFinite(ds)) {
      setSubmitError('Dec requires numeric Deg, Min, and Sec.')
      return null
    }
    if (dd < 0 || dd > 90 || dm < 0 || dm > 59 || ds < 0 || ds >= 60) {
      setSubmitError('Dec range: Deg 0-90, Min 0-59, Sec 0-59.999.')
      return null
    }
    let decDeg = dd + dm / 60 + ds / 3600
    if (decSign === '-') decDeg = -decDeg
    return {
      raHours: Number(raHours.toFixed(8)),
      decDeg: Number(decDeg.toFixed(8)),
    }
  }

  async function submitRequest(
    whenClosedBehavior: 'reject' | 'queue_until_ready',
    coords: { raHours: number; decDeg: number }
  ) {
    if (sessionType !== 'variable_star' && filterPlans.length === 0) {
      setSubmitError('Select at least one filter.')
      return
    }
    const normalizedPlans: Array<{ filterName: string; count: number; exposureSeconds: number }> = []
    if (sessionType === 'variable_star') {
      normalizedPlans.push({ filterName: 'G', count: 1, exposureSeconds: 30 })
    } else {
      for (const plan of filterPlans) {
        const filterName = plan.filterName.trim()
        const frames = Math.round(Number(plan.count))
        const exposure = Math.round(Number(plan.exposureSeconds))
        if (!filterName) {
          setSubmitError('Filter name is required for each row.')
          return
        }
        if (!Number.isFinite(frames) || frames < 1 || frames > 500) {
          setSubmitError(`Frame count for ${filterName} must be between 1 and 500.`)
          return
        }
        if (!Number.isFinite(exposure) || exposure < 1 || exposure > 3600) {
          setSubmitError(`Exposure for ${filterName} must be between 1 and 3600 seconds.`)
          return
        }
        if (outputMode === 'stacked_master' && exposure !== STACKED_MASTER_REQUIRED_EXPOSURE_SECONDS) {
          setSubmitError('600s is required for stacked master mode.')
          return
        }
        normalizedPlans.push({ filterName, count: frames, exposureSeconds: exposure })
      }
    }
    const firstPlan = normalizedPlans[0]
    const emailTrimmed = email.trim()
    if (!emailTrimmed) {
      setSubmitError('Email is required.')
      return
    }
    if (!EMAIL_REGEX.test(emailTrimmed)) {
      setSubmitError('Please enter a valid email address.')
      return
    }

    const tonightWindow = computeTonightWindow(new Date())
    const estimatedDurationSeconds =
      sessionType === 'variable_star'
        ? Math.max(
            0,
            Math.round(
              altitudeAllowedCoverageMsForInterval(
                coords.raHours,
                coords.decDeg,
                tonightWindow.startMs,
                tonightWindow.endMs,
                40
              ) / 1000
            )
          )
        : estimateDurationSecondsFromPlans(normalizedPlans)

    const endpoint = editingSessionId ? `/api/imaging/queue/${encodeURIComponent(editingSessionId)}` : '/api/imaging/queue'
    const editCredential = editingSessionId ? sessionPasswords[editingSessionId] ?? '' : ''
    const res = await fetch(endpoint, {
      method: editingSessionId ? 'PUT' : 'POST',
      headers: {
        ...jsonHeaders,
        ...(editingSessionId ? { 'x-edit-credential': editCredential } : {}),
      },
      body: JSON.stringify({
        count: firstPlan.count,
        exposureSeconds: firstPlan.exposureSeconds,
        filter: firstPlan.filterName,
        filterPlans: normalizedPlans,
        target: requestName.trim() === '' ? null : requestName.trim(),
        firstName: firstName.trim() === '' ? null : firstName.trim(),
        lastName: lastName.trim() === '' ? null : lastName.trim(),
        email: emailTrimmed,
        raHours: coords.raHours,
        decDeg: coords.decDeg,
        whenClosedBehavior,
        sessionPassword,
        outputMode,
        estimatedDurationSeconds,
        sessionType,
      }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      setSubmitError(typeof data.error === 'string' ? data.error : res.statusText)
      return
    }

    setFilterPlans([])
    setRequestName('')
    setFirstName('')
    setLastName('')
    setEmail('')
    setRaHourPart('')
    setRaMinutePart('')
    setRaSecondPart('')
    setDecSign('+')
    setDecDegreePart('')
    setDecMinutePart('')
    setDecSecondPart('')
    setSessionPassword('')
    setOutputMode('raw_zip')
    setSessionType('dso')
    setVariableStarPreviewStar(null)
    setVariableStarLastFoundName(null)
    setVariableStarListSelection('')
    setCatalogQuery('')
    setCatalogLookupResult(null)
    setCatalogLookupError(null)
    setEditingSessionId(null)
    setSubmitSuccess(
      editingSessionId
        ? 'Session edited successfully.'
        : whenClosedBehavior === 'queue_until_ready'
          ? 'Session accepted. It will be available for download when observatory is Ready.'
          : 'Session started successfully.'
    )
    await refreshQueue()
  }

  async function handleDeleteRequest(id: string, password: string) {
    const res = await fetch(`/api/imaging/queue/${id}`, {
      method: 'DELETE',
      headers: { 'x-delete-credential': password.trim() },
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      setDeleteError(typeof data.error === 'string' ? data.error : 'Delete failed')
      return
    }
    setShowDeleteModal(false)
    setDeleteTargetId(null)
    setDeletePassword('')
    await refreshQueue()
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitError(null)
    setSubmitSuccess(null)
    setSubmitting(true)
    try {
      const coords = await parseCoordinates()
      if (!coords) return
      if (!sessionPassword.trim() && !editingSessionId) {
        setSubmitError('Session password is required.')
        return
      }
      if (editingSessionId) {
        await submitRequest('reject', coords)
        return
      }

      const visRes = await fetch('/api/imaging/visibility', {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify(coords),
      })
      const visData = await visRes.json().catch(() => ({}))
      if (visRes.ok && visData?.ok === true) {
        setLastComputedAltitude(typeof visData.altitudeDeg === 'number' ? visData.altitudeDeg : null)
        if (visData.visible !== true) {
          setShowAltitudeModal(true)
          return
        }
      }

      if (status !== 'ready') {
        setShowClosedModal(true)
        return
      }
      await submitRequest('reject', coords)
    } finally {
      setSubmitting(false)
    }
  }

  function beginEditSession(item: (typeof queueItems)[number]) {
    setEditingSessionId(item.id)
    setSessionType(item.sessionType === 'variable_star' ? 'variable_star' : 'dso')
    setVariableStarPreviewStar(null)
    setVariableStarLastFoundName(null)
    setVariableStarListSelection('')
    setCatalogQuery('')
    setCatalogLookupResult(null)
    setCatalogLookupError(null)
    setRequestName(item.target ?? '')
    setFirstName(item.firstName ?? '')
    setLastName(item.lastName ?? '')
    setEmail(item.email ?? '')
    if (typeof item.raHours === 'number' && Number.isFinite(item.raHours)) {
      const totalRaSec = item.raHours * 3600
      const raH = Math.floor(totalRaSec / 3600)
      const raM = Math.floor((totalRaSec - raH * 3600) / 60)
      const raS = totalRaSec - raH * 3600 - raM * 60
      setRaHourPart(String(raH))
      setRaMinutePart(String(raM))
      setRaSecondPart(String(Number(raS.toFixed(3))))
    }
    if (typeof item.decDeg === 'number' && Number.isFinite(item.decDeg)) {
      const sign: '+' | '-' = item.decDeg < 0 ? '-' : '+'
      const absDec = Math.abs(item.decDeg)
      const decD = Math.floor(absDec)
      const decM = Math.floor((absDec - decD) * 60)
      const decS = (absDec - decD - decM / 60) * 3600
      setDecSign(sign)
      setDecDegreePart(String(decD))
      setDecMinutePart(String(decM))
      setDecSecondPart(String(Number(decS.toFixed(3))))
    }
    setOutputMode(item.outputMode ?? 'raw_zip')
    if (Array.isArray(item.filterPlans) && item.filterPlans.length > 0) {
      setFilterPlans(
        item.filterPlans.map((p) => ({
          filterName: p.filterName,
          count: String(p.count),
          exposureSeconds: String(p.exposureSeconds),
        }))
      )
    }
    setSessionPassword('')
    setSubmitError(null)
    setSubmitSuccess('Editing pending session. Update fields then click Finish Editing.')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function applyVariableStarCatalogRow(row: VariableStarRow, source: VariableStarLookupSource) {
    applySexagesimalPartsFromRadec(
      row.raHours,
      row.decDeg,
      setRaHourPart,
      setRaMinutePart,
      setRaSecondPart,
      setDecSign,
      setDecDegreePart,
      setDecMinutePart,
      setDecSecondPart
    )
    setVariableStarPreviewStar(rowToVariableChartStar(row))
    setVariableStarLastFoundName(row.name)
    setVariableStarLastFoundSource(source)
    setCatalogQuery(row.name)
    const visibleInCurrentFilters = displayedVariableStars.some((s) => s.name === row.name)
    setVariableStarListSelection(source === 'catalog' && visibleInCurrentFilters ? row.name : '')
    setCatalogLookupError(null)
    setCatalogLookupResult(null)
  }

  async function handleCatalogLookup() {
    const trimmedQuery = catalogQuery.trim()
    if (!trimmedQuery) {
      setCatalogLookupError(
        sessionType === 'variable_star'
          ? 'Enter a variable star name (e.g. RR Lyr).'
          : 'Enter a catalog target name first (e.g. M31, NGC 7000).'
      )
      setCatalogLookupResult(null)
      setVariableStarLastFoundName(null)
      setVariableStarLastFoundSource(null)
      setVariableStarSimbadSearching(false)
      setVariableStarPreviewStar(null)
      setVariableStarListSelection('')
      return
    }
    setCatalogLookupLoading(true)
    setCatalogLookupError(null)
    setCatalogLookupResult(null)
    setVariableStarLastFoundName(null)
    setVariableStarLastFoundSource(null)
    setVariableStarSimbadSearching(false)
    setVariableStarPreviewStar(null)
    setVariableStarListSelection('')
    try {
      if (sessionType === 'variable_star') {
        if (variableStarCatalogLoading) {
          setCatalogLookupError('Catalog is still loading. Try again in a moment.')
          return
        }
        let localError: string | null = null
        if (variableStarCatalog.length > 0) {
          const picked = pickVariableStarRow(variableStarCatalog, trimmedQuery)
          if (picked.ok) {
            applyVariableStarCatalogRow(picked.row, 'catalog')
            return
          }
          localError = picked.error
        } else if (variableStarCatalogError) {
          localError = variableStarCatalogError
        }

        setVariableStarSimbadSearching(true)
        try {
          const simbadRes = await fetch(`/api/imaging/variable-star-lookup?query=${encodeURIComponent(trimmedQuery)}`)
          const simbadData = await simbadRes.json().catch(() => ({}))
          if (!simbadRes.ok || simbadData?.ok !== true || !simbadData?.star) {
            const simbadError =
              typeof simbadData.error === 'string'
                ? simbadData.error
                : `No SIMBAD variable-star match for "${trimmedQuery}".`
            setCatalogLookupError(localError ? `${localError} Also tried SIMBAD: ${simbadError}` : simbadError)
            return
          }
          applyVariableStarCatalogRow(simbadData.star as VariableStarRow, 'simbad')
        } finally {
          setVariableStarSimbadSearching(false)
        }
        return
      }

      const res = await fetch(`/api/imaging/object-resolve?query=${encodeURIComponent(trimmedQuery)}`)
      const data = await res.json().catch(() => ({}))
      if (!res.ok || data?.ok !== true || !data?.object) {
        setCatalogLookupError(typeof data.error === 'string' ? data.error : 'Target lookup failed.')
        return
      }
      const object = data.object as ResolvedCatalogObject
      setCatalogLookupResult(object)
      setRaHourPart(String(object.ra.hour))
      setRaMinutePart(String(object.ra.minute))
      setRaSecondPart(String(object.ra.second))
      setDecSign(object.dec.sign)
      setDecDegreePart(String(object.dec.degree))
      setDecMinutePart(String(object.dec.minute))
      setDecSecondPart(String(object.dec.second))
    } finally {
      setCatalogLookupLoading(false)
    }
  }

  return (
    <div className="pb-8">
      <div className="grid gap-6 lg:-translate-x-3 lg:grid-cols-[minmax(0,3fr)_1px_minmax(0,2fr)] lg:items-start">
        <section className="max-w-3xl">
          <h1 className="text-2xl font-semibold text-apple-dark dark:text-white mb-4">New Imaging Session</h1>
        <p className="mb-4 text-sm text-gray-600 dark:text-gray-400">
          Observatory status:{' '}
          <span
            className={
              status === 'ready'
                ? 'text-green-600 dark:text-green-400'
                : status === 'loading'
                  ? 'text-gray-500 dark:text-gray-500'
                  : 'text-red-600 dark:text-red-400'
            }
          >
            {statusLabel(status)}
          </span>
          <span className="px-2 text-gray-500 dark:text-gray-500">|</span>
          Tonight&apos;s weather prediction:{' '}
          <span
            className={
              tonightWeatherPrediction === 'permitted'
                ? 'text-green-600 dark:text-green-400'
                : tonightWeatherPrediction === 'unavailable'
                  ? 'text-gray-500 dark:text-gray-500'
                : tonightWeatherPrediction === 'loading'
                  ? 'text-gray-500 dark:text-gray-500'
                  : 'text-red-600 dark:text-red-400'
            }
          >
            {tonightWeatherPrediction === 'permitted'
              ? 'Permitted'
              : tonightWeatherPrediction === 'unavailable'
                ? 'nighttime now, prediction not available'
              : tonightWeatherPrediction === 'loading'
                ? 'Loading...'
                : 'Not permitted'}
          </span>
        </p>
        {statusLoadError && (
          <p className="mb-3 text-sm text-red-600 dark:text-red-400">{statusLoadError}</p>
        )}
          <form onSubmit={handleSubmit} className="boxed-fields grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2 space-y-2">
            <span className="text-sm font-medium text-white">Session Type</span>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                aria-pressed={sessionType === 'dso'}
                onClick={() => {
                  setSessionType('dso')
                  setFilterPlans([])
                  setCatalogQuery('')
                  setVariableStarPreviewStar(null)
                  setVariableStarLastFoundName(null)
                  setVariableStarLastFoundSource(null)
                  setVariableStarListSelection('')
                  setVariableStarFilterSelection([])
                  setCatalogLookupError(null)
                  setCatalogLookupResult(null)
                }}
                className={`rounded-full border px-4 py-2 text-sm font-medium ${
                  sessionType === 'dso'
                    ? 'border-white/60 bg-[#151616] text-white'
                    : 'border-gray-300 dark:border-gray-600 bg-[#151616] text-gray-300 hover:text-white'
                }`}
              >
                Deep Sky Object Imaging
              </button>
              <button
                type="button"
                aria-pressed={sessionType === 'variable_star'}
                onClick={() => {
                  setSessionType('variable_star')
                  setOutputMode('raw_zip')
                  setFilterPlans([{ filterName: 'G', count: '10', exposureSeconds: '60' }])
                }}
                className={`rounded-full border px-4 py-2 text-sm font-medium ${
                  sessionType === 'variable_star'
                    ? 'border-white/60 bg-[#151616] text-white'
                    : 'border-gray-300 dark:border-gray-600 bg-[#151616] text-gray-300 hover:text-white'
                }`}
              >
                Variable Star Imaging
              </button>
            </div>
            {sessionType === 'variable_star' && variableStarCatalogLoading && (
              <p className="text-xs text-gray-400">Loading variable star catalog…</p>
            )}
            {sessionType === 'variable_star' && variableStarCatalogError && !variableStarCatalogLoading && (
              <p className="text-xs text-red-400">{variableStarCatalogError}</p>
            )}
          </div>
          <label className="sm:col-span-2 block space-y-1">
            <span className="text-sm font-medium text-white">Session Name *</span>
            <input
              required
              type="text"
              value={requestName}
              onChange={(e) => setRequestName(e.target.value)}
              placeholder={
                sessionType === 'variable_star'
                  ? 'e.g. AW UMa Session 1'
                  : 'e.g. M31 LRGB Night 1'
              }
              className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-transparent dark:bg-transparent px-3 py-2 text-sm"
            />
          </label>
          <div className="sm:col-span-2 grid gap-3 sm:grid-cols-3">
            <label className="block space-y-1">
              <span className="text-sm font-medium text-white">First Name</span>
              <input
                type="text"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                placeholder="First name"
                className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-transparent dark:bg-transparent px-3 py-2 text-sm"
              />
            </label>
            <label className="block space-y-1">
              <span className="text-sm font-medium text-white">Last Name</span>
              <input
                type="text"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                placeholder="Last name"
                className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-transparent dark:bg-transparent px-3 py-2 text-sm"
              />
            </label>
            <label className="block space-y-1">
              <span className="text-sm font-medium text-white">Email *</span>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Email"
                className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-transparent dark:bg-transparent px-3 py-2 text-sm"
              />
            </label>
          </div>
          <div className="sm:col-span-2 space-y-3">
            {sessionType === 'variable_star' ? (
              <div className="space-y-4">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <label className="block w-full space-y-1">
                    <span className="text-sm font-medium text-white">Star Filter</span>
                    <div className="relative" ref={variableStarFilterDropdownRef}>
                      <button
                        type="button"
                        onClick={() => setVariableStarFilterDropdownOpen((prev) => !prev)}
                        className={`box-border flex h-10 w-full items-center justify-center rounded-lg border border-gray-300 bg-transparent px-3 py-2 text-sm leading-normal dark:border-gray-600 ${
                          variableStarFilterSelection.length === 0 ? 'text-gray-400' : 'text-white'
                        }`}
                      >
                        {variableStarFilterSelection.length === 0
                          ? '-- Select Filter --'
                          : `${variableStarFilterSelection.length} Filter${variableStarFilterSelection.length > 1 ? 's' : ''} Selected`}
                      </button>
                      {variableStarFilterDropdownOpen && (
                        <div className="absolute z-20 mt-1 w-full rounded-lg border border-gray-300 bg-[#151616] p-2 text-sm dark:border-gray-600">
                          {([
                            { value: 'tonight_observable', label: 'Tonight Observable' },
                            { value: 'high_priority', label: 'High Priority' },
                            { value: 'short_period', label: 'Short Period' },
                            { value: 'mid_period', label: 'Mid Period (1-100 Days)' },
                            { value: 'long_period', label: 'Long Period (100+ Days)' },
                          ] as const).map((option) => {
                            const checked = variableStarFilterSelection.includes(option.value)
                            return (
                              <label
                                key={option.value}
                                className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-white hover:bg-white/5"
                              >
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={(e) => {
                                    setVariableStarFilterSelection((prev) =>
                                      e.target.checked
                                        ? [...prev, option.value]
                                        : prev.filter((x) => x !== option.value)
                                    )
                                  }}
                                  className="h-4 w-4 accent-gray-300"
                                />
                                <span>{option.label}</span>
                              </label>
                            )
                          })}
                        </div>
                      )}
                    </div>
                  </label>
                  <label className="block w-full space-y-1">
                    <span className="text-sm font-medium text-white">Star List</span>
                    <select
                      key={variableStarFilterKey}
                      value={variableStarListSelection}
                      disabled={variableStarCatalogLoading || displayedVariableStars.length === 0}
                      onChange={(e) => {
                        const v = e.target.value
                        setVariableStarListSelection(v)
                        if (!v) return
                        const row = variableStarCatalog.find((s) => s.name === v)
                        if (row) applyVariableStarCatalogRow(row, 'catalog')
                      }}
                      className={`box-border h-10 w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-[#151616] px-3 py-2 text-center text-sm leading-normal ${
                        variableStarListSelection ? 'text-white' : 'text-gray-400'
                      }`}
                      style={{ textAlignLast: 'center' }}
                    >
                      <option value="" className="text-center text-gray-400">
                        -- Select A Star--
                      </option>
                      {displayedVariableStars.map((s) => (
                        <option key={s.name} value={s.name} className="text-center text-gray-300">
                          {s.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="relative block w-full space-y-1">
                    <span className="text-sm font-medium text-white">Search A Star</span>
                    {variableStarSimbadSearching && (
                      <span className="absolute right-0 top-0 text-sm font-medium text-gray-400">
                        Searching In SIMBAD
                      </span>
                    )}
                    <input
                      type="text"
                      value={catalogQuery}
                      onChange={(e) => {
                        setCatalogQuery(e.target.value)
                        setVariableStarListSelection('')
                      }}
                      onKeyDown={(e) => {
                        if (e.key !== 'Enter') return
                        e.preventDefault()
                        void handleCatalogLookup()
                      }}
                      placeholder="e.g. RR Lyr"
                      className="box-border h-10 w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-transparent px-3 py-2 text-sm leading-normal dark:bg-transparent"
                    />
                  </label>
                </div>
                <VariableStarPreviewCharts star={variableStarPreviewStar} />
              </div>
            ) : (
              <div className="flex flex-wrap items-end gap-2">
                <label className="min-w-[12rem] flex-1 basis-[min(100%,20rem)] space-y-1">
                  <span className="text-sm font-medium text-white">Catalog Target Search</span>
                  <input
                    type="text"
                    value={catalogQuery}
                    onChange={(e) => setCatalogQuery(e.target.value)}
                    placeholder="Try M31, NGC 7000, IC 434, M42..."
                    className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-transparent dark:bg-transparent px-3 py-2 text-sm"
                  />
                </label>
                <button
                  type="button"
                  onClick={() => {
                    void handleCatalogLookup()
                  }}
                  disabled={catalogLookupLoading}
                  className="rounded-full border border-white/25 bg-[#151616] px-4 py-2 text-sm font-medium text-white hover:bg-[#1b1c1c] disabled:opacity-60"
                >
                  {catalogLookupLoading ? 'Searching...' : 'Search Target'}
                </button>
              </div>
            )}
            {catalogLookupError && <p className="text-sm text-red-400">{catalogLookupError}</p>}
            {sessionType === 'dso' && catalogLookupResult && (
              <p className="text-sm text-green-400">
                Found <span className="font-semibold">{catalogLookupResult.canonicalName}</span>. Coordinates auto-filled.
              </p>
            )}
            {sessionType === 'variable_star' && variableStarLastFoundName && (
              <p className="text-sm text-green-400">
                Found <span className="font-semibold">{variableStarLastFoundName}</span>{' '}
                {variableStarLastFoundSource === 'simbad' ? '(SIMBAD)' : '(Index Catalog)'}.
                Coordinates auto-filled.
              </p>
            )}
          </div>
          <div className="sm:col-span-2 grid gap-2">
            <span className="text-sm font-medium text-white">Right Ascension (RA) *</span>
            <div className="grid grid-cols-3 gap-3">
              <input
                required
                type="text"
                inputMode="numeric"
                value={raHourPart}
                onChange={(e) => setRaHourPart(e.target.value)}
                placeholder="Hour"
                className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-transparent dark:bg-transparent px-3 py-2 text-sm"
              />
              <input
                required
                type="text"
                inputMode="numeric"
                value={raMinutePart}
                onChange={(e) => setRaMinutePart(e.target.value)}
                placeholder="Min"
                className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-transparent dark:bg-transparent px-3 py-2 text-sm"
              />
              <input
                required
                type="text"
                inputMode="decimal"
                value={raSecondPart}
                onChange={(e) => setRaSecondPart(e.target.value)}
                placeholder="Sec"
                className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-transparent dark:bg-transparent px-3 py-2 text-sm"
              />
            </div>
          </div>
          <div className="sm:col-span-2 grid gap-2">
            <span className="text-sm font-medium text-white">Declination (Dec) *</span>
            <div className="grid grid-cols-4 gap-2">
              <select
                value={decSign}
                onChange={(e) => setDecSign(e.target.value)}
                className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-transparent dark:bg-transparent px-3 py-2 text-sm"
              >
                <option value="+">+</option>
                <option value="-">-</option>
              </select>
              <input
                required
                type="text"
                inputMode="numeric"
                value={decDegreePart}
                onChange={(e) => setDecDegreePart(e.target.value)}
                placeholder="Deg"
                className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-transparent dark:bg-transparent px-3 py-2 text-sm"
              />
              <input
                required
                type="text"
                inputMode="numeric"
                value={decMinutePart}
                onChange={(e) => setDecMinutePart(e.target.value)}
                placeholder="Min"
                className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-transparent dark:bg-transparent px-3 py-2 text-sm"
              />
              <input
                required
                type="text"
                inputMode="decimal"
                value={decSecondPart}
                onChange={(e) => setDecSecondPart(e.target.value)}
                placeholder="Sec"
                className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-transparent dark:bg-transparent px-3 py-2 text-sm"
              />
            </div>
          </div>
          {sessionType === 'dso' && (
            <div className="sm:col-span-2 grid gap-3">
              <span className="text-sm font-medium text-white">Filters *</span>
              <div className="flex flex-wrap gap-2">
                {FILTER_OPTIONS.map((option) => {
                  const selected = filterPlans.some((x) => x.filterName === option.value)
                  return (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => {
                        setFilterPlans((prev) => {
                          const idx = prev.findIndex((x) => x.filterName === option.value)
                          if (idx >= 0) return prev.filter((x) => x.filterName !== option.value)
                          return [...prev, { filterName: option.value, count: '10', exposureSeconds: '' }]
                        })
                      }}
                      className={`rounded-full border px-3 py-2 text-sm font-medium ${
                        selected
                          ? 'border-white/60 bg-[#151616] text-white'
                          : 'border-gray-300 dark:border-gray-600 bg-[#151616] text-gray-300 hover:text-white'
                      }`}
                    >
                      {option.label}
                    </button>
                  )
                })}
              </div>
              {filterPlans.length > 0 && (
                <div className="space-y-2">
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,11rem)_1fr_1fr] sm:items-end">
                    <div className="hidden sm:block" />
                    <div className="text-sm font-medium text-white">Frame Count *</div>
                    <div className="text-sm font-medium text-white">Exposure per Frame (s) *</div>
                  </div>

                  <div className="space-y-2">
                    {filterPlans.map((plan) => {
                      const label =
                        FILTER_OPTIONS.find((o) => o.value === plan.filterName)?.label ?? plan.filterName
                      return (
                        <div
                          key={plan.filterName}
                          className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,11rem)_1fr_1fr] sm:items-center"
                        >
                          <button
                            type="button"
                            disabled
                            aria-disabled="true"
                            className="w-full rounded-full border border-white/25 bg-[#151616] px-3 py-2 text-center text-sm font-medium text-white opacity-90 cursor-default sm:self-end"
                          >
                            {label}
                          </button>

                          <input
                            type="text"
                            inputMode="numeric"
                            value={plan.count}
                            onChange={(e) =>
                              setFilterPlans((prev) =>
                                prev.map((x) => (x.filterName === plan.filterName ? { ...x, count: e.target.value } : x))
                              )
                            }
                            className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-transparent px-3 py-2 text-sm"
                          />

                          <input
                            type="text"
                            inputMode="decimal"
                            value={plan.exposureSeconds}
                            placeholder="600s is required for stacked master mode"
                            onChange={(e) =>
                              setFilterPlans((prev) =>
                                prev.map((x) =>
                                  x.filterName === plan.filterName ? { ...x, exposureSeconds: e.target.value } : x
                                )
                              )
                            }
                            className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-transparent px-3 py-2 text-sm"
                          />
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>
          )}
          <div className="sm:col-span-2 grid gap-3 sm:grid-cols-2 sm:items-start">
            <label className="block space-y-1">
              <span className="text-sm font-medium text-white">Session Password *</span>
              <input
                required
                type="password"
                value={sessionPassword}
                onChange={(e) => setSessionPassword(e.target.value)}
                placeholder="Required for progress and download access"
                className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-transparent dark:bg-transparent px-3 py-2 text-sm"
              />
            </label>
            <div className="grid gap-2">
              <span className="text-sm font-medium text-white">Output Type *</span>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setOutputMode('raw_zip')}
                  className={`rounded-full border px-3 py-2 text-sm font-medium ${
                    outputMode === 'raw_zip'
                      ? 'border-white/60 bg-[#151616] text-white'
                      : 'border-gray-300 dark:border-gray-600 bg-[#151616] text-gray-300 hover:text-white'
                  }`}
                >
                  Raw ZIP
                </button>
                {sessionType !== 'variable_star' && (
                  <button
                    type="button"
                    onClick={() => setOutputMode('stacked_master')}
                    className={`rounded-full border px-3 py-2 text-sm font-medium ${
                      outputMode === 'stacked_master'
                        ? 'border-white/60 bg-[#151616] text-white'
                        : 'border-gray-300 dark:border-gray-600 bg-[#151616] text-gray-300 hover:text-white'
                    }`}
                  >
                    Stacked Master
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setOutputMode('none')}
                  className={`rounded-full border px-3 py-2 text-sm font-medium ${
                    outputMode === 'none'
                      ? 'border-white/60 bg-[#151616] text-white'
                      : 'border-gray-300 dark:border-gray-600 bg-[#151616] text-gray-300 hover:text-white'
                  }`}
                >
                  None
                </button>
              </div>
            </div>
          </div>
          {submitError && (
            <p className="sm:col-span-2 text-sm text-red-600 dark:text-red-400" role="alert">
              {submitError}
            </p>
          )}
          {submitSuccess && (
            <p className="sm:col-span-2 text-sm text-green-700 dark:text-green-400" role="status">
              {submitSuccess}
            </p>
          )}
          <div className="sm:col-span-2">
            <button
              type="submit"
              disabled={submitting}
              className="rounded-full bg-[#151616] text-white px-4 py-2 text-sm font-medium hover:bg-[#1b1c1c] disabled:opacity-50"
            >
              {submitting ? (editingSessionId ? 'Finishing...' : 'Starting...') : editingSessionId ? 'Finish Editing' : 'Start Session'}
            </button>
          </div>
          </form>
        </section>
        <div className="hidden lg:block h-full min-h-[16rem] w-px bg-black/10 dark:bg-white/10" />
        <section className="max-w-2xl">
          <h1 className="text-2xl font-semibold text-apple-dark dark:text-white mb-4">Tonight&apos;s Schedule</h1>
          <div className="mt-9 relative">
            {(() => {
              const totalMs = tonightSchedule.end.getTime() - tonightSchedule.start.getTime()
              const hourLines = tonightSchedule.hours.map((slot) => ({
                ...slot,
                topPct: ((slot.hourStartMs - tonightSchedule.start.getTime()) / totalMs) * 100,
              }))
              return (
                <>
            <div className="absolute left-[4.75rem] top-0 bottom-0 w-px bg-black/10 dark:bg-white/10" />
            <div className="absolute -right-16 top-0 bottom-0 w-px bg-black/10 dark:bg-white/10" />
            {hourLines.map((slot, index) => (
              <div key={`hour-line-${slot.hourKey}-${index}`}>
                <div
                  className="absolute left-[4.75rem] -right-16 h-px bg-black/10 dark:bg-white/10"
                  style={{ top: `${slot.topPct}%` }}
                />
                <p
                  className="absolute left-0 w-[4rem] -translate-y-1/2 text-right text-xs text-gray-500 dark:text-gray-500"
                  style={{ top: `${slot.topPct}%` }}
                >
                  {slot.label}
                </p>
              </div>
            ))}
            {tonightSchedule.nowTopPct !== null && (
              <div
                className="absolute left-[4.75rem] -right-16 h-0.5 bg-red-500/90 z-[1]"
                style={{ top: `${tonightSchedule.nowTopPct}%` }}
              />
            )}
            <div className="space-y-0">
              {tonightSchedule.hours.slice(0, -1).map((slot, index) => (
                <div key={`${slot.hourKey}-${index}`} className="grid grid-cols-[4rem_minmax(0,1fr)] items-stretch gap-3 h-14">
                  <div />
                  <div />
                </div>
              ))}
            </div>
            <div className="pointer-events-none absolute left-[4.75rem] -right-16 top-0 bottom-0">
              {weatherBlocks.map((block, idx) => (
                <div
                  key={`weather-${block.kind}-${idx}`}
                  className="absolute left-[33.333%] right-[33.333%] rounded-md border border-white/25 bg-[#151616] px-2 py-0.5 flex items-center justify-center"
                  style={{
                    top: `${block.topPct}%`,
                    height: `${Math.max(block.heightPct, 4)}%`,
                  }}
                >
                  <div className="text-center">
                    <p className="text-[10px] leading-4 text-white">
                      {block.kind === 'permitted' ? 'Weather Permitted' : 'Weather Not Permitted'}
                    </p>
                    {block.kind === 'not_permitted' && block.reasons.length > 0 ? (
                      <p className="text-[10px] leading-4 text-gray-400">{block.reasons.join(' / ')}</p>
                    ) : null}
                  </div>
                </div>
              ))}
              {tonightSchedule.eventBlocks.map((marker) => (
                <div
                  key={marker.label}
                  className="absolute left-0 right-[66.666%] -translate-y-1/2 rounded-md border border-white/25 bg-[#151616] px-2 py-0.5"
                  style={{ top: `${marker.topPct}%` }}
                >
                  <p className="text-center text-[10px] leading-4 text-white">{marker.label}</p>
                </div>
              ))}
              {sessionScheduleBlocks.map((block, idx) => (
                <div
                  key={`session-${idx}`}
                  className="absolute left-[66.666%] right-0 rounded-md border border-white/25 bg-[#151616] px-2 py-0.5 flex items-center justify-center overflow-hidden"
                  style={{
                    top: `${block.topPct}%`,
                    height: `${block.heightPct}%`,
                  }}
                >
                  <p className="text-center text-[10px] leading-4 text-white">{block.label}</p>
                </div>
              ))}
              {tonightSchedule.adminClosedBlocks.map((block) => (
                <div
                  key={`admin-closed-${block.id}`}
                  className="absolute left-[66.666%] right-0 rounded-md border border-red-300/60 bg-[#3a1c1c] px-2 py-0.5 flex items-center justify-center"
                  style={{ top: `${block.topPct}%`, height: `${Math.max(block.heightPct, 4)}%` }}
                >
                  <p className="text-center text-[10px] leading-4 text-white break-words px-0.5">{block.label}</p>
                </div>
              ))}
            </div>
                </>
              )
            })()}
          </div>
        </section>
      </div>
      <div className="mt-6 border-t border-black/10 dark:border-white/10 lg:-translate-x-3" />
      <section className="mt-8 max-w-3xl lg:-translate-x-3">
        <h1 className="text-2xl font-semibold text-apple-dark dark:text-white mb-4">Current Sessions</h1>
        {queueItems.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-gray-500">No sessions.</p>
        ) : (
          <ul className="space-y-2">
            {queueItems.map((item) => (
              <li
                key={item.id}
                className="rounded-lg border border-gray-200 dark:border-gray-700 px-3 py-2 text-sm"
              >
                {(() => {
                  const displayStatus =
                    item.status === 'pending' && item.scheduleStatus === 'scheduled'
                      ? 'scheduled'
                      : item.status
                  const sessionTypeLabel = item.sessionType === 'variable_star' ? 'Variable Star' : 'Deep Sky Object'
                  return (
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium text-white">{`${item.target} | ${sessionTypeLabel}`}</span>
                  <span className={`text-xs font-semibold uppercase ${queueStatusBadgeClass(displayStatus)}`}>
                    {queueStatusLabel(displayStatus)}
                  </span>
                </div>
                  )
                })()}
                <div className="mt-2 flex flex-wrap items-center gap-3">
                  {item.hasDownload && item.downloadPath && (
                    <button
                      type="button"
                      onClick={() => {
                        setAuthModalSessionId(item.id)
                        setAuthModalAction('download')
                        setAuthError(null)
                        setAuthPassword(sessionPasswords[item.id] ?? '')
                      }}
                      className="rounded-full border border-white/25 bg-[#151616] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#1b1c1c]"
                    >
                      Download file
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      setAuthModalSessionId(item.id)
                      setAuthModalAction('progress')
                      setAuthError(null)
                      setAuthPassword(sessionPasswords[item.id] ?? '')
                    }}
                    className="rounded-full border border-white/25 bg-[#151616] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#1b1c1c]"
                  >
                    Check progress
                  </button>
                  {item.status === 'pending' && (
                    <button
                      type="button"
                      onClick={() => {
                        setAuthModalSessionId(item.id)
                        setAuthModalAction('edit')
                        setAuthError(null)
                        setAuthPassword(sessionPasswords[item.id] ?? '')
                      }}
                      className="rounded-full border border-white/25 bg-[#151616] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#1b1c1c]"
                    >
                      Edit session
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      setDeleteError(null)
                      setDeleteTargetId(item.id)
                      setDeletePassword('')
                      setShowDeleteModal(true)
                    }}
                    className="rounded-full border border-red-500/50 bg-[#151616] px-3 py-1.5 text-xs font-medium text-red-300 hover:bg-[#1b1c1c] hover:text-red-200"
                  >
                    Delete session
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
        {deleteError && <p className="mt-3 text-sm text-red-600 dark:text-red-400">{deleteError}</p>}
      </section>

      {terminalSessionId && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="w-full max-w-5xl rounded-xl border border-gray-700 bg-[#08090a] text-gray-100 shadow-xl flex flex-col max-h-[85vh]">
            <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-gray-800">
              <div>
                <h2 className="text-sm font-semibold text-white">Session progress</h2>
                <p className="text-xs text-gray-500 font-mono truncate max-w-[20rem] sm:max-w-md">{terminalSessionId}</p>
              </div>
              <div className="flex items-center gap-2">
                {terminalQueueStatus && (
                  <span className={`text-xs font-semibold uppercase ${queueStatusBadgeClass(terminalQueueStatus)}`}>
                    {queueStatusLabel(terminalQueueStatus)}
                  </span>
                )}
                {terminalLoading && <span className="text-xs text-gray-500">Updating…</span>}
                <button
                  type="button"
                  onClick={() => setTerminalSessionId(null)}
                  className="rounded-lg border border-gray-600 px-3 py-1.5 text-xs text-gray-200 hover:bg-gray-800"
                >
                  Close
                </button>
              </div>
            </div>
            {terminalError && (
              <p className="px-4 py-2 text-xs text-red-400 border-b border-gray-800">{terminalError}</p>
            )}
            <div className="flex flex-1 min-h-[20rem] flex-col">
              <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[1.25fr_1fr]">
                <div className="border-b border-gray-800 md:border-b-0 md:border-r md:border-r-gray-800">
                <div className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-white">Terminal</div>
                <div className="h-full overflow-auto p-3 font-mono text-xs leading-relaxed">
                  {terminalLines.length === 0 && !terminalError && (
                    <p className="flex min-h-full items-center justify-center text-center text-gray-500">
                      {terminalQueueStatus === 'pending' || terminalQueueStatus == null
                        ? 'Waiting For Observatory Signal.'
                        : terminalQueueStatus === 'completed'
                          ? 'Session completed. No further live updates.'
                          : 'Waiting for observatory POSTs…'}
                    </p>
                  )}
                  {terminalLines.map((line, i) => (
                    <div key={`${line.at}-${i}`} className="whitespace-pre-wrap break-words border-l-2 border-green-700/40 pl-2 mb-2">
                      <span className="text-gray-500">[{new Date(line.at).toLocaleTimeString()}]</span>{' '}
                      <span className="text-green-400">{line.text}</span>
                    </div>
                  ))}
                  <div ref={terminalEndRef} />
                </div>
              </div>
                <div className="flex h-full min-h-0 flex-col">
                  <div className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-white">Latest Image</div>
                  <div className="flex-1 p-3 pt-0 flex flex-col items-center justify-center">
                    {terminalPreviewUrl ? (
                      <img
                        src={terminalPreviewUrl}
                        alt="Latest session preview"
                        className="w-full max-h-[55vh] object-contain"
                      />
                    ) : (
                      <p className="text-sm text-gray-500">No Image.</p>
                    )}
                    {terminalPreviewError && <p className="mt-2 text-xs text-gray-500">{terminalPreviewError}</p>}
                  </div>
                </div>
              </div>
              <div className="border-t border-gray-800">
                <div className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-white">Session Detail</div>
                <div className="grid gap-x-4 gap-y-2 p-3 text-xs md:grid-cols-3">
                  <p><span className="text-gray-500">Session Name: </span>{terminalSessionDetail?.target ?? '--'}</p>
                  <p><span className="text-gray-500">First Name: </span>{terminalSessionDetail?.firstName?.trim() ? terminalSessionDetail.firstName : '--'}</p>
                  <p><span className="text-gray-500">Last Name: </span>{terminalSessionDetail?.lastName?.trim() ? terminalSessionDetail.lastName : '--'}</p>
                  <p><span className="text-gray-500">Email: </span>{terminalSessionDetail?.email?.trim() ? terminalSessionDetail.email : '--'}</p>
                  <p><span className="text-gray-500">Output Mode: </span>{terminalSessionDetail?.outputMode ?? '--'}</p>
                  <p><span className="text-gray-500">Submitted At: </span>{terminalSessionDetail ? new Date(terminalSessionDetail.createdAt).toLocaleString() : '--'}</p>
                  <p>
                    <span className="text-gray-500">RA / Dec: </span>
                    {typeof terminalSessionDetail?.raHours === 'number' && typeof terminalSessionDetail?.decDeg === 'number'
                      ? `${terminalSessionDetail.raHours.toFixed(5)}h / ${terminalSessionDetail.decDeg.toFixed(5)}°`
                      : '--'}
                  </p>
                  <p><span className="text-gray-500">Estimated Duration: </span>{formatDurationShort(terminalSessionDetail?.estimatedDurationSeconds)}</p>
                  <p className="md:col-span-3">
                    <span className="text-gray-500">Imaging Plan: </span>
                    {Array.isArray(terminalSessionDetail?.filterPlans) && terminalSessionDetail.filterPlans.length > 0
                      ? terminalSessionDetail.filterPlans
                          .map((p) => `${p.filterName} (${p.count} × ${p.exposureSeconds}s)`)
                          .join(' | ')
                      : '--'}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {authModalSessionId && authModalAction && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <form
            className="w-full max-w-md rounded-xl bg-[#09090a] border border-gray-700 p-6 space-y-4"
            onSubmit={async (e) => {
              e.preventDefault()
              if (!authModalSessionId || !authModalAction) return
              const password = authPassword.trim()
              if (!password) {
                setAuthError('Session/Admin password is required.')
                return
              }
              setAuthSubmitting(true)
              setAuthError(null)
              try {
                setSessionPasswords((prev) => ({ ...prev, [authModalSessionId]: password }))
                if (authModalAction === 'progress') {
                  setTerminalSessionId(authModalSessionId)
                  await loadTerminalProgress(authModalSessionId, password)
                  setAuthModalSessionId(null)
                  setAuthModalAction(null)
                  setAuthPassword('')
                  return
                }
                if (authModalAction === 'edit') {
                  const target = queueItems.find((x) => x.id === authModalSessionId)
                  if (!target) {
                    setAuthError('Session not found.')
                    return
                  }
                  beginEditSession(target)
                  setAuthModalSessionId(null)
                  setAuthModalAction(null)
                  setAuthPassword('')
                  return
                }
                const res = await fetch(
                  `/api/imaging/download?queueId=${encodeURIComponent(authModalSessionId)}&mode=json`,
                  {
                    headers: { 'x-session-password': password },
                  }
                )
                const data = await res.json().catch(() => ({}))
                if (!res.ok || data?.ok !== true || typeof data.signedUrl !== 'string') {
                  setAuthError(typeof data.error === 'string' ? data.error : 'Download failed.')
                  return
                }
                setAuthModalSessionId(null)
                setAuthModalAction(null)
                setAuthPassword('')
                window.location.assign(data.signedUrl)
                await refreshQueue()
              } finally {
                setAuthSubmitting(false)
              }
            }}
          >
            <h2 className="text-lg font-semibold text-white">
              {authModalAction === 'progress'
                ? 'Check Session Progress'
                : authModalAction === 'edit'
                  ? 'Edit Session'
                  : 'Download Session File'}
            </h2>
            <p className="text-sm text-gray-400">
              {authModalAction === 'edit'
                ? 'Enter session password or admin password to edit this pending session.'
                : 'Enter this session password to continue.'}
            </p>
            <label className="block space-y-1">
              <span className="text-sm font-medium text-white">Session/Admin Password</span>
              <input
                type="password"
                value={authPassword}
                onChange={(e) => setAuthPassword(e.target.value)}
                className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-transparent dark:bg-transparent px-3 py-2 text-sm"
              />
            </label>
            {authError && <p className="text-sm text-red-400">{authError}</p>}
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setAuthModalSessionId(null)
                  setAuthModalAction(null)
                  setAuthPassword('')
                  setAuthError(null)
                }}
                className="rounded-full border border-white/25 bg-[#151616] px-3 py-2 text-sm font-medium text-white hover:bg-[#1b1c1c] disabled:opacity-60"
                disabled={authSubmitting}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="rounded-full border border-white/25 bg-[#151616] px-3 py-2 text-sm font-medium text-white hover:bg-[#1b1c1c] disabled:opacity-60"
                disabled={authSubmitting}
              >
                Continue
              </button>
            </div>
          </form>
        </div>
      )}

      {showDeleteModal && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <form
            className="w-full max-w-md rounded-xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 p-6 space-y-4"
            onSubmit={async (e) => {
              e.preventDefault()
              if (!deleteTargetId) return
              const pwd = deletePassword.trim()
              if (!pwd) {
                setDeleteError('Password is required.')
                return
              }
              setDeleteSubmitting(true)
              setDeleteError(null)
              try {
                await handleDeleteRequest(deleteTargetId, pwd)
              } finally {
                setDeleteSubmitting(false)
              }
            }}
          >
            <h2 className="text-lg font-semibold text-apple-dark dark:text-white">Delete Session</h2>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Enter the admin password or this session&apos;s password to delete.
            </p>
            <label className="block space-y-1">
              <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Password</span>
              <input
                type="password"
                value={deletePassword}
                onChange={(e) => setDeletePassword(e.target.value)}
                className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-transparent dark:bg-transparent px-3 py-2 text-sm"
              />
            </label>
            {deleteError && <p className="text-sm text-red-600 dark:text-red-400">{deleteError}</p>}
            <div className="flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => {
                  setShowDeleteModal(false)
                  setDeleteTargetId(null)
                  setDeletePassword('')
                  setDeleteError(null)
                }}
                className="rounded-full border border-gray-300 dark:border-white/25 bg-white dark:bg-[#151616] px-4 py-2 text-sm font-medium text-gray-800 dark:text-white hover:bg-gray-50 dark:hover:bg-[#1b1c1c] disabled:opacity-60"
                disabled={deleteSubmitting}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="rounded-full border border-red-500/60 bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-60"
                disabled={deleteSubmitting}
              >
                {deleteSubmitting ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </form>
        </div>
      )}
      {showClosedModal && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="w-full max-w-lg rounded-xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 p-6 space-y-4">
            <h2 className="text-lg font-semibold text-apple-dark dark:text-white">Observatory Closed</h2>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Choose how to continue:
            </p>
            <div className="space-y-2">
              <button
                type="button"
                className="w-full text-left rounded-lg border border-gray-300 dark:border-gray-600 px-4 py-3 text-sm"
                onClick={() => {
                  setShowClosedModal(false)
                  setSubmitError(
                    status === 'busy_in_use'
                      ? 'Observatory is busy. Session was not started.'
                      : 'Observatory is closed. Session was not started.'
                  )
                }}
              >
                1. {status === 'busy_in_use' ? 'Observatory busy: do not start now.' : 'Observatory closed: cannot start now.'}
              </button>
              <button
                type="button"
                className="w-full text-left rounded-lg border border-gray-300 dark:border-gray-600 px-4 py-3 text-sm"
                onClick={async () => {
                  setShowClosedModal(false)
                  setSubmitting(true)
                  setSubmitError(null)
                  try {
                    const coords = await parseCoordinates()
                    if (!coords) return
                    await submitRequest('queue_until_ready', coords)
                  } finally {
                    setSubmitting(false)
                  }
                }}
              >
                2. {status === 'busy_in_use'
                  ? 'Start now, and wait until the previous task is finished.'
                  : 'Start now, and wait until observatory is Ready before it is available for download.'}
              </button>
            </div>
          </div>
        </div>
      )}
      {showAltitudeModal && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="w-full max-w-lg rounded-xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 p-6 space-y-4">
            <h2 className="text-lg font-semibold text-apple-dark dark:text-white">Target Below 30°</h2>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              {lastComputedAltitude != null
                ? `Current altitude is ${lastComputedAltitude.toFixed(2)}° (< 30°).`
                : 'Current altitude is below 30°.'}
            </p>
            <div className="space-y-2">
              <button
                type="button"
                className="w-full text-left rounded-lg border border-gray-300 dark:border-gray-600 px-4 py-3 text-sm"
                onClick={() => {
                  setShowAltitudeModal(false)
                  setSubmitError('Target below 30°. Session was not started.')
                }}
              >
                1. Do not start.
              </button>
              <button
                type="button"
                className="w-full text-left rounded-lg border border-gray-300 dark:border-gray-600 px-4 py-3 text-sm"
                onClick={async () => {
                  setShowAltitudeModal(false)
                  setSubmitting(true)
                  setSubmitError(null)
                  try {
                    const coords = await parseCoordinates()
                    if (!coords) return
                    if (status !== 'ready') {
                      setShowClosedModal(true)
                      return
                    }
                    await submitRequest('reject', coords)
                    setSubmitSuccess(
                      'Session started. It will be downloadable only when altitude reaches 30°+.'
                    )
                  } finally {
                    setSubmitting(false)
                  }
                }}
              >
                2. Start now and wait until altitude reaches 30°.
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
