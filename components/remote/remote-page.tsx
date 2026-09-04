'use client'

import { PLAN_MOSAIC_DRAFT_KEY, type MosaicDraft, type MosaicPanel } from '@/lib/mosaic/framing-rectangle'

import { currentObservatorySite } from '@/lib/observatory-site-scope'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { MemberAuthPanel } from '@/components/member-auth-panel'
import { useMember } from '@/hooks/use-member'
import { useAdaptivePoll } from '@/hooks/use-adaptive-poll'
import { useSiteStream } from '@/lib/use-site-stream'
import type { VariableStarRow } from '@/lib/variable-star-catalog'
import {
  filterVariableStarCatalog,
  type VariableStarFilterId,
} from '@/lib/variable-star/filters'
import { formatRaDecPair } from '@/lib/format-radec'
import { observatorySiteFetch, useObservatorySite } from '@/components/observatory-site-provider'
import type { ObservatorySite } from '@/lib/observatory-sites'
import {
  MIN_ALTITUDE_DEG,
  altitudeSessionCoverageOk,
  pomfretTargetObservabilityError,
} from '@/lib/target-altitude'
import { getTonightScheduleStrip, isBeforeTonightWeatherHeadline } from '@/lib/schedule-strip'
import type { WeatherNotPermittedReason } from '@/lib/tonight-weather-gate'
import {
  getTonightAstronomicalNightWindow,
  getTonightScheduleEveningAstronomyUtc,
  getTonightScheduleMorningAstronomyUtc,
  getTonightSchedulingWindow,
} from '@/lib/sunrise-window'
import { VariableStarPreviewCharts, type VariableStarChartStar } from '@/app/dashboard/remote/variable-star-preview-charts'
import { TelescopeStatusPanel } from '@/app/dashboard/remote/telescope-status-panel'
import { RemoteScheduleStrip } from '@/components/remote/remote-schedule-strip'
import { RemoteQueuePanel } from '@/components/remote/remote-queue-panel'
import { RemoteSessionForm } from '@/components/remote/remote-session-form'
import { RemoteModals } from '@/components/remote/remote-modals'
import {
  fetchMemberSavedSessions,
  loadMemberSavedSessionById,
  loadMemberSavedSessionByName,
  SAVED_SESSION_ID_QUERY,
  saveMemberSavedSession,
  type MemberSavedSessionApiEntry,
  type RemoteSavedSessionFormV1,
} from '@/lib/remote-saved-session'
import { sexagesimalPartsFromRadec, parseCoordsFromFormParts } from '@/lib/remote/coords'
import { formatDurationShort } from '@/lib/remote/format'
import { queueStatusLabel, isSessionFailedTerminalLine } from '@/lib/remote/queue-status'
import { rowToVariableChartStar, pickVariableStarRow } from '@/lib/remote/variable-star'
import { estimateDurationSecondsFromPlans } from '@/lib/remote/duration'
import {
  type FilterPlanFormRow,
  cloneFilterPlanForms,
  buildMosaicPanel,
  mosaicDraftFromCoords,
  toMosaicDraftPanel,
} from '@/lib/remote/mosaic-form'
import { nightDisplayLabel } from '@/lib/remote/night-label'
import {
  completedSessionOverlapsTonightStripWindow,
  fallbackPlacementForTerminalSession,
  imagingWindowStartMs,
  inProgressSchedulePlacement,
  listScheduledPendingPlacements,
  placementToTimelineBlock,
  serverScheduleBarForNight,
  sessionDurationMsFromItem,
  type ScheduledStripItem,
  type TerminalSessionLike,
} from '@/lib/remote/schedule-placements'
import { queueStatusBadgeClass, statusLabel, type ObservatoryStatus } from '@/lib/remote/ui-status'
import { skyCoordsForMosaicPanel } from '@/lib/imaging/project/panel-coords'
import {
  variableStarBlockHoursFromTotalSeconds,
  variableStarSessionDurationSeconds,
} from '@/lib/imaging-session-overhead'
import { parseProjectNightSubId } from '@/lib/imaging-project-ids'
import {
  glassPillDangerSm,
  glassPillDangerMd,
  glassPillDangerSolid,
  glassPillDisabled,
  glassPillFullWidthMd,
  glassPillFullWidthSm,
  glassPillMd,
  glassPillMuted,
  glassPillSm,
  glassPillToggleActive,
  glassPillToggleActiveMd,
  glassPillToggleDisabledMd,
  glassPillToggleIdle,
  glassPillToggleIdleMd,
  glassPillXs,
} from '@/lib/glass-ui'

const jsonHeaders: HeadersInit = { 'Content-Type': 'application/json' }
/** Pomfret Astro calibration library (Google Drive). */
const POMFRET_CALIBRATION_LIBRARY_DRIVE_URL =
  'https://drive.google.com/drive/folders/1nWZly4-op0yazXUoyr8sAAB9Rm8Jl2D4'

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
type ProjectModeTri = 'off' | 'on' | 'mosaic'
type VariableStarLookupSource = 'catalog' | 'simbad'
type VariableStarFilterUi = VariableStarFilterId

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

function degToRad(deg: number): number {
  return (deg * Math.PI) / 180
}

function radToDeg(rad: number): number {
  return (rad * 180) / Math.PI
}

/** Stable hour key from unix ms (aligned with Open-Meteo hour buckets). */
function buildHourKey(at: Date): string {
  return String(Math.floor(at.getTime() / 3_600_000))
}

function parseHourKeyToMs(key: string): number | null {
  const bucket = Number(key)
  if (!Number.isFinite(bucket)) return null
  return bucket * 3_600_000
}

function formatTonightXAxisHour(ms: number, timeZone: string): string {
  return new Date(ms).toLocaleTimeString(undefined, {
    timeZone,
    hour: 'numeric',
  })
}

