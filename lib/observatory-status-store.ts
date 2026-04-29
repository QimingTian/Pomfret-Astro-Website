import { mkdir, readFile, rename, writeFile } from 'fs/promises'
import path from 'path'
import { appendAuditLog } from '@/lib/imaging-audit-log'
import { kvEnabled, kvGetJson, kvSetJson } from '@/lib/kv-rest'
import { OBS_LAT_DEG, OBS_LON_DEG } from '@/lib/target-altitude'
import { getDaytimeClosedWindowDetail, isWithinDaytimeClosedWindow } from '@/lib/sunrise-window'
import { isWithinAdminClosedWindow } from '@/lib/admin-closed-window-store'

export type ObservatoryStatus =
  | 'ready'
  | 'busy_in_use'
  | 'closed_weather_not_permitted'
  | 'closed_daytime'
  | 'closed_observatory_maintenance'

export type ObservatoryMode = 'manual' | 'auto'

type GlobalState = typeof globalThis & {
  __pomfret_manual_status__?: ObservatoryStatus
  __pomfret_mode__?: ObservatoryMode
  __pomfret_last_poll_ts__?: number
  /** Last auto-computed base for transition log; `undefined` = never set on this instance. */
  __pomfret_auto_audit_last_base__?: ObservatoryStatus
}

