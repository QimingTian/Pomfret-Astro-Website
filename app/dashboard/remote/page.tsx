'use client'

import { PLAN_MOSAIC_DRAFT_KEY, type MosaicDraft, type MosaicPanel } from '@/lib/mosaic/framing-rectangle'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { MemberAuthPanel } from '@/components/member-auth-panel'
import { useMember } from '@/hooks/use-member'
import { useAdaptivePoll } from '@/hooks/use-adaptive-poll'
import { useSiteStream } from '@/lib/use-site-stream'
import type { VariableStarRow } from '@/lib/variable-star-catalog'
import {
  MIN_ALTITUDE_DEG,
  OBS_LAT_DEG,
  OBS_LON_DEG,
  TONIGHT_OBSERVABLE_MIN_COVERAGE_MS,
  altitudeSessionCoverageOk,
} from '@/lib/target-altitude'
import { getTonightScheduleStrip, isBeforeTonightWeatherHeadline } from '@/lib/schedule-strip'
import {
  getTonightAstronomicalNightWindow,
  getTonightScheduleEveningAstronomyUtc,
  getTonightScheduleMorningAstronomyUtc,
  getTonightSchedulingWindow,
} from '@/lib/sunrise-window'
import { VariableStarPreviewCharts, type VariableStarChartStar } from './variable-star-preview-charts'
import { TelescopeStatusPanel } from './telescope-status-panel'
import {
  fetchMemberSavedSessions,
  loadMemberSavedSessionById,
  loadMemberSavedSessionByName,
  SAVED_SESSION_ID_QUERY,
  saveMemberSavedSession,
  type MemberSavedSessionApiEntry,
  type RemoteSavedSessionFormV1,
} from '@/lib/remote-saved-session'
import { canSubmitImagingPublic } from '@/lib/member-access'
import {
  DSO_SESSION_OVERHEAD_SEC,
  VARIABLE_STAR_SESSION_OVERHEAD_SEC,
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
const VARIABLE_STAR_SESSION_OVERHEAD_HOURS = VARIABLE_STAR_SESSION_OVERHEAD_SEC / 3600
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
type VariableStarFilterUi =
  | 'tonight_observable'
  | 'high_priority'
  | 'short_period'
  | 'mid_period'
  | 'long_period'
  | 'type_na'
  | 'type_lc'
  | 'type_m'
  | 'type_src'
  | 'type_ea'

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
    case 'on_hold':
      return 'On hold'
    case 'in_progress':
      return 'In progress'
    case 'completed':
      return 'Completed'
    case 'claimed':
      return 'In progress'
    case 'failed':
      return 'Failed'
    case 'rejected':
      return 'Rejected'
    default:
      return status
  }
}

