import { mkdir, readFile, rename, writeFile } from 'fs/promises'
import path from 'path'
import { appendAuditLog } from '@/lib/imaging-audit-log'
import {
  kvCompareAndSet,
  kvDel,
  kvEnabled,
  kvGetJson,
  kvGetString,
  kvSetJson,
} from '@/lib/kv-rest'
import { getDaytimeClosedWindowDetail, isWithinDaytimeClosedWindow } from '@/lib/sunrise-window'
import { observatoryAgentDisconnectedStaleMs } from '@/lib/observatory-poll-schedule'
import { isWithinAdminClosedWindow } from '@/lib/admin-closed-window-store'
import {
  maybeFailSessionsAfterNinaStopped,
  onNinaRunningReported,
} from '@/lib/imaging-session-failure'
import { emitLiveEvent } from '@/lib/imaging/live-bus'
import {
  evaluateObservatoryReadyWeather,
  fetchAllSkyCamGateState,
  isAscCloudGateApplicable,
  OBSERVATORY_READY_GATE_RULE,
} from '@/lib/asc-cloud'
import { fetchOpenMeteoCurrentWeather } from '@/lib/open-meteo-current'
import { isEmergencyStopBlocking } from '@/lib/imaging-emergency-stop'
import { siteHasAllSkyCamera } from '@/lib/admin-site-access'
import {
  currentObservatorySite,
  currentObservatorySiteId,
  scopedKvKey,
} from '@/lib/observatory-site-scope'

export type ObservatoryStatus =
  | 'ready'
  | 'busy_in_use'
  | 'disconnected'
  | 'closed_weather_not_permitted'
  | 'closed_daytime'
  | 'closed_observatory_maintenance'

export type ObservatoryMode = 'manual' | 'auto'

/**
 * Per-site in-process cache. Must never be a single global: one warm instance
 * serves every observatory, and a shared `lastAgentSeenTs` would report one
 * site as connected because another site's agent polled.
 */
type ObservatoryMemoryState = {
  __pomfret_manual_status__?: ObservatoryStatus
  __pomfret_mode__?: ObservatoryMode
  __pomfret_last_poll_ts__?: number
  __pomfret_last_agent_seen_ts__?: number
  __pomfret_nina_running__?: boolean
  __pomfret_nina_running_reported_at__?: number
  /** Last auto-computed base for transition log; `undefined` = never set on this instance. */
  __pomfret_auto_audit_last_base__?: ObservatoryStatus
  __pomfret_last_pushed_obs_status__?: ObservatoryStatus
  __pomfret_last_persist_at__?: number
}

type GlobalState = typeof globalThis & {
  __pomfret_observatory_memory_by_site__?: Record<string, ObservatoryMemoryState>
}

const statusFile = process.env.OBSERVATORY_STATUS_FILE
let loaded = false
const NINA_RUNNING_STALE_MS = 90_000
const WEATHER_CACHE_MS = 0
function autoBaseCursorKvKey(): string {
  return scopedKvKey('observatory-auto-audit-last-base')
}
function lastPushedStatusKvKey(): string {
  return scopedKvKey('observatory-last-pushed-final-status')
}
function observatoryStatusKvKey(): string {
  return scopedKvKey('observatory-status')
}
const OBSERVATORY_PERSIST_DEBOUNCE_MS = 30_000

export type GetObservatoryStatusOptions = {
  /** Skip SSE fan-out (used when caller will force-push). */
  skipLivePush?: boolean
}

async function readLastPushedObservatoryStatus(): Promise<ObservatoryStatus | undefined> {
  if (kvEnabled()) {
    const raw = await kvGetString(lastPushedStatusKvKey())
    if (raw && isObservatoryStatus(raw)) return raw
    return undefined
  }
  return memory().__pomfret_last_pushed_obs_status__
}

async function markLastPushedObservatoryStatus(status: ObservatoryStatus): Promise<void> {
  if (kvEnabled()) {
    await kvSetJson(lastPushedStatusKvKey(), { status, at: new Date().toISOString() })
  }
  memory().__pomfret_last_pushed_obs_status__ = status
}

