import Database from 'better-sqlite3'
import { dbPath, ensureDataDir } from './config.js'

export type SessionOutputMode = 'none' | 'raw_zip'

export type SessionStatus =
  | 'pending'
  | 'scheduled'
  | 'in_progress'
  | 'completed'
  | 'failed'
  | 'on_hold'

export type SessionRow = {
  id: string
  target: string
  status: SessionStatus
  outputMode: SessionOutputMode
  createdAt: string
  updatedAt: string
  plannedStartIso: string | null
  raHours: number | null
  decDeg: number | null
  filter: string | null
  exposureSeconds: number | null
  count: number | null
}

export type ObservatoryMode = 'manual' | 'auto'
export type ObservatoryStatus =
  | 'ready'
  | 'busy_in_use'
  | 'disconnected'
  | 'closed_weather_not_permitted'
  | 'closed_daytime'
  | 'closed_observatory_maintenance'

let db: Database.Database | null = null

export function getDb(): Database.Database {
  if (db) return db
  ensureDataDir()
  db = new Database(dbPath())
  db.pragma('journal_mode = WAL')
  migrate(db)
  return db
}

function migrate(database: Database.Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      target TEXT NOT NULL,
      status TEXT NOT NULL,
      output_mode TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      planned_start_iso TEXT,
      ra_hours REAL,
      dec_deg REAL,
      filter TEXT,
      exposure_seconds INTEGER,
      count INTEGER
    );

    CREATE TABLE IF NOT EXISTS observatory (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      mode TEXT NOT NULL DEFAULT 'auto',
      status TEXT NOT NULL DEFAULT 'disconnected',
      agent_last_seen_ms INTEGER NOT NULL DEFAULT 0,
      nina_running INTEGER NOT NULL DEFAULT 0
    );

    INSERT OR IGNORE INTO observatory (id, mode, status)
    VALUES (1, 'auto', 'disconnected');
  `)
}

function rowToSession(row: Record<string, unknown>): SessionRow {
  return {
    id: String(row.id),
    target: String(row.target),
    status: row.status as SessionStatus,
    outputMode: row.output_mode as SessionOutputMode,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    plannedStartIso: row.planned_start_iso != null ? String(row.planned_start_iso) : null,
    raHours: row.ra_hours != null ? Number(row.ra_hours) : null,
    decDeg: row.dec_deg != null ? Number(row.dec_deg) : null,
    filter: row.filter != null ? String(row.filter) : null,
    exposureSeconds: row.exposure_seconds != null ? Number(row.exposure_seconds) : null,
    count: row.count != null ? Number(row.count) : null,
  }
}

export function listSessions(): SessionRow[] {
  const rows = getDb()
    .prepare(
      `SELECT * FROM sessions ORDER BY datetime(created_at) ASC`
    )
    .all() as Record<string, unknown>[]
  return rows.map(rowToSession)
}

export function insertSession(input: {
  id: string
  target: string
  outputMode: SessionOutputMode
  raHours?: number | null
  decDeg?: number | null
  filter?: string | null
  exposureSeconds?: number | null
  count?: number | null
}): SessionRow {
  const now = new Date().toISOString()
  getDb()
    .prepare(
      `INSERT INTO sessions (
        id, target, status, output_mode, created_at, updated_at,
        planned_start_iso, ra_hours, dec_deg, filter, exposure_seconds, count
      ) VALUES (?, ?, 'pending', ?, ?, ?, NULL, ?, ?, ?, ?, ?)`
    )
    .run(
      input.id,
      input.target,
      input.outputMode,
      now,
      now,
      input.raHours ?? null,
      input.decDeg ?? null,
      input.filter ?? null,
      input.exposureSeconds ?? null,
      input.count ?? null
    )
  return listSessions().find((s) => s.id === input.id)!
}

export function getObservatoryState(): {
  mode: ObservatoryMode
  status: ObservatoryStatus
  agentLastSeenMs: number
  ninaRunning: boolean
} {
  const row = getDb()
    .prepare(`SELECT mode, status, agent_last_seen_ms, nina_running FROM observatory WHERE id = 1`)
    .get() as Record<string, unknown>
  const agentLastSeenMs = Number(row.agent_last_seen_ms) || 0
  const ninaRunning = Number(row.nina_running) === 1
  let status = row.status as ObservatoryStatus
  const staleMs = 90_000
  if (Date.now() - agentLastSeenMs > staleMs) {
    status = 'disconnected'
  } else if (ninaRunning) {
    status = 'busy_in_use'
  } else if (status === 'busy_in_use' || status === 'disconnected') {
    status = 'ready'
  }
  return {
    mode: row.mode as ObservatoryMode,
    status,
    agentLastSeenMs,
    ninaRunning,
  }
}

export function touchAgentPulse(ninaRunning: boolean): void {
  getDb()
    .prepare(
      `UPDATE observatory SET agent_last_seen_ms = ?, nina_running = ? WHERE id = 1`
    )
    .run(Date.now(), ninaRunning ? 1 : 0)
}

export function setObservatoryPatch(input: {
  mode?: ObservatoryMode
  status?: ObservatoryStatus
}): void {
  const current = getObservatoryState()
  getDb()
    .prepare(`UPDATE observatory SET mode = ?, status = ? WHERE id = 1`)
    .run(input.mode ?? current.mode, input.status ?? current.status)
}

export function sessionToPublicJson(s: SessionRow): Record<string, unknown> {
  return {
    id: s.id,
    target: s.target,
    status: s.status,
    outputMode: s.outputMode,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
    plannedStartIso: s.plannedStartIso,
    raHours: s.raHours,
    decDeg: s.decDeg,
    filter: s.filter,
    exposureSeconds: s.exposureSeconds,
    count: s.count,
    sessionType: 'dso',
    projectMode: false,
  }
}
