import assert from 'node:assert/strict'
import test from 'node:test'

import { computeSiteImagingActive, queueStatusIsImagingActive } from './site-imaging-active'

test('queueStatusIsImagingActive matches in-progress rows', () => {
  assert.equal(queueStatusIsImagingActive('in_progress'), true)
  assert.equal(queueStatusIsImagingActive('claimed'), true)
  assert.equal(queueStatusIsImagingActive('scheduled'), false)
  assert.equal(queueStatusIsImagingActive('completed'), false)
})

test('computeSiteImagingActive is true for NINA, queue, board, or project nights', () => {
  assert.equal(
    computeSiteImagingActive({ queueRows: [], boardRows: [], projects: [], ninaRunning: false }),
    false
  )
  assert.equal(
    computeSiteImagingActive({
      queueRows: [{ status: 'scheduled' }],
      ninaRunning: false,
    }),
    false
  )
  assert.equal(
    computeSiteImagingActive({
      queueRows: [{ status: 'in_progress' }],
      ninaRunning: false,
    }),
    true
  )
  assert.equal(
    computeSiteImagingActive({
      queueRows: [],
      boardRows: [{ status: 'in_progress' }],
      ninaRunning: false,
    }),
    true
  )
  assert.equal(
    computeSiteImagingActive({
      queueRows: [],
      projects: [{ status: 'scheduled', nights: [{ status: 'in_progress' }] }],
      ninaRunning: false,
    }),
    true
  )
  assert.equal(
    computeSiteImagingActive({
      queueRows: [],
      projects: [{ status: 'in_progress', nights: [{ status: 'scheduled' }] }],
      ninaRunning: false,
    }),
    false
  )
  assert.equal(
    computeSiteImagingActive({
      queueRows: [],
      projects: [{ status: 'in_progress', nights: [] }],
      ninaRunning: false,
    }),
    false
  )
  assert.equal(
    computeSiteImagingActive({ queueRows: [], ninaRunning: true }),
    true
  )
})
