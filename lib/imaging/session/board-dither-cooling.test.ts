import assert from 'node:assert/strict'
import test from 'node:test'
import {
  boardUpsertInProgress,
  getBoardEntry,
  listBoardEntries,
} from '@/lib/imaging-session-board'
import { withObservatorySiteAsync } from '@/lib/observatory-site-scope'

test('boardUpsertInProgress preserves dither and camera cooling for single-night sessions', async () => {
  await withObservatorySiteAsync('cygnus', async () => {
    const id = `board-dither-cooling-${Date.now()}`
    await boardUpsertInProgress({
      id,
      target: 'Test target',
      createdAt: new Date().toISOString(),
      raHours: 1,
      decDeg: 45,
      outputMode: 'raw_zip',
      filterPlans: [{ filterName: 'L', exposureSeconds: 180, count: 10 }],
      estimatedDurationSeconds: 3600,
      ditherEnabled: true,
      cameraCoolingTempC: -10,
      sequenceTemplate: 'dso',
    })
    const entry = await getBoardEntry(id)
    assert.ok(entry)
    assert.equal(entry!.ditherEnabled, true)
    assert.equal(entry!.cameraCoolingTempC, -10)
    const listed = await listBoardEntries()
    const found = listed.find((e) => e.id === id)
    assert.ok(found)
    assert.equal(found!.ditherEnabled, true)
    assert.equal(found!.cameraCoolingTempC, -10)
  })
})