const statusFile = process.env.OBSERVATORY_STATUS_FILE
let loaded = false
const BUSY_TIMEOUT_MS = 90_000
const WEATHER_CACHE_MS = 0
const KMH_TO_MS = 1 / 3.6
let weatherCache:
  | {
      ts: number
      cloudCover: number
      precipitation: number
      windSpeed: number
      weatherAllowed: boolean
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

async function fetchWeatherAllowed(now = Date.now()): Promise<boolean> {
  if (weatherCache && now - weatherCache.ts < WEATHER_CACHE_MS) {
    return weatherCache.weatherAllowed
  }

  try {
    const url =
      `https://api.open-meteo.com/v1/forecast?latitude=${OBS_LAT_DEG}&longitude=${OBS_LON_DEG}` +
      '&current=cloud_cover,precipitation,wind_speed_10m&timezone=UTC'
    const res = await fetch(url, { cache: 'no-store' })
    if (!res.ok) throw new Error(`weather http ${res.status}`)
    const data = (await res.json()) as {
      current?: { cloud_cover?: number; precipitation?: number; wind_speed_10m?: number }
    }
    const cloudCover = Number(data.current?.cloud_cover ?? 100)
    const precipitation = Number(data.current?.precipitation ?? 999)
    const windSpeedRaw = Number(data.current?.wind_speed_10m ?? 999)
    const windSpeed = Number.isFinite(windSpeedRaw) ? windSpeedRaw * KMH_TO_MS : 999
    const weatherAllowed = cloudCover < 20 && precipitation <= 0 && windSpeed < 10
    weatherCache = { ts: now, cloudCover, precipitation, windSpeed, weatherAllowed }
    return weatherAllowed
  } catch {
    weatherCache = { ts: now, cloudCover: 100, precipitation: 999, windSpeed: 999, weatherAllowed: false }
    return false
  }
}

function weatherDetailForAudit(now: number): Record<string, unknown> | null {
  if (!weatherCache) return null
  return {
    cloudCoverPercent: weatherCache.cloudCover,
    precipitationMm: weatherCache.precipitation,
    windSpeedMs: weatherCache.windSpeed,
    gateOk: weatherCache.weatherAllowed,
    gateRule: 'cloud < 20% and precipitation <= 0 and wind_speed_10m < 10 m/s',
    cacheAgeSeconds: Math.round((now - weatherCache.ts) / 1000),
    observatoryLatDeg: OBS_LAT_DEG,
    observatoryLonDeg: OBS_LON_DEG,
  }
}

async function readAutoBaseCursor(): Promise<ObservatoryStatus | 'unset'> {
  const m = memory().__pomfret_auto_audit_last_base__
  if (m === undefined) return 'unset'
  return m
}

async function writeAutoBaseCursor(base: ObservatoryStatus): Promise<void> {
  memory().__pomfret_auto_audit_last_base__ = base
}

async function resetAutoBaseAuditCursor(): Promise<void> {
  memory().__pomfret_auto_audit_last_base__ = undefined
}

function autoBaseLabel(s: ObservatoryStatus): string {
  if (s === 'ready') return 'Ready'
  if (s === 'busy_in_use') return 'Busy -- In Use'
  if (s === 'closed_weather_not_permitted') return 'Closed -- Weather Not Permitted'
  if (s === 'closed_daytime') return 'Closed -- Daytime'
  return 'Closed -- Observatory Maintenance'
}

async function maybeLogAutoComputedBaseChange(input: {
  previousCursor: ObservatoryStatus | 'unset'
  base: ObservatoryStatus
  finalStatus: ObservatoryStatus
  nowMs: number
  pollTimeoutApplied: boolean
}): Promise<void> {
  const { previousCursor, base, finalStatus, nowMs, pollTimeoutApplied } = input
  if (previousCursor === 'unset') {
    await writeAutoBaseCursor(base)
    return
  }
  if (previousCursor === base) return

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
      why: 'Computed base left Closed--Daytime: instant is after nautical dusk; next state uses Open-Meteo (values below are at transition time).',
      nauticalDawnUtc: daytime.nauticalDawnUtc,
      nauticalDuskUtc: daytime.nauticalDuskUtc,
      weatherAtTransition: weather,
      withinClosedWindowNow: daytime.within,
    }
  } else {
    evidence = {
      kind: 'night_weather_gate',
      why: 'Outside daytime closed window at this instant; Ready vs Closed--Weather from cached Open-Meteo current conditions.',
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
      ? ' (display shows Busy -- In Use: no nina-sequence poll within 90s)'
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

  await writeAutoBaseCursor(base)
}

export function isObservatoryReady(status: ObservatoryStatus): boolean {
  return status === 'ready'
}

function applyObservatoryPayload(parsed: { status?: unknown; mode?: unknown; lastPollTs?: unknown }): void {
  if (
    parsed.status === 'ready' ||
    parsed.status === 'busy_in_use' ||
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
  const remote = await kvGetJson<{ status?: unknown; mode?: unknown; lastPollTs?: unknown }>(
    'observatory-status'
  )
  if (!remote || (remote.mode !== 'manual' && remote.mode !== 'auto')) return

  const prevPoll = memory().__pomfret_last_poll_ts__ ?? 0
  applyObservatoryPayload(remote)
  if (typeof remote.lastPollTs === 'number' && Number.isFinite(remote.lastPollTs)) {
    memory().__pomfret_last_poll_ts__ = Math.max(remote.lastPollTs, prevPoll)
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
  }
  if (kvEnabled()) {
    const ok = await kvSetJson('observatory-status', payload)
    if (ok) return
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
}

export async function getObservatoryStatus(): Promise<ObservatoryStatus> {
  await ensureLoaded()
  await mergeObservatorySnapshotFromKv()
  await refreshLastPollTsFromKv()
  const mode = currentMode()
  const now = Date.now()
  const lastPollTs = memory().__pomfret_last_poll_ts__ ?? 0

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
  if (base === 'busy_in_use') {
    final = 'busy_in_use'
  } else if (lastPollTs > 0 && now - lastPollTs > BUSY_TIMEOUT_MS) {
    final = 'busy_in_use'
  } else {
    final = base
  }

  if (mode === 'auto') {
    const prev = await readAutoBaseCursor()
    await maybeLogAutoComputedBaseChange({
      previousCursor: prev,
      base,
      finalStatus: final,
      nowMs: now,
      pollTimeoutApplied: final === 'busy_in_use' && base !== 'busy_in_use',
    })
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

export async function touchObservatoryPoll(): Promise<void> {
  await ensureLoaded()
  memory().__pomfret_last_poll_ts__ = Date.now()
  await persist()
}
