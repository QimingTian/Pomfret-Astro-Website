import type { Express, Request, Response, IRouter } from 'express'
import { v4 as uuidv4 } from 'uuid'
import {
  deleteSessionById,
  getObservatoryState,
  listSessions,
  setObservatoryPatch,
  touchAgentPulse,
} from '../db.js'
import { appendAuditLog, listAuditLog } from '../personal-audit-log.js'
import {
  armEmergencyStop,
  estopSequenceJson,
  getEmergencyStopPublicState,
  getEmergencyStopState,
  isEmergencyStopBlocking,
  isEmergencyStopStopping,
  isEstopQueueId,
  markEmergencyStopCompleted,
  markEmergencyStopDelivered,
} from '../personal-estop.js'
import { handleNinaSequenceGet, handleSessionProgressPost } from './delivery.js'
import { createQueueSession, sessionToPublic } from './queue-service.js'
import { reconcilePendingScheduleStatus } from './reconcile.js'
import { emitAgentWakePollSequence, subscribeLiveEvents } from './live-bus.js'
import {
  getMountPointingSample,
  liveMountChannel,
  parseMountPointingPayload,
  setMountPointingSample,
  subscribeMountEvents,
} from './mount-pointing.js'
import { imagingQueueSecret } from '../config.js'

function resolveTenantId(req: Request, tenantId?: string | ((req: Request) => string | undefined)): string | undefined {
  if (typeof tenantId === 'function') return tenantId(req)
  return tenantId
}

function bearerAuthorized(req: Request): boolean {
  const secret = imagingQueueSecret()
  if (!secret) return true
  const header = req.header('authorization') ?? ''
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : ''
  return token === secret
}

function parseQueueBody(body: Record<string, unknown>) {
  const target = typeof body.target === 'string' ? body.target.trim() : ''
  const filterPlansRaw = body.filterPlans
  const filterPlans = Array.isArray(filterPlansRaw)
    ? filterPlansRaw
        .map((p) => {
          if (!p || typeof p !== 'object') return null
          const rec = p as Record<string, unknown>
          return {
            filterName: String(rec.filterName ?? ''),
            exposureSeconds: Number(rec.exposureSeconds),
            count: Number(rec.count),
          }
        })
        .filter(
          (p): p is { filterName: string; exposureSeconds: number; count: number } =>
            p != null && Boolean(p.filterName) && Number.isFinite(p.exposureSeconds) && Number.isFinite(p.count)
        )
    : []

  return {
    target,
    requestName: typeof body.requestName === 'string' ? body.requestName : target,
    sessionType: body.sessionType === 'variable_star' ? ('variable_star' as const) : ('dso' as const),
    whenClosedBehavior: typeof body.whenClosedBehavior === 'string' ? body.whenClosedBehavior : undefined,
    outputMode: typeof body.outputMode === 'string' ? body.outputMode : 'none',
    outputModeRequested:
      typeof body.outputModeRequested === 'string' ? body.outputModeRequested : undefined,
    cameraCoolingTempC: typeof body.cameraCoolingTempC === 'number' ? body.cameraCoolingTempC : undefined,
    projectMode: body.projectMode === true,
    raHours: typeof body.raHours === 'number' ? body.raHours : null,
    decDeg: typeof body.decDeg === 'number' ? body.decDeg : null,
    filter: typeof body.filter === 'string' ? body.filter : null,
    exposureSeconds: typeof body.exposureSeconds === 'number' ? body.exposureSeconds : null,
    count: typeof body.count === 'number' ? body.count : null,
    filterPlans,
    estimatedDurationSeconds:
      typeof body.estimatedDurationSeconds === 'number' ? body.estimatedDurationSeconds : null,
    variableStarBlockHours:
      typeof body.variableStarBlockHours === 'number' ? body.variableStarBlockHours : null,
    catalogQuery: typeof body.catalogQuery === 'string' ? body.catalogQuery : null,
    observatoryLat: typeof body.observatoryLat === 'number' ? body.observatoryLat : null,
    observatoryLon: typeof body.observatoryLon === 'number' ? body.observatoryLon : null,
    observatoryElevationM: typeof body.observatoryElevationM === 'number' ? body.observatoryElevationM : null,
  }
}

