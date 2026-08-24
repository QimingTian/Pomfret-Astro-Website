import assert from 'node:assert/strict'
import test from 'node:test'

import { isDatabaseConfigured, postgresReadsEnabled } from './db'
import * as schema from './db/schema'

test('Postgres is optional: missing DATABASE_URL does not configure db', () => {
  const prev = process.env.DATABASE_URL
  const prevPg = process.env.POSTGRES_URL
  delete process.env.DATABASE_URL
  delete process.env.POSTGRES_URL
  delete process.env.DATABASE_URL_UNPOOLED
  assert.equal(isDatabaseConfigured(), false)
  if (prev !== undefined) process.env.DATABASE_URL = prev
  if (prevPg !== undefined) process.env.POSTGRES_URL = prevPg
})

test('postgres reads stay off during npm test', () => {
  const prevUrl = process.env.DATABASE_URL
  const prevRead = process.env.POSTGRES_READ
  const prevLife = process.env.npm_lifecycle_event
  process.env.DATABASE_URL = 'postgres://example.invalid/db'
  delete process.env.POSTGRES_READ
  process.env.npm_lifecycle_event = 'test'
  assert.equal(postgresReadsEnabled(), false)
  if (prevUrl === undefined) delete process.env.DATABASE_URL
  else process.env.DATABASE_URL = prevUrl
  if (prevRead === undefined) delete process.env.POSTGRES_READ
  else process.env.POSTGRES_READ = prevRead
  if (prevLife === undefined) delete process.env.npm_lifecycle_event
  else process.env.npm_lifecycle_event = prevLife
})

test('schema exports the planned tables', () => {
  assert.ok(schema.users)
  assert.ok(schema.memberships)
  assert.ok(schema.imagingRequests)
  assert.ok(schema.imagingRequestPayloads)
  assert.ok(schema.imagingProjects)
  assert.ok(schema.sessionBoard)
  assert.ok(schema.auditLog)
})
