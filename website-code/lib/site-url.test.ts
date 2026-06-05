import assert from 'node:assert/strict'
import test from 'node:test'
import { publicSiteOrigin, publicSiteUrl } from './site-url'

test('publicSiteOrigin prefers SITE_URL', () => {
  const prevSite = process.env.SITE_URL
  const prevPublic = process.env.NEXT_PUBLIC_SITE_URL
  const prevVercel = process.env.VERCEL_URL
  process.env.SITE_URL = 'https://www.pomfretastro.org'
  delete process.env.NEXT_PUBLIC_SITE_URL
  process.env.VERCEL_URL = 'pomfret-astro-website-cezgr3bkq-james-tians-projects.vercel.app'
  try {
    assert.equal(publicSiteOrigin(), 'https://www.pomfretastro.org')
    assert.equal(publicSiteUrl('/login?verified=1').href, 'https://www.pomfretastro.org/login?verified=1')
  } finally {
    if (prevSite === undefined) delete process.env.SITE_URL
    else process.env.SITE_URL = prevSite
    if (prevPublic === undefined) delete process.env.NEXT_PUBLIC_SITE_URL
    else process.env.NEXT_PUBLIC_SITE_URL = prevPublic
    if (prevVercel === undefined) delete process.env.VERCEL_URL
    else process.env.VERCEL_URL = prevVercel
  }
})
