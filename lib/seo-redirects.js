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
  // Retired image-SEO Explore routes → Our Data (static /explore/*.webp assets untouched).
  { source: '/data', destination: '/dashboard/gallery' },
  { source: '/explore', destination: '/dashboard/gallery' },
  { source: '/explore/w80', destination: '/dashboard/gallery' },
  { source: '/explore/ngc-7822', destination: '/dashboard/gallery' },
  { source: '/explore/m33', destination: '/dashboard/gallery' },
  { source: '/explore/m31', destination: '/dashboard/gallery' },
  { source: '/explore/ic1805', destination: '/dashboard/gallery' },
  { source: '/explore/markarians-chain', destination: '/dashboard/gallery' },
  { source: '/explore/m101', destination: '/dashboard/gallery' },
  { source: '/explore/sn-2026aaiv', destination: '/dashboard/gallery' },
  { source: '/explore/xz-dra', destination: '/dashboard/gallery' },
]

module.exports = { ABOUT_PATH, PERMANENT_REDIRECTS }
