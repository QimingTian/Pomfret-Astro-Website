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
import { OBS_LAT_DEG, OBS_LON_DEG } from '@/lib/target-altitude'
import { getDaytimeClosedWindowDetail, isWithinDaytimeClosedWindow } from '@/lib/sunrise-window'
import { isWithinAdminClosedWindow } from '@/lib/admin-closed-window-store'
import { onObservatoryFinalStatusChanged } from '@/lib/imaging-session-failure'
import { emitSiteObservatoryStatus } from '@/lib/imaging/site-events-server'
import {
  evaluateObservatoryReadyWeather,
  fetchAscCloud,
  OBSERVATORY_READY_GATE_RULE,
} from '@/lib/asc-cloud'

export type ObservatoryStatus =
  | 'ready'
  | 'busy_in_use'
  | 'disconnected'
  | 'closed_weather_not_permitted'
  | 'closed_daytime'
  | 'closed_observatory_maintenance'

export type ObservatoryMode = 'manual' | 'auto'

type GlobalState = typeof globalThis & {
  __pomfret_manual_status__?: ObservatoryStatus
  __pomfret_mode__?: ObservatoryMode
  __pomfret_last_poll_ts__?: number
  __pomfret_last_agent_seen_ts__?: number
  __pomfret_nina_running__?: boolean
  __pomfret_nina_running_reported_at__?: number
  /** Last auto-computed base for transition log; `undefined` = never set on this instance. */
  __pomfret_auto_audit_last_base__?: ObservatoryStatus
}

const statusFile = process.env.OBSERVATORY_STATUS_FILE
let loaded = false
const NINA_RUNNING_STALE_MS = 90_000
const AGENT_DISCONNECTED_MS = 90_000
const WEATHER_CACHE_MS = 0
const AUTO_BASE_CURSOR_KV_KEY = 'observatory-auto-audit-last-base'
const KMH_TO_MS = 1 / 3.6
let weatherCache:
  | {
      ts: number
      cloudCover: number
      rainDetected: boolean
      precipitation: number
      windSpeed: number
      weatherAllowed: boolean
      ascAvailable: boolean
      ascFrameIso: string | null
      ascModelPhase: string | null
      ascLastError: string | null
    }
  | undefined

function memory(): GlobalState {
  return globalThis as GlobalState
}

function currentManualStatus(): ObservatoryStatus {
  return memory().__pomfret_manual_status__ ?? 'ready'
}

function currentMode(): ObservatoryMode {
  return memory().__pomfret_mode__ ?? 'manual'
}