export function mountImagingRoutes(
  app: IRouter,
  options?: {
    tenantId?: string | ((req: Request) => string | undefined)
    requireAuth?: boolean
  }
): void {
  const requireAuth = options?.requireAuth !== false

  const auth = (req: Request, res: Response): boolean => {
    if (!requireAuth) return true
    if (!bearerAuthorized(req)) {
      res.status(401).json({ ok: false, error: 'Unauthorized' })
      return false
    }
    return true
  }

  app.get('/imaging/observatory-status', (_req, res) => {
    const { mode, status } = getObservatoryState()
    res.json({ ok: true, mode, status })
  })

  app.patch('/imaging/observatory-status', (req, res) => {
    const body = req.body as { mode?: string; status?: string }
    if (body.mode !== 'manual' && body.mode !== 'auto' && body.mode != null) {
      res.status(400).json({ ok: false, error: 'Invalid mode' })
      return
    }
    setObservatoryPatch({
      mode: body.mode as 'manual' | 'auto' | undefined,
      status: body.status as Parameters<typeof setObservatoryPatch>[0]['status'],
    })
    const next = getObservatoryState()
    res.json({ ok: true, mode: next.mode, status: next.status })
  })

  app.get('/imaging/current-sessions', async (_req, res) => {
    await reconcilePendingScheduleStatus()
    const sessions = listSessions().map(sessionToPublic)
    res.json({ ok: true, sessions })
  })

  app.post('/imaging/queue', async (req, res) => {
    const body = parseQueueBody(req.body as Record<string, unknown>)
    if (!body.target) {
      res.status(400).json({ ok: false, error: 'target is required' })
      return
    }
    const session = await createQueueSession(body, uuidv4(), resolveTenantId(req, options?.tenantId))
    res.status(201).json({ ok: true, request: sessionToPublic(session) })
  })

  app.delete('/imaging/sessions/:sessionId', (req, res) => {
    const id = String(req.params.sessionId ?? '').trim()
    if (!id) {
      res.status(400).json({ ok: false, error: 'sessionId is required' })
      return
    }
    if (!deleteSessionById(id)) {
      res.status(404).json({ ok: false, error: 'Session not found' })
      return
    }
    appendAuditLog({ kind: 'session.deleted', message: `Session deleted: ${id}`, detail: { id } })
    emitAgentWakePollSequence()
    res.json({ ok: true })
  })

  app.post('/imaging/agent-pulse', (req, res) => {
    if (!auth(req, res)) return
    const ninaRunning = Boolean((req.body as { ninaRunning?: unknown })?.ninaRunning)
    touchAgentPulse(ninaRunning)
    res.json({ ok: true })
  })

  app.get('/imaging/reconcile-queue-schedule', async (req, res) => {
    if (!auth(req, res)) return
    await reconcilePendingScheduleStatus()
    res.json({ ok: true })
  })

  app.get('/imaging/nina-sequence', async (req, res) => {
    if (!auth(req, res)) return
    const result = await handleNinaSequenceGet(resolveTenantId(req, options?.tenantId))
    if (result.kind === 'json') {
      res.setHeader('Content-Type', 'application/json; charset=utf-8')
      res.setHeader('Cache-Control', 'no-store')
      res.status(result.status).send(result.body)
      return
    }
    if (result.kind === 'empty') {
      res.status(result.status).end()
      return
    }
    res.status(result.status).json({ error: result.error })
  })

  app.get('/imaging/agent-events', (req, res) => {
    if (!auth(req, res)) return
    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')
    if (typeof (res as Response & { flushHeaders?: () => void }).flushHeaders === 'function') {
      ;(res as Response & { flushHeaders: () => void }).flushHeaders()
    }

    const controller = new AbortController()
    const send = (event: string, data: unknown) => {
      res.write(`event: ${event}\n`)
      res.write(`data: ${JSON.stringify(data)}\n\n`)
    }

    send('connected', { ok: true, at: new Date().toISOString() })
    const unsubWake = subscribeLiveEvents('agent:wake', (payload) => send('agent:wake', payload), controller.signal)
    const unsubSessions = subscribeLiveEvents(
      'site:sessions',
      (payload) => send('site:sessions', payload),
      controller.signal
    )

    req.on('close', () => {
      controller.abort()
      unsubWake()
      unsubSessions()
    })
  })

  app.get('/imaging/emergency-stop', (_req, res) => {
    res.json({ ok: true, ...getEmergencyStopPublicState() })
  })

  app.post('/imaging/emergency-stop', (_req, res) => {
    const publicState = getEmergencyStopPublicState()
    if (!publicState.agentConnected) {
      res.status(409).json({ ok: false, error: 'NINA agent is disconnected. ESTOP is unavailable.' })
      return
    }
    try {
      armEmergencyStop('control-client')
    } catch (ex) {
      const message = ex instanceof Error ? ex.message : 'Emergency STOP failed.'
      res.status(409).json({ ok: false, error: message })
      return
    }
    emitAgentWakePollSequence()
    res.json({ ok: true, ...getEmergencyStopPublicState() })
  })

  app.get('/imaging/emergency-stop/delivery', (req, res) => {
    if (!auth(req, res)) return
    const tenant = resolveTenantId(req, options?.tenantId) ?? 'local'
    if (isEmergencyStopStopping()) {
      const state = getEmergencyStopState()
      const queueId = state?.queueId
      if (queueId && !state?.deliveredAt && markEmergencyStopDelivered(queueId)) {
        res.setHeader('Content-Type', 'application/json; charset=utf-8')
        res.setHeader('Cache-Control', 'no-store')
        res.send(estopSequenceJson(tenant, queueId))
        return
      }
    }
    if (isEmergencyStopBlocking()) {
      res.status(409).json({ error: 'Emergency STOP active; no imaging sequences are available.' })
      return
    }
    res.status(204).end()
  })

  app.post('/imaging/session-progress', (req, res) => {
    const body = req.body as Record<string, unknown>
    const detail =
      body && typeof body === 'object' && !Array.isArray(body)
        ? body
        : { text: typeof body === 'string' ? body : '' }
    const borean = detail.BoreanAstro
    let queueId: string | null = null
    if (borean && typeof borean === 'object' && !Array.isArray(borean)) {
      const raw = (borean as Record<string, unknown>).QueueId
      if (typeof raw === 'string' && raw.trim()) queueId = raw.trim()
    }
    if (!queueId && typeof detail.queueId === 'string') queueId = detail.queueId.trim()
    const text =
      typeof detail.text === 'string'
        ? detail.text
        : typeof detail.message === 'string'
          ? detail.message
          : ''
    if (queueId && isEstopQueueId(queueId) && text.toLowerCase().includes('dome closed')) {
      markEmergencyStopCompleted(queueId)
    }
    const result = handleSessionProgressPost(detail)
    res.json(result)
  })

  app.get('/imaging/audit-log', (req, res) => {
    const raw = req.query.limit
    const limit = typeof raw === 'string' ? Number(raw) : 200
    const safe = Number.isFinite(limit) ? Math.min(400, Math.max(1, Math.floor(limit))) : 200
    res.json({ ok: true, entries: listAuditLog(safe) })
  })

  app.post('/imaging/mount-pointing', (req, res) => {
    if (!auth(req, res)) return
    const tenant = resolveTenantId(req, options?.tenantId) ?? 'local'
    const body = req.body as Record<string, unknown>
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      res.status(400).json({ ok: false, error: 'Expected JSON object' })
      return
    }
    const payload = parseMountPointingPayload(body)
    if (!payload) {
      res.status(400).json({ ok: false, error: 'Missing boolean "connected"' })
      return
    }
    const stored = setMountPointingSample(tenant, payload.stationId, payload)
    res.json({ ok: true, receivedAtUtc: stored.receivedAtUtc })
  })

  app.get('/imaging/mount-pointing', (req, res) => {
    if (!auth(req, res)) return
    const tenant = resolveTenantId(req, options?.tenantId) ?? 'local'
    const stationId =
      typeof req.query.stationId === 'string' ? req.query.stationId : undefined
    const sample = getMountPointingSample(tenant, stationId)
    res.json({ ok: true, sample, serverNowUtc: new Date().toISOString() })
  })

  app.get('/imaging/mount-pointing/stream', (req, res) => {
    if (!auth(req, res)) return
    const tenant = resolveTenantId(req, options?.tenantId) ?? 'local'
    const stationId =
      typeof req.query.stationId === 'string' ? req.query.stationId : undefined
    const channel = liveMountChannel(tenant, stationId)

    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
    res.setHeader('Cache-Control', 'no-cache, no-transform')
    res.setHeader('Connection', 'keep-alive')
    res.setHeader('Access-Control-Allow-Origin', '*')
    if (typeof (res as Response & { flushHeaders?: () => void }).flushHeaders === 'function') {
      ;(res as Response & { flushHeaders: () => void }).flushHeaders()
    }

    const controller = new AbortController()
    const send = (payload: unknown) => {
      res.write(`data: ${JSON.stringify(payload)}\n\n`)
    }

    const sample = getMountPointingSample(tenant, stationId)
    send({
      type: 'snapshot',
      sample,
      serverNowUtc: new Date().toISOString(),
    })

    const unsub = subscribeMountEvents(
      channel,
      (payload) => {
        if (!payload || typeof payload !== 'object') return
        const p = payload as { type?: string; sample?: unknown }
        if (p.type === 'sample' && p.sample) {
          send({
            type: 'sample',
            sample: p.sample,
            serverNowUtc: new Date().toISOString(),
          })
        }
      },
      controller.signal
    )

    const keepAlive = setInterval(() => {
      send({ type: 'ping' })
    }, 15000)

    req.on('close', () => {
      clearInterval(keepAlive)
      controller.abort()
      unsub()
    })
  })
}
