import { publicSiteOrigin } from '@/lib/site-url'

export const SITE_NAME = 'Pomfret Astro Network'

export const DEFAULT_DESCRIPTION =
  'Pomfret Astro Network connects independent observatories worldwide with intelligent automation, multi-night session scheduling, and shared remote telescope access.'

/** Primary landing page for search engines. */
export const ABOUT_PATH = '/dashboard/about'

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
