import type { MetadataRoute } from 'next'
import { PUBLIC_DATA_CATALOG, publicDataExploreSrc } from '@/lib/public-data-catalog'
import { ABOUT_PATH, siteOrigin } from '@/lib/seo'

export default function sitemap(): MetadataRoute.Sitemap {
  const origin = siteOrigin()
  const exploreEntries: MetadataRoute.Sitemap = PUBLIC_DATA_CATALOG.map((entry) => ({
    url: `${origin}/explore/${entry.slug}`,
    lastModified: new Date('2026-11-21'),
    changeFrequency: 'monthly',
    priority: entry.flagship ? 0.9 : 0.8,
    images: [`${origin}${publicDataExploreSrc(entry)}`],
  }))

  return [
    {
      url: `${origin}${ABOUT_PATH}`,
      lastModified: new Date('2026-09-01'),
      changeFrequency: 'weekly',
      priority: 1,
    },
    {
      url: `${origin}/explore`,
      lastModified: new Date('2026-11-21'),
      changeFrequency: 'weekly',
      priority: 0.95,
    },
    ...exploreEntries,
  ]
}
