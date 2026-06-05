import assert from 'node:assert/strict'
import test from 'node:test'
import { NextRequest } from 'next/server'
import { GET as getNinaSequence } from '@/app/api/imaging/nina-sequence/route'
import { resetEmergencyStopForTests } from '@/lib/imaging/session/emergency-stop'
import {
  isNinaReportedRunningNow,
  reportObservatoryAgentPulse,
} from '@/lib/observatory-status-store'

function mockNinaSequenceRequest(): NextRequest {
  return new NextRequest(new URL('/api/imaging/nina-sequence', 'https://www.pomfretastro.org'))
}

test('GET nina-sequence returns 409 when NINA is running (no queue/project delivery)', async () => {
  await resetEmergencyStopForTests()
  await reportObservatoryAgentPulse({ ninaRunning: true })
  assert.equal(await isNinaReportedRunningNow(), true)

  const res = await getNinaSequence(mockNinaSequenceRequest())
  assert.equal(res.status, 409)
  const body = (await res.json()) as { error?: string }
  assert.match(body.error ?? '', /NINA is running/i)

  await reportObservatoryAgentPulse({ ninaRunning: false })
})

test('GET nina-sequence does not use NINA-running gate when agent reports NINA stopped', async () => {
  await reportObservatoryAgentPulse({ ninaRunning: false })
  assert.equal(await isNinaReportedRunningNow(), false)

  const res = await getNinaSequence(mockNinaSequenceRequest())
  const body = (await res.json()) as { error?: string }
  assert.doesNotMatch(body.error ?? '', /poll for Emergency STOP only/i)
})
