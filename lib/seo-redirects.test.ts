import assert from 'node:assert/strict'
import test from 'node:test'
import seoRedirects from './seo-redirects.js'

const { ABOUT_PATH, PERMANENT_REDIRECTS } = seoRedirects

test('permanent SEO redirects cover legacy public paths once each', () => {
  assert.equal(ABOUT_PATH, '/dashboard/about')
  const sources = PERMANENT_REDIRECTS.map((r) => r.source)
  assert.deepEqual(sources, ['/', '/dashboard', '/dashboard/admin', '/dashboard/camera', '/dashboard/atlas'])
  assert.equal(new Set(sources).size, sources.length)
  for (const row of PERMANENT_REDIRECTS) {
    assert.ok(row.destination.startsWith('/'), row.destination)
    assert.notEqual(row.source, row.destination)
  }
})