function queueStatusBadgeClass(status: string): string {
  if (status === 'pending') return 'text-amber-700 dark:text-amber-400'
  if (status === 'scheduled') return 'text-cyan-700 dark:text-cyan-400'
  if (status === 'on_hold') return 'text-violet-700 dark:text-violet-400'
  if (status === 'in_progress') return 'text-blue-700 dark:text-blue-400'
  if (status === 'completed') return 'text-green-700 dark:text-green-400'
  if (status === 'failed') return 'text-red-700 dark:text-red-400'
  if (status === 'rejected') return 'text-red-700 dark:text-red-400'
  if (status === 'claimed') return 'text-blue-700 dark:text-blue-400'
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
  | 'disconnected'
  | 'closed_weather_not_permitted'
  | 'closed_daytime'
  | 'closed_observatory_maintenance'

function statusLabel(status: ObservatoryStatus): string {
  if (status === 'loading') return '...'
  if (status === 'ready') return 'Ready'
  if (status === 'busy_in_use') return 'Busy -- In Use'
  if (status === 'disconnected') return 'Disconnected'
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

function formatTonightXAxisHour(ms: number): string {
  const d = new Date(ms)
  const h24 = d.getHours()
  const h12 = h24 % 12 || 12
  const ampm = h24 < 12 ? 'AM' : 'PM'
  return `${h12}${ampm}`
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
  if (!Array.isArray(plans) || plans.length === 0) return DSO_SESSION_OVERHEAD_SEC
  const imagingSeconds = plans.reduce((sum, p) => sum + p.count * p.exposureSeconds, 0)
  return Math.max(imagingSeconds + DSO_SESSION_OVERHEAD_SEC, DSO_SESSION_OVERHEAD_SEC)
}

type TerminalSessionLike = {
  id: string
  status: string
  createdAt: string
  nightKey?: string
  plannedStartIso?: string | null
  failedAt?: string | null
  scheduleStripNightKey?: string | null
  scheduleBarStartMs?: number | null
  scheduleBarEndMs?: number | null
  estimatedDurationSeconds?: number
  filterPlans?: Array<{ filterName: string; exposureSeconds: number; count: number }>
}

function serverScheduleBarForNight(
  item: TerminalSessionLike,
  nightKey: string
): { startMs: number; endMs: number } | null {
  if (item.scheduleStripNightKey !== nightKey) return null
  const startMs = item.scheduleBarStartMs
  const endMs = item.scheduleBarEndMs
  if (typeof startMs !== 'number' || typeof endMs !== 'number' || !Number.isFinite(startMs) || !Number.isFinite(endMs)) {
    return null
  }
  if (endMs <= startMs) return null
  return { startMs, endMs }
}

const SESSION_FAILED_TERMINAL_MESSAGE = 'Session failed -- contact support.'

function isSessionFailedTerminalLine(text: string): boolean {
  return text.trim() === SESSION_FAILED_TERMINAL_MESSAGE
}

function sessionDurationMsFromItem(item: {
  estimatedDurationSeconds?: number
  filterPlans?: Array<{ filterName: string; exposureSeconds: number; count: number }>
}): number {
  const estimatedSeconds =
    typeof item.estimatedDurationSeconds === 'number' && Number.isFinite(item.estimatedDurationSeconds)
      ? item.estimatedDurationSeconds
      : estimateDurationSecondsFromPlans(item.filterPlans)
  return Math.max(estimatedSeconds, 60) * 1000
}

type ScheduledStripItem = TerminalSessionLike & { target: string }

function listScheduledPendingPlacements(
  scheduleStripItems: ScheduledStripItem[],
  imagingStartMs: number,
  schedulingDeadlineMs: number,
  tonightNightKey: string
): Array<{ item: ScheduledStripItem; startMs: number; endMs: number }> {
  return scheduleStripItems
    .filter((item) => item.status === 'scheduled')
    .map((item) => {
      const serverBar = serverScheduleBarForNight(item, tonightNightKey)
      if (serverBar) {
        const startMs = Math.max(serverBar.startMs, imagingStartMs)
        const endMs = Math.min(serverBar.endMs, schedulingDeadlineMs)
        if (endMs <= startMs) return null
        return { item, startMs, endMs }
      }
      const startMsRaw = item.plannedStartIso ? Date.parse(item.plannedStartIso) : Number.NaN
      if (!Number.isFinite(startMsRaw)) return null
      if (startMsRaw < imagingStartMs - 60_000) return null
      const durationMs = sessionDurationMsFromItem(item)
      const startMs = Math.max(startMsRaw, imagingStartMs)
      const endMs = Math.min(startMs + durationMs, schedulingDeadlineMs)
      if (endMs <= startMs) return null
      return { item, startMs, endMs }
    })
    .filter((x): x is { item: ScheduledStripItem; startMs: number; endMs: number } => x != null)
    .sort((a, b) => a.startMs - b.startMs)
}

function placementToTimelineBlock(
  scheduled: { item: { id: string; target: string }; startMs: number; endMs: number },
  windowStartMs: number,
  windowEndMs: number
): { id: string; startMs: number; endMs: number; topPct: number; heightPct: number; label: string } {
  const topPct = ((scheduled.startMs - windowStartMs) / (windowEndMs - windowStartMs)) * 100
  const heightPct = ((scheduled.endMs - scheduled.startMs) / (windowEndMs - windowStartMs)) * 100
  return {
    id: scheduled.item.id,
    startMs: scheduled.startMs,
    endMs: scheduled.endMs,
    topPct,
    heightPct,
    label: scheduled.item.target,
  }
}

/** Placement for in_progress / completed when the weather-aware packer cannot run or fails.
 *  Prefer an existing lock, then planned start, then created time, then "now" for in_progress. */
/** Earliest time a session block may appear on the strip (after 4pm anchor, not before nautical dusk). */
function imagingWindowStartMs(windowStartMs: number, nauticalDuskMs: number): number {
  return Math.max(windowStartMs, nauticalDuskMs)
}

function fallbackPlacementForTerminalSession(
  item: TerminalSessionLike,
  locked: Record<string, { startMs: number; endMs: number }>,
  windowStartMs: number,
  schedulingDeadlineMs: number,
  nowMs: number,
): { startMs: number; endMs: number } | null {
  const existing = locked[item.id]
  if (
    existing &&
    Number.isFinite(existing.startMs) &&
    Number.isFinite(existing.endMs) &&
    existing.endMs > existing.startMs
  ) {
    return { startMs: existing.startMs, endMs: existing.endMs }
  }

  const durationMs = sessionDurationMsFromItem(item)
  let startMs: number | null = null
  if (item.plannedStartIso) {
    const t = Date.parse(item.plannedStartIso)
    if (Number.isFinite(t)) startMs = t
  }
  if (startMs == null) {
    const c = Date.parse(item.createdAt)
    if (Number.isFinite(c)) startMs = c
  }
  if (startMs == null && item.status === 'in_progress') {
    startMs = nowMs
  }
  if (startMs == null) return null

  let s = Math.max(startMs, windowStartMs)
  let e = Math.min(s + durationMs, schedulingDeadlineMs)
  if (item.status === 'failed' && item.failedAt) {
    const failMs = Date.parse(item.failedAt)
    if (Number.isFinite(failMs)) {
      e = Math.min(e, failMs, schedulingDeadlineMs)
    }
  }
  if (e <= s) {
    s = Math.max(windowStartMs, schedulingDeadlineMs - 5 * 60 * 1000)
    e = schedulingDeadlineMs
  }
  if (e <= s) return null
  return { startMs: s, endMs: e }
}

/**
 * in_progress sessions must stay on one full-duration bar for tonight — never re-pack to weather windows.
 * Start: frozen lock → planned → created → now. End: start + estimated duration (cap at dawn only).
 */
function inProgressSchedulePlacement(
  item: TerminalSessionLike,
  locked: Record<string, { startMs: number; endMs: number }>,
  imagingStartMs: number,
  schedulingDeadlineMs: number,
  nowMs: number
): { startMs: number; endMs: number } | null {
  const durationMs = sessionDurationMsFromItem(item)
  const existing = locked[item.id]

  let startMs: number | null = null
  if (existing && Number.isFinite(existing.startMs)) {
    startMs = existing.startMs
  } else if (item.plannedStartIso) {
    const t = Date.parse(item.plannedStartIso)
    if (Number.isFinite(t)) startMs = t
  }
  if (startMs == null) {
    const c = Date.parse(item.createdAt)
    if (Number.isFinite(c)) startMs = c
  }
  if (startMs == null) startMs = nowMs

  const start = Math.max(startMs, imagingStartMs)
  const end = Math.min(start + durationMs, schedulingDeadlineMs)
  if (end <= start) return null
  return { startMs: start, endMs: end }
}

/** Completed rows only belong on the current 4pm→8am strip if their time range overlaps that window. */
function completedSessionOverlapsTonightStripWindow(
  item: TerminalSessionLike,
  tonightNightKey: string,
  windowStartMs: number,
  windowEndMs: number,
  locked: Record<string, { startMs: number; endMs: number }>,
): boolean {
  if (item.nightKey && item.nightKey !== tonightNightKey) return false
  const durationMs = sessionDurationMsFromItem(item)
  const lock = locked[item.id]
  if (
    lock &&
    Number.isFinite(lock.startMs) &&
    Number.isFinite(lock.endMs) &&
    lock.endMs > lock.startMs
  ) {
    if (lock.endMs > windowStartMs && lock.startMs < windowEndMs) return true
  }
  if (item.plannedStartIso) {
    const t = Date.parse(item.plannedStartIso)
    if (Number.isFinite(t) && t + durationMs > windowStartMs && t < windowEndMs) return true
  }
  const c = Date.parse(item.createdAt)
  return Number.isFinite(c) && c + durationMs > windowStartMs && c < windowEndMs
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

function parseCoordsFromFormParts(
  raHourPart: string,
  raMinutePart: string,
  raSecondPart: string,
  decSign: string,
  decDegreePart: string,
  decMinutePart: string,
  decSecondPart: string
): { ok: true; raHours: number; decDeg: number } | { ok: false; message: string } {
  const h = Number(raHourPart)
  const m = Number(raMinutePart)
  const s = Number(raSecondPart)
  if (!Number.isFinite(h) || !Number.isFinite(m) || !Number.isFinite(s)) {
    return { ok: false, message: 'RA requires numeric Hour, Min, and Sec.' }
  }
  if (h < 0 || h > 23 || m < 0 || m > 59 || s < 0 || s >= 60) {
    return { ok: false, message: 'RA range: Hour 0-23, Min 0-59, Sec 0-59.999.' }
  }
  const raHours = h + m / 60 + s / 3600

  const dd = Number(decDegreePart)
  const dm = Number(decMinutePart)
  const ds = Number(decSecondPart)
  if (!Number.isFinite(dd) || !Number.isFinite(dm) || !Number.isFinite(ds)) {
    return { ok: false, message: 'Dec requires numeric Deg, Min, and Sec.' }
  }
  if (dd < 0 || dd > 90 || dm < 0 || dm > 59 || ds < 0 || ds >= 60) {
    return { ok: false, message: 'Dec range: Deg 0-90, Min 0-59, Sec 0-59.999.' }
  }
  let decDeg = dd + dm / 60 + ds / 3600
  if (decSign === '-') decDeg = -decDeg
  return {
    ok: true,
    raHours: Number(raHours.toFixed(8)),
    decDeg: Number(decDeg.toFixed(8)),
  }
}

function buildMosaicPanel(id: number, raHours: number, decDeg: number): MosaicPanel {
  return {
    id,
    raHours,
    decDeg,
    positionAngleDeg: 0,
    name: `Panel ${id}`,
    screenDeltaXPx: 0,
    screenDeltaYPx: 0,
  }
}

type FilterPlanFormRow = { filterName: string; count: string; exposureSeconds: string }

function cloneFilterPlanForms(plans: FilterPlanFormRow[]): FilterPlanFormRow[] {
  return plans.map((p) => ({ ...p }))
}

function mosaicDraftFromCoords(
  panels: MosaicPanel[],
  targetName: string,
  centerRaHours: number,
  centerDecDeg: number,
  equipmentSnapshot: unknown = null,
): MosaicDraft {
  return {
    targetName,
    panels,
    equipmentSnapshot,
    centerRaHours,
    centerDecDeg,
  }
}



export default function RemotePage() {
  const router = useRouter()
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
  const [showSaveRemoteSessionModal, setShowSaveRemoteSessionModal] = useState(false)
  const [showRunRemoteSessionModal, setShowRunRemoteSessionModal] = useState(false)
  const [saveModalName, setSaveModalName] = useState('')
  const [saveModalError, setSaveModalError] = useState<string | null>(null)
  const [runModalName, setRunModalName] = useState('')
  const [runModalError, setRunModalError] = useState<string | null>(null)
  const [cloudSavedSessions, setCloudSavedSessions] = useState<MemberSavedSessionApiEntry[]>([])
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
      failedAt?: string | null
      scheduleStripNightKey?: string | null
      scheduleBarStartMs?: number | null
      scheduleBarEndMs?: number | null
      projectMode?: boolean
      mosaicMode?: boolean
      userId?: string | null
      projectFramesTotal?: number
      projectFramesCaptured?: number
      projectFilterProgress?: Array<{ filterName: string; total: number; captured: number }>
      nights?: Array<{
        id: string
        nightIndex: number
        nightKey: string
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
          'https://api.open-meteo.com/v1/forecast?latitude=41.9159&longitude=-71.9626&current=temperature_2m&timezone=UTC'
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
  }, [])

  const loggedInContact = useMemo(() => {
    if (member.status !== 'authenticated') return null
    return {
      firstName: member.user.firstName.trim() || null,
      lastName: member.user.lastName.trim() || null,
      email: member.user.email,
    }
  }, [member])

  const imagingAccess = useMemo(() => {
    if (member.status !== 'authenticated') {
      return { ok: false as const, error: 'Sign in to submit a session.' }
    }
    return canSubmitImagingPublic(member.user)
  }, [member])

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
  const displayedVariableStars = useMemo(() => {
    const selected = new Set(variableStarFilterSelection)
    if (selected.size === 0) return sortedVariableStars

    const hasShortPeriod = selected.has('short_period')
    const hasMidPeriod = selected.has('mid_period')
    const hasLongPeriod = selected.has('long_period')
    const hasAnyPeriodFilter = hasShortPeriod || hasMidPeriod || hasLongPeriod
    const hasTypeNa = selected.has('type_na')
    const hasTypeLc = selected.has('type_lc')
    const hasTypeM = selected.has('type_m')
    const hasTypeSrc = selected.has('type_src')
    const hasTypeEa = selected.has('type_ea')
    const hasAnyTypeFilter = hasTypeNa || hasTypeLc || hasTypeM || hasTypeSrc || hasTypeEa
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

    // Type filters are OR within the type group, then AND with other groups.
    if (hasAnyTypeFilter) {
      filtered = filtered.filter((s) => {
        const t = (s.varType ?? '').toUpperCase()
        if (hasTypeNa && t.includes('NA')) return true
        if (hasTypeLc && t.includes('LC')) return true
        if (hasTypeM && t === 'M') return true
        if (hasTypeSrc && t.includes('SRC')) return true
        if (hasTypeEa && t.includes('EA')) return true
        return false
      })
    }

    if (!wantsTonightObservable && !hasAnyPeriodFilter && !hasAnyTypeFilter) return filtered

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
    const nextId = (mosaicDraft?.panels.reduce((max, p) => Math.max(max, p.id), 0) ?? 0) + 1
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
        projectFramesTotal?: unknown
        projectFramesCaptured?: unknown
        projectFilterProgress?: unknown
        nights?: unknown
      }>
      const normalized = items
        .filter((x) => typeof x.id === 'string')
        .map((x) => {
          const sessionType: 'dso' | 'variable_star' = x.sessionType === 'variable_star' ? 'variable_star' : 'dso'
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
            projectMode: x.projectMode === true,
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
                    return {
                      id: rec.id,
                      nightIndex: typeof rec.nightIndex === 'number' ? rec.nightIndex : 0,
                      nightKey: typeof rec.nightKey === 'string' ? rec.nightKey : '',
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
    () => isBeforeTonightWeatherHeadline(new Date(scheduleNowMs)),
    [scheduleNowMs]
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

    const { sunsetUtc: sunset, civilDuskUtc: civilDusk, nauticalDuskUtc: nauticalDusk, astronomicalDarkUtc: astronomicalDark } =
      getTonightScheduleEveningAstronomyUtc(now)
    const {
      sunriseUtc: sunrise,
      civilDawnUtc: civilDawn,
      nauticalDawnUtc: nauticalDawn,
      astronomicalDawnUtc: astronomicalDawn,
    } = getTonightScheduleMorningAstronomyUtc(now)

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

  const tonightNightKey = useMemo(
    () => getTonightScheduleStrip(new Date(scheduleNowMs)).nightKey,
    [scheduleNowMs]
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
              target: `${item.target} — Session ${night.nightIndex}`,
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
            target: `${item.target} — Session ${night.nightIndex}`,
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
        if (!Number.isFinite(frames) || frames < 1 || frames > 500) return null
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
      if (!Number.isFinite(frames) || frames < 1 || frames > 500) return false
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
      return {
        ...item,
        id: night.id,
        target: `${item.target} — Session ${night.nightIndex}`,
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

  async function submitRequest(
    whenClosedBehavior: 'reject' | 'queue_until_ready',
    coords: { raHours: number; decDeg: number }
  ) {
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
        if (!Number.isFinite(frames) || frames < 1 || frames > 500) {
          setSubmitError(`Frame count for ${filterName}${where} must be between 1 and 500.`)
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

    const estimatedDurationSeconds =
      sessionType === 'variable_star'
        ? Math.round((variableStarBlockHours + VARIABLE_STAR_SESSION_OVERHEAD_HOURS) * 3600)
        : mosaicFilterPlansByPanel
          ? mosaicFilterPlansByPanel.reduce((sum, plans) => sum + estimateDurationSecondsFromPlans(plans), 0)
          : estimateDurationSecondsFromPlans(normalizedPlans)

    const endpoint = editingSessionId ? `/api/imaging/queue/${encodeURIComponent(editingSessionId)}` : '/api/imaging/queue'
    const editCredential = editingSessionId ? sessionPasswords[editingSessionId] ?? '' : ''
    const res = await fetch(endpoint, {
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
        whenClosedBehavior,
        ...(isLoggedIn && !sessionPassword.trim() ? {} : { sessionPassword }),
        outputMode: outputMode === 'none' ? 'none' : 'raw_zip',
        cameraCoolingTempC,
        estimatedDurationSeconds,
        sessionType,
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
            : 'Project submitted for administrator approval (over 30 hours total).'
          : whenClosedBehavior === 'queue_until_ready'
            ? 'Session accepted. It will be available for download when observatory is Ready.'
            : 'Session started successfully.'
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
    setProjectModeTri(item.mosaicMode === true ? 'mosaic' : item.projectMode === true ? 'on' : 'off')
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
      if (typeof est === 'number' && Number.isFinite(est) && est > VARIABLE_STAR_SESSION_OVERHEAD_SEC) {
        const blockH = est / 3600 - VARIABLE_STAR_SESSION_OVERHEAD_HOURS
        const snapped = Math.round(blockH * 2) / 2
        setVariableStarBlockHours(Number.isFinite(snapped) && snapped >= 0.5 ? snapped : 1)
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
        <section className="max-w-3xl min-w-0">
          <h1 className="text-2xl font-semibold text-apple-dark dark:text-white mb-4">New Imaging Session</h1>
          <div className="flex flex-col gap-4">
            <p className="text-sm text-gray-600 dark:text-gray-400">
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
          {showTonightWeatherHeadline ? (
            <>
              <span className="px-2 text-gray-500 dark:text-gray-500">|</span>
              Tonight&apos;s weather prediction:{' '}
              <span
                className={
                  tonightWeatherPrediction === 'permitted'
                    ? 'text-green-600 dark:text-green-400'
                    : tonightWeatherPrediction === 'loading'
                      ? 'text-gray-500 dark:text-gray-500'
                      : 'text-red-600 dark:text-red-400'
                }
              >
                {tonightWeatherPrediction === 'permitted'
                  ? 'Permitted'
                  : tonightWeatherPrediction === 'loading'
                    ? 'Loading...'
                    : 'Not permitted'}
              </span>
            </>
          ) : null}
            </p>
            {statusLoadError && (
              <p className="text-sm text-red-600 dark:text-red-400">{statusLoadError}</p>
            )}
            {member.status === 'loading' ? (
              <p className="py-14 text-center text-sm text-gray-500">…</p>
            ) : !isLoggedIn ? (
              <MemberAuthPanel
                onSignedIn={(user) => {
                  if (user) member.completeSignIn(user)
                  else void member.refresh()
                }}
              />
            ) : (
            <>
            {!imagingAccess.ok ? (
              member.status === 'authenticated' && !member.user.emailVerified ? (
                <div className="rounded-lg border border-amber-500/40 bg-transparent px-4 py-3 text-sm text-amber-100">
                  <p>Verify your email before submitting imaging sessions.</p>
                  <button
                    type="button"
                    disabled={verifySending}
                    onClick={async () => {
                      setVerifySending(true)
                      setVerifyMsg(null)
                      try {
                        const res = await fetch('/api/auth/verify-email', {
                          method: 'POST',
                          credentials: 'include',
                        })
                        const data = await res.json().catch(() => ({}))
                        if (!res.ok || data?.ok !== true) {
                          setVerifyMsg(typeof data.error === 'string' ? data.error : 'Could not send email.')
                          return
                        }
                        setVerifyMsg('Verification email sent. Check your inbox.')
                      } catch {
                        setVerifyMsg('Could not send email.')
                      } finally {
                        setVerifySending(false)
                      }
                    }}
                    className={`${glassPillMd} mt-2 disabled:opacity-50`}
                  >
                    {verifySending ? 'Sending…' : 'Resend verification email'}
                  </button>
                  {verifyMsg ? <p className="mt-2 text-xs text-amber-200/90">{verifyMsg}</p> : null}
                </div>
              ) : member.status === 'authenticated' && member.user.imagingPending ? (
                <div className="rounded-lg border border-sky-500/40 bg-transparent px-4 py-3 text-sm text-sky-100">
                  Imaging access is pending administrator approval for non-@pomfret.org accounts.
                </div>
              ) : member.status === 'authenticated' && member.user.imagingRejected ? (
                <div className="rounded-lg border border-red-500/40 bg-red-950/30 px-4 py-3 text-sm text-red-200">
                  Imaging access was not approved for this account. Contact the observatory team.
                </div>
              ) : (
                <div className="rounded-lg border border-amber-500/40 bg-transparent px-4 py-3 text-sm text-amber-100">
                  <p>{imagingAccess.error}</p>
                </div>
              )
            ) : null}
            <form onSubmit={handleSubmit} className="boxed-fields grid gap-4 sm:grid-cols-2">
            <fieldset disabled={!imagingAccess.ok} className="contents min-w-0 border-0 p-0 m-0">
          <div className="sm:col-span-2 flex flex-wrap items-start gap-x-10 gap-y-4">
            <div className="space-y-2 min-w-0">
            <span className="text-sm font-medium text-white">Session Type</span>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                aria-pressed={sessionType === 'dso'}
                onClick={() => {
                  setSessionType('dso')
                  setFilterPlans([])
                  setPanelFilterPlansById({})
                  setCatalogQuery('')
                  setVariableStarPreviewStar(null)
                  setVariableStarLastFoundName(null)
                  setVariableStarLastFoundSource(null)
                  setVariableStarListSelection('')
                  setVariableStarFilterSelection([])
                  setCatalogLookupError(null)
                  setCatalogLookupResult(null)
                  setVariableStarBlockHours(1)
                }}
                className={sessionType === 'dso' ? glassPillToggleActiveMd : glassPillToggleIdleMd}
              >
                Deep Sky Object Imaging
              </button>
              <button
                type="button"
                aria-pressed={sessionType === 'variable_star'}
                onClick={() => {
                  setEditingSessionId(null)
                  setRequestName('')
                  setRaHourPart('')
                  setRaMinutePart('')
                  setRaSecondPart('')
                  setDecSign('+')
                  setDecDegreePart('')
                  setDecMinutePart('')
                  setDecSecondPart('')
                  setSessionPassword('')
                  setCatalogQuery('')
                  setCatalogLookupResult(null)
                  setCatalogLookupError(null)
                  setVariableStarPreviewStar(null)
                  setVariableStarLastFoundName(null)
                  setVariableStarLastFoundSource(null)
                  setVariableStarListSelection('')
                  setVariableStarFilterSelection([])
                  setSessionType('variable_star')
                  setOutputMode('raw_zip')
                  setFilterPlans([{ filterName: 'G', count: '10', exposureSeconds: '60' }])
                  setVariableStarBlockHours(1)
                }}
                className={sessionType === 'variable_star' ? glassPillToggleActiveMd : glassPillToggleIdleMd}
              >
                Variable Star Imaging
              </button>
            </div>
            </div>
            {sessionType === 'dso' && (
              <div className="space-y-2">
                <span className="text-sm font-medium text-white">Project Mode</span>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    aria-pressed={projectModeTri === 'off'}
                    onClick={() => setProjectModeTri('off')}
                    className={projectModeTri === 'off' ? glassPillToggleActiveMd : glassPillToggleIdleMd}
                  >
                    Off
                  </button>
                  <button
                    type="button"
                    aria-pressed={projectModeTri === 'on'}
                    onClick={() => setProjectModeTri('on')}
                    className={projectModeTri === 'on' ? glassPillToggleActiveMd : glassPillToggleIdleMd}
                  >
                    On
                  </button>
                  <button
                    type="button"
                    aria-pressed={projectModeTri === 'mosaic'}
                    onClick={enableMosaicMode}
                    className={projectModeTri === 'mosaic' ? glassPillToggleActiveMd : glassPillToggleIdleMd}
                  >
                    Mosaic On
                  </button>
                </div>
              </div>
            )}
          </div>
          {sessionType === 'variable_star' && variableStarCatalogLoading && (
            <p className="sm:col-span-2 text-xs text-gray-400">Loading variable star catalog…</p>
          )}
          {sessionType === 'variable_star' && variableStarCatalogError && !variableStarCatalogLoading && (
            <p className="sm:col-span-2 text-xs text-red-400">{variableStarCatalogError}</p>
          )}
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
                  : 'e.g. M31 LRGB Session 1'
              }
              className="w-full rounded-full border border-gray-300 dark:border-gray-600 bg-transparent dark:bg-transparent px-3 py-2 text-sm"
            />
          </label>
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
                        className={`box-border flex h-10 w-full items-center justify-center rounded-full border border-gray-300 bg-transparent px-3 py-2 text-sm leading-normal dark:border-gray-600 ${
                          variableStarFilterSelection.length === 0 ? 'text-gray-400' : 'text-white'
                        }`}
                      >
                        {variableStarFilterSelection.length === 0
                          ? '-- Select Filter --'
                          : `${variableStarFilterSelection.length} Filter${variableStarFilterSelection.length > 1 ? 's' : ''} Selected`}
                      </button>
                      {variableStarFilterDropdownOpen && (
                        <div className="absolute z-20 mt-1 w-full rounded-2xl border border-gray-300 bg-[#151616] p-2 text-sm dark:border-gray-600">
                          {([
                            { value: 'tonight_observable', label: 'Tonight Observable' },
                            { value: 'high_priority', label: 'High Priority' },
                            { value: 'short_period', label: 'Short Period' },
                            { value: 'mid_period', label: 'Mid Period (1-100 Days)' },
                            { value: 'long_period', label: 'Long Period (100+ Days)' },
                            { value: 'type_na', label: 'Type: NA (Nova)' },
                            { value: 'type_lc', label: 'Type: LC (Irregular Slow)' },
                            { value: 'type_m', label: 'Type: M (Mira)' },
                            { value: 'type_src', label: 'Type: SRC (Semiregular Supergiant)' },
                            { value: 'type_ea', label: 'Type: EA (Algol Eclipsing Binary)' },
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
                      className={`box-border h-10 w-full appearance-none rounded-full border border-gray-300 dark:border-gray-600 bg-[#151616] px-3 py-2 text-center text-sm leading-normal ${
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
                      className="box-border h-10 w-full rounded-full border border-gray-300 dark:border-gray-600 bg-transparent px-3 py-2 text-sm leading-normal dark:bg-transparent"
                    />
                  </label>
                </div>
                <VariableStarPreviewCharts star={variableStarPreviewStar} />
              </div>
            ) : (
              <div className="space-y-3">
                {mosaicMode ? (
                  <div className="space-y-2">
                    <span className="text-sm font-medium text-white">Mosaic</span>
                    <div className="flex flex-wrap items-center gap-2">
                      {(mosaicDraft?.panels ?? []).map((p) => (
                        <button
                          key={p.id}
                          type="button"
                          aria-pressed={selectedMosaicPanelId === p.id}
                          onClick={() => selectMosaicPanel(p.id)}
                          className={
                            selectedMosaicPanelId === p.id ? glassPillToggleActiveMd : glassPillToggleIdleMd
                          }
                        >
                          {p.name}
                        </button>
                      ))}
                      <button type="button" onClick={addMosaicPanel} className={glassPillMd}>
                        Add Panel
                      </button>
                    </div>
                  </div>
                ) : null}
                <div className="flex flex-wrap items-end gap-2">
                  <label className="min-w-[12rem] flex-1 basis-[min(100%,20rem)] space-y-1">
                    <span className="text-sm font-medium text-white">Catalog Target Search</span>
                    <input
                      type="text"
                      value={catalogQuery}
                      onChange={(e) => setCatalogQuery(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key !== 'Enter') return
                        e.preventDefault()
                        void handleCatalogLookup()
                      }}
                      placeholder="Try M31, NGC 7000, IC 434, M42..."
                      className="w-full rounded-full border border-gray-300 dark:border-gray-600 bg-transparent dark:bg-transparent px-3 py-2 text-sm"
                    />
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      void handleCatalogLookup()
                    }}
                    disabled={catalogLookupLoading}
                    className={`${glassPillMd} disabled:opacity-60`}
                  >
                    {catalogLookupLoading ? 'Searching...' : 'Search Target'}
                  </button>
                </div>
              </div>
            )}
            {catalogLookupError && <p className="text-sm text-red-400">{catalogLookupError}</p>}
            {sessionType === 'dso' && catalogLookupResult && (
              <p className="text-sm text-green-400">
                Found <span className="font-semibold">{catalogLookupResult.canonicalName}</span>. Coordinates auto-filled.
              </p>
            )}
            {sessionType === 'dso' && catalogLookupResult && dsoTonightAltitudePreview && (
              <div className="sm:col-span-2 space-y-1">
                <p className="text-sm font-medium text-white">Tonight</p>
                <div className="rounded-lg border border-black/10 p-2 dark:border-white/10">
                  {(() => {
                    const VB_W = 420
                    const VB_H = 168
                    const PAD_L = 30
                    const PAD_R = 26
                    const PAD_T = 24
                    const PAD_B = 22
                    const plotW = VB_W - PAD_L - PAD_R
                    const plotH = VB_H - PAD_T - PAD_B
                    const xTickY0 = PAD_T + plotH
                    const spanMs = Math.max(1, dsoTonightAltitudePreview.dawnMs - dsoTonightAltitudePreview.duskMs)
                    const x = (ms: number) => PAD_L + ((ms - dsoTonightAltitudePreview.duskMs) / spanMs) * plotW
                    const yAlt = (alt: number) => PAD_T + ((90 - Math.max(0, Math.min(90, alt))) / 90) * plotH
                    const points = dsoTonightAltitudePreview.samples
                      .map((p) => `${x(p.ms).toFixed(1)},${yAlt(p.alt).toFixed(1)}`)
                      .join(' ')
                    return (
                      <svg className="block w-full -translate-x-1 -translate-y-1 text-gray-600" viewBox={`0 0 ${VB_W} ${VB_H}`} aria-hidden>
                        <rect x={PAD_L} y={PAD_T} width={plotW} height={plotH} fill="none" stroke="currentColor" strokeOpacity={0.2} />
                        <line x1={PAD_L} y1={xTickY0} x2={PAD_L + plotW} y2={xTickY0} stroke="currentColor" strokeOpacity={0.35} />
                        {[0, 30, 60, 90].map((deg) => {
                          const y = PAD_T + ((90 - deg) / 90) * plotH
                          return (
                            <g key={deg}>
                              <line x1={PAD_L} y1={y} x2={PAD_L + plotW} y2={y} stroke="currentColor" strokeOpacity={0.08} />
                              <text x={PAD_L + plotW + 6} y={y + 3} fill="rgb(156 163 175)" fontSize={8} textAnchor="start">
                                {`${deg}°`}
                              </text>
                            </g>
                          )
                        })}
                        <polyline fill="none" stroke="rgb(251 191 36)" strokeWidth="1.4" points={points} />
                        {dsoTonightAltitudePreview.xTickMs.map((ms) => {
                          const xi = x(ms)
                          return (
                            <g key={ms}>
                              <line x1={xi} y1={xTickY0} x2={xi} y2={xTickY0 + 4} stroke="currentColor" strokeOpacity={0.4} />
                              <text x={xi} y={xTickY0 + 10} fill="rgb(156 163 175)" fontSize={8} textAnchor="middle" dominantBaseline="hanging">
                                {formatTonightXAxisHour(ms)}
                              </text>
                            </g>
                          )
                        })}
                      </svg>
                    )
                  })()}
                </div>
              </div>
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
                className="w-full rounded-full border border-gray-300 dark:border-gray-600 bg-transparent dark:bg-transparent px-3 py-2 text-sm"
              />
              <input
                required
                type="text"
                inputMode="numeric"
                value={raMinutePart}
                onChange={(e) => setRaMinutePart(e.target.value)}
                placeholder="Min"
                className="w-full rounded-full border border-gray-300 dark:border-gray-600 bg-transparent dark:bg-transparent px-3 py-2 text-sm"
              />
              <input
                required
                type="text"
                inputMode="decimal"
                value={raSecondPart}
                onChange={(e) => setRaSecondPart(e.target.value)}
                placeholder="Sec"
                className="w-full rounded-full border border-gray-300 dark:border-gray-600 bg-transparent dark:bg-transparent px-3 py-2 text-sm"
              />
            </div>
          </div>
          <div className="sm:col-span-2 grid gap-2">
            <span className="text-sm font-medium text-white">Declination (Dec) *</span>
            <div className="grid grid-cols-4 gap-2">
              <select
                value={decSign}
                onChange={(e) => setDecSign(e.target.value)}
                className="w-full appearance-none rounded-full border border-gray-300 dark:border-gray-600 bg-transparent dark:bg-transparent px-3 py-2 text-sm"
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
                className="w-full rounded-full border border-gray-300 dark:border-gray-600 bg-transparent dark:bg-transparent px-3 py-2 text-sm"
              />
              <input
                required
                type="text"
                inputMode="numeric"
                value={decMinutePart}
                onChange={(e) => setDecMinutePart(e.target.value)}
                placeholder="Min"
                className="w-full rounded-full border border-gray-300 dark:border-gray-600 bg-transparent dark:bg-transparent px-3 py-2 text-sm"
              />
              <input
                required
                type="text"
                inputMode="decimal"
                value={decSecondPart}
                onChange={(e) => setDecSecondPart(e.target.value)}
                placeholder="Sec"
                className="w-full rounded-full border border-gray-300 dark:border-gray-600 bg-transparent dark:bg-transparent px-3 py-2 text-sm"
              />
            </div>
          </div>
          {sessionType === 'variable_star' && variableStarDurationPick && (
            <div className="sm:col-span-2 grid gap-2">
              <span className="text-sm font-medium text-white">Session duration</span>
              <div
                className="grid w-full gap-2"
                style={{
                  gridTemplateColumns: `repeat(${Math.max(1, Math.ceil(variableStarDurationPick.allOptions.length / 2))}, minmax(0, 1fr))`,
                }}
              >
                {variableStarDurationPick.allOptions.map((h) => {
                  const halfStepsForH = Math.round(h * 2)
                  const enabled =
                    variableStarDurationPick.coordsOk && halfStepsForH <= variableStarDurationPick.starHalfSteps
                  const selected = enabled && variableStarBlockHours === h
                  return (
                    <button
                      key={h}
                      type="button"
                      disabled={!enabled}
                      aria-disabled={!enabled}
                      onClick={() => {
                        if (enabled) {
                          setVariableStarBlockHours(h)
                          setVariableStarDurationUserSelected(true)
                        }
                      }}
                      className={selected ? `${glassPillToggleActive} w-full` : enabled ? `${glassPillToggleIdle} w-full` : glassPillToggleDisabledMd}
                    >
                      {`${h} h`}
                    </button>
                  )
                })}
              </div>
            </div>
          )}
          {sessionType === 'dso' && (
            <div className="sm:col-span-2 grid gap-3">
              <span className="text-sm font-medium text-white">
                Filters *
                {mosaicMode
                  ? ` · ${(mosaicDraft?.panels.find((p) => p.id === selectedMosaicPanelId)?.name ?? `Panel ${selectedMosaicPanelId}`)}`
                  : ''}
              </span>
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
                      className={selected ? glassPillToggleActive : glassPillToggleIdle}
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
                            className={`${glassPillFullWidthMd} opacity-90 cursor-default sm:self-end`}
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
                            className="w-full rounded-full border border-gray-300 dark:border-gray-600 bg-transparent px-3 py-2 text-sm"
                          />

                          <input
                            type="text"
                            inputMode="decimal"
                            value={plan.exposureSeconds}
                            onChange={(e) =>
                              setFilterPlans((prev) =>
                                prev.map((x) =>
                                  x.filterName === plan.filterName ? { ...x, exposureSeconds: e.target.value } : x
                                )
                              )
                            }
                            className="w-full rounded-full border border-gray-300 dark:border-gray-600 bg-transparent px-3 py-2 text-sm"
                          />
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>
          )}
          <div className="sm:col-span-2 grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="grid gap-2">
              <span className="text-sm font-medium text-white">Output Type *</span>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setOutputMode('raw_zip')}
                  className={outputMode === 'raw_zip' ? glassPillToggleActive : glassPillToggleIdle}
                >
                  Raw ZIP
                </button>
                <button
                  type="button"
                  onClick={() => setOutputMode('none')}
                  className={outputMode === 'none' ? glassPillToggleActive : glassPillToggleIdle}
                >
                  None
                </button>
              </div>
            </div>
            <div className="grid gap-2">
              <span className="text-sm font-medium text-white">Camera Temperature</span>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={ambientTempC !== null && ambientTempC > 20}
                  onClick={() => setCameraCoolingTempC(-10)}
                  className={
                    ambientTempC !== null && ambientTempC > 20
                      ? `${glassPillDisabled} px-3 py-2 text-sm`
                      : cameraCoolingTempC === -10
                        ? glassPillToggleActive
                        : glassPillToggleIdle
                  }
                >
                  −10°C
                </button>
                <button
                  type="button"
                  onClick={() => setCameraCoolingTempC(0)}
                  className={cameraCoolingTempC === 0 ? glassPillToggleActive : glassPillToggleIdle}
                >
                  0°C
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
          <div className="sm:col-span-2 flex flex-wrap items-center gap-2">
            <button
              type="submit"
              disabled={submitting || !imagingAccess.ok}
              className={`${glassPillMd} disabled:opacity-60`}
            >
              {submitting ? (editingSessionId ? 'Finishing...' : 'Starting...') : editingSessionId ? 'Finish Editing' : 'Start Session'}
            </button>
            <button
              type="button"
              disabled={!imagingAccess.ok}
              onClick={() => {
                if (!imagingAccess.ok) return
                setRunModalError(null)
                setRunModalName('')
                setShowRunRemoteSessionModal(true)
              }}
              className={`${glassPillMd} disabled:opacity-50`}
            >
              Run A Saved Session
            </button>
            <button
              type="button"
              disabled={!canSaveRemoteSessionSpec}
              onClick={() => {
                if (!canSaveRemoteSessionSpec) return
                setSaveModalError(null)
                setSaveModalName(requestName.trim())
                setShowSaveRemoteSessionModal(true)
              }}
              className={`${glassPillMd} disabled:opacity-50`}
            >
              Save Session
            </button>
          </div>
          <p className="sm:col-span-2 text-xs text-gray-500">
            Estimated duration:{' '}
            {sessionType === 'variable_star'
              ? !variableStarDurationPick?.coordsOk ||
                (variableStarDurationPick?.starHalfSteps ?? 0) < 1 ||
                !variableStarDurationUserSelected
                ? '--'
                : formatDurationShort(
                    (variableStarBlockHours + VARIABLE_STAR_SESSION_OVERHEAD_HOURS) * 3600
                  )
              : dsoEstimatedDurationPreviewSeconds == null
                ? '--'
                : formatDurationShort(dsoEstimatedDurationPreviewSeconds)}
          </p>
            </fieldset>
            </form>
            </>
            )}
          </div>
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
            <div className="absolute right-0 lg:-right-16 top-0 bottom-0 w-px bg-black/10 dark:bg-white/10" />
            {hourLines.map((slot, index) => (
              <div key={`hour-line-${slot.hourKey}-${index}`}>
                <div
                  className="absolute left-[4.75rem] right-0 lg:-right-16 h-px bg-black/10 dark:bg-white/10"
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
                className="absolute left-[4.75rem] right-0 lg:-right-16 h-0.5 bg-red-500/90 z-[1]"
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
            <div className="pointer-events-none absolute left-[4.75rem] right-0 lg:-right-16 top-0 bottom-0">
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
      <div className="mt-6 sm:mt-8 grid gap-4 sm:gap-6 lg:-translate-x-3 lg:grid-cols-[minmax(0,3fr)_1px_minmax(0,2fr)] lg:items-start">
        <section className="max-w-3xl min-w-0">
          <h1 className="text-2xl font-semibold text-apple-dark dark:text-white mb-4">Current Sessions</h1>
          <div className="flex flex-col gap-4">
            <p className="text-sm text-gray-600 dark:text-gray-400">
              This list includes every session that is pending, scheduled, in progress, or completed. Single-night
              sessions are kept for{' '}
              <span className="font-semibold text-red-600 dark:text-red-400">48 hours</span> after they finish.
              Project Mode keeps every completed sub-session download available until the{' '}
              <span className="font-semibold text-red-600 dark:text-red-400">entire project</span> is done; then all
              project files are removed 48 hours after that. When your session finishes, you will receive an
              email—please download your data while it is still available. For the observatory master calibration library
              (bias, darks, flats),{' '}
              <a
                href={POMFRET_CALIBRATION_LIBRARY_DRIVE_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium text-green-600 underline decoration-green-600/70 underline-offset-2 hover:text-green-500 dark:text-green-400 dark:hover:text-green-300"
              >
                here
              </a>
              .
            </p>
            {queueItems.length === 0 ? (
              <p className="text-sm text-gray-500 dark:text-gray-500">No sessions.</p>
            ) : (
              <ul className="space-y-2">
              {queueItems.map((item) => {
                const displayStatus = item.status === 'claimed' ? 'in_progress' : item.status
                const sessionTypeLabel = item.sessionType === 'variable_star' ? 'Variable Star' : 'Deep Sky Object'
                const projectLabel = item.projectMode ? ' · Project Mode' : ''
                const projectHasDownloads =
                  item.projectMode === true &&
                  item.outputMode !== 'none' &&
                  (item.nights?.some((n) => n.hasDownload === true) ?? false)
                const showDownloadButton = item.projectMode ? projectHasDownloads : item.hasDownload === true
                const actionsEnabled = canInteractWithSession(item)
                return (
                <li
                  key={item.id}
                  className="rounded-lg border border-gray-200 dark:border-gray-700 px-3 py-2 text-sm"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium text-white">{`${item.target} | ${sessionTypeLabel}${projectLabel}`}</span>
                    <span className={`text-xs font-semibold uppercase ${queueStatusBadgeClass(displayStatus)}`}>
                      {queueStatusLabel(displayStatus)}
                    </span>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-3">
                    {showDownloadButton && (
                      <button
                        type="button"
                        disabled={!actionsEnabled}
                        onClick={() => void handleDownloadClick(item)}
                        className={sessionActionButtonClass(actionsEnabled)}
                      >
                        Download file
                      </button>
                    )}
                    <button
                      type="button"
                      disabled={!actionsEnabled}
                      onClick={() => void handleCheckProgressClick(item)}
                      className={sessionActionButtonClass(actionsEnabled)}
                    >
                      Check progress
                    </button>
                    {(item.status === 'pending' || item.status === 'scheduled') && (
                      <button
                        type="button"
                        disabled={!actionsEnabled}
                        onClick={() => handleEditSessionClick(item)}
                        className={sessionActionButtonClass(actionsEnabled)}
                      >
                        Edit session
                      </button>
                    )}
                    <button
                      type="button"
                      disabled={!actionsEnabled}
                      onClick={() => handleDeleteSessionClick(item)}
                      className={sessionActionButtonClass(actionsEnabled, 'danger')}
                    >
                      Delete session
                    </button>
                  </div>
                </li>
                )
              })}
              </ul>
            )}
          </div>
          {deleteError && <p className="mt-3 text-sm text-red-600 dark:text-red-400">{deleteError}</p>}
        </section>
        <div className="hidden lg:block h-full min-h-[16rem] w-px bg-black/10 dark:bg-white/10" />
        <section className="min-w-0 w-full">
          <h1 className="text-2xl font-semibold text-apple-dark dark:text-white mb-4">Telescope Status</h1>
          <div className="lg:mr-[-4rem]">
            <TelescopeStatusPanel />
          </div>
        </section>
      </div>

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
                <div className="flex h-full min-h-0 flex-col border-b border-gray-800 md:border-b-0 md:border-r md:border-r-gray-800">
                  <div className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-white">Terminal</div>
                  {terminalLines.length === 0 && !terminalError ? (
                    <div className="flex flex-1 min-h-0 flex-col items-center justify-center p-3 pt-0">
                      <p className="text-center text-sm text-gray-500">
                        {terminalQueueStatus === 'pending' || terminalQueueStatus == null
                          ? 'Waiting For Observatory Signal.'
                          : terminalQueueStatus === 'completed'
                            ? 'Session completed. No further live updates.'
                            : terminalQueueStatus === 'failed'
                              ? 'Session marked failed. Waiting for observatory POSTs…'
                              : 'Waiting for observatory POSTs…'}
                      </p>
                    </div>
                  ) : (
                    <div className="min-h-0 flex-1 overflow-auto p-3 font-mono text-xs leading-relaxed">
                      {terminalLines.map((line, i) => {
                        const failedLine = isSessionFailedTerminalLine(line.text)
                        return (
                          <div
                            key={`${line.at}-${i}-${line.text.slice(0, 24)}`}
                            className={`whitespace-pre-wrap break-words border-l-2 pl-2 mb-2 ${
                              failedLine ? 'border-red-600/60' : 'border-green-700/40'
                            }`}
                          >
                            <span className="text-gray-500">[{new Date(line.at).toLocaleTimeString()}]</span>{' '}
                            <span className={failedLine ? 'text-red-400 font-semibold' : 'text-green-400'}>
                              {line.text}
                            </span>
                          </div>
                        )
                      })}
                      <div ref={terminalEndRef} />
                    </div>
                  )}
                </div>
                <div className="flex h-full min-h-0 flex-col">
                  <div className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-white">Latest Image</div>
                  <div className="flex-1 p-3 pt-0 flex flex-col items-center justify-center">
                    {terminalPreviewUrl ? (
                      <>
                        <img
                          src={terminalPreviewUrl}
                          alt="Latest session preview"
                          className="w-full max-h-[55vh] object-contain"
                        />
                        <p className="mt-2 w-full text-center text-xs">
                          <span className="text-gray-500">Updated on </span>
                          {terminalPreviewUpdatedAt
                            ? new Date(terminalPreviewUpdatedAt).toLocaleString()
                            : '—'}
                        </p>
                      </>
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

      {nightPickerProjectId && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div
            role="dialog"
            aria-labelledby="night-picker-title"
            className="w-full max-w-md rounded-xl bg-[#09090a] border border-gray-700 p-6 space-y-4"
          >
            <h2 id="night-picker-title" className="text-lg font-semibold text-white">
              {nightPickerPurpose === 'download' ? 'Select session to download' : 'Select session'}
            </h2>
            {(() => {
              const projectItem = queueItems.find((x) => x.id === nightPickerProjectId)
              const projectOwned = projectItem ? sessionOwnedByMe(projectItem) : false
              const projectFilterProgress = projectItem?.projectFilterProgress ?? []
              const showProjectProgress =
                nightPickerPurpose === 'progress' &&
                projectItem?.projectMode === true &&
                projectFilterProgress.length > 0
              const pickerNights = (projectItem?.nights ?? []).filter((n) => {
                if (nightPickerPurpose === 'download') {
                  return n.status === 'completed' && n.hasDownload === true
                }
                return (
                  n.status === 'scheduled' ||
                  n.status === 'in_progress' ||
                  n.status === 'completed' ||
                  n.status === 'failed' ||
                  n.status === 'on_hold'
                )
              })
              if (pickerNights.length === 0 && !showProjectProgress) {
                return (
                  <p className="text-sm text-gray-400 py-2">
                    {nightPickerPurpose === 'download'
                      ? 'No completed session with a download yet.'
                      : 'No Session Scheduled'}
                  </p>
                )
              }
              return (
                <>
                {pickerNights.length === 0 ? (
                  <p className="text-sm text-gray-400 py-2">No Session Scheduled</p>
                ) : (
                <ul className="space-y-2 max-h-64 overflow-y-auto">
                  {pickerNights.map((night) => (
                    <li key={night.id}>
                      {nightPickerPurpose === 'download' ? (
                        <div className="flex items-center justify-between gap-2 rounded-lg border border-gray-600 px-3 py-2">
                          <div className="min-w-0 text-sm text-white">
                            <span className="font-medium">Session {night.nightIndex}</span>
                            <span className="text-gray-400"> · {night.nightKey}</span>
                          </div>
                          <button
                            type="button"
                            onClick={async () => {
                              const projectId = nightPickerProjectId
                              const password = projectId ? sessionPasswords[projectId] ?? '' : ''
                              if (!password && !isAdmin && !projectOwned) return
                              const err = await downloadSessionFile(night.id, password)
                              if (err) setDeleteError(err)
                            }}
                            className={`shrink-0 ${glassPillXs}`}
                          >
                            Download
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => {
                            const projectId = nightPickerProjectId
                            const password = projectId ? sessionPasswords[projectId] ?? '' : ''
                            setNightPickerProjectId(null)
                            setNightPickerPurpose(null)
                            if (!password && !isAdmin && !projectOwned) {
                              setAuthModalSessionId(projectId)
                              setAuthModalAction('project_progress')
                              setAuthError('Session password required.')
                              return
                            }
                            if (password) {
                              setSessionPasswords((prev) => ({
                                ...prev,
                                [night.id]: password,
                                ...(projectId ? { [projectId]: password } : {}),
                              }))
                            }
                            setTerminalSessionId(night.id)
                          }}
                          className="w-full rounded-lg border border-gray-600 px-3 py-2 text-left text-sm text-white hover:bg-[#151616]"
                        >
                          <span className="font-medium">Session {night.nightIndex}</span>
                          <span className="text-gray-400"> · {night.nightKey}</span>
                          <span
                            className={`ml-2 text-xs font-semibold uppercase ${queueStatusBadgeClass(
                              night.status === 'in_progress' ? 'in_progress' : night.status
                            )}`}
                          >
                            {queueStatusLabel(night.status)}
                          </span>
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
                )}
                {showProjectProgress && (
                  <>
                    <h2 className="text-lg font-semibold text-white">Project progress</h2>
                    <div className="space-y-3">
                      {projectFilterProgress.map((filter) => {
                        const pct =
                          filter.total > 0
                            ? Math.min(100, Math.round((filter.captured / filter.total) * 100))
                            : 0
                        const complete = filter.captured >= filter.total
                        return (
                          <div key={filter.filterName} className="space-y-1">
                            <div className="flex items-baseline justify-between gap-2 text-xs">
                              <span className="font-medium text-white">{filter.filterName}</span>
                              <span className="text-gray-400">
                                {filter.captured} / {filter.total}
                                {complete ? ' · complete' : ''}
                              </span>
                            </div>
                            <div
                              className="flex h-2.5 w-full overflow-hidden rounded-full"
                              role="progressbar"
                              aria-valuenow={filter.captured}
                              aria-valuemin={0}
                              aria-valuemax={filter.total}
                              aria-label={`${filter.filterName} frames captured`}
                            >
                              <div
                                className="h-full shrink-0 bg-emerald-500 transition-[width] duration-300"
                                style={{ width: `${pct}%` }}
                              />
                              <div className="h-full min-w-0 flex-1 bg-gray-600" aria-hidden />
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </>
                )}
                </>
              )
            })()}
            <button
              type="button"
              onClick={() => {
                setNightPickerProjectId(null)
                setNightPickerPurpose(null)
              }}
              className={glassPillMuted}
            >
              Cancel
            </button>
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
                if (authModalAction === 'project_progress') {
                  const res = await fetch(
                    `/api/imaging/queue/${encodeURIComponent(authModalSessionId)}/progress`,
                    { headers: { 'x-session-password': password } }
                  )
                  const data = await res.json().catch(() => ({}))
                  if (!res.ok || data?.ok !== true) {
                    setAuthError(typeof data.error === 'string' ? data.error : 'Invalid session password.')
                    return
                  }
                  setNightPickerProjectId(authModalSessionId)
                  setNightPickerPurpose('progress')
                  setAuthModalSessionId(null)
                  setAuthModalAction(null)
                  setAuthPassword('')
                  return
                }
                if (authModalAction === 'project_download') {
                  const res = await fetch(
                    `/api/imaging/queue/${encodeURIComponent(authModalSessionId)}/progress`,
                    { headers: { 'x-session-password': password } }
                  )
                  const data = await res.json().catch(() => ({}))
                  if (!res.ok || data?.ok !== true) {
                    setAuthError(typeof data.error === 'string' ? data.error : 'Invalid session password.')
                    return
                  }
                  setNightPickerProjectId(authModalSessionId)
                  setNightPickerPurpose('download')
                  setAuthModalSessionId(null)
                  setAuthModalAction(null)
                  setAuthPassword('')
                  return
                }
                if (authModalAction === 'progress') {
                  setTerminalSessionId(authModalSessionId)
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
                const err = await downloadSessionFile(authModalSessionId, password)
                if (err) {
                  setAuthError(err)
                  return
                }
                setAuthModalSessionId(null)
                setAuthModalAction(null)
                setAuthPassword('')
              } finally {
                setAuthSubmitting(false)
              }
            }}
          >
            <h2 className="text-lg font-semibold text-white">
              {authModalAction === 'project_progress'
                ? 'Check Project Progress'
                : authModalAction === 'project_download'
                  ? 'Download Project Session'
                  : authModalAction === 'progress'
                    ? 'Check Session Progress'
                    : authModalAction === 'edit'
                      ? 'Edit Session'
                      : 'Download Session File'}
            </h2>
            {authModalAction === 'edit' && (
              <p className="text-sm text-gray-400">
                Enter session password or admin password to edit this pending session.
              </p>
            )}
            <label className="block space-y-1">
              <span className="text-sm font-medium text-white">Session/Admin Password</span>
              <input
                type="password"
                value={authPassword}
                onChange={(e) => setAuthPassword(e.target.value)}
                className="w-full rounded-full border border-gray-300 dark:border-gray-600 bg-transparent dark:bg-transparent px-3 py-2 text-sm"
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
                className={`${glassPillFullWidthSm} disabled:opacity-60`}
                disabled={authSubmitting}
              >
                Cancel
              </button>
              <button
                type="submit"
                className={`${glassPillFullWidthSm} disabled:opacity-60`}
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
            className="w-full max-w-md rounded-xl bg-[#09090a] border border-gray-700 p-6 space-y-4"
            onSubmit={async (e) => {
              e.preventDefault()
              if (!deleteTargetId) return
              const pwd = deletePassword.trim()
              const deleteTargetItem = queueItems.find((item) => item.id === deleteTargetId)
              const deleteOwned = deleteTargetItem ? sessionOwnedByMe(deleteTargetItem) : false
              if (!isAdmin && !deleteOwned && !pwd) {
                setDeleteError('Password is required.')
                return
              }
              setDeleteSubmitting(true)
              setDeleteError(null)
              try {
                await handleDeleteRequest(deleteTargetId, isAdmin || deleteOwned ? '' : pwd)
              } finally {
                setDeleteSubmitting(false)
              }
            }}
          >
            <h2 className="text-lg font-semibold text-white">Delete Session</h2>
            {(() => {
              const deleteTargetItem = deleteTargetId
                ? queueItems.find((item) => item.id === deleteTargetId)
                : undefined
              const deleteOwned = deleteTargetItem ? sessionOwnedByMe(deleteTargetItem) : false
              if (isAdmin || deleteOwned) {
                return (
                  <p className="text-sm text-gray-300">
                    Delete this session permanently? This cannot be undone.
                  </p>
                )
              }
              return (
                <label className="block space-y-1">
                  <span className="text-sm font-medium text-white">Password</span>
                  <input
                    type="password"
                    value={deletePassword}
                    onChange={(e) => setDeletePassword(e.target.value)}
                    className="w-full rounded-full border border-gray-600 bg-transparent px-3 py-2 text-sm text-white placeholder:text-gray-500"
                  />
                </label>
              )
            })()}
            {deleteError && <p className="text-sm text-red-400">{deleteError}</p>}
            <div className="flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => {
                  setShowDeleteModal(false)
                  setDeleteTargetId(null)
                  setDeletePassword('')
                  setDeleteError(null)
                }}
                className={`${glassPillMd} disabled:opacity-60`}
                disabled={deleteSubmitting}
              >
                Cancel
              </button>
              <button
                type="submit"
                className={`${glassPillDangerSolid} disabled:opacity-60`}
                disabled={deleteSubmitting}
              >
                {deleteSubmitting ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </form>
        </div>
      )}

      {showSaveRemoteSessionModal && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="w-full max-w-md rounded-xl bg-[#09090a] border border-gray-700 p-6 space-y-4">
            <h2 className="text-lg font-semibold text-white">Save Session</h2>
            <p className="text-sm text-gray-400">Save this form as a reusable template on your account.</p>
            <label className="block space-y-1">
              <span className="text-sm font-medium text-white">Session name</span>
              <input
                type="text"
                value={saveModalName}
                onChange={(e) => setSaveModalName(e.target.value)}
                className="w-full rounded-full border border-gray-600 bg-transparent px-3 py-2 text-sm text-white placeholder:text-gray-500"
              />
            </label>
            {saveModalError && <p className="text-sm text-red-400">{saveModalError}</p>}
            <div className="flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => {
                  setShowSaveRemoteSessionModal(false)
                  setSaveModalError(null)
                }}
                className={`${glassPillMd}`}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  void (async () => {
                    const name = saveModalName.trim()
                    if (!name) {
                      setSaveModalError('Session name is required.')
                      return
                    }
                    const form = captureRemoteSavedForm()
                    form.requestName = name
                    form.sessionPassword = ''
                    const result = await saveMemberSavedSession({ name, form })
                    if (!result.ok) {
                      setSaveModalError(result.error)
                      return
                    }
                    await refreshCloudSavedSessions()
                    setRequestName(name)
                    setShowSaveRemoteSessionModal(false)
                    setSaveModalError(null)
                    setSubmitError(null)
                    setSubmitSuccess(`Saved session "${name}" to your account.`)
                  })()
                }}
                className={`${glassPillMd} glass-pill-active`}
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {showRunRemoteSessionModal && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="w-full max-w-md rounded-xl bg-[#09090a] border border-gray-700 p-6 space-y-4">
            <h2 className="text-lg font-semibold text-white">Run A Saved Session</h2>
            {cloudSavedSessions.length > 0 ? (
              <label className="block space-y-1">
                <span className="text-sm font-medium text-white">Saved templates</span>
                <select
                  value={runModalName}
                  onChange={(e) => setRunModalName(e.target.value)}
                  className="w-full appearance-none rounded-full border border-gray-600 bg-transparent px-3 py-2 text-sm text-white"
                >
                  <option value="">Select…</option>
                  {cloudSavedSessions.map((s) => (
                    <option key={s.id} value={s.name}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <label className="block space-y-1">
              <span className="text-sm font-medium text-white">Session name</span>
              <input
                type="text"
                value={runModalName}
                onChange={(e) => setRunModalName(e.target.value)}
                className="w-full rounded-full border border-gray-600 bg-transparent px-3 py-2 text-sm text-white placeholder:text-gray-500"
              />
            </label>
            {runModalError && <p className="text-sm text-red-400">{runModalError}</p>}
            <div className="flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => {
                  setShowRunRemoteSessionModal(false)
                  setRunModalError(null)
                }}
                className={`${glassPillMd}`}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  void (async () => {
                    const name = runModalName.trim()
                    if (!name) {
                      setRunModalError('Session name is required.')
                      return
                    }
                    const found = await loadMemberSavedSessionByName(name)
                    if (!found) {
                      setRunModalError('No saved session with that name.')
                      return
                    }
                    applyRemoteSavedForm(found.form)
                    setShowRunRemoteSessionModal(false)
                    setRunModalError(null)
                    setSubmitError(null)
                    setSubmitSuccess(`Loaded saved session "${found.name}".`)
                  })()
                }}
                className={`${glassPillMd} glass-pill-active`}
              >
                Load
              </button>
            </div>
          </div>
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
                      : status === 'disconnected'
                        ? 'Observatory is disconnected. Session was not started.'
                      : 'Observatory is closed. Session was not started.'
                  )
                }}
              >
                1. {status === 'busy_in_use'
                  ? 'Observatory busy: do not start now.'
                  : status === 'disconnected'
                    ? 'Observatory disconnected: do not start now.'
                    : 'Observatory closed: cannot start now.'}
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
                  : status === 'disconnected'
                    ? 'Start now, and wait until the agent reconnects and observatory returns to Ready.'
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