/** Push site:observatory SSE when computed final status changes (Auto weather, busy, etc.). */
async function publishObservatoryStatusLive(
  status: ObservatoryStatus,
  mode: ObservatoryMode,
  force = false
): Promise<void> {
  if (!force) {
    const prev = await readLastPushedObservatoryStatus()
    if (prev === status) return
  }
  await markLastPushedObservatoryStatus(status)
  void emitLiveEvent('site:observatory', { type: 'observatory_status', mode, status })
}

/** After persist / admin patch — always fan out latest computed status. */
export async function forcePushObservatoryStatusLive(): Promise<void> {
  const mode = await getObservatoryMode()
  const status = await getObservatoryStatus({ skipLivePush: true })
  await publishObservatoryStatusLive(status, mode, true)
}
const KMH_TO_MS = 1 / 3.6
type WeatherCacheEntry =
  | {
      ts: number
      cloudCover: number
      openMeteoCloudCover: number | null
      rainDetected: boolean
      precipitation: number
      windSpeed: number
      precipProbability: number
      ascGateApplicable: boolean
      sequenceActive: boolean
      ascStaleReason: string | null
      weatherAllowed: boolean
      ascAvailable: boolean
      ascFrameIso: string | null
      ascModelPhase: string | null
      ascLastError: string | null
    }
  | undefined

type GlobalWeatherCache = typeof globalThis & {
  __pomfret_weather_cache_by_site__?: Record<string, WeatherCacheEntry>
}

/** Weather gate snapshot is per observatory — Pomfret's sky must not describe Cygnus. */
function weatherCacheGet(): WeatherCacheEntry {
  const g = globalThis as GlobalWeatherCache
  return g.__pomfret_weather_cache_by_site__?.[currentObservatorySiteId()]
}

function weatherCacheSet(entry: WeatherCacheEntry): void {
  const g = globalThis as GlobalWeatherCache
  if (!g.__pomfret_weather_cache_by_site__) g.__pomfret_weather_cache_by_site__ = {}
  g.__pomfret_weather_cache_by_site__[currentObservatorySiteId()] = entry
}

function memory(): ObservatoryMemoryState {
  const g = globalThis as GlobalState
  if (!g.__pomfret_observatory_memory_by_site__) g.__pomfret_observatory_memory_by_site__ = {}
  const siteId = currentObservatorySiteId()
  const existing = g.__pomfret_observatory_memory_by_site__[siteId]
  if (existing) return existing
  const fresh: ObservatoryMemoryState = {}
  g.__pomfret_observatory_memory_by_site__[siteId] = fresh
  return fresh
}

function currentManualStatus(): ObservatoryStatus {
  return memory().__pomfret_manual_status__ ?? 'ready'
}

function currentMode(): ObservatoryMode {
  return memory().__pomfret_mode__ ?? 'manual'
}

async function fetchOpenMeteoObservatoryGate(): Promise<{
  windSpeedMs: number
  precipProbability: number
  cloudCoverPercent: number | null
}> {
  const wx = await fetchOpenMeteoCurrentWeather()
  const windKmh = wx.windSpeedKmh
  const windSpeedMs =
    windKmh != null && Number.isFinite(windKmh) ? windKmh * KMH_TO_MS : 999
  const precipProbability =
    wx.precipProbabilityPercent != null && Number.isFinite(wx.precipProbabilityPercent)
      ? wx.precipProbabilityPercent
      : 100
  const cloudCoverPercent =
    wx.cloudCoverPercent != null && Number.isFinite(wx.cloudCoverPercent) ? wx.cloudCoverPercent : null
  return { windSpeedMs, precipProbability, cloudCoverPercent }
}

