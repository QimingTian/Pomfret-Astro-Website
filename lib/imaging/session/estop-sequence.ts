import estopTemplate from '@/EStop.json'
import {
  ESTOP_DISCORD_MANUAL,
  ESTOP_DISCORD_WEATHER_SAFETY,
  patchNinaDiscordMessageText,
} from '@/lib/imaging/nina-discord-message'
import { applySessionProgressSiteInHttpUris } from '@/lib/imaging/nina/sequence-json'
import { currentObservatorySiteId } from '@/lib/observatory-site-scope'

const ESTOP_TEMPLATE = estopTemplate as Record<string, unknown>

function patchEstopHttpPost(root: Record<string, unknown>, queueId: string): void {
  const body = JSON.stringify({
    text: 'Dome Closed',
    queueId,
    PomfretAstro: { QueueId: queueId, SessionType: 'estop' },
  })

  function walk(node: unknown): void {
    if (!node || typeof node !== 'object') return
    if (Array.isArray(node)) {
      for (const item of node) walk(item)
      return
    }
    const rec = node as Record<string, unknown>
    const type = rec.$type
    if (typeof type === 'string' && type.includes('HTTP.HttpClient')) {
      rec.HttpPostBody = body
      rec.HttpPostContentType = 'application/json'
    }
    for (const value of Object.values(rec)) walk(value)
  }

  walk(root)
}

export function isWeatherSafetyEmergencyStopActor(input: {
  requestedByUserId?: string | null
  requestedByUsername?: string | null
}): boolean {
  const userId = typeof input.requestedByUserId === 'string' ? input.requestedByUserId.trim() : ''
  const username =
    typeof input.requestedByUsername === 'string' ? input.requestedByUsername.trim() : ''
  return userId === 'weather-safety-auto' || username === 'weather-safety-auto'
}

export function estopDiscordMessageForState(input: {
  requestedByUserId?: string | null
  requestedByUsername?: string | null
}): string {
  return isWeatherSafetyEmergencyStopActor(input)
    ? ESTOP_DISCORD_WEATHER_SAFETY
    : ESTOP_DISCORD_MANUAL
}

export function estopSequenceJson(
  queueId: string,
  options?: {
    requestedByUserId?: string | null
    requestedByUsername?: string | null
    discordText?: string
  },
): string {
  const siteId = currentObservatorySiteId()
  const root = structuredClone(ESTOP_TEMPLATE) as Record<string, unknown>
  root.Name = 'Emergency Stop'
  root.PomfretAstro = {
    QueueId: queueId,
    SiteId: siteId,
    SessionType: 'estop',
    OutputMode: 'none',
    SessionProgressHint:
      'POST to /api/imaging/session-progress?site=<SiteId> with queueId when dome is closed to clear ESTOP.',
  }
  patchEstopHttpPost(root, queueId)
  applySessionProgressSiteInHttpUris(root, siteId)
  patchNinaDiscordMessageText(
    root,
    options?.discordText ?? estopDiscordMessageForState(options ?? {}),
  )
  return JSON.stringify(root, null, 2)
}
