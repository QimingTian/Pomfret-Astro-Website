import type { MetadataRoute } from 'next'
import { ABOUT_PATH, siteOrigin } from '@/lib/seo'

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: `${siteOrigin()}${ABOUT_PATH}`,
      lastModified: new Date('2026-09-01'),
      changeFrequency: 'weekly',
      priority: 1,
    },
  ]
}
