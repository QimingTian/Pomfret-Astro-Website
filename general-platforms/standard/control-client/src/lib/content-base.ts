import { getPersonalTenant } from './tenant'

const DEFAULT_CONTENT_BASE = 'https://www.boreanastro.com'

/** APIs for maps, moon images, object resolve, Stellarium — until Personal Station serves them locally. */
export function getContentBaseUrl(): string {
  const hub = getPersonalTenant().apiBaseUrl
  if (hub.includes('www.boreanastro.com')) return hub.replace(/\/+$/, '')
  return DEFAULT_CONTENT_BASE
}

export function contentApiPath(path: string): string {
  const base = getContentBaseUrl()
  return `${base}${path.startsWith('/') ? path : `/${path}`}`
}