async function fetchOpenMeteoWindSpeedMs(): Promise<number> {
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${OBS_LAT_DEG}&longitude=${OBS_LON_DEG}` +
    '&current=wind_speed_10m&timezone=UTC'
  const res = await fetch(url, { cache: 'no-store' })
  if (!res.ok) throw new Error(`weather http ${res.status}`)
  const data = (await res.json()) as { current?: { wind_speed_10m?: number } }
  const windSpeedRaw = Number(data.current?.wind_speed_10m ?? 999)
  return Number.isFinite(windSpeedRaw) ? windSpeedRaw * KMH_TO_MS : 999
}

async function fetchWeatherAllowed(now = Date.now()): Promise<boolean> {
  if (weatherCache && now - weatherCache.ts < WEATHER_CACHE_MS) {
    return weatherCache.weatherAllowed
  }

  try {
    const [ascCloud, windSpeed] = await Promise.all([fetchAscCloud(), fetchOpenMeteoWindSpeedMs()])
    const ascCloudCover = ascCloud?.cloudCoverPercent
    const cloudCover =
      ascCloudCover != null && Number.isFinite(ascCloudCover) ? ascCloudCover : null
    const rainDetected = ascCloud?.rain?.detected === true
    const weatherAllowed = evaluateObservatoryReadyWeather({
      cloudCoverPercent: cloudCover,
      rainDetected,
      windSpeedMs: windSpeed,
    })
    weatherCache = {
      ts: now,
      cloudCover: cloudCover ?? 100,
      rainDetected,
      precipitation: rainDetected ? 1 : 0,
      windSpeed,
      weatherAllowed,
      ascAvailable: cloudCover != null,
      ascFrameIso: ascCloud?.frameIso ?? null,
      ascModelPhase: ascCloud?.modelPhase ?? null,
      ascLastError: ascCloud?.lastError ?? null,
    }
    return weatherAllowed
  } catch {
    weatherCache = {
      ts: now,
      cloudCover: 100,
      rainDetected: true,
      precipitation: 1,
      windSpeed: 999,
      weatherAllowed: false,
      ascAvailable: false,
      ascFrameIso: null,
      ascModelPhase: null,
      ascLastError: null,
    }
    return false
  }
}

function weatherDetailForAudit(now: number): Record<string, unknown> | null {
  if (!weatherCache) return null
  return {
    cloudCoverPercent: weatherCache.cloudCover,
    cloudSource: 'asc_ai',
    rainDetected: weatherCache.rainDetected,
    precipitationMm: weatherCache.precipitation,
    windSpeedMs: weatherCache.windSpeed,
    windSource: 'open_meteo',
    gateOk: weatherCache.weatherAllowed,
    gateRule: OBSERVATORY_READY_GATE_RULE,
    ascAvailable: weatherCache.ascAvailable,
    ascFrameIso: weatherCache.ascFrameIso,
    ascModelPhase: weatherCache.ascModelPhase,
    ascLastError: weatherCache.ascLastError,
    cacheAgeSeconds: Math.round((now - weatherCache.ts) / 1000),
    observatoryLatDeg: OBS_LAT_DEG,
    observatoryLonDeg: OBS_LON_DEG,
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
    const raw = await kvGetString(AUTO_BASE_CURSOR_KV_KEY)
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
    const claimed = await kvCompareAndSet(AUTO_BASE_CURSOR_KV_KEY, expectedStr, next)
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
    await kvDel(AUTO_BASE_CURSOR_KV_KEY)
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

async function ensureLoaded() {
  if (loaded) return

  if (kvEnabled()) {
    const remote = await kvGetJson<{ status?: unknown; mode?: unknown; lastPollTs?: unknown }>(
      'observatory-status'
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
 * Re-merge mode / manual status / lastPollTs from KV on every status read when KV is on.
 * Fixes cold starts where ensureLoaded() missed KV once and left defaults (manual + ready),
 * and keeps all serverless instances aligned with the persisted mode.
 */
async function mergeObservatorySnapshotFromKv(): Promise<void> {
  if (!kvEnabled()) return
  const remote = await kvGetJson<{
    status?: unknown
    mode?: unknown
    lastPollTs?: unknown
    lastAgentSeenTs?: unknown
    ninaRunning?: unknown
    ninaRunningReportedAt?: unknown
  }>(
    'observatory-status'
  )
  if (!remote || (remote.mode !== 'manual' && remote.mode !== 'auto')) return

  const prevPoll = memory().__pomfret_last_poll_ts__ ?? 0
  const prevAgentSeen = memory().__pomfret_last_agent_seen_ts__ ?? 0
  const prevReportedAt = memory().__pomfret_nina_running_reported_at__ ?? 0
  applyObservatoryPayload(remote)
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

/** When KV is on, other serverless instances may have advanced lastPollTs — re-read before computing busy. */
async function refreshLastPollTsFromKv(): Promise<void> {
  if (!kvEnabled()) return
  const remote = await kvGetJson<{ lastPollTs?: unknown }>('observatory-status')
  if (!remote || typeof remote.lastPollTs !== 'number' || !Number.isFinite(remote.lastPollTs)) return
  const fromKv = remote.lastPollTs
  const local = memory().__pomfret_last_poll_ts__ ?? 0
  memory().__pomfret_last_poll_ts__ = Math.max(fromKv, local)
}

async function persist() {
  const payload = {
    mode: currentMode(),
    status: currentManualStatus(),
    lastPollTs: memory().__pomfret_last_poll_ts__ ?? null,
    lastAgentSeenTs: memory().__pomfret_last_agent_seen_ts__ ?? null,
    ninaRunning: memory().__pomfret_nina_running__ ?? null,
    ninaRunningReportedAt: memory().__pomfret_nina_running_reported_at__ ?? null,
  }
  if (kvEnabled()) {
    const ok = await kvSetJson('observatory-status', payload)
    if (ok) {
      void emitSiteObservatoryStatus()
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
  void emitSiteObservatoryStatus()
}

export type GetObservatoryStatusOptions = {
  /**
   * When false, skip observatory_left_busy failure side effects.
   * Agent nina-sequence polls (e.g. ESTOP every 5s while NINA runs) must not fail in-progress sessions.
   */
  trackSessionFailure?: boolean
}

export async function getObservatoryStatus(options?: GetObservatoryStatusOptions): Promise<ObservatoryStatus> {
  await ensureLoaded()
  await mergeObservatorySnapshotFromKv()
  await refreshLastPollTsFromKv()
  const mode = currentMode()
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

  if (options?.trackSessionFailure !== false) {
    const ninaReportedBusy = isObservatoryBusyFromNinaReport(now, ninaRunning, ninaRunningReportedAt)
    try {
      await onObservatoryFinalStatusChanged(final, { ninaReportedBusy })
    } catch {
      // never block status reads
    }
  }

  return final
}

export async function setObservatoryStatus(next: ObservatoryStatus): Promise<ObservatoryStatus> {
  await ensureLoaded()
  memory().__pomfret_manual_status__ = next
  await persist()
  return next
}

export async function setObservatoryMode(mode: ObservatoryMode): Promise<ObservatoryMode> {
  await ensureLoaded()
  const prev = currentMode()
  memory().__pomfret_mode__ = mode
  await persist()
  if (prev !== mode) {
    await resetAutoBaseAuditCursor()
  }
  return mode
}

export async function getObservatoryMode(): Promise<ObservatoryMode> {
  await ensureLoaded()
  await mergeObservatorySnapshotFromKv()
  return currentMode()
}

/** Agent heartbeat from nina-sequence GET (including ESTOP polls while NINA runs). */
export async function touchObservatoryPoll(): Promise<void> {
  await ensureLoaded()
  await mergeObservatorySnapshotFromKv()
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
  await mergeObservatorySnapshotFromKv()
  const ninaRunning = memory().__pomfret_nina_running__ ?? false
  const ninaRunningReportedAt = memory().__pomfret_nina_running_reported_at__ ?? 0
  return isObservatoryBusyFromNinaReport(nowMs, ninaRunning, ninaRunningReportedAt)
}

export async function reportObservatoryAgentPulse(input: { ninaRunning: boolean }): Promise<void> {
  await ensureLoaded()
  await mergeObservatorySnapshotFromKv()
  const now = Date.now()
  memory().__pomfret_nina_running__ = input.ninaRunning
  memory().__pomfret_nina_running_reported_at__ = now
  memory().__pomfret_last_agent_seen_ts__ = now
  await persist()
}

export function isObservatoryAgentDisconnected(nowMs: number, lastAgentSeenTs: number): boolean {
  if (!Number.isFinite(lastAgentSeenTs) || lastAgentSeenTs <= 0) return true
  return nowMs - lastAgentSeenTs > AGENT_DISCONNECTED_MS
}

/** True when the NINA agent heartbeat (pulse or nina-sequence poll) was seen within the stale window. */
export async function isObservatoryAgentConnected(nowMs = Date.now()): Promise<boolean> {
  await mergeObservatorySnapshotFromKv()
  const lastAgentSeenTs = memory().__pomfret_last_agent_seen_ts__ ?? 0
  return !isObservatoryAgentDisconnected(nowMs, lastAgentSeenTs)
}
