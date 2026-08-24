import assert from 'node:assert/strict'
import test from 'node:test'

import { isDatabaseConfigured } from './db'
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

test('schema exports the planned tables', () => {
  assert.ok(schema.users)
  assert.ok(schema.memberships)
  assert.ok(schema.imagingRequests)
  assert.ok(schema.imagingRequestPayloads)
  assert.ok(schema.imagingProjects)
  assert.ok(schema.sessionBoard)
  assert.ok(schema.auditLog)
})