function mergeWithFrozenPastHours(
  previous: string[],
  incoming: string[],
  now: Date,
  site: ObservatorySite
): string[] {
  const strip = getTonightScheduleStrip(now, site)
  const startMs = strip.windowStartMs
  const endMs = strip.windowEndMs
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

function currentAltitudeDegAt(raHours: number, decDeg: number, now: Date): number {
  const raDeg = raHours * 15
  const jd = now.getTime() / 86400000 + 2440587.5
  const t = (jd - 2451545.0) / 36525
  const gmst =
    280.46061837 +
    360.98564736629 * (jd - 2451545.0) +
    0.000387933 * t * t -
    (t * t * t) / 38710000
  const site = currentObservatorySite()
  let lstDeg = (gmst + site.observerLonDeg) % 360
  if (lstDeg < 0) lstDeg += 360
  let hourAngleDeg = (lstDeg - raDeg) % 360
  if (hourAngleDeg < 0) hourAngleDeg += 360

  const latRad = degToRad(site.observerLatDeg)
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

function variableStarNightHalfHourLadder(nauticalDuskUtc: Date, nauticalDawnUtc: Date): {
  allOptions: number[]
  nightHours: number
  nightHalfSteps: number
} {
  const startMs = nauticalDuskUtc.getTime()
  const endMs = nauticalDawnUtc.getTime()
  const nightHours = (endMs - startMs) / 3600000
  const nightHalfSteps = Math.max(1, Math.floor(nightHours * 2 + 1e-6))
  const allOptions: number[] = []
  for (let k = 1; k <= nightHalfSteps; k++) allOptions.push(k * 0.5)
  return { allOptions, nightHours, nightHalfSteps }
}

function variableStarDurationButtonModel(
  raHours: number,
  decDeg: number,
  nauticalDuskUtc: Date,
  nauticalDawnUtc: Date
) {
  const startMs = nauticalDuskUtc.getTime()
  const endMs = nauticalDawnUtc.getTime()
  const { allOptions, nightHours, nightHalfSteps } = variableStarNightHalfHourLadder(nauticalDuskUtc, nauticalDawnUtc)
  const above30Ms = altitudeAllowedCoverageMsForInterval(raHours, decDeg, startMs, endMs, 30)
  const above30Hours = above30Ms / 3600000
  const maxEnabledBlockHours = Math.min(nightHours, above30Hours)
  const starHalfSteps = Math.max(0, Math.floor(maxEnabledBlockHours * 2 + 1e-6))
  return { above30Ms, nightHours, above30Hours, nightHalfSteps, starHalfSteps, allOptions }
}

export default function RemotePage() {
  const router = useRouter()
  const { site, siteId } = useObservatorySite()
  const member = useMember()
  const isLoggedIn = member.status === 'authenticated'
  const isAdmin = member.status === 'authenticated' && member.isAdmin

  const [submitError, setSubmitError] = useState<string | null>(null)
  const [submitSuccess, setSubmitSuccess] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [verifyMsg, setVerifyMsg] = useState<string | null>(null)
  const [verifySending, setVerifySending] = useState(false)
  const [status, setStatus] = useState<ObservatoryStatus>('loading')
  const [tonightWeatherPrediction, setTonightWeatherPrediction] = useState<
    'permitted' | 'not_permitted' | 'unavailable' | 'loading'
  >('loading')
  const [readyWeatherHourKeys, setReadyWeatherHourKeys] = useState<string[]>([])
  const [nightWeatherHourKeys, setNightWeatherHourKeys] = useState<string[]>([])
  const [notPermittedReasonByHourKey, setNotPermittedReasonByHourKey] = useState<
    Record<string, WeatherNotPermittedReason[]>
  >({})
  const [scheduleNowMs, setScheduleNowMs] = useState(() => Date.now())
  const [hasAnyPrecipitationTonight, setHasAnyPrecipitationTonight] = useState(false)
  const [adminClosedWindows, setAdminClosedWindows] = useState<
    Array<{ id: string; startIso: string; endIso: string; description?: string }>
  >([])
  const [statusLoadError, setStatusLoadError] = useState<string | null>(null)
  const [showSaveRemoteSessionModal, setShowSaveRemoteSessionModal] = useState(false)
  const [showRunRemoteSessionModal, setShowRunRemoteSessionModal] = useState(false)
  const [saveModalName, setSaveModalName] = useState('')
  const [saveModalError, setSaveModalError] = useState<string | null>(null)
  const [runModalName, setRunModalName] = useState('')
  const [runModalError, setRunModalError] = useState<string | null>(null)
  const [cloudSavedSessions, setCloudSavedSessions] = useState<MemberSavedSessionApiEntry[]>([])
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
      cameraCoolingTempC?: -10 | 0
      estimatedDurationSeconds?: number
      filterPlans?: Array<{ filterName: string; exposureSeconds: number; count: number }>
      plannedStartIso?: string | null
      scheduleReasons?: string[]
      hasDownload?: boolean
      downloadPath?: string
      hasPreview?: boolean
      previewPath?: string
      sessionType?: 'dso' | 'variable_star'
      variableStarAmplitudeMag?: number | null
      failedAt?: string | null
      scheduleStripNightKey?: string | null
      scheduleBarStartMs?: number | null
      scheduleBarEndMs?: number | null
      projectMode?: boolean
      mosaicMode?: boolean
      mosaicPanels?: MosaicPanel[]
      mosaicFilterPlansByPanel?: Array<Array<{ filterName: string; exposureSeconds: number; count: number }>>
      userId?: string | null
      projectFramesTotal?: number
      projectFramesCaptured?: number
      projectFilterProgress?: Array<{ filterName: string; total: number; captured: number }>
      nights?: Array<{
        id: string
        nightIndex: number
        nightKey: string
        sessionLabel?: string
        mosaicPanelIndex?: number
        mosaicSubIndex?: number
        status: string
        plannedStartIso?: string | null
        scheduleStripNightKey?: string | null
        scheduleBarStartMs?: number | null
        scheduleBarEndMs?: number | null
        failedAt?: string | null
        estimatedDurationSeconds?: number
        filterPlans?: Array<{ filterName: string; exposureSeconds: number; count: number }>
        hasDownload?: boolean
        downloadPath?: string
      }>
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

  const [filterPlans, setFilterPlans] = useState<FilterPlanFormRow[]>([])
  /** Mosaic: each panel keeps its own filter/exposure rows; `filterPlans` edits the selected panel. */
  const [panelFilterPlansById, setPanelFilterPlansById] = useState<Record<number, FilterPlanFormRow[]>>({})
  const panelFilterPlansByIdRef = useRef(panelFilterPlansById)
  panelFilterPlansByIdRef.current = panelFilterPlansById
  const filterPlansRef = useRef(filterPlans)
  filterPlansRef.current = filterPlans
  const [requestName, setRequestName] = useState('')
  const [raHourPart, setRaHourPart] = useState('')
  const [raMinutePart, setRaMinutePart] = useState('')
  const [raSecondPart, setRaSecondPart] = useState('')
  const [decSign, setDecSign] = useState('+')
  const [decDegreePart, setDecDegreePart] = useState('')
  const [decMinutePart, setDecMinutePart] = useState('')
  const [decSecondPart, setDecSecondPart] = useState('')
  const [sessionPassword, setSessionPassword] = useState('')
  const [outputMode, setOutputMode] = useState<'raw_zip' | 'stacked_master' | 'none'>('raw_zip')
  const [cameraCoolingTempC, setCameraCoolingTempC] = useState<-10 | 0>(-10)
  const [ambientTempC, setAmbientTempC] = useState<number | null>(null)

  useEffect(() => {
    let cancelled = false
    const fetchTemp = async () => {
      try {
        const res = await fetch(
          `https://api.open-meteo.com/v1/forecast?latitude=${site.weatherLat}&longitude=${site.weatherLon}&current=temperature_2m&timezone=UTC`
        )
        const data = await res.json()
        if (!cancelled && typeof data?.current?.temperature_2m === 'number') {
          setAmbientTempC(data.current.temperature_2m)
          if (data.current.temperature_2m > 20) setCameraCoolingTempC(0)
        }
      } catch { /* ignore */ }
    }
    fetchTemp()
    const iv = setInterval(fetchTemp, 10 * 60_000)
    return () => { cancelled = true; clearInterval(iv) }
  }, [site.weatherLat, site.weatherLon])

  useEffect(() => {
    setReadyWeatherHourKeys([])
    setNightWeatherHourKeys([])
    setNotPermittedReasonByHourKey({})
    setTonightWeatherPrediction('loading')
  }, [siteId])

  const loggedInContact = useMemo(() => {
    if (member.status !== 'authenticated') return null
    return {
      firstName: member.user.firstName.trim() || null,
      lastName: member.user.lastName.trim() || null,
      email: member.user.email,
    }
  }, [member])

  const [imagingAccess, setImagingAccess] = useState<
    { ok: true } | { ok: false; error: string }
  >({
    ok: false,
    error: 'Sign in to submit a session.',
  })

  const fetchImagingAccess = useCallback(async () => {
    if (member.status !== 'authenticated') {
      setImagingAccess({ ok: false, error: 'Sign in to submit a session.' })
      return
    }
    try {
      const res = await observatorySiteFetch('/api/member/imaging-access', siteId)
      const data = await res.json().catch(() => ({}))
      if (!res.ok || data?.ok !== true) {
        setImagingAccess({
          ok: false,
          error: typeof data.error === 'string' ? data.error : 'Could not check imaging access.',
        })
        return
      }
      if (data.canSubmit === true) {
        setImagingAccess({ ok: true })
      } else {
        setImagingAccess({
          ok: false,
          error: typeof data.error === 'string' ? data.error : 'Imaging is not available.',
        })
      }
    } catch {
      setImagingAccess({ ok: false, error: 'Could not check imaging access.' })
    }
  }, [member, siteId])

  useEffect(() => {
    void fetchImagingAccess()
  }, [fetchImagingAccess])

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void fetchImagingAccess()
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [fetchImagingAccess])

  const currentMemberId = member.status === 'authenticated' ? member.user.id : null
  const currentMemberEmail = member.status === 'authenticated' ? member.user.email : null

  const sessionOwnedByMe = useCallback(
    (item: { userId?: string | null; email?: string | null }) => {
      if (!isLoggedIn) return false
      if (currentMemberId && item.userId && item.userId === currentMemberId) return true
      if (
        currentMemberEmail &&
        item.email &&
        item.email.trim().toLowerCase() === currentMemberEmail.trim().toLowerCase()
      ) {
        return true
      }
      return false
    },
    [isLoggedIn, currentMemberId, currentMemberEmail]
  )

  const canInteractWithSession = useCallback(
    (item: { userId?: string | null; email?: string | null }) => {
      if (isAdmin) return true
      if (!isLoggedIn) return false
      return sessionOwnedByMe(item)
    },
    [isAdmin, isLoggedIn, sessionOwnedByMe]
  )

  const canAccessSessionId = useCallback(
    (sessionId: string): boolean => {
      if (isAdmin) return true
      const direct = queueItems.find((i) => i.id === sessionId)
      if (direct && sessionOwnedByMe(direct)) return true
      const nightSub = parseProjectNightSubId(sessionId)
      if (nightSub) {
        const project = queueItems.find((i) => i.id === nightSub.projectId)
        if (project && sessionOwnedByMe(project)) return true
      }
      return false
    },
    [isAdmin, queueItems, sessionOwnedByMe]
  )

  const sessionActionButtonClass = useCallback((enabled: boolean, variant: 'default' | 'danger' = 'default') => {
    if (!enabled) {
      return `${glassPillDisabled} px-3 py-1.5 text-xs`
    }
    if (variant === 'danger') {
      return `${glassPillDangerSm} px-3 py-1.5`
    }
    return glassPillSm
  }, [])

  const refreshCloudSavedSessions = useCallback(async () => {
    if (!isLoggedIn) {
      setCloudSavedSessions([])
      return
    }
    const list = await fetchMemberSavedSessions()
    setCloudSavedSessions(list)
  }, [isLoggedIn])

  useEffect(() => {
    if (!isLoggedIn) return
    void refreshCloudSavedSessions()
  }, [isLoggedIn, refreshCloudSavedSessions])

  const [sessionPasswords, setSessionPasswords] = useState<Record<string, string>>({})
  const [catalogQuery, setCatalogQuery] = useState('')
  const [catalogLookupLoading, setCatalogLookupLoading] = useState(false)
  const [catalogLookupError, setCatalogLookupError] = useState<string | null>(null)
  const [catalogLookupResult, setCatalogLookupResult] = useState<ResolvedCatalogObject | null>(null)
  const [sessionType, setSessionType] = useState<ImagingSessionTypeUi>('dso')
  const [projectModeTri, setProjectModeTri] = useState<ProjectModeTri>('off')
  const [mosaicDraft, setMosaicDraft] = useState<MosaicDraft | null>(null)
  const [selectedMosaicPanelId, setSelectedMosaicPanelId] = useState(1)
  const selectedMosaicPanelIdRef = useRef(selectedMosaicPanelId)
  selectedMosaicPanelIdRef.current = selectedMosaicPanelId
  const projectMode = projectModeTri === 'on' || projectModeTri === 'mosaic'
  const mosaicMode = projectModeTri === 'mosaic'
  const [nightPickerProjectId, setNightPickerProjectId] = useState<string | null>(null)
  const [nightPickerPurpose, setNightPickerPurpose] = useState<'progress' | 'download' | null>(null)
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
  const [variableStarBlockHours, setVariableStarBlockHours] = useState(1)
  /** Until user taps a session duration pill, show `--` for estimated duration (not the clamped default). */
  const [variableStarDurationUserSelected, setVariableStarDurationUserSelected] = useState(false)

  const [editingSessionId, setEditingSessionId] = useState<string | null>(null)
  const [terminalSessionId, setTerminalSessionId] = useState<string | null>(null)
  const [terminalLines, setTerminalLines] = useState<SessionProgressLine[]>([])
  const [terminalQueueStatus, setTerminalQueueStatus] = useState<string | null>(null)
  const [terminalLoading, setTerminalLoading] = useState(false)
  const [terminalError, setTerminalError] = useState<string | null>(null)
  const [terminalPreviewUrl, setTerminalPreviewUrl] = useState<string | null>(null)
  const [terminalPreviewError, setTerminalPreviewError] = useState<string | null>(null)
  const [terminalPreviewUpdatedAt, setTerminalPreviewUpdatedAt] = useState<string | null>(null)
  /** Dedupe preview refetches: same server `updatedAt` can repeat across uploads; include payload slice so new frames still count. */
  const terminalPreviewLastFingerprintRef = useRef<string | null>(null)
  const terminalEndRef = useRef<HTMLDivElement>(null)
  const terminalOpenedSessionRef = useRef<string | null>(null)
  const [authModalSessionId, setAuthModalSessionId] = useState<string | null>(null)
  const [authModalAction, setAuthModalAction] = useState<
    'progress' | 'project_progress' | 'project_download' | 'download' | 'edit' | null
  >(null)
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
  const displayedVariableStars = useMemo(
    () => filterVariableStarCatalog(sortedVariableStars, variableStarFilterSelection),
    [sortedVariableStars, variableStarFilterSelection]
  )

  const variableStarFilterKey = useMemo(
    () => [...variableStarFilterSelection].sort().join('|'),
    [variableStarFilterSelection]
  )

  useEffect(() => {
    setVariableStarListSelection('')
  }, [variableStarFilterKey])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const params = new URLSearchParams(window.location.search)
    if (params.get('mosaic') === '1') {
      try {
        const raw = sessionStorage.getItem(PLAN_MOSAIC_DRAFT_KEY)
        if (raw) {
          const draft = JSON.parse(raw) as MosaicDraft
          if (draft?.panels?.length) {
            setMosaicDraft(draft)
            setProjectModeTri('mosaic')
            setSelectedMosaicPanelId(draft.panels[0]?.id ?? 1)
            if (draft.targetName) setRequestName(draft.targetName)
            const seed = cloneFilterPlanForms(filterPlansRef.current)
            const byId: Record<number, FilterPlanFormRow[]> = {}
            for (const p of draft.panels) {
              byId[p.id] = cloneFilterPlanForms(seed)
            }
            setPanelFilterPlansById(byId)
            const center = draft.panels[0]
            if (center) {
              applySexagesimalPartsFromRadec(
                center.raHours,
                center.decDeg,
                setRaHourPart,
                setRaMinutePart,
                setRaSecondPart,
                setDecSign,
                setDecDegreePart,
                setDecMinutePart,
                setDecSecondPart,
              )
            }
          }
        }
      } catch {
        /* ignore */
      }
      const url = new URL(window.location.href)
      url.searchParams.delete('mosaic')
      window.history.replaceState({}, '', url.toString())
      return
    }
    const prefillTarget = params.get('prefillTarget')
    const prefillRa = params.get('prefillRa')
    const prefillDec = params.get('prefillDec')
    if (!prefillTarget && !prefillRa && !prefillDec) return
    if (prefillTarget) setRequestName(prefillTarget)
    const ra = prefillRa != null ? Number(prefillRa) : NaN
    const dec = prefillDec != null ? Number(prefillDec) : NaN
    if (Number.isFinite(ra) && Number.isFinite(dec)) {
      applySexagesimalPartsFromRadec(
        ra,
        dec,
        setRaHourPart,
        setRaMinutePart,
        setRaSecondPart,
        setDecSign,
        setDecDegreePart,
        setDecMinutePart,
        setDecSecondPart
      )
    }
    const url = new URL(window.location.href)
    url.searchParams.delete('prefillTarget')
    url.searchParams.delete('prefillRa')
    url.searchParams.delete('prefillDec')
    window.history.replaceState({}, '', url.toString())
  }, [])

  const enableMosaicMode = useCallback(() => {
    setProjectModeTri('mosaic')
    setMosaicDraft((prev) => {
      if (prev?.panels?.length) return prev
      const coords = parseCoordsFromFormParts(
        raHourPart,
        raMinutePart,
        raSecondPart,
        decSign,
        decDegreePart,
        decMinutePart,
        decSecondPart,
      )
      const ra = coords.ok ? coords.raHours : 0
      const dec = coords.ok ? coords.decDeg : 0
      return mosaicDraftFromCoords([buildMosaicPanel(1, ra, dec)], requestName.trim() || 'Mosaic target', ra, dec)
    })
    setSelectedMosaicPanelId(1)
    setPanelFilterPlansById((prev) => {
      if (Object.keys(prev).length > 0) return prev
      return { 1: cloneFilterPlanForms(filterPlansRef.current) }
    })
  }, [raHourPart, raMinutePart, raSecondPart, decSign, decDegreePart, decMinutePart, decSecondPart, requestName])

  const selectMosaicPanel = useCallback(
    (id: number) => {
      if (id === selectedMosaicPanelIdRef.current) return
      const flushed = {
        ...panelFilterPlansByIdRef.current,
        [selectedMosaicPanelIdRef.current]: cloneFilterPlanForms(filterPlansRef.current),
      }
      setPanelFilterPlansById(flushed)
      setSelectedMosaicPanelId(id)
      const loaded = flushed[id]
      setFilterPlans(loaded ? cloneFilterPlanForms(loaded) : [])
      const panel = mosaicDraft?.panels.find((p) => p.id === id)
      if (!panel) return
      applySexagesimalPartsFromRadec(
        panel.raHours,
        panel.decDeg,
        setRaHourPart,
        setRaMinutePart,
        setRaSecondPart,
        setDecSign,
        setDecDegreePart,
        setDecMinutePart,
        setDecSecondPart,
      )
    },
    [mosaicDraft],
  )

  const addMosaicPanel = useCallback(() => {
    const coords = parseCoordsFromFormParts(
      raHourPart,
      raMinutePart,
      raSecondPart,
      decSign,
      decDegreePart,
      decMinutePart,
      decSecondPart,
    )
    const ra = coords.ok ? coords.raHours : 0
    const dec = coords.ok ? coords.decDeg : 0
    const used = new Set((mosaicDraft?.panels ?? []).map((p) => p.id))
    let nextId = 1
    while (used.has(nextId)) nextId++
    const panel = buildMosaicPanel(nextId, ra, dec)
    const flushed = {
      ...panelFilterPlansByIdRef.current,
      [selectedMosaicPanelIdRef.current]: cloneFilterPlanForms(filterPlansRef.current),
      [nextId]: cloneFilterPlanForms(filterPlansRef.current),
    }
    setPanelFilterPlansById(flushed)
    setMosaicDraft((prev) =>
      mosaicDraftFromCoords(
        [...(prev?.panels ?? []), panel],
        prev?.targetName ?? (requestName.trim() || 'Mosaic target'),
        prev?.centerRaHours ?? ra,
        prev?.centerDecDeg ?? dec,
        prev?.equipmentSnapshot ?? null,
      ),
    )
    setSelectedMosaicPanelId(nextId)
    setFilterPlans(cloneFilterPlanForms(flushed[nextId] ?? []))
    applySexagesimalPartsFromRadec(
      panel.raHours,
      panel.decDeg,
      setRaHourPart,
      setRaMinutePart,
      setRaSecondPart,
      setDecSign,
      setDecDegreePart,
      setDecMinutePart,
      setDecSecondPart,
    )
  }, [
    mosaicDraft,
    raHourPart,
    raMinutePart,
    raSecondPart,
    decSign,
    decDegreePart,
    decMinutePart,
    decSecondPart,
    requestName,
  ])

  useEffect(() => {
    if (!mosaicMode || !mosaicDraft?.panels?.length) return
    const coords = parseCoordsFromFormParts(
      raHourPart,
      raMinutePart,
      raSecondPart,
      decSign,
      decDegreePart,
      decMinutePart,
      decSecondPart,
    )
    if (!coords.ok) return
    setMosaicDraft((prev) => {
      if (!prev) return prev
      const panel = prev.panels.find((p) => p.id === selectedMosaicPanelId)
      if (!panel) return prev
      if (panel.raHours === coords.raHours && panel.decDeg === coords.decDeg) return prev
      return {
        ...prev,
        panels: prev.panels.map((p) =>
          p.id === selectedMosaicPanelId ? { ...p, raHours: coords.raHours, decDeg: coords.decDeg } : p,
        ),
      }
    })
  }, [
    mosaicMode,
    selectedMosaicPanelId,
    raHourPart,
    raMinutePart,
    raSecondPart,
    decSign,
    decDegreePart,
    decMinutePart,
    decSecondPart,
    mosaicDraft?.panels.length,
  ])

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
          data.status === 'disconnected' ||
          data.status === 'closed_weather_not_permitted' ||
          data.status === 'closed_daytime' ||
          data.status === 'closed_observatory_maintenance')
      ) {
        setStatus(data.status)
        setStatusLoadError(null)
      } else {
        setStatusLoadError('Unable to load observatory status.')
      }
    }

    void loadStatus()
    return () => {
      mounted = false
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
      const strip = getTonightScheduleStrip(now, site)
      const scheduleStartSec = Math.floor(strip.windowStartMs / 1000)
      const scheduleEndSec = Math.floor(strip.windowEndMs / 1000)

      try {
        const res = await observatorySiteFetch(
          `/api/imaging/tonight-weather-prediction?startSec=${scheduleStartSec}&endSec=${scheduleEndSec}`,
          siteId,
          { cache: 'no-store' }
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
            setReadyWeatherHourKeys((prev) => mergeWithFrozenPastHours(prev, keys, nowForMerge, site))
          } else {
            const nowForMerge = new Date()
            setReadyWeatherHourKeys((prev) => mergeWithFrozenPastHours(prev, [], nowForMerge, site))
          }
          if (Array.isArray(data.notPermittedHourReasons)) {
            const mapped: Record<string, WeatherNotPermittedReason[]> = {}
            for (const row of data.notPermittedHourReasons) {
              if (!row || typeof row !== 'object') continue
              const hourStartSec =
                typeof (row as { hourStartSec?: unknown }).hourStartSec === 'number'
                  ? (row as { hourStartSec: number }).hourStartSec
                  : null
              const reasonsRaw = (row as { reasons?: unknown }).reasons
              if (hourStartSec == null || !Array.isArray(reasonsRaw)) continue
              const reasons = reasonsRaw.filter(
                (r): r is WeatherNotPermittedReason =>
                  r === 'cloud' || r === 'rain' || r === 'wind'
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
            setNightWeatherHourKeys((prev) => mergeWithFrozenPastHours(prev, keys, nowForMerge, site))
          } else {
            const nowForMerge = new Date()
            setNightWeatherHourKeys((prev) => mergeWithFrozenPastHours(prev, [], nowForMerge, site))
          }
          return
        }
        setTonightWeatherPrediction('not_permitted')
        setHasAnyPrecipitationTonight(false)
        setNotPermittedReasonByHourKey({})
        const nowForMerge = new Date()
        setReadyWeatherHourKeys((prev) => mergeWithFrozenPastHours(prev, [], nowForMerge, site))
        setNightWeatherHourKeys((prev) => mergeWithFrozenPastHours(prev, [], nowForMerge, site))
      } catch {
        if (!mounted) return
        setTonightWeatherPrediction('not_permitted')
        setHasAnyPrecipitationTonight(false)
        setNotPermittedReasonByHourKey({})
        const nowForMerge = new Date()
        setReadyWeatherHourKeys((prev) => mergeWithFrozenPastHours(prev, [], nowForMerge, site))
        setNightWeatherHourKeys((prev) => mergeWithFrozenPastHours(prev, [], nowForMerge, site))
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
  }, [site, siteId])

  const refreshQueue = useCallback(async () => {
    const res = await observatorySiteFetch('/api/imaging/current-sessions', siteId)
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
        userId?: unknown
        raHours?: unknown
        decDeg?: unknown
        outputMode?: unknown
        sessionType?: unknown
        estimatedDurationSeconds?: unknown
        filterPlans?: unknown
        plannedStartIso?: unknown
        scheduleReasons?: unknown
        hasDownload?: unknown
        downloadPath?: unknown
        hasPreview?: unknown
        previewPath?: unknown
        failedAt?: unknown
        scheduleStripNightKey?: unknown
        scheduleBarStartMs?: unknown
        scheduleBarEndMs?: unknown
        projectMode?: unknown
        mosaicMode?: unknown
        mosaicPanels?: unknown
        mosaicFilterPlansByPanel?: unknown
        projectFramesTotal?: unknown
        projectFramesCaptured?: unknown
        projectFilterProgress?: unknown
        nights?: unknown
      }>
      const normalized = items
        .filter((x) => typeof x.id === 'string')
        .map((x) => {
          const sessionType: 'dso' | 'variable_star' = x.sessionType === 'variable_star' ? 'variable_star' : 'dso'
          const mosaicPanels = Array.isArray(x.mosaicPanels)
            ? x.mosaicPanels
                .map((p) => {
                  if (!p || typeof p !== 'object') return null
                  const rec = p as Record<string, unknown>
                  const id = typeof rec.id === 'number' && Number.isFinite(rec.id) ? rec.id : null
                  const raHours = typeof rec.raHours === 'number' && Number.isFinite(rec.raHours) ? rec.raHours : null
                  const decDeg = typeof rec.decDeg === 'number' && Number.isFinite(rec.decDeg) ? rec.decDeg : null
                  if (id == null || raHours == null || decDeg == null) return null
                  return toMosaicDraftPanel({
                    id,
                    raHours,
                    decDeg,
                    positionAngleDeg:
                      typeof rec.positionAngleDeg === 'number' && Number.isFinite(rec.positionAngleDeg)
                        ? rec.positionAngleDeg
                        : 0,
                    name: typeof rec.name === 'string' ? rec.name : undefined,
                  })
                })
                .filter((p): p is MosaicPanel => p != null)
            : undefined
          const mosaicFilterPlansByPanel =
            Array.isArray(x.mosaicFilterPlansByPanel) &&
            mosaicPanels &&
            x.mosaicFilterPlansByPanel.length === mosaicPanels.length
              ? x.mosaicFilterPlansByPanel.map((plans) => {
                  if (!Array.isArray(plans)) return [] as Array<{ filterName: string; exposureSeconds: number; count: number }>
                  return plans
                    .map((p) => {
                      if (!p || typeof p !== 'object') return null
                      const rec = p as Record<string, unknown>
                      const filterName = typeof rec.filterName === 'string' ? rec.filterName : ''
                      const exposureSeconds = Number(rec.exposureSeconds)
                      const count = Number(rec.count)
                      if (!filterName || !Number.isFinite(exposureSeconds) || !Number.isFinite(count)) return null
                      return { filterName, exposureSeconds, count }
                    })
                    .filter((p): p is { filterName: string; exposureSeconds: number; count: number } => p != null)
                })
              : undefined
          const mosaicMode =
            x.mosaicMode === true || (Array.isArray(mosaicPanels) && mosaicPanels.length > 0)
          return {
            id: String(x.id),
            target: typeof x.target === 'string' ? x.target : 'Unknown target',
            createdAt: typeof x.createdAt === 'string' ? x.createdAt : new Date().toISOString(),
            status: (() => {
              const s = typeof x.status === 'string' ? x.status : 'pending'
              if (s === 'claimed') return 'in_progress'
              if (
                s === 'pending' ||
                s === 'scheduled' ||
                s === 'on_hold' ||
                s === 'in_progress' ||
                s === 'completed' ||
                s === 'failed' ||
                s === 'rejected'
              )
                return s
              return 'pending'
            })(),
            firstName: typeof x.firstName === 'string' ? x.firstName : null,
            lastName: typeof x.lastName === 'string' ? x.lastName : null,
            email: typeof x.email === 'string' ? x.email : null,
            userId: typeof x.userId === 'string' ? x.userId : null,
            raHours:
              typeof x.raHours === 'number' && Number.isFinite(x.raHours) ? x.raHours : null,
            decDeg:
              typeof x.decDeg === 'number' && Number.isFinite(x.decDeg) ? x.decDeg : null,
            outputMode: (() => {
              if (x.outputMode === 'none') return 'none' as const
              if (x.outputMode === 'raw_zip' || x.outputMode === 'stacked_master') return 'raw_zip' as const
              return undefined
            })(),
            cameraCoolingTempC:
              (x as Record<string, unknown>).cameraCoolingTempC === -10 || (x as Record<string, unknown>).cameraCoolingTempC === 0
                ? ((x as Record<string, unknown>).cameraCoolingTempC as -10 | 0)
                : undefined,
            sessionType,
            variableStarAmplitudeMag:
              typeof (x as Record<string, unknown>).variableStarAmplitudeMag === 'number' &&
              Number.isFinite((x as Record<string, unknown>).variableStarAmplitudeMag as number)
                ? ((x as Record<string, unknown>).variableStarAmplitudeMag as number)
                : null,
            estimatedDurationSeconds:
              typeof x.estimatedDurationSeconds === 'number' && Number.isFinite(x.estimatedDurationSeconds)
                ? x.estimatedDurationSeconds
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
            failedAt: typeof x.failedAt === 'string' ? x.failedAt : null,
            scheduleStripNightKey: typeof x.scheduleStripNightKey === 'string' ? x.scheduleStripNightKey : null,
            scheduleBarStartMs:
              typeof x.scheduleBarStartMs === 'number' && Number.isFinite(x.scheduleBarStartMs)
                ? x.scheduleBarStartMs
                : null,
            scheduleBarEndMs:
              typeof x.scheduleBarEndMs === 'number' && Number.isFinite(x.scheduleBarEndMs)
                ? x.scheduleBarEndMs
                : null,
            projectMode: x.projectMode === true || mosaicMode,
            mosaicMode,
            ...(mosaicPanels && mosaicPanels.length > 0 ? { mosaicPanels } : {}),
            ...(mosaicFilterPlansByPanel ? { mosaicFilterPlansByPanel } : {}),
            projectFramesTotal:
              typeof x.projectFramesTotal === 'number' && Number.isFinite(x.projectFramesTotal)
                ? x.projectFramesTotal
                : undefined,
            projectFramesCaptured:
              typeof x.projectFramesCaptured === 'number' && Number.isFinite(x.projectFramesCaptured)
                ? x.projectFramesCaptured
                : undefined,
            projectFilterProgress: Array.isArray(x.projectFilterProgress)
              ? x.projectFilterProgress
                  .map((row) => {
                    if (!row || typeof row !== 'object') return null
                    const rec = row as Record<string, unknown>
                    if (typeof rec.filterName !== 'string') return null
                    const total =
                      typeof rec.total === 'number' && Number.isFinite(rec.total) ? rec.total : null
                    const captured =
                      typeof rec.captured === 'number' && Number.isFinite(rec.captured) ? rec.captured : null
                    if (total == null || captured == null) return null
                    return { filterName: rec.filterName, total, captured }
                  })
                  .filter((row): row is { filterName: string; total: number; captured: number } => row != null)
              : undefined,
            nights: Array.isArray(x.nights)
              ? x.nights
                  .map((n) => {
                    if (!n || typeof n !== 'object') return null
                    const rec = n as Record<string, unknown>
                    if (typeof rec.id !== 'string') return null
                    const nightIndex = typeof rec.nightIndex === 'number' ? rec.nightIndex : 0
                    const mosaicPanelIndex =
                      typeof rec.mosaicPanelIndex === 'number' && Number.isFinite(rec.mosaicPanelIndex)
                        ? rec.mosaicPanelIndex
                        : undefined
                    const mosaicSubIndex =
                      typeof rec.mosaicSubIndex === 'number' && Number.isFinite(rec.mosaicSubIndex)
                        ? rec.mosaicSubIndex
                        : undefined
                    const sessionLabel =
                      typeof rec.sessionLabel === 'string'
                        ? rec.sessionLabel
                        : nightDisplayLabel({ nightIndex, mosaicPanelIndex, mosaicSubIndex })
                    return {
                      id: rec.id,
                      nightIndex,
                      nightKey: typeof rec.nightKey === 'string' ? rec.nightKey : '',
                      sessionLabel,
                      ...(mosaicPanelIndex != null ? { mosaicPanelIndex } : {}),
                      ...(mosaicSubIndex != null ? { mosaicSubIndex } : {}),
                      status: typeof rec.status === 'string' ? rec.status : 'planned',
                      plannedStartIso: typeof rec.plannedStartIso === 'string' ? rec.plannedStartIso : null,
                      scheduleStripNightKey:
                        typeof rec.scheduleStripNightKey === 'string' ? rec.scheduleStripNightKey : null,
                      scheduleBarStartMs:
                        typeof rec.scheduleBarStartMs === 'number' && Number.isFinite(rec.scheduleBarStartMs)
                          ? rec.scheduleBarStartMs
                          : null,
                      scheduleBarEndMs:
                        typeof rec.scheduleBarEndMs === 'number' && Number.isFinite(rec.scheduleBarEndMs)
                          ? rec.scheduleBarEndMs
                          : null,
                      failedAt: typeof rec.failedAt === 'string' ? rec.failedAt : null,
                      estimatedDurationSeconds:
                        typeof rec.estimatedDurationSeconds === 'number' &&
                        Number.isFinite(rec.estimatedDurationSeconds)
                          ? rec.estimatedDurationSeconds
                          : undefined,
                      filterPlans: Array.isArray(rec.filterPlans)
                        ? rec.filterPlans
                            .map((p) => {
                              if (!p || typeof p !== 'object') return null
                              const fp = p as Record<string, unknown>
                              const filterName = typeof fp.filterName === 'string' ? fp.filterName : ''
                              const exposureSeconds = Number(fp.exposureSeconds)
                              const count = Number(fp.count)
                              if (!filterName || !Number.isFinite(exposureSeconds) || !Number.isFinite(count)) {
                                return null
                              }
                              return { filterName, exposureSeconds, count }
                            })
                            .filter(
                              (p): p is { filterName: string; exposureSeconds: number; count: number } => p !== null
                            )
                        : undefined,
                      hasDownload: rec.hasDownload === true,
                      downloadPath: typeof rec.downloadPath === 'string' ? rec.downloadPath : undefined,
                    }
                  })
                  .filter((n): n is NonNullable<typeof n> => n != null)
              : undefined,
            adminApprovalPending: (x as Record<string, unknown>).adminApprovalPending === true,
          }
        })
      setQueueItems(normalized)
    } else {
      setQueueItems([])
    }
  }, [siteId])

  useEffect(() => {
    void refreshQueue()
  }, [refreshQueue])

  const refreshQueueRef = useRef(refreshQueue)
  refreshQueueRef.current = refreshQueue

  const { siteImagingActive } = useSiteStream(
    {
      onObservatoryStatus: (event) => {
        const next = event.status
        if (
          next === 'ready' ||
          next === 'busy_in_use' ||
          next === 'disconnected' ||
          next === 'closed_weather_not_permitted' ||
          next === 'closed_daytime' ||
          next === 'closed_observatory_maintenance'
        ) {
          setStatus(next)
          setStatusLoadError(null)
        }
      },
      onSessionsChanged: () => {
        void refreshQueueRef.current()
      },
    },
    member.status === 'authenticated'
  )

  const queueImagingActive = useMemo(
    () =>
      queueItems.some(
        (item) =>
          item.status === 'in_progress' ||
          (item.nights?.some((night) => night.status === 'in_progress') ?? false)
      ),
    [queueItems]
  )

  useAdaptivePoll(
    'queue',
    () => {
      void refreshQueueRef.current()
    },
    {
      enabled: member.status === 'authenticated',
      imagingActive: siteImagingActive || queueImagingActive,
    }
  )

  const terminalImagingActive =
    Boolean(terminalSessionId) &&
    (terminalQueueStatus === 'in_progress' || terminalQueueStatus === 'scheduled')

  const showTonightWeatherHeadline = useMemo(
    () => isBeforeTonightWeatherHeadline(new Date(scheduleNowMs), site),
    [scheduleNowMs, site]
  )

  const tonightSchedule = useMemo(() => {
    const now = new Date(scheduleNowMs)
    const strip = getTonightScheduleStrip(now, site)
    const start = new Date(strip.windowStartMs)
    const end = new Date(strip.windowEndMs)

    const points: Array<{ label: string; hourKey: string; hourStartMs: number }> = []
    for (let ms = strip.windowStartMs; ms <= strip.windowEndMs; ms += 3_600_000) {
      const at = new Date(ms)
      points.push({
        label: at.toLocaleTimeString(undefined, { timeZone: site.timezone, hour: 'numeric' }),
        hourKey: buildHourKey(at),
        hourStartMs: ms,
      })
    }

    const { sunsetUtc: sunset, civilDuskUtc: civilDusk, nauticalDuskUtc: nauticalDusk, astronomicalDarkUtc: astronomicalDark } =
      getTonightScheduleEveningAstronomyUtc(now, site)
    const {
      sunriseUtc: sunrise,
      civilDawnUtc: civilDawn,
      nauticalDawnUtc: nauticalDawn,
      astronomicalDawnUtc: astronomicalDawn,
    } = getTonightScheduleMorningAstronomyUtc(now, site)

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
  }, [scheduleNowMs, adminClosedWindows, site])

  const tonightNightKey = useMemo(
    () => getTonightScheduleStrip(new Date(scheduleNowMs), site).nightKey,
    [scheduleNowMs, site]
  )

  const persistScheduleBarPlacement = useCallback(
    async (queueId: string, nightKey: string, startMs: number, endMs: number) => {
      try {
        await fetch('/api/imaging/session-schedule-placement', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ queueId, nightKey, startMs, endMs }),
        })
      } catch {
        // ignore network errors; server may already have frozen bar
      }
    },
    []
  )

  useEffect(() => {
    setLockedSessionSchedule((prev) => {
      let changed = false
      const next = { ...prev }
      for (const item of queueItems) {
        const bar = serverScheduleBarForNight(item, tonightNightKey)
        if (!bar) continue
        if (
          item.status === 'completed' ||
          item.status === 'failed' ||
          item.status === 'in_progress'
        ) {
          if (next[item.id]?.startMs !== bar.startMs || next[item.id]?.endMs !== bar.endMs) {
            next[item.id] = bar
            changed = true
          }
        }
      }
      return changed ? next : prev
    })
  }, [queueItems, tonightNightKey])

  const variableStarDurationPick = useMemo(() => {
    if (sessionType !== 'variable_star') return null
    const { nauticalDuskUtc, nauticalDawnUtc } = getTonightSchedulingWindow(new Date(scheduleNowMs))
    const { allOptions, nightHours, nightHalfSteps } = variableStarNightHalfHourLadder(nauticalDuskUtc, nauticalDawnUtc)
    const parsed = parseCoordsFromFormParts(
      raHourPart,
      raMinutePart,
      raSecondPart,
      decSign,
      decDegreePart,
      decMinutePart,
      decSecondPart
    )
    if (!parsed.ok) {
      return {
        coordsOk: false as const,
        allOptions,
        nightHours,
        nightHalfSteps,
        starHalfSteps: 0,
        above30Ms: 0,
        above30Hours: 0,
      }
    }
    const model = variableStarDurationButtonModel(parsed.raHours, parsed.decDeg, nauticalDuskUtc, nauticalDawnUtc)
    return { coordsOk: true as const, raHours: parsed.raHours, decDeg: parsed.decDeg, ...model }
  }, [
    sessionType,
    scheduleNowMs,
    raHourPart,
    raMinutePart,
    raSecondPart,
    decSign,
    decDegreePart,
    decMinutePart,
    decSecondPart,
  ])

  const variableStarEstimatedDurationPreviewSeconds = useMemo(() => {
    if (sessionType !== 'variable_star') return null
    if (!variableStarDurationPick?.coordsOk) return null
    if ((variableStarDurationPick.starHalfSteps ?? 0) < 1) return null
    if (!variableStarDurationUserSelected) return null
    const { nauticalDuskUtc } = getTonightSchedulingWindow(new Date(scheduleNowMs))
    return Math.round(
      variableStarSessionDurationSeconds({
        blockHours: variableStarBlockHours,
        raHours: variableStarDurationPick.raHours,
        startMs: nauticalDuskUtc.getTime(),
      })
    )
  }, [
    sessionType,
    variableStarDurationPick,
    variableStarDurationUserSelected,
    variableStarBlockHours,
    scheduleNowMs,
  ])

  useEffect(() => {
    if (sessionType !== 'variable_star') return
    if (!variableStarDurationPick?.coordsOk) return
    const { allOptions, starHalfSteps } = variableStarDurationPick
    if (allOptions.length === 0 || starHalfSteps < 1) return
    const maxEnabled = starHalfSteps * 0.5
    setVariableStarBlockHours((prev) => {
      const enabled = allOptions.filter((o) => o <= maxEnabled + 1e-9)
      if (enabled.length === 0) return prev
      if (enabled.includes(prev)) return prev
      let best = enabled[0]
      for (const o of enabled) {
        if (o <= prev) best = o
        else break
      }
      return best
    })
  }, [sessionType, variableStarDurationPick])

  useEffect(() => {
    if (sessionType !== 'variable_star') setVariableStarDurationUserSelected(false)
  }, [sessionType])

  useEffect(() => {
    if (sessionType === 'variable_star' && !variableStarDurationPick?.coordsOk) {
      setVariableStarDurationUserSelected(false)
    }
  }, [sessionType, variableStarDurationPick?.coordsOk])

  useEffect(() => {
    if (sessionType !== 'dso') setProjectModeTri('off')
  }, [sessionType])

  const scheduleStripItems = useMemo(() => {
    type StripItem = (typeof queueItems)[number] & { nightKey?: string }
    const expanded: StripItem[] = []
    for (const item of queueItems) {
      if (item.projectMode && item.nights && item.nights.length > 0) {
        for (const night of item.nights) {
          if (night.nightKey !== tonightNightKey) continue
          if (night.status === 'on_hold') {
            expanded.push({
              ...item,
              id: night.id,
              nightKey: night.nightKey,
              target: `${item.target} — ${nightDisplayLabel(night)}`,
              status: 'on_hold',
              plannedStartIso: null,
              estimatedDurationSeconds: night.estimatedDurationSeconds,
              filterPlans: night.filterPlans,
              failedAt: night.failedAt ?? null,
              scheduleStripNightKey: null,
              scheduleBarStartMs: null,
              scheduleBarEndMs: null,
            })
            continue
          }
          if (night.status === 'failed') continue
          if (night.status === 'planned' && !night.plannedStartIso) continue
          expanded.push({
            ...item,
            id: night.id,
            nightKey: night.nightKey,
            target: `${item.target} — ${nightDisplayLabel(night)}`,
            status:
              night.status === 'in_progress'
                ? 'in_progress'
                : night.status === 'completed'
                  ? 'completed'
                  : night.status === 'scheduled'
                      ? 'scheduled'
                      : 'pending',
            plannedStartIso: night.plannedStartIso ?? null,
            estimatedDurationSeconds: night.estimatedDurationSeconds,
            filterPlans: night.filterPlans,
            failedAt: night.failedAt ?? null,
            scheduleStripNightKey: night.scheduleStripNightKey ?? null,
            scheduleBarStartMs: night.scheduleBarStartMs ?? null,
            scheduleBarEndMs: night.scheduleBarEndMs ?? null,
          })
        }
      } else if (!item.projectMode) {
        if (item.status === 'failed') continue
        expanded.push(item)
      }
    }
    return expanded
  }, [queueItems, tonightNightKey])

  const dsoEstimatedDurationPreviewSeconds = useMemo(() => {
    if (sessionType !== 'dso') return null
    const normalize = (plans: FilterPlanFormRow[]) => {
      const normalized: Array<{ filterName: string; count: number; exposureSeconds: number }> = []
      for (const plan of plans) {
        const filterName = plan.filterName.trim()
        const frames = Math.round(Number(plan.count))
        const exposure = Math.round(Number(plan.exposureSeconds))
        if (!filterName) return null
        if (!Number.isFinite(frames) || frames < 1) return null
        if (!Number.isFinite(exposure) || exposure < 1 || exposure > 3600) return null
        normalized.push({ filterName, count: frames, exposureSeconds: exposure })
      }
      return normalized
    }
    if (mosaicMode && mosaicDraft?.panels?.length) {
      const flushed = {
        ...panelFilterPlansById,
        [selectedMosaicPanelId]: cloneFilterPlanForms(filterPlans),
      }
      let total = 0
      for (const panel of mosaicDraft.panels) {
        const plans = flushed[panel.id] ?? []
        if (plans.length === 0) return null
        const normalized = normalize(plans)
        if (!normalized) return null
        total += estimateDurationSecondsFromPlans(normalized)
      }
      return total
    }
    if (filterPlans.length === 0) return null
    const normalized = normalize(filterPlans)
    if (!normalized) return null
    return estimateDurationSecondsFromPlans(normalized)
  }, [sessionType, filterPlans, mosaicMode, mosaicDraft, panelFilterPlansById, selectedMosaicPanelId])

  const canSaveRemoteSessionSpec = useMemo(() => {
    if (!imagingAccess.ok) return false
    if (!requestName.trim()) return false
    if (!loggedInContact?.email) return false
    const coord = parseCoordsFromFormParts(
      raHourPart,
      raMinutePart,
      raSecondPart,
      decSign,
      decDegreePart,
      decMinutePart,
      decSecondPart
    )
    if (!coord.ok) return false
    if (sessionType === 'variable_star') {
      if (!variableStarDurationPick?.coordsOk) return false
      const { starHalfSteps, allOptions } = variableStarDurationPick
      if (starHalfSteps < 1) return false
      const maxEnabled = starHalfSteps * 0.5
      if (!allOptions.includes(variableStarBlockHours) || variableStarBlockHours > maxEnabled + 1e-9) return false
      return true
    }
    if (filterPlans.length === 0) return false
    for (const plan of filterPlans) {
      const filterName = plan.filterName.trim()
      const frames = Math.round(Number(plan.count))
      const exposure = Math.round(Number(plan.exposureSeconds))
      if (!filterName) return false
      if (!Number.isFinite(frames) || frames < 1) return false
      if (!Number.isFinite(exposure) || exposure < 1 || exposure > 3600) return false
    }
    return true
  }, [
    imagingAccess.ok,
    requestName,
    loggedInContact,
    raHourPart,
    raMinutePart,
    raSecondPart,
    decSign,
    decDegreePart,
    decMinutePart,
    decSecondPart,
    sessionType,
    variableStarDurationPick,
    variableStarBlockHours,
    filterPlans,
  ])

  const captureRemoteSavedForm = useCallback((): RemoteSavedSessionFormV1 => {
    return {
      sessionType: sessionType === 'variable_star' ? 'variable_star' : 'dso',
      requestName,
      raHourPart,
      raMinutePart,
      raSecondPart,
      decSign,
      decDegreePart,
      decMinutePart,
      decSecondPart,
      sessionPassword,
      outputMode: outputMode === 'none' ? 'none' : 'raw_zip',
      cameraCoolingTempC,
      filterPlans: filterPlans.map((p) => ({ ...p })),
      variableStarBlockHours,
      variableStarListSelection,
      variableStarFilterSelection: [...variableStarFilterSelection],
      catalogQuery,
    }
  }, [
    sessionType,
    requestName,
    raHourPart,
    raMinutePart,
    raSecondPart,
    decSign,
    decDegreePart,
    decMinutePart,
    decSecondPart,
    sessionPassword,
    outputMode,
    cameraCoolingTempC,
    filterPlans,
    variableStarBlockHours,
    variableStarListSelection,
    variableStarFilterSelection,
    catalogQuery,
  ])

  const applyRemoteSavedForm = useCallback(
    (form: RemoteSavedSessionFormV1) => {
      setEditingSessionId(null)
      setSubmitError(null)
      setSessionType(form.sessionType === 'variable_star' ? 'variable_star' : 'dso')
      setRequestName(form.requestName)
      setRaHourPart(form.raHourPart)
      setRaMinutePart(form.raMinutePart)
      setRaSecondPart(form.raSecondPart)
      setDecSign(form.decSign)
      setDecDegreePart(form.decDegreePart)
      setDecMinutePart(form.decMinutePart)
      setDecSecondPart(form.decSecondPart)
      setSessionPassword(form.sessionPassword)
      setOutputMode(form.outputMode === 'none' ? 'none' : 'raw_zip')
      if (form.cameraCoolingTempC === 0 || form.cameraCoolingTempC === -10) {
        setCameraCoolingTempC(form.cameraCoolingTempC)
      }
      setFilterPlans(
        form.filterPlans.length > 0
          ? form.filterPlans.map((p) => ({ ...p }))
          : [{ filterName: 'G', count: '10', exposureSeconds: '60' }]
      )
      setVariableStarBlockHours(form.variableStarBlockHours)
      setVariableStarDurationUserSelected(form.sessionType === 'variable_star')
      setVariableStarListSelection(form.variableStarListSelection)
      setVariableStarFilterSelection(form.variableStarFilterSelection as VariableStarFilterUi[])
      setCatalogQuery(form.catalogQuery)
      setCatalogLookupResult(null)
      setCatalogLookupError(null)
      if (form.sessionType === 'variable_star') {
        const row = variableStarCatalog.find(
          (r) => r.name === form.variableStarListSelection || r.name === form.catalogQuery.trim()
        )
        if (row) {
          setVariableStarPreviewStar(rowToVariableChartStar(row))
          setVariableStarLastFoundName(row.name)
          setVariableStarLastFoundSource('catalog')
        } else {
          setVariableStarPreviewStar(null)
          setVariableStarLastFoundName(null)
          setVariableStarLastFoundSource(null)
        }
      } else {
        setVariableStarPreviewStar(null)
        setVariableStarLastFoundName(null)
        setVariableStarLastFoundSource(null)
      }
    },
    [variableStarCatalog]
  )

  const loadedSavedSessionIdRef = useRef<string | null>(null)

  useEffect(() => {
    if (!isLoggedIn) return
    if (typeof window === 'undefined') return
    const id = new URLSearchParams(window.location.search).get(SAVED_SESSION_ID_QUERY)?.trim() ?? ''
    if (!id) {
      loadedSavedSessionIdRef.current = null
      return
    }
    if (loadedSavedSessionIdRef.current === id) return

    void (async () => {
      loadedSavedSessionIdRef.current = id
      const found = await loadMemberSavedSessionById(id)
      router.replace('/dashboard/remote')
      if (!found) {
        setSubmitError('Saved session not found.')
        return
      }
      applyRemoteSavedForm(found.form)
      setRequestName(found.name)
      setSubmitError(null)
      setSubmitSuccess(`Loaded saved session "${found.name}".`)
    })()
  }, [isLoggedIn, applyRemoteSavedForm, router])

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
        reasons: WeatherNotPermittedReason[]
      }>
    }
    const readyKeySet = new Set(readyWeatherHourKeys)
    const nightKeySet = new Set(effectiveNightHourKeys)
    const blocks: Array<{
      topPct: number
      heightPct: number
      kind: 'permitted' | 'not_permitted'
      reasons: WeatherNotPermittedReason[]
    }> = []
    const reasonOrder = { cloud: 0, rain: 1, wind: 2 } as const
    const normalizeReasons = (reasons: WeatherNotPermittedReason[]) =>
      Array.from(new Set(reasons)).sort((a, b) => reasonOrder[a] - reasonOrder[b])
    const sameReasonSet = (a: WeatherNotPermittedReason[], b: WeatherNotPermittedReason[]) => {
      if (a.length !== b.length) return false
      return a.every((reason, i) => reason === b[i])
    }
    const flushRun = () => {
      if (runStartMs == null || runEndMsExclusive == null || runKind == null) return
      const clampedEnd = Math.min(runEndMsExclusive, tonightSchedule.end.getTime())
      const topPct =
        ((runStartMs - tonightSchedule.start.getTime()) /
          (tonightSchedule.end.getTime() - tonightSchedule.start.getTime())) *
        100
      const heightPct =
        ((clampedEnd - runStartMs) / (tonightSchedule.end.getTime() - tonightSchedule.start.getTime())) * 100
      if (heightPct > 0) {
        blocks.push({ topPct, heightPct, kind: runKind, reasons: [...runReasons] })
      }
      runStartMs = null
      runEndMsExclusive = null
      runKind = null
      runReasons = []
    }

    let runStartMs: number | null = null
    let runEndMsExclusive: number | null = null
    let runKind: 'permitted' | 'not_permitted' | null = null
    let runReasons: WeatherNotPermittedReason[] = []

    for (const slot of tonightSchedule.hours) {
      if (!nightKeySet.has(slot.hourKey)) {
        flushRun()
        continue
      }

      const kind: 'permitted' | 'not_permitted' = readyKeySet.has(slot.hourKey) ? 'permitted' : 'not_permitted'
      const reasonsForHour = normalizeReasons(
        kind === 'not_permitted' ? (notPermittedReasonByHourKey[slot.hourKey] ?? []) : []
      )
      // Merge only when kind and exact reason set match (e.g. cloud-only stays separate from cloud/rain).
      if (runStartMs != null && runKind === kind && sameReasonSet(runReasons, reasonsForHour)) {
        runEndMsExclusive = slot.hourStartMs + 60 * 60 * 1000
        continue
      }
      flushRun()
      runStartMs = slot.hourStartMs
      runEndMsExclusive = slot.hourStartMs + 60 * 60 * 1000
      runKind = kind
      runReasons = reasonsForHour
    }

    flushRun()

    return blocks
  }, [readyWeatherHourKeys, nightWeatherHourKeys, tonightSchedule, tonightWeatherPrediction, notPermittedReasonByHourKey])

  const sessionSchedulePlan = useMemo(() => {
    const windowStartMs = tonightSchedule.start.getTime()
    const windowEndMs = tonightSchedule.end.getTime()
    const nauticalDuskMs = tonightSchedule.nauticalDusk.getTime()
    const imagingStartMs = imagingWindowStartMs(windowStartMs, nauticalDuskMs)
    const schedulingDeadlineMs = Math.min(windowEndMs, tonightSchedule.astronomicalDawn.getTime())

    const effectiveLocks: Record<string, { startMs: number; endMs: number }> = { ...lockedSessionSchedule }
    for (const item of scheduleStripItems) {
      const bar = serverScheduleBarForNight(item, tonightNightKey)
      if (bar) effectiveLocks[item.id] = bar
    }

    // Bad weather must not wipe in_progress / completed bars: those stay on the tonight strip using
    // saved locks or a stable fallback (planned start → created → now for in_progress).
    if (tonightWeatherPrediction === 'not_permitted' || hasAnyPrecipitationTonight) {
      const nowMs = Date.now()
      const blocks: Array<{ id: string; startMs: number; endMs: number; topPct: number; heightPct: number; label: string }> =
        []
      const newlyLocked: Record<string, { startMs: number; endMs: number }> = {}

      for (const item of scheduleStripItems) {
        if (item.status !== 'in_progress' && item.status !== 'completed') continue
        if (
          item.status === 'completed' &&
          !completedSessionOverlapsTonightStripWindow(
            item,
            tonightNightKey,
            windowStartMs,
            windowEndMs,
            effectiveLocks
          )
        ) {
          continue
        }
        const placed =
          item.status === 'in_progress'
            ? inProgressSchedulePlacement(
                item,
                effectiveLocks,
                imagingStartMs,
                schedulingDeadlineMs,
                nowMs
              ) ??
              fallbackPlacementForTerminalSession(
                item,
                effectiveLocks,
                imagingStartMs,
                schedulingDeadlineMs,
                nowMs
              )
            : serverScheduleBarForNight(item, tonightNightKey) ??
              fallbackPlacementForTerminalSession(
                item,
                effectiveLocks,
                imagingStartMs,
                schedulingDeadlineMs,
                nowMs
              )
        if (!placed) continue
        const startMs = Math.max(placed.startMs, imagingStartMs)
        const endMs = Math.min(placed.endMs, schedulingDeadlineMs)
        if (endMs <= startMs) continue
        const topPct = ((startMs - windowStartMs) / (windowEndMs - windowStartMs)) * 100
        const heightPct = ((endMs - startMs) / (windowEndMs - windowStartMs)) * 100
        blocks.push({ id: item.id, startMs, endMs, topPct, heightPct, label: item.target })
        if (item.status === 'in_progress') {
          const prev = effectiveLocks[item.id]
          if (!prev || prev.startMs !== startMs || prev.endMs !== endMs) {
            newlyLocked[item.id] = { startMs, endMs }
          }
        } else if (!effectiveLocks[item.id]) {
          newlyLocked[item.id] = { startMs, endMs }
        }
      }
      // Server-scheduled sessions keep their planned bar even when later hours fail the global gate.
      for (const scheduled of listScheduledPendingPlacements(
        scheduleStripItems,
        imagingStartMs,
        schedulingDeadlineMs,
        tonightNightKey
      )) {
        blocks.push(placementToTimelineBlock(scheduled, windowStartMs, windowEndMs))
      }
      blocks.sort((a, b) => a.startMs - b.startMs)
      return { blocks, newlyLocked }
    }

    const readyHourKeySet = new Set(readyWeatherHourKeys)
    const readyHourStartsMs = tonightSchedule.hours
      .filter((h) => readyWeatherHourKeys.includes(h.hourKey))
      .map((h) => h.hourStartMs)
      .sort((a, b) => a - b)

    const blocks: Array<{ id: string; startMs: number; endMs: number; topPct: number; heightPct: number; label: string }> = []
    type Interval = { startMs: number; endMs: number }
    let freeIntervals: Interval[] = [{ startMs: imagingStartMs, endMs: schedulingDeadlineMs }]
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
      item: (typeof scheduleStripItems)[number],
      minStartMs: number
    ): { startMs: number; endMs: number } | null => {
      const createdMs = Number.isFinite(Date.parse(item.createdAt)) ? Date.parse(item.createdAt) : windowStartMs
      const plannedMs = item.plannedStartIso ? Date.parse(item.plannedStartIso) : Number.NaN
      const anchorMs = Number.isFinite(plannedMs) ? plannedMs : createdMs
      const estimatedSeconds =
        typeof item.estimatedDurationSeconds === 'number' && Number.isFinite(item.estimatedDurationSeconds)
          ? item.estimatedDurationSeconds
          : estimateDurationSecondsFromPlans(item.filterPlans)
      const durationMs = Math.max(estimatedSeconds, 60) * 1000

      for (const interval of freeIntervals) {
        if (interval.endMs <= interval.startMs) continue
        let startMs = Math.max(interval.startMs, anchorMs, nauticalDuskMs, minStartMs)

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
          if (!altitudeSessionCoverageOk(item.raHours, item.decDeg, startMs, endMs)) continue
        }

        return { startMs, endMs }
      }

      return null
    }

    const newlyLocked: Record<string, { startMs: number; endMs: number }> = {}
    const lockable = scheduleStripItems
      .filter((item) => item.status === 'in_progress' || item.status === 'completed')
      .filter((item) => {
        if (item.status === 'in_progress') return true
        return completedSessionOverlapsTonightStripWindow(
          item,
          tonightNightKey,
          windowStartMs,
          windowEndMs,
          effectiveLocks
        )
      })
      .sort((a, b) => {
        const aMs = a.plannedStartIso ? Date.parse(a.plannedStartIso) : Date.parse(a.createdAt)
        const bMs = b.plannedStartIso ? Date.parse(b.plannedStartIso) : Date.parse(b.createdAt)
        return (Number.isFinite(aMs) ? aMs : 0) - (Number.isFinite(bMs) ? bMs : 0)
      })

    for (const item of lockable) {
      let placed: { startMs: number; endMs: number } | undefined = effectiveLocks[item.id]
      if (item.status === 'in_progress') {
        const locked = inProgressSchedulePlacement(
          item,
          effectiveLocks,
          imagingStartMs,
          schedulingDeadlineMs,
          Date.now()
        )
        if (!locked) continue
        placed = locked
        const prev = effectiveLocks[item.id]
        if (!prev || prev.startMs !== locked.startMs || prev.endMs !== locked.endMs) {
          newlyLocked[item.id] = locked
        }
      } else if (!placed) {
        const computed = placeInFreeIntervals(item, imagingStartMs)
        if (computed) {
          placed = computed
          newlyLocked[item.id] = placed
        } else {
          const fb = fallbackPlacementForTerminalSession(
            item,
            effectiveLocks,
            imagingStartMs,
            schedulingDeadlineMs,
            Date.now(),
          )
          if (!fb) continue
          placed = fb
          newlyLocked[item.id] = placed
        }
      }

      if (!placed) continue

      const startMs = Math.max(placed.startMs, imagingStartMs)
      const endMs = Math.min(placed.endMs, schedulingDeadlineMs)
      if (endMs <= startMs) continue

      freeIntervals = subtractInterval(freeIntervals, { startMs, endMs })

      const topPct = ((startMs - windowStartMs) / (windowEndMs - windowStartMs)) * 100
      const heightPct = ((endMs - startMs) / (windowEndMs - windowStartMs)) * 100
      blocks.push({ id: item.id, startMs, endMs, topPct, heightPct, label: item.target })
    }

    const scheduledPending = listScheduledPendingPlacements(
      scheduleStripItems,
      imagingStartMs,
      schedulingDeadlineMs,
      tonightNightKey
    )

    for (const scheduled of scheduledPending) {
      freeIntervals = subtractInterval(freeIntervals, {
        startMs: scheduled.startMs,
        endMs: scheduled.endMs,
      })
      blocks.push(placementToTimelineBlock(scheduled, windowStartMs, windowEndMs))
    }

    blocks.sort((a, b) => a.startMs - b.startMs)
    return { blocks, newlyLocked }
  }, [
    scheduleStripItems,
    readyWeatherHourKeys,
    tonightSchedule,
    tonightNightKey,
    lockedSessionSchedule,
    tonightWeatherPrediction,
    hasAnyPrecipitationTonight,
    adminClosedWindows,
  ])

  useEffect(() => {
    const windowStartMs = tonightSchedule.start.getTime()
    const windowEndMs = tonightSchedule.end.getTime()
    setLockedSessionSchedule((prev) => {
      const activeLockableIds = new Set(
        scheduleStripItems
          .filter((x) => x.status === 'in_progress' || x.status === 'completed')
          .map((x) => x.id)
      )

      const next: Record<string, { startMs: number; endMs: number }> = {}
      let changed = false

      for (const [id, placement] of Object.entries(prev)) {
        if (!activeLockableIds.has(id)) {
          changed = true
          continue
        }
        const item = scheduleStripItems.find((x) => x.id === id)
        if (
          item?.status === 'completed' &&
          !completedSessionOverlapsTonightStripWindow(item, tonightNightKey, windowStartMs, windowEndMs, prev)
        ) {
          changed = true
          continue
        }
        next[id] = placement
      }

      for (const [id, placement] of Object.entries(sessionSchedulePlan.newlyLocked)) {
        const prev = next[id]
        if (!prev || prev.startMs !== placement.startMs || prev.endMs !== placement.endMs) {
          next[id] = placement
          changed = true
        }
      }

      for (const [id, placement] of Object.entries(next)) {
        const item = scheduleStripItems.find((x) => x.id === id)
        if (!item) continue
        if (item.status !== 'in_progress' && item.status !== 'completed') continue
        // Never re-stamp a completed session onto a later strip night.
        if (
          item.status === 'completed' &&
          typeof item.scheduleStripNightKey === 'string' &&
          item.scheduleStripNightKey.trim() &&
          item.scheduleStripNightKey !== tonightNightKey
        ) {
          continue
        }
        const frozen = serverScheduleBarForNight(item, tonightNightKey)
        if (frozen && item.status !== 'in_progress') continue
        if (
          frozen &&
          item.status === 'in_progress' &&
          frozen.startMs === placement.startMs &&
          frozen.endMs === placement.endMs
        ) {
          continue
        }
        void persistScheduleBarPlacement(id, tonightNightKey, placement.startMs, placement.endMs)
      }

      return changed ? next : prev
    })
  }, [
    scheduleStripItems,
    sessionSchedulePlan.newlyLocked,
    tonightSchedule.start,
    tonightSchedule.end,
    tonightNightKey,
    persistScheduleBarPlacement,
  ])

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
  const terminalSessionDetail = useMemo(() => {
    if (!terminalSessionId) return null
    const direct = queueItems.find((item) => item.id === terminalSessionId)
    if (direct) return direct
    for (const item of queueItems) {
      if (!item.nights) continue
      const night = item.nights.find((n) => n.id === terminalSessionId)
      if (!night) continue
      const sky =
        typeof item.raHours === 'number' &&
        Number.isFinite(item.raHours) &&
        typeof item.decDeg === 'number' &&
        Number.isFinite(item.decDeg)
          ? skyCoordsForMosaicPanel(
              {
                raHours: item.raHours,
                decDeg: item.decDeg,
                mosaicMode: item.mosaicMode === true,
                mosaicPanels: item.mosaicPanels,
              },
              night.mosaicPanelIndex,
            )
          : null
      return {
        ...item,
        id: night.id,
        target: `${item.target} — ${nightDisplayLabel(night)}`,
        status:
          night.status === 'in_progress'
            ? 'in_progress'
            : night.status === 'completed'
              ? 'completed'
              : night.status === 'failed'
                ? 'failed'
                : night.status,
        filterPlans: night.filterPlans ?? item.filterPlans,
        estimatedDurationSeconds: night.estimatedDurationSeconds ?? item.estimatedDurationSeconds,
        ...(sky
          ? { raHours: sky.raHours, decDeg: sky.decDeg }
          : {}),
      }
    }
    return null
  }, [queueItems, terminalSessionId])

  const resolveSessionPassword = useCallback(
    (sessionId: string): string => {
      const direct = sessionPasswords[sessionId]
      if (direct) return direct
      const nightSub = parseProjectNightSubId(sessionId)
      if (nightSub) return sessionPasswords[nightSub.projectId] ?? ''
      return ''
    },
    [sessionPasswords]
  )

  useEffect(() => {
    if (!terminalSessionId) {
      terminalOpenedSessionRef.current = null
      return
    }
    const isNewSession = terminalOpenedSessionRef.current !== terminalSessionId
    terminalOpenedSessionRef.current = terminalSessionId
    if (isNewSession) {
      setTerminalLines([])
      setTerminalQueueStatus(null)
      setTerminalError(null)
      setTerminalLoading(true)
      setTerminalPreviewUrl(null)
      setTerminalPreviewError(null)
      setTerminalPreviewUpdatedAt(null)
      terminalPreviewLastFingerprintRef.current = null
    }
    const password = resolveSessionPasswordRef.current(terminalSessionId)
    if (isNewSession) void loadTerminalPreviewRef.current(terminalSessionId, password)
  }, [terminalSessionId])

  const downloadSessionFile = useCallback(
    async (queueId: string, password: string): Promise<string | null> => {
      const res = await fetch(`/api/imaging/download?queueId=${encodeURIComponent(queueId)}&mode=json`, {
        credentials: 'include',
        headers: password ? { 'x-session-password': password } : {},
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || data?.ok !== true || typeof data.signedUrl !== 'string') {
        return typeof data.error === 'string' ? data.error : 'Download failed.'
      }
      window.location.assign(data.signedUrl)
      await refreshQueue()
      return null
    },
    [refreshQueue]
  )

  const loadTerminalPreview = useCallback(
    async (id: string, passwordOverride?: string) => {
      const password = passwordOverride ?? resolveSessionPassword(id)
      if (!password && !isAdmin && !canAccessSessionId(id)) return
      try {
        const res = await fetch(
          `/api/imaging/preview?queueId=${encodeURIComponent(id)}&mode=json&_=${Date.now()}`,
          {
            credentials: 'include',
            headers: password ? { 'x-session-password': password } : {},
            cache: 'no-store',
          }
        )
        const data = await res.json().catch(() => ({}))
        if (!res.ok || data?.ok !== true || typeof data.dataBase64 !== 'string') {
          if (res.status === 404) {
            setTerminalPreviewUrl(null)
            setTerminalPreviewError(null)
            setTerminalPreviewUpdatedAt(null)
            terminalPreviewLastFingerprintRef.current = null
            return
          }
          setTerminalPreviewError(typeof data.error === 'string' ? data.error : 'Preview unavailable.')
          return
        }
        const updatedAt = typeof data.updatedAt === 'string' ? data.updatedAt : null
        const dataBase64 = data.dataBase64 as string
        const fingerprint = `${updatedAt ?? ''}|${dataBase64.length}|${dataBase64.slice(0, 240)}|${dataBase64.slice(-240)}`
        if (fingerprint === terminalPreviewLastFingerprintRef.current) {
          setTerminalPreviewError(null)
          return
        }
        terminalPreviewLastFingerprintRef.current = fingerprint
        const contentType = typeof data.contentType === 'string' ? data.contentType : 'image/jpeg'
        const nextPreviewUrl = `data:${contentType};base64,${dataBase64}`
        await new Promise<void>((resolve) => {
          const image = new window.Image()
          image.onload = () => resolve()
          image.onerror = () => resolve()
          image.src = nextPreviewUrl
        })
        setTerminalPreviewError(null)
        setTerminalPreviewUpdatedAt(updatedAt)
        setTerminalPreviewUrl(nextPreviewUrl)
      } catch {
        setTerminalPreviewError('Preview unavailable.')
      }
    },
    [resolveSessionPassword, isAdmin, canAccessSessionId]
  )

  const loadTerminalPreviewRef = useRef(loadTerminalPreview)
  loadTerminalPreviewRef.current = loadTerminalPreview

  const resolveSessionPasswordRef = useRef(resolveSessionPassword)
  resolveSessionPasswordRef.current = resolveSessionPassword

  const canAccessSessionIdRef = useRef(canAccessSessionId)
  canAccessSessionIdRef.current = canAccessSessionId

  useAdaptivePoll(
    'preview',
    () => {
      if (!terminalSessionId) return
      const sessionId = terminalSessionId
      const password = resolveSessionPasswordRef.current(sessionId)
      if (!password && !isAdmin && !canAccessSessionIdRef.current(sessionId)) return
      void loadTerminalPreviewRef.current(sessionId, password)
    },
    { enabled: Boolean(terminalSessionId), imagingActive: terminalImagingActive }
  )

  useAdaptivePoll(
    'progress',
    async () => {
      if (!terminalSessionId) return
      const sessionId = terminalSessionId
      const password = resolveSessionPasswordRef.current(sessionId)
      if (!password && !isAdmin && !canAccessSessionIdRef.current(sessionId)) {
        setTerminalError('Session password required.')
        setTerminalLoading(false)
        return
      }
      const headers: HeadersInit = password ? { 'x-session-password': password } : {}
      try {
        const res = await fetch(`/api/imaging/queue/${encodeURIComponent(sessionId)}/progress`, {
          cache: 'no-store',
          headers,
        })
        const data = (await res.json().catch(() => ({}))) as {
          ok?: boolean
          lines?: SessionProgressLine[]
          queueStatus?: string
          error?: string
        }
        if (!res.ok || data.ok !== true) {
          setTerminalLoading(false)
          if (typeof data.error === 'string') setTerminalError(data.error)
          return
        }
        setTerminalError(null)
        setTerminalLines(Array.isArray(data.lines) ? data.lines : [])
        setTerminalQueueStatus(typeof data.queueStatus === 'string' ? data.queueStatus : null)
        setTerminalLoading(false)
        if (data.queueStatus === 'completed') void refreshQueueRef.current()
      } catch {
        setTerminalLoading(false)
      }
    },
    { enabled: Boolean(terminalSessionId), imagingActive: terminalImagingActive }
  )

  useEffect(() => {
    terminalEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [terminalLines, terminalSessionId])

  async function parseCoordinates(): Promise<{ raHours: number; decDeg: number } | null> {
    const r = parseCoordsFromFormParts(
      raHourPart,
      raMinutePart,
      raSecondPart,
      decSign,
      decDegreePart,
      decMinutePart,
      decSecondPart
    )
    if (!r.ok) {
      setSubmitError(r.message)
      return null
    }
    return { raHours: r.raHours, decDeg: r.decDeg }
  }

  async function submitRequest(coords: { raHours: number; decDeg: number }) {
    const normalizeFormPlans = (
      plans: FilterPlanFormRow[],
      panelLabel?: string,
    ): Array<{ filterName: string; count: number; exposureSeconds: number }> | null => {
      const out: Array<{ filterName: string; count: number; exposureSeconds: number }> = []
      for (const plan of plans) {
        const filterName = plan.filterName.trim()
        const frames = Math.round(Number(plan.count))
        const exposure = Math.round(Number(plan.exposureSeconds))
        const where = panelLabel ? ` (${panelLabel})` : ''
        if (!filterName) {
          setSubmitError(`Filter name is required for each row${where}.`)
          return null
        }
        if (!Number.isFinite(frames) || frames < 1) {
          setSubmitError(`Frame count for ${filterName}${where} must be at least 1.`)
          return null
        }
        if (!Number.isFinite(exposure) || exposure < 1 || exposure > 3600) {
          setSubmitError(`Exposure for ${filterName}${where} must be between 1 and 3600 seconds.`)
          return null
        }
        out.push({ filterName, count: frames, exposureSeconds: exposure })
      }
      return out
    }

    let normalizedPlans: Array<{ filterName: string; count: number; exposureSeconds: number }> = []
    let mosaicFilterPlansByPanel:
      | Array<Array<{ filterName: string; count: number; exposureSeconds: number }>>
      | undefined

    if (sessionType === 'variable_star') {
      normalizedPlans = [{ filterName: 'G', count: 1, exposureSeconds: 30 }]
    } else if (mosaicMode && mosaicDraft?.panels?.length) {
      const flushed = {
        ...panelFilterPlansByIdRef.current,
        [selectedMosaicPanelIdRef.current]: cloneFilterPlanForms(filterPlansRef.current),
      }
      setPanelFilterPlansById(flushed)
      mosaicFilterPlansByPanel = []
      for (const panel of mosaicDraft.panels) {
        const formPlans = flushed[panel.id] ?? []
        if (formPlans.length === 0) {
          setSubmitError(`Select at least one filter for ${panel.name}.`)
          return
        }
        const normalized = normalizeFormPlans(formPlans, panel.name)
        if (!normalized) return
        mosaicFilterPlansByPanel.push(normalized)
      }
      normalizedPlans = mosaicFilterPlansByPanel.flat()
      if (normalizedPlans.length === 0) {
        setSubmitError('Select at least one filter.')
        return
      }
    } else {
      if (filterPlans.length === 0) {
        setSubmitError('Select at least one filter.')
        return
      }
      const normalized = normalizeFormPlans(filterPlans)
      if (!normalized) return
      normalizedPlans = normalized
    }
    const firstPlan = normalizedPlans[0]
    if (!loggedInContact?.email) {
      setSubmitError('Sign in to submit a session.')
      return
    }
    if (!imagingAccess.ok) {
      setSubmitError(imagingAccess.error)
      return
    }

    if (mosaicMode && mosaicDraft?.panels?.length) {
      for (const panel of mosaicDraft.panels) {
        const obsErr = pomfretTargetObservabilityError(panel.decDeg)
        if (obsErr) {
          setSubmitError(`${panel.name}: ${obsErr}`)
          return
        }
      }
    } else {
      const obsErr = pomfretTargetObservabilityError(coords.decDeg)
      if (obsErr) {
        setSubmitError(obsErr)
        return
      }
    }

    if (sessionType === 'variable_star') {
      if (!variableStarDurationPick || !variableStarDurationPick.coordsOk) {
        setSubmitError('Enter valid RA and Dec for a variable star session.')
        return
      }
      const { starHalfSteps, allOptions } = variableStarDurationPick
      if (starHalfSteps < 1) {
        setSubmitError("This target is not high enough in tonight's scheduling window for the chosen duration.")
        return
      }
      const maxEnabled = starHalfSteps * 0.5
      if (!allOptions.includes(variableStarBlockHours) || variableStarBlockHours > maxEnabled + 1e-9) {
        setSubmitError("Pick a session duration that fits tonight's visibility (the enabled buttons above).")
        return
      }
    }

    const { nauticalDuskUtc } = getTonightSchedulingWindow(new Date(scheduleNowMs))
    const vsPick = variableStarDurationPick
    const estimatedDurationSeconds =
      sessionType === 'variable_star' && vsPick?.coordsOk
        ? Math.round(
            variableStarSessionDurationSeconds({
              blockHours: variableStarBlockHours,
              raHours: vsPick.raHours,
              startMs: nauticalDuskUtc.getTime(),
            })
          )
        : mosaicFilterPlansByPanel
          ? mosaicFilterPlansByPanel.reduce((sum, plans) => sum + estimateDurationSecondsFromPlans(plans), 0)
          : estimateDurationSecondsFromPlans(normalizedPlans)

    const variableStarAmplitudeMag =
      sessionType === 'variable_star' &&
      variableStarPreviewStar?.minMag != null &&
      variableStarPreviewStar?.maxMag != null &&
      Number.isFinite(variableStarPreviewStar.minMag) &&
      Number.isFinite(variableStarPreviewStar.maxMag)
        ? Math.abs(variableStarPreviewStar.minMag - variableStarPreviewStar.maxMag)
        : undefined

    const endpoint = editingSessionId ? `/api/imaging/queue/${encodeURIComponent(editingSessionId)}` : '/api/imaging/queue'
    const editCredential = editingSessionId ? sessionPasswords[editingSessionId] ?? '' : ''
    const res = await observatorySiteFetch(endpoint, siteId, {
      method: editingSessionId ? 'PUT' : 'POST',
      credentials: 'include',
      headers: {
        ...jsonHeaders,
        ...(editingSessionId && editCredential && !isAdmin ? { 'x-edit-credential': editCredential } : {}),
      },
      body: JSON.stringify({
        count: firstPlan.count,
        exposureSeconds: firstPlan.exposureSeconds,
        filter: firstPlan.filterName,
        filterPlans: normalizedPlans,
        target: requestName.trim() === '' ? null : requestName.trim(),
        firstName: loggedInContact.firstName,
        lastName: loggedInContact.lastName,
        email: loggedInContact.email,
        raHours: coords.raHours,
        decDeg: coords.decDeg,
        whenClosedBehavior: 'queue_until_ready',
        ...(isLoggedIn && !sessionPassword.trim() ? {} : { sessionPassword }),
        outputMode: outputMode === 'none' ? 'none' : 'raw_zip',
        cameraCoolingTempC,
        estimatedDurationSeconds,
        sessionType,
        ...(variableStarAmplitudeMag != null && variableStarAmplitudeMag > 0
          ? { variableStarAmplitudeMag }
          : {}),
        ...(sessionType === 'dso' && projectMode ? { projectMode: true } : {}),
        ...(sessionType === 'dso' && mosaicMode && mosaicDraft?.panels?.length
          ? {
              mosaicMode: true,
              mosaicPanels: mosaicDraft.panels,
              ...(mosaicFilterPlansByPanel ? { mosaicFilterPlansByPanel } : {}),
            }
          : {}),
      }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      setSubmitError(typeof data.error === 'string' ? data.error : res.statusText)
      return
    }

    setFilterPlans([])
    setPanelFilterPlansById({})
    setRequestName('')
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
    setProjectModeTri('off')
    setMosaicDraft(null)
    setVariableStarBlockHours(1)
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
        : data.adminApprovalPending === true
          ? typeof data.message === 'string'
            ? data.message
            : 'Session submitted for administrator approval.'
          : 'Session submitted. It will appear in Current Sessions when scheduled.'
    )
    await refreshQueue()
  }

  async function handleDeleteRequest(id: string, password: string) {
    const res = await fetch(`/api/imaging/queue/${id}`, {
      method: 'DELETE',
      credentials: 'include',
      headers: password.trim() ? { 'x-delete-credential': password.trim() } : {},
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

  const openProjectPickerAfterAccess = useCallback(
    async (projectId: string, purpose: 'progress' | 'download') => {
      const res = await fetch(`/api/imaging/queue/${encodeURIComponent(projectId)}/progress`, {
        credentials: 'include',
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || data?.ok !== true) {
        setDeleteError(typeof data.error === 'string' ? data.error : 'Could not access project session.')
        return false
      }
      setNightPickerProjectId(projectId)
      setNightPickerPurpose(purpose)
      return true
    },
    []
  )

  const handleCheckProgressClick = useCallback(
    async (item: (typeof queueItems)[number]) => {
      if (!canInteractWithSession(item)) return
      const isProjectSession = item.projectMode === true || (item.nights?.length ?? 0) > 0
      if (isProjectSession) {
        if (isAdmin || sessionOwnedByMe(item)) {
          await openProjectPickerAfterAccess(item.id, 'progress')
          return
        }
        setAuthModalSessionId(item.id)
        setAuthModalAction('project_progress')
        setAuthError(null)
        setAuthPassword(sessionPasswords[item.id] ?? '')
        return
      }
      if (isAdmin || sessionOwnedByMe(item)) {
        setTerminalSessionId(item.id)
        return
      }
      setAuthModalSessionId(item.id)
      setAuthModalAction('progress')
      setAuthError(null)
      setAuthPassword(sessionPasswords[item.id] ?? '')
    },
    [
      canInteractWithSession,
      isAdmin,
      openProjectPickerAfterAccess,
      sessionOwnedByMe,
      sessionPasswords,
    ]
  )

  const handleDownloadClick = useCallback(
    async (item: (typeof queueItems)[number]) => {
      if (!canInteractWithSession(item)) return
      const isProjectSession = item.projectMode === true || (item.nights?.length ?? 0) > 0
      if (isProjectSession) {
        if (isAdmin || sessionOwnedByMe(item)) {
          await openProjectPickerAfterAccess(item.id, 'download')
          return
        }
        setAuthModalSessionId(item.id)
        setAuthModalAction('project_download')
        setAuthError(null)
        setAuthPassword(sessionPasswords[item.id] ?? '')
        return
      }
      if (isAdmin || sessionOwnedByMe(item)) {
        const err = await downloadSessionFile(item.id, '')
        if (err) setDeleteError(err)
        return
      }
      setAuthModalSessionId(item.id)
      setAuthModalAction('download')
      setAuthError(null)
      setAuthPassword(sessionPasswords[item.id] ?? '')
    },
    [
      canInteractWithSession,
      downloadSessionFile,
      isAdmin,
      openProjectPickerAfterAccess,
      sessionOwnedByMe,
      sessionPasswords,
    ]
  )

  const handleEditSessionClick = useCallback(
    (item: (typeof queueItems)[number]) => {
      if (!canInteractWithSession(item)) return
      if (isAdmin || sessionOwnedByMe(item)) {
        beginEditSession(item)
        return
      }
      setAuthModalSessionId(item.id)
      setAuthModalAction('edit')
      setAuthError(null)
      setAuthPassword(sessionPasswords[item.id] ?? '')
    },
    [canInteractWithSession, isAdmin, sessionOwnedByMe, sessionPasswords]
  )

  const handleDeleteSessionClick = useCallback((item: (typeof queueItems)[number]) => {
    setDeleteError(null)
    setDeleteTargetId(item.id)
    setDeletePassword('')
    setShowDeleteModal(true)
  }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitError(null)
    setSubmitSuccess(null)
    setSubmitting(true)
    try {
      const coords = await parseCoordinates()
      if (!coords) return
      await submitRequest(coords)
    } finally {
      setSubmitting(false)
    }
  }

  function beginEditSession(item: (typeof queueItems)[number]) {
    setEditingSessionId(item.id)
    const isMosaic =
      item.mosaicMode === true || (Array.isArray(item.mosaicPanels) && item.mosaicPanels.length > 0)
    setProjectModeTri(isMosaic ? 'mosaic' : item.projectMode === true ? 'on' : 'off')
    setSessionType(item.sessionType === 'variable_star' ? 'variable_star' : 'dso')
    setVariableStarPreviewStar(null)
    setVariableStarLastFoundName(null)
    setVariableStarListSelection('')
    setCatalogQuery('')
    setCatalogLookupResult(null)
    setCatalogLookupError(null)
    setRequestName(item.target ?? '')
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
    if (item.sessionType === 'variable_star') {
      const est = item.estimatedDurationSeconds
      const raHours =
        typeof item.raHours === 'number' && Number.isFinite(item.raHours) ? item.raHours : undefined
      const { nauticalDuskUtc } = getTonightSchedulingWindow(new Date(scheduleNowMs))
      if (typeof est === 'number' && Number.isFinite(est) && est > 0) {
        const blockH = variableStarBlockHoursFromTotalSeconds(est, {
          raHours,
          startMs: nauticalDuskUtc.getTime(),
        })
        setVariableStarBlockHours(blockH != null && blockH >= 0.5 ? blockH : 1)
      } else {
        setVariableStarBlockHours(1)
      }
    } else {
      setVariableStarBlockHours(1)
    }
    setOutputMode(item.outputMode === 'none' ? 'none' : 'raw_zip')
    if (item.cameraCoolingTempC === 0 || item.cameraCoolingTempC === -10) {
      setCameraCoolingTempC(item.cameraCoolingTempC)
    }

    const sharedFilterForms: FilterPlanFormRow[] =
      Array.isArray(item.filterPlans) && item.filterPlans.length > 0
        ? item.filterPlans.map((p) => ({
            filterName: p.filterName,
            count: String(p.count),
            exposureSeconds: String(p.exposureSeconds),
          }))
        : []

    if (isMosaic && item.mosaicPanels && item.mosaicPanels.length > 0) {
      const panels = item.mosaicPanels.map((p) => toMosaicDraftPanel(p))
      const center = panels[0]!
      const raHours =
        typeof item.raHours === 'number' && Number.isFinite(item.raHours) ? item.raHours : center.raHours
      const decDeg =
        typeof item.decDeg === 'number' && Number.isFinite(item.decDeg) ? item.decDeg : center.decDeg
      setMosaicDraft(mosaicDraftFromCoords(panels, item.target ?? 'Mosaic target', raHours, decDeg))
      const byId: Record<number, FilterPlanFormRow[]> = {}
      const perPanel =
        item.mosaicFilterPlansByPanel &&
        item.mosaicFilterPlansByPanel.length === panels.length
          ? item.mosaicFilterPlansByPanel
          : null
      for (let i = 0; i < panels.length; i++) {
        const panel = panels[i]!
        const plans = perPanel
          ? perPanel[i]!.map((p) => ({
              filterName: p.filterName,
              count: String(p.count),
              exposureSeconds: String(p.exposureSeconds),
            }))
          : cloneFilterPlanForms(sharedFilterForms)
        byId[panel.id] = plans
      }
      setPanelFilterPlansById(byId)
      setSelectedMosaicPanelId(center.id)
      setFilterPlans(cloneFilterPlanForms(byId[center.id] ?? sharedFilterForms))
      applySexagesimalPartsFromRadec(
        center.raHours,
        center.decDeg,
        setRaHourPart,
        setRaMinutePart,
        setRaSecondPart,
        setDecSign,
        setDecDegreePart,
        setDecMinutePart,
        setDecSecondPart,
      )
    } else {
      setMosaicDraft(null)
      setPanelFilterPlansById({})
      setSelectedMosaicPanelId(1)
      setFilterPlans(sharedFilterForms)
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

  const dsoTonightAltitudePreview = useMemo(() => {
    if (sessionType !== 'dso' || !catalogLookupResult) return null
    const h = Number(raHourPart)
    const m = Number(raMinutePart)
    const s = Number(raSecondPart)
    const dd = Number(decDegreePart)
    const dm = Number(decMinutePart)
    const ds = Number(decSecondPart)
    if (
      !Number.isFinite(h) ||
      !Number.isFinite(m) ||
      !Number.isFinite(s) ||
      !Number.isFinite(dd) ||
      !Number.isFinite(dm) ||
      !Number.isFinite(ds)
    ) {
      return null
    }
    if (h < 0 || h > 23 || m < 0 || m > 59 || s < 0 || s >= 60) return null
    if (dd < 0 || dd > 90 || dm < 0 || dm > 59 || ds < 0 || ds >= 60) return null
    const raHours = h + m / 60 + s / 3600
    let decDeg = dd + dm / 60 + ds / 3600
    if (decSign === '-') decDeg = -decDeg

    const now = new Date()
    const { astronomicalDuskUtc, astronomicalDawnUtc } = getTonightAstronomicalNightWindow(now)
    const duskMs = astronomicalDuskUtc.getTime()
    const dawnMs = astronomicalDawnUtc.getTime()
    if (dawnMs <= duskMs) return null

    const STEP_MS = 5 * 60 * 1000
    const samples: Array<{ ms: number; alt: number }> = []
    for (let ms = duskMs; ms <= dawnMs; ms += STEP_MS) {
      samples.push({ ms, alt: currentAltitudeDegAt(raHours, decDeg, new Date(ms)) })
    }
    if (samples[samples.length - 1]?.ms !== dawnMs) {
      samples.push({ ms: dawnMs, alt: currentAltitudeDegAt(raHours, decDeg, new Date(dawnMs)) })
    }
    return {
      duskMs,
      dawnMs,
      xTickMs: Array.from({ length: 7 }, (_, i) => duskMs + ((dawnMs - duskMs) * i) / 6),
      samples,
    }
  }, [
    sessionType,
    catalogLookupResult,
    raHourPart,
    raMinutePart,
    raSecondPart,
    decSign,
    decDegreePart,
    decMinutePart,
    decSecondPart,
  ])

  return (
    <div className="pb-4 sm:pb-8">
      <div className="grid gap-4 sm:gap-6 lg:-translate-x-3 lg:grid-cols-[minmax(0,3fr)_1px_minmax(0,2fr)] lg:items-start">
        <RemoteSessionForm
          status={status}
          showTonightWeatherHeadline={showTonightWeatherHeadline}
          tonightWeatherPrediction={tonightWeatherPrediction}
          statusLoadError={statusLoadError}
          member={member}
          isLoggedIn={isLoggedIn}
          imagingAccess={imagingAccess}
          verifySending={verifySending}
          setVerifySending={setVerifySending}
          verifyMsg={verifyMsg}
          setVerifyMsg={setVerifyMsg}
          handleSubmit={handleSubmit}
          sessionType={sessionType}
          setSessionType={setSessionType}
          filterPlans={filterPlans}
          setFilterPlans={setFilterPlans}
          panelFilterPlansById={panelFilterPlansById}
          setPanelFilterPlansById={setPanelFilterPlansById}
          catalogQuery={catalogQuery}
          setCatalogQuery={setCatalogQuery}
          variableStarPreviewStar={variableStarPreviewStar}
          setVariableStarPreviewStar={setVariableStarPreviewStar}
          variableStarLastFoundName={variableStarLastFoundName}
          setVariableStarLastFoundName={setVariableStarLastFoundName}
          variableStarLastFoundSource={variableStarLastFoundSource}
          setVariableStarLastFoundSource={setVariableStarLastFoundSource}
          variableStarListSelection={variableStarListSelection}
          setVariableStarListSelection={setVariableStarListSelection}
          variableStarFilterSelection={variableStarFilterSelection}
          setVariableStarFilterSelection={setVariableStarFilterSelection}
          catalogLookupError={catalogLookupError}
          setCatalogLookupError={setCatalogLookupError}
          catalogLookupResult={catalogLookupResult}
          setCatalogLookupResult={setCatalogLookupResult}
          variableStarBlockHours={variableStarBlockHours}
          setVariableStarBlockHours={setVariableStarBlockHours}
          editingSessionId={editingSessionId}
          setEditingSessionId={setEditingSessionId}
          requestName={requestName}
          setRequestName={setRequestName}
          raHourPart={raHourPart}
          setRaHourPart={setRaHourPart}
          raMinutePart={raMinutePart}
          setRaMinutePart={setRaMinutePart}
          raSecondPart={raSecondPart}
          setRaSecondPart={setRaSecondPart}
          decSign={decSign}
          setDecSign={setDecSign}
          decDegreePart={decDegreePart}
          setDecDegreePart={setDecDegreePart}
          decMinutePart={decMinutePart}
          setDecMinutePart={setDecMinutePart}
          decSecondPart={decSecondPart}
          setDecSecondPart={setDecSecondPart}
          sessionPassword={sessionPassword}
          setSessionPassword={setSessionPassword}
          outputMode={outputMode}
          setOutputMode={setOutputMode}
          projectModeTri={projectModeTri}
          setProjectModeTri={setProjectModeTri}
          enableMosaicMode={enableMosaicMode}
          variableStarCatalogLoading={variableStarCatalogLoading}
          variableStarCatalogError={variableStarCatalogError}
          variableStarFilterDropdownRef={variableStarFilterDropdownRef}
          variableStarFilterDropdownOpen={variableStarFilterDropdownOpen}
          setVariableStarFilterDropdownOpen={setVariableStarFilterDropdownOpen}
          variableStarFilterKey={variableStarFilterKey}
          variableStarCatalog={variableStarCatalog}
          displayedVariableStars={displayedVariableStars}
          applyVariableStarCatalogRow={applyVariableStarCatalogRow}
          variableStarSimbadSearching={variableStarSimbadSearching}
          handleCatalogLookup={handleCatalogLookup}
          mosaicMode={mosaicMode}
          mosaicDraft={mosaicDraft}
          selectedMosaicPanelId={selectedMosaicPanelId}
          selectMosaicPanel={selectMosaicPanel}
          addMosaicPanel={addMosaicPanel}
          catalogLookupLoading={catalogLookupLoading}
          dsoTonightAltitudePreview={dsoTonightAltitudePreview}
          variableStarDurationPick={variableStarDurationPick}
          variableStarDurationUserSelected={variableStarDurationUserSelected}
          setVariableStarDurationUserSelected={setVariableStarDurationUserSelected}
          ambientTempC={ambientTempC}
          cameraCoolingTempC={cameraCoolingTempC}
          setCameraCoolingTempC={setCameraCoolingTempC}
          submitError={submitError}
          submitSuccess={submitSuccess}
          submitting={submitting}
          setRunModalError={setRunModalError}
          setRunModalName={setRunModalName}
          setShowRunRemoteSessionModal={setShowRunRemoteSessionModal}
          canSaveRemoteSessionSpec={canSaveRemoteSessionSpec}
          setSaveModalError={setSaveModalError}
          setSaveModalName={setSaveModalName}
          setShowSaveRemoteSessionModal={setShowSaveRemoteSessionModal}
          dsoEstimatedDurationPreviewSeconds={dsoEstimatedDurationPreviewSeconds}
          variableStarEstimatedDurationPreviewSeconds={variableStarEstimatedDurationPreviewSeconds}
        />
        <div className="hidden lg:block h-full min-h-[16rem] w-px bg-black/10 dark:bg-white/10" />
        <RemoteScheduleStrip
          tonightSchedule={tonightSchedule}
          weatherBlocks={weatherBlocks}
          sessionScheduleBlocks={sessionScheduleBlocks}
        />
      </div>
      <div className="mt-6 border-t border-black/10 dark:border-white/10 lg:-translate-x-3" />
      <div className="mt-6 sm:mt-8 grid gap-4 sm:gap-6 lg:-translate-x-3 lg:grid-cols-[minmax(0,3fr)_1px_minmax(0,2fr)] lg:items-start">
        <RemoteQueuePanel
          queueItems={queueItems}
          deleteError={deleteError}
          canInteractWithSession={canInteractWithSession}
          sessionActionButtonClass={sessionActionButtonClass}
          onDownloadClick={handleDownloadClick}
          onCheckProgressClick={handleCheckProgressClick}
          onEditSessionClick={handleEditSessionClick}
          onDeleteSessionClick={handleDeleteSessionClick}
        />
        <div className="hidden lg:block h-full min-h-[16rem] w-px bg-black/10 dark:bg-white/10" />
        <section className="min-w-0 w-full">
          <h1 className="text-2xl font-semibold text-apple-dark dark:text-white mb-4">Telescope Status</h1>
          <div className="lg:mr-[-4rem]">
            <TelescopeStatusPanel />
          </div>
        </section>
      </div>
      <RemoteModals
        terminalSessionId={terminalSessionId}
        setTerminalSessionId={setTerminalSessionId}
        terminalQueueStatus={terminalQueueStatus}
        terminalLoading={terminalLoading}
        terminalError={terminalError}
        terminalLines={terminalLines}
        terminalEndRef={terminalEndRef}
        terminalPreviewUrl={terminalPreviewUrl}
        terminalPreviewUpdatedAt={terminalPreviewUpdatedAt}
        terminalPreviewError={terminalPreviewError}
        terminalSessionDetail={terminalSessionDetail}
        nightPickerProjectId={nightPickerProjectId}
        nightPickerPurpose={nightPickerPurpose}
        queueItems={queueItems}
        sessionOwnedByMe={sessionOwnedByMe}
        sessionPasswords={sessionPasswords}
        isAdmin={isAdmin}
        downloadSessionFile={downloadSessionFile}
        setDeleteError={setDeleteError}
        setNightPickerProjectId={setNightPickerProjectId}
        setNightPickerPurpose={setNightPickerPurpose}
        setAuthModalSessionId={setAuthModalSessionId}
        setAuthModalAction={setAuthModalAction}
        setAuthError={setAuthError}
        setSessionPasswords={setSessionPasswords}
        authModalSessionId={authModalSessionId}
        authModalAction={authModalAction}
        authPassword={authPassword}
        setAuthPassword={setAuthPassword}
        authError={authError}
        authSubmitting={authSubmitting}
        setAuthSubmitting={setAuthSubmitting}
        beginEditSession={beginEditSession}
        showDeleteModal={showDeleteModal}
        deleteTargetId={deleteTargetId}
        deletePassword={deletePassword}
        setDeletePassword={setDeletePassword}
        deleteError={deleteError}
        deleteSubmitting={deleteSubmitting}
        setDeleteSubmitting={setDeleteSubmitting}
        setShowDeleteModal={setShowDeleteModal}
        setDeleteTargetId={setDeleteTargetId}
        handleDeleteRequest={handleDeleteRequest}
        showSaveRemoteSessionModal={showSaveRemoteSessionModal}
        saveModalName={saveModalName}
        setSaveModalName={setSaveModalName}
        saveModalError={saveModalError}
        setSaveModalError={setSaveModalError}
        setShowSaveRemoteSessionModal={setShowSaveRemoteSessionModal}
        captureRemoteSavedForm={captureRemoteSavedForm}
        refreshCloudSavedSessions={refreshCloudSavedSessions}
        setRequestName={setRequestName}
        setSubmitError={setSubmitError}
        setSubmitSuccess={setSubmitSuccess}
        showRunRemoteSessionModal={showRunRemoteSessionModal}
        cloudSavedSessions={cloudSavedSessions}
        runModalName={runModalName}
        setRunModalName={setRunModalName}
        runModalError={runModalError}
        setRunModalError={setRunModalError}
        setShowRunRemoteSessionModal={setShowRunRemoteSessionModal}
        applyRemoteSavedForm={applyRemoteSavedForm}
      />

    </div>
  )
}