async function fetchWeatherAllowed(now = Date.now()): Promise<boolean> {
  const cached = weatherCacheGet()
  if (cached && now - cached.ts < WEATHER_CACHE_MS) {
    return cached.weatherAllowed
  }

  try {
    const hasAsc = siteHasAllSkyCamera(currentObservatorySiteId())
    const [gate, openMeteo] = await Promise.all([
      hasAsc ? fetchAllSkyCamGateState() : Promise.resolve(null),
      fetchOpenMeteoObservatoryGate(),
    ])

    let ascGateApplicable = false
    let cloudCover: number | null = null
    let rainDetected = false
    let sequenceActive = false
    let ascStaleReason: string | null = 'no_camera'
    let ascFrameIso: string | null = null
    let ascModelPhase: string | null = null
    let ascLastError: string | null = null

    if (hasAsc && gate) {
      const ascCloud = gate.ascCloud
      sequenceActive = gate.sequenceActive
      ascGateApplicable = isAscCloudGateApplicable(ascCloud, gate.sequenceActive)
      const ascCloudCover = ascCloud?.cloudCoverPercent
      cloudCover =
        ascCloudCover != null && Number.isFinite(ascCloudCover) ? ascCloudCover : null
      rainDetected = ascCloud?.rain?.detected === true
      ascStaleReason = ascGateApplicable
        ? null
        : (ascCloud?.staleReason ?? (gate.sequenceActive ? 'sequence_active' : 'stale'))
      ascFrameIso = ascCloud?.frameIso ?? null
      ascModelPhase = ascCloud?.modelPhase ?? null
      ascLastError = ascCloud?.lastError ?? null
    }

    const weatherAllowed = evaluateObservatoryReadyWeather({
      cloudCoverPercent: cloudCover,
      openMeteoCloudCoverPercent: openMeteo.cloudCoverPercent,
      rainDetected,
      windSpeedMs: openMeteo.windSpeedMs,
      precipProbabilityPercent: openMeteo.precipProbability,
      ascGateApplicable,
    })
    weatherCacheSet({
      ts: now,
      cloudCover: cloudCover ?? 100,
      openMeteoCloudCover: openMeteo.cloudCoverPercent,
      rainDetected,
      precipitation: rainDetected ? 1 : 0,
      windSpeed: openMeteo.windSpeedMs,
      precipProbability: openMeteo.precipProbability,
      ascGateApplicable,
      sequenceActive,
      ascStaleReason,
      weatherAllowed,
      ascAvailable: ascGateApplicable && cloudCover != null,
      ascFrameIso,
      ascModelPhase,
      ascLastError,
    })
    // Weather-safety ESTOP arm + auto-clear when Open-Meteo/ASC clear; daytime arm is no-op.
    void import('@/lib/imaging/weather-safety-estop').then((m) =>
      m.triggerWeatherSafetyEmergencyStopCheck()
    )
    return weatherAllowed
  } catch {
    weatherCacheSet({
      ts: now,
      cloudCover: 100,
      openMeteoCloudCover: null,
      rainDetected: true,
      precipitation: 1,
      windSpeed: 999,
      precipProbability: 100,
      ascGateApplicable: false,
      sequenceActive: false,
      ascStaleReason: 'fetch_failed',
      weatherAllowed: false,
      ascAvailable: false,
      ascFrameIso: null,
      ascModelPhase: null,
      ascLastError: null,
    })
    void import('@/lib/imaging/weather-safety-estop').then((m) =>
      m.triggerWeatherSafetyEmergencyStopCheck()
    )
    return false
  }
}

function weatherDetailForAudit(now: number): Record<string, unknown> | null {
  const weatherCache = weatherCacheGet()
  if (!weatherCache) return null
  return {
    cloudCoverPercent: weatherCache.cloudCover,
    cloudSource: weatherCache.ascGateApplicable ? 'asc_ai' : 'open_meteo_current',
    openMeteoCloudCoverPercent: weatherCache.openMeteoCloudCover,
    rainDetected: weatherCache.rainDetected,
    precipitationMm: weatherCache.precipitation,
    windSpeedMs: weatherCache.windSpeed,
    precipProbabilityPercent: weatherCache.precipProbability,
    precipSource: 'open_meteo_current',
    ascGateApplicable: weatherCache.ascGateApplicable,
    sequenceActive: weatherCache.sequenceActive,
    ascStaleReason: weatherCache.ascStaleReason,
    windSource: 'open_meteo',
    gateOk: weatherCache.weatherAllowed,
    gateRule: OBSERVATORY_READY_GATE_RULE,
    ascAvailable: weatherCache.ascAvailable,
    ascFrameIso: weatherCache.ascFrameIso,
    ascModelPhase: weatherCache.ascModelPhase,
    ascLastError: weatherCache.ascLastError,
    cacheAgeSeconds: Math.round((now - weatherCache.ts) / 1000),
    observatoryLatDeg: currentObservatorySite().observerLatDeg,
    observatoryLonDeg: currentObservatorySite().observerLonDeg,
  }
}

