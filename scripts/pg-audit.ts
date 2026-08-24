import { createHash } from 'crypto'

import { neon } from '@neondatabase/serverless'

import { databaseUrl, isDatabaseConfigured } from '@/lib/db'
import { kvEnabled, kvGetJson } from '@/lib/kv-rest'
import type { MemberUser } from '@/lib/member-store'

function fp(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value ?? null)).digest('hex').slice(0, 16)
}

function sortedIds(ids: string[]): string[] {
  return Array.from(new Set(ids.filter(Boolean))).sort()
}

function diffIds(label: string, kvIds: string[], pgIds: string[]): string[] {
  const kv = new Set(kvIds)
  const pg = new Set(pgIds)
  const missingInPg = kvIds.filter((id) => !pg.has(id))
  const extraInPg = pgIds.filter((id) => !kv.has(id))
  if (missingInPg.length || extraInPg.length) {
    return [
      `${label}: kv=${kvIds.length} pg=${pgIds.length} missingInPg=${missingInPg.length} extraInPg=${extraInPg.length}`,
    ]
  }
  return [`${label}: ok count=${kvIds.length}`]
}

async function main() {
  const issues: string[] = []
  const ok: string[] = []
  if (!isDatabaseConfigured()) {
    console.error('DATABASE_URL missing')
    process.exit(1)
  }
  if (!kvEnabled()) {
    console.error('KV missing')
    process.exit(1)
  }
  const sql = neon(databaseUrl())

  const members = (await kvGetJson<{ users?: MemberUser[] }>('member-users'))?.users ?? []
  const pgUsers = (await sql.query('SELECT id, email, username, role, password_hash, email_verified_at, created_at FROM users')) as Array<{
    id: string
    email: string
    username: string
    role: string
    password_hash: string
    email_verified_at: string | null
    created_at: string
  }>
  const pgMemberships = (await sql.query(
    "SELECT user_id, imaging_approved_at, imaging_rejected_at FROM memberships WHERE site_id = 'pomfret'"
  )) as Array<{
    user_id: string
    imaging_approved_at: string | null
    imaging_rejected_at: string | null
  }>
  issues.push(...diffIds('users', sortedIds(members.map((u) => u.id)), sortedIds(pgUsers.map((u) => u.id))))
  const memById = new Map(members.map((u) => [u.id, u]))
  const pgById = new Map(pgUsers.map((u) => [u.id, u]))
  const mship = new Map(pgMemberships.map((m) => [m.user_id, m]))
  let memberFieldMismatches = 0
  for (const id of Array.from(memById.keys())) {
    const kv = memById.get(id)!
    const pg = pgById.get(id)
    if (!pg) continue
    if (pg.email !== kv.email || pg.username !== kv.username || pg.role !== kv.role) memberFieldMismatches += 1
    if (pg.password_hash !== kv.passwordHash) memberFieldMismatches += 1
    const ms = mship.get(id)
    const kvAppr = kv.imagingApprovedAt ? 1 : 0
    const pgAppr = ms?.imaging_approved_at ? 1 : 0
    const kvRej = kv.imagingRejectedAt ? 1 : 0
    const pgRej = ms?.imaging_rejected_at ? 1 : 0
    if (kvAppr !== pgAppr || kvRej !== pgRej) memberFieldMismatches += 1
  }
  if (memberFieldMismatches) issues.push(`users fields mismatches=${memberFieldMismatches}`)
  else ok.push('users fields+memberships match')

  const queue = (await kvGetJson<{ requests?: Array<{ id: string; ninaSequenceJson?: string }> }>('imaging-queue-requests'))?.requests ?? []
  const pgQueue = (await sql.query('SELECT id FROM imaging_requests')) as Array<{ id: string }>
  const pgPayloads = (await sql.query(
    'SELECT id, (nina_sequence_json IS NOT NULL AND length(nina_sequence_json) > 0) AS has_json FROM imaging_request_payloads'
  )) as Array<{ id: string; has_json: boolean }>
  issues.push(...diffIds('queue', sortedIds(queue.map((r) => r.id)), sortedIds(pgQueue.map((r) => r.id))))
  const payloadById = new Map(pgPayloads.map((p) => [p.id, p.has_json]))
  let ninaMismatch = 0
  for (const r of queue) {
    const kvHas = Boolean(r.ninaSequenceJson && r.ninaSequenceJson.length > 0)
    if (kvHas !== Boolean(payloadById.get(r.id))) ninaMismatch += 1
  }
  if (ninaMismatch) issues.push(`queue nina json mismatches=${ninaMismatch}`)
  else ok.push(`queue nina json match (kvRows=${queue.length})`)

  const projects = (await kvGetJson<{ projects?: Array<{ id: string; nights?: unknown[] }> }>('imaging-projects'))?.projects ?? []
  const pgProjects = (await sql.query('SELECT id FROM imaging_projects')) as Array<{ id: string }>
  issues.push(...diffIds('projects', sortedIds(projects.map((p) => p.id)), sortedIds(pgProjects.map((p) => p.id))))
  const pgProjectDocs = (await sql.query('SELECT id, jsonb_array_length(COALESCE(document->\'nights\', \'[]\'::jsonb)) AS nights FROM imaging_projects')) as Array<{
    id: string
    nights: number
  }>
  const nightsById = new Map(pgProjectDocs.map((p) => [p.id, p.nights]))
  let nightMismatch = 0
  for (const p of projects) {
    if ((p.nights?.length ?? 0) !== (nightsById.get(p.id) ?? -1)) nightMismatch += 1
  }
  if (nightMismatch) issues.push(`project nights mismatches=${nightMismatch}`)
  else ok.push('project nights match')

  const board = (await kvGetJson<{ entries?: Array<{ id: string }> }>('imaging-session-board'))?.entries ?? []
  const pgBoard = (await sql.query('SELECT id FROM session_board')) as Array<{ id: string }>
  issues.push(...diffIds('board', sortedIds(board.map((e) => e.id)), sortedIds(pgBoard.map((e) => e.id))))

  const audit = (await kvGetJson<{ entries?: Array<{ id: string }> }>('imaging-audit-log'))?.entries ?? []
  const pgAudit = (await sql.query('SELECT id FROM audit_log')) as Array<{ id: string }>
  issues.push(...diffIds('audit', sortedIds(audit.map((e) => e.id)), sortedIds(pgAudit.map((e) => e.id))))

  const gallery = (await kvGetJson<{ submissions?: Array<{ id: string }> }>('gallery-submissions'))?.submissions ?? []
  const pgGallery = (await sql.query('SELECT id FROM gallery_submissions')) as Array<{ id: string }>
  issues.push(...diffIds('gallery', sortedIds(gallery.map((s) => s.id)), sortedIds(pgGallery.map((s) => s.id))))

  const windows = (await kvGetJson<{ windows?: Array<{ id: string }> }>('imaging-admin-closed-windows'))?.windows ?? []
  const pgWindows = (await sql.query('SELECT id FROM admin_closed_windows')) as Array<{ id: string }>
  issues.push(...diffIds('closed-windows', sortedIds(windows.map((w) => w.id)), sortedIds(pgWindows.map((w) => w.id))))

  const objects = (await kvGetJson<{ byQueueId?: Record<string, string> }>('imaging-r2-object-map'))?.byQueueId ?? {}
  const previews = (await kvGetJson<{ byQueueId?: Record<string, string> }>('imaging-r2-preview-map'))?.byQueueId ?? {}
  const pgR2 = (await sql.query('SELECT kind, queue_id, object_key FROM r2_object_map')) as Array<{
    kind: string
    queue_id: string
    object_key: string
  }>
  const kvR2 = [
    ...Object.entries(objects).map(([queueId, objectKey]) => `object:${queueId}:${objectKey}`),
    ...Object.entries(previews).map(([queueId, objectKey]) => `preview:${queueId}:${objectKey}`),
  ].sort()
  const pgR2Ids = pgR2.map((r) => `${r.kind}:${r.queue_id}:${r.object_key}`).sort()
  if (fp(kvR2) !== fp(pgR2Ids)) issues.push(`r2 map kv=${kvR2.length} pg=${pgR2Ids.length} fingerprint mismatch`)
  else ok.push(`r2 map ok count=${kvR2.length}`)

  const equipment = await kvGetJson<{ rigs?: unknown }>('pomfret:imaging-equipment')
  const kvRigs = Array.isArray(equipment?.rigs) ? equipment!.rigs : equipment
  const pgEq = (await sql.query('SELECT rigs FROM imaging_equipment WHERE site_id = \'pomfret\'')) as Array<{ rigs: unknown }>
  const slimRigs = (value: unknown) => {
    const list = Array.isArray(value) ? value : []
    return list.map((r) => {
      if (!r || typeof r !== 'object') return null
      const o = r as Record<string, unknown>
      return {
        name: o.label ?? o.name ?? null,
        telescope: o.telescope ?? o.scope ?? null,
        camera: o.camera ?? null,
        pixelSizeUm: o.pixelSizeUm ?? o.pixel_size_um ?? null,
        focalLengthMm: o.focalLengthMm ?? o.focal_length_mm ?? null,
        sensorWidthPx: o.sensorWidthPx ?? null,
        sensorHeightPx: o.sensorHeightPx ?? null,
      }
    })
  }
  if (fp(slimRigs(kvRigs)) !== fp(slimRigs(pgEq[0]?.rigs))) issues.push('equipment FOV fields mismatch')
  else ok.push(`equipment ok slots=${Array.isArray(kvRigs) ? kvRigs.length : 'n/a'}`)

  let savedKv = 0
  let savedPg = 0
  let histKv = 0
  let histPg = 0
  const pgSaved = (await sql.query('SELECT user_id, id FROM member_saved_sessions')) as Array<{ user_id: string; id: string }>
  const pgHist = (await sql.query('SELECT user_id, id FROM member_session_history')) as Array<{ user_id: string; id: string }>
  savedPg = pgSaved.length
  histPg = pgHist.length
  for (const u of members) {
    const saved = (await kvGetJson<{ sessions?: Array<{ id: string }> }>(`member-saved-sessions:${u.id}`))?.sessions ?? []
    const hist = (await kvGetJson<{ sessions?: Array<{ id: string }> }>(`member-session-history:${u.id}`))?.sessions ?? []
    savedKv += saved.length
    histKv += hist.length
  }
  if (savedKv !== savedPg) issues.push(`saved-sessions kv=${savedKv} pg=${savedPg}`)
  else ok.push(`saved-sessions ok count=${savedKv}`)
  if (histKv !== histPg) issues.push(`session-history kv=${histKv} pg=${histPg}`)
  else ok.push(`session-history ok count=${histKv}`)

  const emailIndex = (await kvGetJson<{ index?: Record<string, string> }>('member-email-index'))?.index ?? {}
  let indexMiss = 0
  for (const [email, id] of Object.entries(emailIndex)) {
    const row = pgById.get(id)
    if (!row || row.email !== email) indexMiss += 1
  }
  if (indexMiss) issues.push(`email-index mismatches=${indexMiss} kvKeys=${Object.keys(emailIndex).length}`)
  else ok.push(`email-index ok keys=${Object.keys(emailIndex).length}`)

  console.log('OK')
  for (const line of ok) console.log('  ' + line)
  console.log(issues.some((l) => l.includes('missingInPg') || l.includes('mismatch') || l.includes('extraInPg') || l.includes('kv=')) ? 'ISSUES' : 'ISSUES_NONE')
  for (const line of issues) console.log('  ' + line)
  const blocking = issues.filter((l) => /missingInPg|mismatch|extraInPg|fingerprint|saved-sessions|session-history/.test(l) && !l.includes(': ok '))
  process.exit(blocking.length ? 2 : 0)
}

void main()
