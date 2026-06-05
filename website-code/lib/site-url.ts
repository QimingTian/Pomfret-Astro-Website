function env(name: string): string {
  return (process.env[name] ?? '').trim()
}

const PRODUCTION_CANONICAL_ORIGIN = 'https://www.pomfretastro.org'

/**
 * Public site origin for auth emails and post-verify redirects.
 * Production must use SITE_URL / NEXT_PUBLIC_SITE_URL — never a deployment preview host.
 */
export function publicSiteOrigin(): string {
  const configured = env('NEXT_PUBLIC_SITE_URL') || env('SITE_URL')
  if (configured) return configured.replace(/\/+$/, '')

  if (process.env.VERCEL_ENV === 'production' || process.env.NODE_ENV === 'production') {
    console.error(
      '[site-url] SITE_URL or NEXT_PUBLIC_SITE_URL is missing in production; using canonical origin.'
    )
    return PRODUCTION_CANONICAL_ORIGIN
  }

  const vercelUrl = env('VERCEL_URL')
  if (vercelUrl) return `https://${vercelUrl}`

  return 'http://localhost:3000'
}

export function publicSiteUrl(path: string): URL {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`
  return new URL(normalizedPath, `${publicSiteOrigin()}/`)
}