function isObservatoryStatus(value: string): value is ObservatoryStatus {
  return (
    value === 'ready' ||
    value === 'busy_in_use' ||
    value === 'disconnected' ||
    value === 'closed_weather_not_permitted' ||
    value === 'closed_daytime' ||
    value === 'closed_observatory_maintenance'
  )
}

async function readAutoBaseCursor(): Promise<ObservatoryStatus | 'unset'> {
  if (kvEnabled()) {
    const raw = await kvGetString(autoBaseCursorKvKey())
    if (raw && isObservatoryStatus(raw)) {
      memory().__pomfret_auto_audit_last_base__ = raw
      return raw
    }
  }
  const m = memory().__pomfret_auto_audit_last_base__
  if (m === undefined) return 'unset'
  return m
}

/** One winner per base transition across serverless instances (KV CAS when available). */
async function tryClaimAutoBaseCursor(
  expected: ObservatoryStatus | 'unset',
  next: ObservatoryStatus
): Promise<boolean> {
  const expectedStr = expected === 'unset' ? '' : expected
  if (kvEnabled()) {
    const claimed = await kvCompareAndSet(autoBaseCursorKvKey(), expectedStr, next)
    if (claimed) {
      memory().__pomfret_auto_audit_last_base__ = next
      return true
    }
    return false
  }
  const current = memory().__pomfret_auto_audit_last_base__
  const currentNorm = current === undefined ? 'unset' : current
  if (currentNorm !== expected) return false
  memory().__pomfret_auto_audit_last_base__ = next
  return true
}

async function resetAutoBaseAuditCursor(): Promise<void> {
  memory().__pomfret_auto_audit_last_base__ = undefined
  if (kvEnabled()) {
    await kvDel(autoBaseCursorKvKey())
  }
}

function autoBaseLabel(s: ObservatoryStatus): string {
  if (s === 'ready') return 'Ready'
  if (s === 'busy_in_use') return 'Busy -- In Use'
  if (s === 'disconnected') return 'Disconnected'
  if (s === 'closed_weather_not_permitted') return 'Closed -- Weather Not Permitted'
  if (s === 'closed_daytime') return 'Closed -- Daytime'
  return 'Closed -- Observatory Maintenance'
}

