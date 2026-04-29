import type { MetadataRoute } from 'next'

const BASE = 'https://www.pomfretastro.org'

export default function sitemap(): MetadataRoute.Sitemap {
  const routes = [
    '/',
    '/login',
    '/dashboard',
    '/dashboard/camera',
    '/dashboard/gallery',
    '/dashboard/weather',
    '/dashboard/remote',
    '/dashboard/admin',
  ]

  const now = new Date()
  return routes.map((route) => ({
    url: `${BASE}${route}`,
    lastModified: now,
    changeFrequency: route === '/' ? 'daily' : 'weekly',
    priority: route === '/' ? 1 : route === '/dashboard' ? 0.9 : 0.7,
  }))
}
