import assert from 'node:assert/strict'
import test from 'node:test'
import { NINA_AGENT_JOB_KIND, serializeNinaAgentJob, stableStringify } from '@/lib/imaging/nina/agent-job'

test('stableStringify sorts object keys', () => {
  assert.equal(stableStringify({ b: 1, a: 2 }), '{"a":2,"b":1}')
})

test('serializeNinaAgentJob wraps a run command without NINA $type graph', () => {
  const raw = serializeNinaAgentJob({
    command: 'run',
    queueId: 'q1',
    issuedAt: '2026-08-24T00:00:00.000Z',
    params: {
      raHoursDecimal: 20.0,
      decDegDecimal: 44.0,
      filterName: 'Ha',
      exposureSeconds: 120,
      exposureCount: 10,
      pomfretQueueId: 'q1',
      templateKind: 'dso',
    },
  })
  const parsed = JSON.parse(raw) as { PomfretAstroJob: { kind: string; command: string; params: { filterName: string } } }
  assert.equal(parsed.PomfretAstroJob.kind, NINA_AGENT_JOB_KIND)
  assert.equal(parsed.PomfretAstroJob.command, 'run')
  assert.equal(parsed.PomfretAstroJob.params.filterName, 'Ha')
  assert.equal(raw.includes('NINA.Sequencer'), false)
  assert.equal(raw.includes('$type'), false)
})

test('serializeNinaAgentJob wraps estop and end_night as named commands', () => {
  const estop = JSON.parse(
    serializeNinaAgentJob({
      command: 'estop',
      queueId: 'e1',
      issuedAt: '2026-08-24T00:00:00.000Z',
      estop: { weatherSafety: true, discordText: 'lock' },
    }),
  ) as { PomfretAstroJob: { command: string } }
  const end = JSON.parse(
    serializeNinaAgentJob({
      command: 'end_night',
      queueId: 'n1',
      issuedAt: '2026-08-24T00:00:00.000Z',
      endNight: { trigger: 'dawn', discordText: 'dawn' },
    }),
  ) as { PomfretAstroJob: { command: string } }
  assert.equal(estop.PomfretAstroJob.command, 'estop')
  assert.equal(end.PomfretAstroJob.command, 'end_night')
})