async function maybeLogAutoComputedBaseChange(input: {
  base: ObservatoryStatus
  finalStatus: ObservatoryStatus
  nowMs: number
  pollTimeoutApplied: boolean
}): Promise<void> {
  const { base, finalStatus, nowMs, pollTimeoutApplied } = input
  const previousCursor = await readAutoBaseCursor()
  if (previousCursor === 'unset') {
    await tryClaimAutoBaseCursor('unset', base)
    return
  }
  if (previousCursor === base) return

  const claimed = await tryClaimAutoBaseCursor(previousCursor, base)
  if (!claimed) return

  if (base === 'ready') {
    const { emitAgentWakePollSequenceDebounced } = await import('@/lib/imaging/site-events')
    emitAgentWakePollSequenceDebounced()
  }

  const daytime = getDaytimeClosedWindowDetail(new Date(nowMs))
  const weather = daytime.within ? null : weatherDetailForAudit(nowMs)

  const enteringDaytime =
    base === 'closed_daytime' && previousCursor !== 'closed_daytime'
  const leavingDaytime = previousCursor === 'closed_daytime' && base !== 'closed_daytime'

  let evidence: Record<string, unknown>
  if (enteringDaytime) {
    evidence = {
      kind: 'entered_daytime_closed_window',
      why: 'Computed base is Closed--Daytime: current UTC instant falls in nautical dawn .. nautical dusk for this UTC date at observatory coordinates.',
      nauticalDawnUtc: daytime.nauticalDawnUtc,
      nauticalDuskUtc: daytime.nauticalDuskUtc,
      withinClosedWindowNow: daytime.within,
    }
  } else if (leavingDaytime) {
    evidence = {
      kind: 'left_daytime_closed_window',
      why: 'Computed base left Closed--Daytime: instant is after nautical dusk; next state uses ASC AI cloud/rain + Open-Meteo wind (values below are at transition time).',
      nauticalDawnUtc: daytime.nauticalDawnUtc,
      nauticalDuskUtc: daytime.nauticalDuskUtc,
      weatherAtTransition: weather,
      withinClosedWindowNow: daytime.within,
    }
  } else {
    evidence = {
      kind: 'night_weather_gate',
      why: 'Outside daytime closed window at this instant; Ready vs Closed--Weather from cached ASC AI cloud/rain + Open-Meteo wind.',
      weatherAtTransition: weather,
      withinClosedWindowNow: daytime.within,
      nauticalDawnUtc: daytime.nauticalDawnUtc,
      nauticalDuskUtc: daytime.nauticalDuskUtc,
      daytimeClosedFromUtc: daytime.closedStartUtc,
      daytimeClosedUntilUtc: daytime.closedEndUtc,
    }
  }

  const message = `Auto observatory base: ${autoBaseLabel(previousCursor)} → ${autoBaseLabel(base)}${
    pollTimeoutApplied && finalStatus === 'busy_in_use' && base !== 'busy_in_use'
      ? ' (display shows Busy -- In Use: agent reports NINA is running)'
      : ''
  }`

  await appendAuditLog({
    kind: 'observatory.auto_transition',
    message,
    detail: {
      from: previousCursor,
      to: base,
      returnedStatus: finalStatus,
      pollTimeoutApplied,
      evaluatedAtUtc: new Date(nowMs).toISOString(),
      evidence,
    },
  })
}

export function isObservatoryReady(status: ObservatoryStatus): boolean {
  return status === 'ready'
}

function applyObservatoryPayload(parsed: { status?: unknown; mode?: unknown; lastPollTs?: unknown }): void {
  if (
    parsed.status === 'ready' ||
    parsed.status === 'busy_in_use' ||
    parsed.status === 'disconnected' ||
    parsed.status === 'closed_weather_not_permitted' ||
    parsed.status === 'closed_daytime' ||
    parsed.status === 'closed_observatory_maintenance'
  ) {
    memory().__pomfret_manual_status__ = parsed.status
  }
  if (parsed.mode === 'manual' || parsed.mode === 'auto') {
    memory().__pomfret_mode__ = parsed.mode
  }
  if (typeof parsed.lastPollTs === 'number' && Number.isFinite(parsed.lastPollTs)) {
    memory().__pomfret_last_poll_ts__ = parsed.lastPollTs
  }
  if (
    typeof (parsed as { lastAgentSeenTs?: unknown }).lastAgentSeenTs === 'number' &&
    Number.isFinite((parsed as { lastAgentSeenTs: number }).lastAgentSeenTs)
  ) {
    memory().__pomfret_last_agent_seen_ts__ = (parsed as { lastAgentSeenTs: number }).lastAgentSeenTs
  }
  if (typeof (parsed as { ninaRunning?: unknown }).ninaRunning === 'boolean') {
    memory().__pomfret_nina_running__ = (parsed as { ninaRunning: boolean }).ninaRunning
  }
  if (
    typeof (parsed as { ninaRunningReportedAt?: unknown }).ninaRunningReportedAt === 'number' &&
    Number.isFinite((parsed as { ninaRunningReportedAt: number }).ninaRunningReportedAt)
  ) {
    memory().__pomfret_nina_running_reported_at__ = (parsed as { ninaRunningReportedAt: number }).ninaRunningReportedAt
  }
}

