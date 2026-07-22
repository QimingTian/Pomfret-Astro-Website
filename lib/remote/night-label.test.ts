import assert from 'node:assert/strict'
import test from 'node:test'
import { nightDisplayLabel } from './night-label'

test('nightDisplayLabel prefers sessionLabel when set', () => {
  assert.equal(
    nightDisplayLabel({ nightIndex: 2, sessionLabel: '  Custom label  ' }),
    'Custom label'
  )
})

test('nightDisplayLabel falls back to projectSessionDisplayLabel', () => {
  assert.equal(
    nightDisplayLabel({ nightIndex: 1, mosaicPanelIndex: 2, mosaicSubIndex: 3 }),
    'Session 2-3'
  )
})
