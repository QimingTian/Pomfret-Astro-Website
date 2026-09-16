import assert from 'node:assert/strict'
import test from 'node:test'
import { NextRequest } from 'next/server'
import { GET as getNinaSequence } from '@/app/api/imaging/nina-sequence/route'
import { createImagingProject, patchProject } from '@/lib/imaging-project-store'
import { createRequest, patchRequestScheduleInsight } from '@/lib/imaging-queue-store'
import { resetEmergencyStopForTests } from '@/lib/imaging/session/emergency-stop'
import { reportObservatoryAgentPulse } from '@/lib/observatory-status-store'
import { getTonightScheduleStrip } from '@/lib/schedule-strip'

function mockNinaSequenceRequest(): NextRequest {
  return new NextRequest(new URL('/api/imaging/nina-sequence', 'https://www.pomfretastro.org'))
}

/** In-progress project holding tonight's schedule with a sub-session that is not due yet. */
async function seedProjectWaitingForPlannedStart(nowMs: number): Promise<string> {
  const project = await createImagingProject({
    id: 'proj-passthrough',
    target: 'Passthrough Project',
    raHours: 20,
    decDeg: 40,
    outputMode: 'raw_zip',
    filterPlans: [{ filterName: 'L', exposureSeconds: 300, count: 24 }],
    estimatedDurationSeconds: 24 * 300,
  })
  await patchProject(project.id, {
    status: 'in_progress',
    onBoard: true,
    nights: [
      {
        id: `${project.id}::night-1`,
        nightKey: getTonightScheduleStrip(new Date(nowMs)).nightKey,
        nightIndex: 1,
        status: 'scheduled',
        plannedStartIso: new Date(nowMs + 3 * 3600_000).toISOString(),
        filterPlansTonight: [{ filterName: 'L', exposureSeconds: 300, count: 24 }],
        ninaSequenceJson: '{"mock":true}',
      },
    ],
  })
  return project.id
}

test('a project sub-session waiting for its planned start does not end the delivery request', async () => {
  await resetEmergencyStopForTests()
  await reportObservatoryAgentPulse({ ninaRunning: false })
  const nowMs = Date.now()
  await seedProjectWaitingForPlannedStart(nowMs)

  const created = await createRequest({
    raHours: 20,
    decDeg: 40,
    filter: 'L',
    exposureSeconds: 60,
    count: 5,
    userId: 'test-user-passthrough',
    email: 'passthrough@example.com',
    sessionPassword: 'test-pass',
    firstName: 'Pass',
    lastName: 'Through',
  })
  assert.ok(!('error' in created), JSON.stringify(created))
  await patchRequestScheduleInsight(created.id, {
    status: 'scheduled',
    plannedStartIso: new Date(nowMs - 60_000).toISOString(),
    reasons: ['Due now for this regression.'],
  })

  const res = await getNinaSequence(mockNinaSequenceRequest())
  const body = (await res.json()) as { error?: string }
  assert.doesNotMatch(
    body.error ?? '',
    /waits until planned start/i,
    'a not-yet-due project sub must pass through so other sessions are evaluated'
  )
})