/** While ESTOP is active, never revert manual/maintenance from stale KV `auto`. */
export function applyRemoteObservatoryModeStatus(
  remote: { mode?: unknown; status?: unknown },
  estopBlocking: boolean
): void {
  if (estopBlocking) {
    if (remote.mode === 'manual') {
      memory().__pomfret_mode__ = 'manual'
    }
    if (remote.status === 'closed_observatory_maintenance') {
      memory().__pomfret_manual_status__ = 'closed_observatory_maintenance'
    }
    return
  }
  if (remote.mode === 'manual' || remote.mode === 'auto') {
    applyObservatoryPayload(remote)
  }
}

function mergeObservatoryTelemetry(remote: {
  lastPollTs?: unknown
  lastAgentSeenTs?: unknown
  ninaRunning?: unknown
  ninaRunningReportedAt?: unknown
}): void {
  if (typeof remote.lastPollTs === 'number' && Number.isFinite(remote.lastPollTs)) {
    memory().__pomfret_last_poll_ts__ = remote.lastPollTs
  }
  if (typeof remote.lastAgentSeenTs === 'number' && Number.isFinite(remote.lastAgentSeenTs)) {
    memory().__pomfret_last_agent_seen_ts__ = remote.lastAgentSeenTs
  }
  if (typeof remote.ninaRunning === 'boolean') {
    memory().__pomfret_nina_running__ = remote.ninaRunning
  }
  if (typeof remote.ninaRunningReportedAt === 'number' && Number.isFinite(remote.ninaRunningReportedAt)) {
    memory().__pomfret_nina_running_reported_at__ = remote.ninaRunningReportedAt
  }
}

async function enforceEmergencyStopObservatoryLock(): Promise<void> {
  if (!(await isEmergencyStopBlocking())) return
  if (currentMode() !== 'manual') {
    memory().__pomfret_mode__ = 'manual'
  }
  if (currentManualStatus() !== 'closed_observatory_maintenance') {
    memory().__pomfret_manual_status__ = 'closed_observatory_maintenance'
  }
}

async function ensureLoaded() {
  if (loaded) return

  if (kvEnabled()) {
    const remote = await kvGetJson<{ status?: unknown; mode?: unknown; lastPollTs?: unknown }>(
      observatoryStatusKvKey()
    )
    if (remote && (remote.mode === 'manual' || remote.mode === 'auto')) {
      applyObservatoryPayload(remote)
      loaded = true
      return
    }
  }

  if (statusFile) {
    try {
      const raw = await readFile(statusFile, 'utf-8')
      const parsed = JSON.parse(raw) as { status?: unknown; mode?: unknown; lastPollTs?: unknown }
      applyObservatoryPayload(parsed)
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code
      if (code !== 'ENOENT') throw e
    }
  }

  loaded = true
}

/**
 * Single KV read for mode, agent heartbeat, and NINA running flags (was two GETs per call).
 */
async function syncObservatoryFromKv(): Promise<void> {
  if (!kvEnabled()) return
  const remote = await kvGetJson<{
    status?: unknown
    mode?: unknown
    lastPollTs?: unknown
    lastAgentSeenTs?: unknown
    ninaRunning?: unknown
    ninaRunningReportedAt?: unknown
  }> (observatoryStatusKvKey())
  if (!remote) return

  const estopBlocking = await isEmergencyStopBlocking()
  applyRemoteObservatoryModeStatus(remote, estopBlocking)
  if (estopBlocking) {
    mergeObservatoryTelemetry(remote)
  } else if (remote.mode !== 'manual' && remote.mode !== 'auto') {
    mergeObservatoryTelemetry(remote)
  }

  const prevPoll = memory().__pomfret_last_poll_ts__ ?? 0
  const prevAgentSeen = memory().__pomfret_last_agent_seen_ts__ ?? 0
  const prevReportedAt = memory().__pomfret_nina_running_reported_at__ ?? 0

  if (typeof remote.lastPollTs === 'number' && Number.isFinite(remote.lastPollTs)) {
    memory().__pomfret_last_poll_ts__ = Math.max(remote.lastPollTs, prevPoll)
  }
  if (typeof remote.lastAgentSeenTs === 'number' && Number.isFinite(remote.lastAgentSeenTs)) {
    memory().__pomfret_last_agent_seen_ts__ = Math.max(remote.lastAgentSeenTs, prevAgentSeen)
  }
  if (typeof remote.ninaRunningReportedAt === 'number' && Number.isFinite(remote.ninaRunningReportedAt)) {
    memory().__pomfret_nina_running_reported_at__ = Math.max(remote.ninaRunningReportedAt, prevReportedAt)
  }
}

