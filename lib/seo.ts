import { publicSiteOrigin } from '@/lib/site-url'
import seoRedirects from '@/lib/seo-redirects'

// Shared with next.config.js — keep legacy 308 targets in one place.
const { ABOUT_PATH: ABOUT_PATH_FROM_REDIRECTS, PERMANENT_REDIRECTS } = seoRedirects as {
  ABOUT_PATH: string
  PERMANENT_REDIRECTS: Array<{ source: string; destination: string }>
}

export const SITE_NAME = 'Pomfret Astro Network'

export const DEFAULT_DESCRIPTION =
  'Pomfret Astro Network connects independent observatories worldwide with intelligent automation, multi-night session scheduling, and shared remote telescope access.'

/** Primary landing page for search engines. */
export const ABOUT_PATH = ABOUT_PATH_FROM_REDIRECTS

/** Destination for a legacy path from {@link ./seo-redirects.js}. */
export function permanentLegacyDestination(source: string): string {
  const hit = PERMANENT_REDIRECTS.find((row) => row.source === source)
  if (!hit) {
    throw new Error(`No permanent SEO redirect configured for ${source}`)
  }
  return hit.destination
}

export const SEO_KEYWORDS = [
  'remote observatory',
  'observatory automation',
  'telescope network',
  'remote telescope',
  'automated observatory',
  'iTelescope alternative',
  'observatory network',
  'astrophotography automation',
  'NINA automation',
  'multi-user observatory',
  'shared observatory',
  'remote imaging',
  'Pomfret Astro',
]

export const OG_IMAGE_PATH = '/about/ngc7000-complex-mosaic.webp'

export function siteOrigin(): string {
  return publicSiteOrigin()
}

export function absoluteUrl(path: string): string {
  const normalized = path.startsWith('/') ? path : `/${path}`
  return `${siteOrigin()}${normalized}`
}

export function openGraphImages() {
  const url = absoluteUrl(OG_IMAGE_PATH)
  return [
    {
      url,
      width: 1200,
      height: 630,
      alt: 'North America Nebula mosaic from the Pomfret Astro Network',
    },
  ]
}
