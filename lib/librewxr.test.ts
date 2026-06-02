import assert from 'node:assert/strict'
import test from 'node:test'
import { isAllowedLibrewxrTilePath, librewxrRadarTilePath } from '@/lib/librewxr'

test('isAllowedLibrewxrTilePath accepts v2 radar tiles', () => {
  assert.equal(
    isAllowedLibrewxrTilePath('/v2/radar/1780330800/256/7/64/96/7/1_1.png'),
    true
  )
})

test('isAllowedLibrewxrTilePath rejects traversal and foreign paths', () => {
  assert.equal(isAllowedLibrewxrTilePath('/v2/radar/../etc/passwd'), false)
  assert.equal(isAllowedLibrewxrTilePath('https://evil.example/x.png'), false)
})

test('librewxrRadarTilePath builds Rain Viewer style path', () => {
  assert.equal(
    librewxrRadarTilePath('/v2/radar/1780330800', 7, 64, 96),
    '/v2/radar/1780330800/256/7/64/96/7/1_1.png'
  )
})
