import { createHmac } from 'crypto'
import { NextResponse } from 'next/server'
import { imagingCorsHeadersResolved } from '@/lib/imaging-queue-auth'
import {
  computeVariableStarWindowHms,
  type NinaSequenceParams,
  type ObservatoryHms,
} from '@/lib/imaging/nina/sequence-json'
import { VARIABLE_STAR_SESSION_OVERHEAD_SEC } from '@/lib/imaging/session/overhead'
import {
  estopDiscordMessageForState,
  isWeatherSafetyEmergencyStopActor,
} from '@/lib/imaging/session/estop-sequence'
import {
  END_NIGHT_DISCORD_AFTER_SESSIONS,
  END_NIGHT_DISCORD_DAWN,
} from '@/lib/imaging/nina-discord-message'
import type { ImagingRequest } from '@/lib/imaging-queue-store'
import {
  projectTargetCoords,
  projectTargetCoordsForPanel,
  type ImagingProject,
  type ProjectNight,
} from '@/lib/imaging-project-store'

export const NINA_AGENT_JOB_KIND = 'pomfret-nina-job'
export const NINA_AGENT_JOB_VERSION = 7

export type NinaAgentJobCommand = 'run' | 'estop' | 'end_night'

export type NinaAgentRunParams = NinaSequenceParams & {
  variableStarWindow?: { start: ObservatoryHms; end: ObservatoryHms }
}

export type NinaAgentJob = {
  kind: typeof NINA_AGENT_JOB_KIND
  version: number
  command: NinaAgentJobCommand
  queueId: string
  issuedAt: string
  params?: NinaAgentRunParams
  estop?: { weatherSafety: boolean; discordText: string }
  endNight?: { trigger: 'after_sessions' | 'dawn'; discordText: string }
  httpAuth?: { username: string; password: string }
  signature?: string
}

export type NinaAgentJobInput = Omit<NinaAgentJob, 'kind' | 'version' | 'signature' | 'issuedAt'> & {
  issuedAt?: string
}

export function stableStringify(value: unknown): string {
  if (value === null) return 'null'
  const t = typeof value
  if (t === 'boolean') return value ? 'true' : 'false'
  if (t === 'number') {
    if (!Number.isFinite(value as number)) throw new Error('non-finite number')
    return JSON.stringify(value)
  }
  if (t === 'string') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  if (t === 'object') {
    const rec = value as Record<string, unknown>
    const keys = Object.keys(rec).sort()
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(rec[k])}`).join(',')}}`
  }
  throw new Error(`cannot stringify ${t}`)
}

function signingSecret(): string {
  return process.env.IMAGING_QUEUE_SECRET?.trim() ?? ''
}

function httpAuthFromEnv(): NinaAgentJob['httpAuth'] | undefined {
  const password = process.env.NINA_SESSION_PROGRESS_BASIC_PASSWORD
  if (!password) return undefined
  return {
    username: process.env.NINA_SESSION_PROGRESS_BASIC_USER ?? 'pomfretastro',
    password,
  }
}

export function signNinaAgentJob(job: Omit<NinaAgentJob, 'signature'>): string {
  const secret = signingSecret()
  if (!secret) return ''
  return createHmac('sha256', secret).update(stableStringify(job), 'utf8').digest('hex')
}

export function serializeNinaAgentJob(job: NinaAgentJobInput): string {
  const fromEnv = httpAuthFromEnv()
  const unsigned: Omit<NinaAgentJob, 'signature'> = {
    kind: NINA_AGENT_JOB_KIND,
    version: NINA_AGENT_JOB_VERSION,
    issuedAt: job.issuedAt ?? new Date().toISOString(),
    command: job.command,
    queueId: job.queueId,
    ...(job.params ? { params: job.params } : {}),
    ...(job.estop ? { estop: job.estop } : {}),
    ...(job.endNight ? { endNight: job.endNight } : {}),
    ...(job.httpAuth ? { httpAuth: job.httpAuth } : fromEnv ? { httpAuth: fromEnv } : {}),
  }
  const signature = signNinaAgentJob(unsigned)
  const wrapped: NinaAgentJob = signature ? { ...unsigned, signature } : unsigned
  return JSON.stringify({ PomfretAstroJob: wrapped }, null, 2)
}

