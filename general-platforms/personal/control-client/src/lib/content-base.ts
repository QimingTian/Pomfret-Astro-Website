import { getHubBaseUrl } from './settings'

const DEFAULT_CONTENT_BASE = 'https://www.pomfretastro.org'

/** APIs for maps, moon images, object resolve, Stellarium — until Personal Station serves them locally. */
export function getContentBaseUrl(): string {
  const hub = getHubBaseUrl()
  if (hub.includes('pomfretastro.org')) return hub.replace(/\/+$/, '')
  return DEFAULT_CONTENT_BASE
}

export function contentApiPath(path: string): string {
  const base = getContentBaseUrl()
  return `${base}${path.startsWith('/') ? path : `/${path}`}`
}
