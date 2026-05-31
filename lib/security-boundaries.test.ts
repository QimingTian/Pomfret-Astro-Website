import assert from 'node:assert/strict'
import test from 'node:test'
import { NextRequest } from 'next/server'
import { GET as getNoaaGoes } from '@/app/api/noaa-goes/route'
import { GET as getNinaSequence } from '@/app/api/imaging/nina-sequence/route'
import { PATCH as patchQueueItem } from '@/app/api/imaging/queue/[id]/route'
import { cronAuthorized } from '@/lib/cron-auth'
import { isSameSiteMutation } from '@/lib/csrf-origin'
import { imagingQueueAuthorized } from '@/lib/imaging/queue/auth'
import { mountTelemetryAuthorized } from '@/lib/mount-telemetry-auth'

const QUEUE_ID = '00000000-0000-0000-0000-000000000001'
const TEST_SECRET = 'ci-test-imaging-queue-secret-32chars'

type EnvSnapshot = Record<string, string | undefined>

function setEnvVar(key: string, value: string | undefined): void {
  const env = process.env as Record<string, string | undefined>
  if (value === undefined) delete env[key]
  else env[key] = value
}

function snapshotEnv(keys: string[]): EnvSnapshot {
  const snap: EnvSnapshot = {}
  for (const key of keys) {
    snap[key] = process.env[key]
  }
  return snap
}

function restoreEnv(snap: EnvSnapshot): void {
  for (const [key, value] of Object.entries(snap)) {
    setEnvVar(key, value)
  }
}

function mockRequest(
  path: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string }
): NextRequest {
  return new NextRequest(new URL(path, 'https://www.pomfretastro.org'), init)
}

async function withEnv(
  keys: string[],
  apply: () => void,
  run: () => void | Promise<void>
): Promise<void> {
  const snap = snapshotEnv(keys)
  apply()
  try {
    await run()
  } finally {
    restoreEnv(snap)
  }
}

test('imagingQueueAuthorized fails closed in production when secret is unset', async () => {
  await withEnv(
    ['NODE_ENV', 'IMAGING_QUEUE_SECRET'],
    () => {
      setEnvVar('NODE_ENV', 'production')
      setEnvVar('IMAGING_QUEUE_SECRET', undefined)
    },
    () => {
      const req = mockRequest('/api/imaging/nina-sequence', {
        headers: { Authorization: 'Bearer anything' },
      })
      assert.equal(imagingQueueAuthorized(req), false)
    }
  )
})

test('imagingQueueAuthorized rejects missing or wrong bearer when secret is set', async () => {
  await withEnv(
    ['NODE_ENV', 'IMAGING_QUEUE_SECRET'],
    () => {
      setEnvVar('NODE_ENV', 'production')
      setEnvVar('IMAGING_QUEUE_SECRET', TEST_SECRET)
    },
    () => {
      assert.equal(imagingQueueAuthorized(mockRequest('/api/imaging/nina-sequence')), false)
      assert.equal(
        imagingQueueAuthorized(
          mockRequest('/api/imaging/nina-sequence', {
            headers: { Authorization: 'Bearer wrong-secret' },
          })
        ),
        false
      )
    }
  )
})

test('imagingQueueAuthorized accepts matching bearer', async () => {
  await withEnv(
    ['NODE_ENV', 'IMAGING_QUEUE_SECRET'],
    () => {
      setEnvVar('NODE_ENV', 'production')
      setEnvVar('IMAGING_QUEUE_SECRET', TEST_SECRET)
    },
    () => {
      assert.equal(
        imagingQueueAuthorized(
          mockRequest('/api/imaging/nina-sequence', {
            headers: { Authorization: `Bearer ${TEST_SECRET}` },
          })
        ),
        true
      )
    }
  )
})

test('cronAuthorized fails closed in production when CRON_SECRET is unset', async () => {
  await withEnv(
    ['NODE_ENV', 'CRON_SECRET'],
    () => {
      setEnvVar('NODE_ENV', 'production')
      setEnvVar('CRON_SECRET', undefined)
    },
    () => {
      assert.equal(
        cronAuthorized(
          mockRequest('/api/imaging/reconcile-queue-schedule', {
            headers: { Authorization: 'Bearer cron-token' },
          })
        ),
        false
      )
    }
  )
})