export function ninaAgentJobResponse(job: NinaAgentJobInput): NextResponse {
  return new NextResponse(serializeNinaAgentJob(job), {
    status: 200,
    headers: {
      ...imagingCorsHeadersResolved(),
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Pomfret-Payload': 'nina-job-v7',
    },
  })
}

export function sequenceParamsFromQueueRequest(r: ImagingRequest): NinaAgentRunParams | null {
  if (r.raHours == null || r.decDeg == null || !r.filter) return null
  const templateKind = r.sequenceTemplate === 'variable_star' ? 'variable_star' : 'dso'
  const variableStarObservingSeconds =
    templateKind === 'variable_star' &&
    typeof r.estimatedDurationSeconds === 'number' &&
    Number.isFinite(r.estimatedDurationSeconds)
      ? Math.max(0, r.estimatedDurationSeconds - VARIABLE_STAR_SESSION_OVERHEAD_SEC)
      : undefined
  const params: NinaAgentRunParams = {
    raHoursDecimal: r.raHours,
    decDegDecimal: r.decDeg,
    filterName: r.filter,
    exposureSeconds: r.exposureSeconds,
    exposureCount: r.count,
    pomfretQueueId: r.id,
    templateKind,
    outputMode: r.outputMode as NinaSequenceParams['outputMode'],
    cameraCoolingTempC: r.cameraCoolingTempC,
    targetName: r.target ?? undefined,
    ...(r.filterPlans && r.filterPlans.length > 0
      ? {
          filterPlans: r.filterPlans.map((p) => ({
            filterName: p.filterName,
            exposureSeconds: p.exposureSeconds,
            exposureCount: p.count,
          })),
        }
      : {}),
    ...(variableStarObservingSeconds != null ? { variableStarObservingSeconds } : {}),
  }
  if (templateKind === 'variable_star') {
    const observingMs =
      typeof variableStarObservingSeconds === 'number'
        ? Math.round(variableStarObservingSeconds * 1000)
        : undefined
    params.variableStarWindow = computeVariableStarWindowHms(
      params.raHoursDecimal,
      params.decDegDecimal,
      observingMs,
    )
  }
  return params
}

export function sequenceParamsFromProjectNight(
  project: ImagingProject,
  night: ProjectNight,
): NinaAgentRunParams | null {
  const plans = night.filterPlansTonight
  const first = plans[0]
  if (!first) return null
  const coords =
    night.mosaicPanelIndex != null
      ? projectTargetCoordsForPanel(project, night.mosaicPanelIndex)
      : projectTargetCoords(project)
  return {
    raHoursDecimal: coords.raHours,
    decDegDecimal: coords.decDeg,
    filterName: first.filterName,
    exposureSeconds: first.exposureSeconds,
    exposureCount: first.count,
    pomfretQueueId: night.id,
    templateKind: 'dso',
    outputMode: project.outputMode as NinaSequenceParams['outputMode'],
    cameraCoolingTempC: project.cameraCoolingTempC,
    targetName: project.target,
    filterPlans: plans.map((p) => ({
      filterName: p.filterName,
      exposureSeconds: p.exposureSeconds,
      exposureCount: p.count,
    })),
  }
}

export function runJobFromQueueRequest(r: ImagingRequest): NinaAgentJobInput | null {
  const params = sequenceParamsFromQueueRequest(r)
  if (!params) return null
  return { command: 'run', queueId: r.id, params }
}

export function runJobFromProjectNight(project: ImagingProject, night: ProjectNight): NinaAgentJobInput | null {
  const params = sequenceParamsFromProjectNight(project, night)
  if (!params) return null
  return { command: 'run', queueId: night.id, params }
}

export function estopJobFromState(
  queueId: string,
  state: { requestedByUserId?: string | null; requestedByUsername?: string | null },
): NinaAgentJobInput {
  return {
    command: 'estop',
    queueId,
    estop: {
      weatherSafety: isWeatherSafetyEmergencyStopActor(state),
      discordText: estopDiscordMessageForState(state),
    },
  }
}

export function endNightJob(queueId: string, trigger: 'after_sessions' | 'dawn'): NinaAgentJobInput {
  return {
    command: 'end_night',
    queueId,
    endNight: {
      trigger,
      discordText: trigger === 'dawn' ? END_NIGHT_DISCORD_DAWN : END_NIGHT_DISCORD_AFTER_SESSIONS,
    },
  }
}