async function persist(options?: { force?: boolean }) {
  const now = Date.now()
  const lastPersistAt = memory().__pomfret_last_persist_at__ ?? 0
  if (!options?.force && now - lastPersistAt < OBSERVATORY_PERSIST_DEBOUNCE_MS) {
    return
  }
  memory().__pomfret_last_persist_at__ = now
  const payload = {
    mode: currentMode(),
    status: currentManualStatus(),
    lastPollTs: memory().__pomfret_last_poll_ts__ ?? null,
    lastAgentSeenTs: memory().__pomfret_last_agent_seen_ts__ ?? null,
    ninaRunning: memory().__pomfret_nina_running__ ?? null,
    ninaRunningReportedAt: memory().__pomfret_nina_running_reported_at__ ?? null,
  }
  if (kvEnabled()) {
    const ok = await kvSetJson(observatoryStatusKvKey(), payload)
    if (ok) {
      void forcePushObservatoryStatusLive()
      return
    }
  }
  if (!statusFile) return
  await mkdir(path.dirname(statusFile), { recursive: true })
  const tmp = `${statusFile}.${process.pid}.${Date.now()}.tmp`
  await writeFile(
    tmp,
    JSON.stringify(payload, null, 2),
    'utf-8'
  )
  await rename(tmp, statusFile)
  void forcePushObservatoryStatusLive()
}

export async function getObservatoryStatus(
  options?: GetObservatoryStatusOptions
): Promise<ObservatoryStatus> {
  await ensureLoaded()
  await syncObservatoryFromKv()
  await enforceEmergencyStopObservatoryLock()
  const estopBlocking = await isEmergencyStopBlocking()
  const mode = estopBlocking ? 'manual' : currentMode()
  const now = Date.now()
  const lastAgentSeenTs = memory().__pomfret_last_agent_seen_ts__ ?? 0
  const ninaRunning = memory().__pomfret_nina_running__ ?? false
  const ninaRunningReportedAt = memory().__pomfret_nina_running_reported_at__ ?? 0

  let base: ObservatoryStatus
  if (await isWithinAdminClosedWindow(now)) {
    base = 'closed_observatory_maintenance'
  } else if (mode === 'manual') {
    base = currentManualStatus()
  } else if (isWithinDaytimeClosedWindow(new Date(now))) {
    base = 'closed_daytime'
  } else {
    const weatherAllowed = await fetchWeatherAllowed(now)
    base = weatherAllowed ? 'ready' : 'closed_weather_not_permitted'
  }

  let final: ObservatoryStatus
  if (isObservatoryAgentDisconnected(now, lastAgentSeenTs)) {
    final = 'disconnected'
  } else if (base === 'busy_in_use') {
    final = 'busy_in_use'
  } else if (isObservatoryBusyFromNinaReport(now, ninaRunning, ninaRunningReportedAt)) {
    final = 'busy_in_use'
  } else {
    final = base
  }

  if (mode === 'auto') {
    await maybeLogAutoComputedBaseChange({
      base,
      finalStatus: final,
      nowMs: now,
      pollTimeoutApplied: final === 'busy_in_use' && base !== 'busy_in_use' && ninaRunning,
    })
  }

  try {
    await maybeFailSessionsAfterNinaStopped(now)
  } catch {
    // never block status reads
  }

  if (!options?.skipLivePush) {
    void publishObservatoryStatusLive(final, mode, false)
  }

  return final
}