test('cronAuthorized accepts matching bearer', async () => {
  await withEnv(
    ['NODE_ENV', 'CRON_SECRET'],
    () => {
      setEnvVar('NODE_ENV', 'production')
      setEnvVar('CRON_SECRET', 'ci-test-cron-secret')
    },
    () => {
      assert.equal(
        cronAuthorized(
          mockRequest('/api/imaging/reconcile-queue-schedule', {
            headers: { Authorization: 'Bearer ci-test-cron-secret' },
          })
        ),
        true
      )
    }
  )
})

test('mountTelemetryAuthorized fails closed in production when telemetry secret is unset', async () => {
  await withEnv(
    ['NODE_ENV', 'NINA_MOUNT_TELEMETRY_SECRET', 'NINA_MOUNT_TELEMETRY_BASIC_PASSWORD'],
    () => {
      setEnvVar('NODE_ENV', 'production')
      setEnvVar('NINA_MOUNT_TELEMETRY_SECRET', undefined)
      setEnvVar('NINA_MOUNT_TELEMETRY_BASIC_PASSWORD', undefined)
    },
    () => {
      assert.equal(mountTelemetryAuthorized(mockRequest('/api/imaging/mount-pointing')), false)
    }
  )
})

test('GET /api/noaa-goes blocks SSRF and off-allowlist hosts', async () => {
  const metadata = { status: 400 }
  const aws = await getNoaaGoes(
    mockRequest('/api/noaa-goes?url=http://169.254.169.254/latest/meta-data/')
  )
  assert.equal(aws.status, metadata.status)

  const evil = await getNoaaGoes(mockRequest('/api/noaa-goes?url=https://evil.example/GOES19/x.gif'))
  assert.equal(evil.status, metadata.status)

  const wrongHost = await getNoaaGoes(
    mockRequest(
      `/api/noaa-goes?url=${encodeURIComponent('https://cdn.star.nesdis.noaa.gov.evil.com/GOES19/x.gif')}`
    )
  )
  assert.equal(wrongHost.status, metadata.status)
})

test('GET /api/imaging/nina-sequence returns 401 without bearer in production', async () => {
  await withEnv(
    ['NODE_ENV', 'IMAGING_QUEUE_SECRET'],
    () => {
      setEnvVar('NODE_ENV', 'production')
      setEnvVar('IMAGING_QUEUE_SECRET', TEST_SECRET)
    },
    async () => {
      const res = await getNinaSequence(mockRequest('/api/imaging/nina-sequence'))
      assert.equal(res.status, 401)
    }
  )
})

test('PATCH /api/imaging/queue/[id] returns 401 without bearer in production', async () => {
  await withEnv(
    ['NODE_ENV', 'IMAGING_QUEUE_SECRET'],
    () => {
      setEnvVar('NODE_ENV', 'production')
      setEnvVar('IMAGING_QUEUE_SECRET', TEST_SECRET)
    },
    async () => {
      const res = await patchQueueItem(
        mockRequest(`/api/imaging/queue/${QUEUE_ID}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'completed' }),
        }),
        { params: { id: QUEUE_ID } }
      )
      assert.equal(res.status, 401)
    }
  )
})

test('isSameSiteMutation rejects cross-site Origin on member mutations', () => {
  assert.equal(
    isSameSiteMutation(
      mockRequest('/api/admin/members', {
        method: 'PATCH',
        headers: { Origin: 'https://evil.example' },
      })
    ),
    false
  )
})

test('isSameSiteMutation allows first-party Origin', () => {
  assert.equal(
    isSameSiteMutation(
      mockRequest('/api/admin/members', {
        method: 'PATCH',
        headers: { Origin: 'https://www.pomfretastro.org' },
      })
    ),
    true
  )
})

test('isSameSiteMutation allows requests without Origin (observatory clients)', () => {
  assert.equal(isSameSiteMutation(mockRequest('/api/imaging/session-files', { method: 'POST' })), true)
})
