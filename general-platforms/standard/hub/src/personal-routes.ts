import type { Express, Request, Response } from 'express'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { v4 as uuidv4 } from 'uuid'
import {
  getObservatoryState,
  insertSession,
  listSessions,
  sessionToPublicJson,
  setObservatoryPatch,
  touchAgentPulse,
  type SessionOutputMode,
} from './db.js'
import { personalTenantSecret } from './tenant-auth.js'

const fraosRelease = JSON.parse(
  readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), '../../shared/fraos-release.json'),
    'utf8'
  )
) as {
  channel?: string
  station?: { latestVersion?: string; downloadUrlWindows?: string | null }
  control?: {
    latestVersion?: string
    downloadUrlWindows?: string | null
    downloadUrlMac?: string | null
  }
}

function bearerAuthorized(req: Request, tenantId: string): boolean {
  const expected = personalTenantSecret(tenantId)
  if (!expected) return false
  const header = req.header('authorization') ?? ''
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : ''
  return token === expected
}

function requireTenant(req: Request, res: Response, tenantId: string): boolean {
  if (!personalTenantSecret(tenantId)) {
    res.status(404).json({ ok: false, error: 'Unknown tenant' })
    return false
  }
  if (!bearerAuthorized(req, tenantId)) {
    res.status(401).json({ ok: false, error: 'Unauthorized' })
    return false
  }
  return true
}

export function mountPersonalRoutes(app: Express): void {
  app.get('/api/personal/:tenantId/health', (req, res) => {
    res.json({ ok: true, edition: 'personal', tenantId: req.params.tenantId, hub: 'cloud' })
  })

  app.get('/api/personal/:tenantId/station/version', (req, res) => {
    res.json({
      ok: true,
      tenantId: req.params.tenantId,
      latestVersion: fraosRelease.station?.latestVersion ?? '0.1.0',
      channel: fraosRelease.channel ?? 'stable',
      downloadUrl: fraosRelease.station?.downloadUrlWindows ?? null,
      downloadUrlWindows: fraosRelease.station?.downloadUrlWindows ?? null,
    })
  })

  app.get('/api/personal/:tenantId/control/version', (req, res) => {
    res.json({
      ok: true,
      tenantId: req.params.tenantId,
      latestVersion: fraosRelease.control?.latestVersion ?? '0.1.0',
      channel: fraosRelease.channel ?? 'stable',
      downloadUrlWindows: fraosRelease.control?.downloadUrlWindows ?? null,
      downloadUrlMac: fraosRelease.control?.downloadUrlMac ?? null,
      downloadUrl:
        fraosRelease.control?.downloadUrlMac ??
        fraosRelease.control?.downloadUrlWindows ??
        null,
    })
  })

  app.get('/api/personal/:tenantId/imaging/observatory-status', (req, res) => {
    const { tenantId } = req.params
    if (!requireTenant(req, res, tenantId)) return
    const { mode, status } = getObservatoryState()
    res.json({ ok: true, mode, status })
  })

  app.patch('/api/personal/:tenantId/imaging/observatory-status', (req, res) => {
    const { tenantId } = req.params
    if (!requireTenant(req, res, tenantId)) return
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

  app.get('/api/personal/:tenantId/imaging/current-sessions', (req, res) => {
    const { tenantId } = req.params
    if (!requireTenant(req, res, tenantId)) return
    const sessions = listSessions().map(sessionToPublicJson)
    res.json({ ok: true, sessions })
  })

  app.post('/api/personal/:tenantId/imaging/queue', (req, res) => {
    const { tenantId } = req.params
    if (!requireTenant(req, res, tenantId)) return
    const body = req.body as Record<string, unknown>
    const target = typeof body.target === 'string' ? body.target.trim() : ''
    if (!target) {
      res.status(400).json({ ok: false, error: 'target is required' })
      return
    }
    const outputModeRaw = typeof body.outputMode === 'string' ? body.outputMode : 'none'
    const outputMode: SessionOutputMode = outputModeRaw === 'raw_zip' ? 'raw_zip' : 'none'
    const session = insertSession({
      id: uuidv4(),
      target,
      outputMode,
      raHours: typeof body.raHours === 'number' ? body.raHours : null,
      decDeg: typeof body.decDeg === 'number' ? body.decDeg : null,
      filter: typeof body.filter === 'string' ? body.filter : null,
      exposureSeconds: typeof body.exposureSeconds === 'number' ? body.exposureSeconds : null,
      count: typeof body.count === 'number' ? body.count : null,
    })
    res.status(201).json({ ok: true, request: sessionToPublicJson(session) })
  })

  app.post('/api/personal/:tenantId/imaging/agent-pulse', (req, res) => {
    const { tenantId } = req.params
    if (!requireTenant(req, res, tenantId)) return
    const ninaRunning = Boolean((req.body as { ninaRunning?: unknown })?.ninaRunning)
    touchAgentPulse(ninaRunning)
    res.json({ ok: true })
  })

  app.get('/api/personal/:tenantId/imaging/nina-sequence', (req, res) => {
    const { tenantId } = req.params
    if (!requireTenant(req, res, tenantId)) return
    touchAgentPulse(false)
    res.status(404).json({
      ok: false,
      error: 'No sequence available yet (Personal Hub scheduling pending).',
    })
  })
}