export async function setObservatoryStatus(next: ObservatoryStatus): Promise<ObservatoryStatus> {
  await ensureLoaded()
  memory().__pomfret_manual_status__ = next
  await persist({ force: true })
  return next
}

export async function setObservatoryMode(mode: ObservatoryMode): Promise<ObservatoryMode> {
  await ensureLoaded()
  const prev = currentMode()
  memory().__pomfret_mode__ = mode
  await persist({ force: true })
  if (prev !== mode) {
    await resetAutoBaseAuditCursor()
  }
  return mode
}

export async function getObservatoryMode(): Promise<ObservatoryMode> {
  await ensureLoaded()
  await syncObservatoryFromKv()
  await enforceEmergencyStopObservatoryLock()
  if (await isEmergencyStopBlocking()) return 'manual'
  return currentMode()
}

/** Agent heartbeat from nina-sequence GET (including ESTOP polls while NINA runs). */
export async function touchObservatoryPoll(): Promise<void> {
  await ensureLoaded()
  await syncObservatoryFromKv()
  await enforceEmergencyStopObservatoryLock()
  const now = Date.now()
  memory().__pomfret_last_poll_ts__ = now
  memory().__pomfret_last_agent_seen_ts__ = now
  // Heartbeat only — ninaRunning is owned by agent-pulse POST. Merge KV before persist so a
  // cold lambda cannot overwrite a fresh ninaRunning=true with undefined/false.
  await persist()
}

export function isObservatoryBusyFromNinaReport(
  nowMs: number,
  ninaRunning: boolean,
  ninaRunningReportedAt: number
): boolean {
  if (!ninaRunning) return false
  if (!Number.isFinite(ninaRunningReportedAt) || ninaRunningReportedAt <= 0) return false
  return nowMs - ninaRunningReportedAt <= NINA_RUNNING_STALE_MS
}

/** Agent pulse says NINA is actively running (fresh report within stale window). */
export async function isNinaReportedRunningNow(nowMs = Date.now()): Promise<boolean> {
  await syncObservatoryFromKv()
  const ninaRunning = memory().__pomfret_nina_running__ ?? false
  const ninaRunningReportedAt = memory().__pomfret_nina_running_reported_at__ ?? 0
  return isObservatoryBusyFromNinaReport(nowMs, ninaRunning, ninaRunningReportedAt)
}

export async function reportObservatoryAgentPulse(input: { ninaRunning: boolean }): Promise<void> {
  await ensureLoaded()
  await syncObservatoryFromKv()
  const now = Date.now()
  const prevRunning = memory().__pomfret_nina_running__ ?? false
  memory().__pomfret_nina_running__ = input.ninaRunning
  memory().__pomfret_nina_running_reported_at__ = now
  memory().__pomfret_last_agent_seen_ts__ = now
  await persist({ force: prevRunning !== input.ninaRunning })
  if (prevRunning !== input.ninaRunning) {
    void import('@/lib/imaging/site-poll-snapshot')
      .then((m) => m.refreshSitePollSnapshot())
      .catch(() => {
        // ignore
      })
  }
  try {
    await onNinaRunningReported(input.ninaRunning, now)
  } catch {
    // never block agent pulse
  }
}

export function isObservatoryAgentDisconnected(nowMs: number, lastAgentSeenTs: number): boolean {
  if (!Number.isFinite(lastAgentSeenTs) || lastAgentSeenTs <= 0) return true
  const staleMs = observatoryAgentDisconnectedStaleMs(new Date(nowMs))
  return nowMs - lastAgentSeenTs > staleMs
}

/** True when the NINA agent heartbeat (pulse or nina-sequence poll) was seen within the stale window. */
export async function isObservatoryAgentConnected(nowMs = Date.now()): Promise<boolean> {
  await syncObservatoryFromKv()
  const lastAgentSeenTs = memory().__pomfret_last_agent_seen_ts__ ?? 0
  return !isObservatoryAgentDisconnected(nowMs, lastAgentSeenTs)
}
