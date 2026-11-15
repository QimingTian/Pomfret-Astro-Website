/**
 * Legacy URL → canonical path. Single source for next.config edge 308s and
 * App Router permanentRedirect pages (client navigations skip next.config).
 *
 * @typedef {{ source: string, destination: string }} SeoRedirect
 */

/** @type {string} */
const ABOUT_PATH = '/dashboard/about'

/** @type {SeoRedirect[]} */
const PERMANENT_REDIRECTS = [
  { source: '/', destination: ABOUT_PATH },
  { source: '/dashboard', destination: ABOUT_PATH },
  { source: '/dashboard/admin', destination: '/dashboard/account' },
  { source: '/dashboard/camera', destination: '/dashboard/weather' },
  { source: '/dashboard/atlas', destination: '/dashboard/plan' },
]

module.exports = { ABOUT_PATH, PERMANENT_REDIRECTS }
