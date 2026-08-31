import assert from 'node:assert/strict'
import test from 'node:test'
import '@/lib/observatory-site-als'
import { withObservatorySiteAsync } from '@/lib/observatory-site-scope'
import { buildNinaSequenceJson } from '@/lib/imaging/nina/sequence-json'
import { estopSequenceJson } from '@/lib/imaging/session/estop-sequence'

test('buildNinaSequenceJson pins session-progress HttpUri to request site', async () => {
  await withObservatorySiteAsync('cygnus', async () => {
    const json = buildNinaSequenceJson({
      raHoursDecimal: 20.9,
      decDegDecimal: 44.3,
      filterName: 'Ha',
      exposureSeconds: 180,
      exposureCount: 2,
      pomfretQueueId: 'q-cygnus-1',
      templateKind: 'dso',
      targetName: 'NGC7000',
    })
    const root = JSON.parse(json) as {
      PomfretAstro?: { SiteId?: string; QueueId?: string }
    }
    assert.equal(root.PomfretAstro?.SiteId, 'cygnus')
    assert.equal(root.PomfretAstro?.QueueId, 'q-cygnus-1')
    assert.match(json, /session-progress\?site=cygnus/)
    assert.doesNotMatch(json, /session-progress"(?!\?)/)
  })
})

test('estopSequenceJson pins session-progress HttpUri to request site', async () => {
  await withObservatorySiteAsync('cygnus', async () => {
    const json = estopSequenceJson('estop-cygnus-1', { discordText: 'ESTOPPED' })
    assert.match(json, /session-progress\?site=cygnus/)
    assert.match(json, /"SiteId": "cygnus"/)
  })
})
