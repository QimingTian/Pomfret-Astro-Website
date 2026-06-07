import cors from 'cors'
import express from 'express'
import { v4 as uuidv4 } from 'uuid'
import { hubPort, imagingQueueSecret } from './config.js'
import {
  getObservatoryState,
  insertSession,
  listSessions,
  sessionToPublicJson,
  setObservatoryPatch,
  touchAgentPulse,
  type SessionOutputMode,
} from './db.js'

const app = express()
app.use(cors())
app.use(express.json({ limit: '2mb' }))

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, edition: 'personal', hub: 'embedded' })
})

app.get('/api/imaging/observatory-status', (_req, res) => {
  const { mode, status } = getObservatoryState()
  res.json({ ok: true, mode, status })
})

app.patch('/api/imaging/observatory-status', (req, res) => {
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

app.get('/api/imaging/current-sessions', (_req, res) => {
  const sessions = listSessions().map(sessionToPublicJson)
  res.json({ ok: true, sessions })
})

app.post('/api/imaging/queue', (req, res) => {
  const body = req.body as Record<string, unknown>
  const target = typeof body.target === 'string' ? body.target.trim() : ''
  if (!target) {
    res.status(400).json({ ok: false, error: 'target is required' })
    return
  }
  const outputModeRaw = typeof body.outputMode === 'string' ? body.outputMode : 'none'
  const outputMode: SessionOutputMode =
    outputModeRaw === 'raw_zip' || outputModeRaw === 'stacked_master' ? outputModeRaw : 'none'

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

function bearerAuthorized(req: express.Request): boolean {
  const secret = imagingQueueSecret()
  if (!secret) return true
  const header = req.header('authorization') ?? ''
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : ''
  return token === secret
}

app.post('/api/imaging/agent-pulse', (req, res) => {
  if (!bearerAuthorized(req)) {
    res.status(401).json({ ok: false, error: 'Unauthorized' })
    return
  }
  const ninaRunning = Boolean((req.body as { ninaRunning?: unknown })?.ninaRunning)
  touchAgentPulse(ninaRunning)
  res.json({ ok: true })
})

/** Station agent: no sequence builder yet — returns 404 until scheduling/NINA JSON is ported. */
app.get('/api/imaging/nina-sequence', (req, res) => {
  if (!bearerAuthorized(req)) {
    res.status(401).json({ ok: false, error: 'Unauthorized' })
    return
  }
  touchAgentPulse(false)
  res.status(404).json({ ok: false, error: 'No sequence available yet (Personal Hub scheduling pending).' })
})

app.listen(hubPort(), () => {
  console.log(`Pomfret Astro Personal Hub listening on http://127.0.0.1:${hubPort()}`)
})
