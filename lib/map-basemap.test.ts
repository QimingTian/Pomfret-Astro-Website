import assert from 'node:assert/strict'
import test from 'node:test'

import { resolveRadarBasemap } from '@/lib/map-basemap'

test('resolveRadarBasemap uses Esri when Carto key is missing', () => {
  const prev = process.env.NEXT_PUBLIC_CARTO_API_KEY
  delete process.env.NEXT_PUBLIC_CARTO_API_KEY
  try {
    const basemap = resolveRadarBasemap()
    assert.equal(basemap.kind, 'esri')
    assert.match(basemap.url, /arcgisonline\.com/)
  } finally {
    if (prev === undefined) delete process.env.NEXT_PUBLIC_CARTO_API_KEY
    else process.env.NEXT_PUBLIC_CARTO_API_KEY = prev
  }
})

test('resolveRadarBasemap uses Carto when key is set', () => {
  const prev = process.env.NEXT_PUBLIC_CARTO_API_KEY
  process.env.NEXT_PUBLIC_CARTO_API_KEY = 'test-key'
  try {
    const basemap = resolveRadarBasemap()
    assert.equal(basemap.kind, 'carto')
    assert.match(basemap.url, /cartocdn\.com/)
    assert.match(basemap.url, /key=test-key/)
  } finally {
    if (prev === undefined) delete process.env.NEXT_PUBLIC_CARTO_API_KEY
    else process.env.NEXT_PUBLIC_CARTO_API_KEY = prev
  }
})
