import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { JsonLd } from '@/components/seo/json-ld'
import {
  PUBLIC_DATA_CATALOG,
  publicDataAltText,
  publicDataBySlug,
  publicDataExploreSrc,
} from '@/lib/public-data-catalog'
import { SITE_NAME, absoluteUrl, siteOrigin } from '@/lib/seo'

type PageProps = {
  params: { slug: string }
}

export function generateStaticParams() {
  return PUBLIC_DATA_CATALOG.map((entry) => ({ slug: entry.slug }))
}

export function generateMetadata({ params }: PageProps): Metadata {
  const entry = publicDataBySlug(params.slug)
  if (!entry) return {}
  const title = `${entry.title}${entry.aliases[0] ? ` (${entry.aliases[0]})` : ''}`
  const description = entry.description
  const imageUrl = absoluteUrl(publicDataExploreSrc(entry))
  const canonical = `/explore/${entry.slug}`
  return {
    title,
    description,
    keywords: [entry.title, ...entry.aliases, 'Pomfret Astro', 'astrophotography', entry.filters],
    alternates: { canonical },
    openGraph: {
      title: `${title} | ${SITE_NAME}`,
      description,
      url: absoluteUrl(canonical),
      siteName: SITE_NAME,
      locale: 'en_US',
      type: 'website',
      images: [
        {
          url: imageUrl,
          alt: publicDataAltText(entry),
        },
      ],
    },
    twitter: {
      card: 'summary_large_image',
      title: `${title} | ${SITE_NAME}`,
      description,
      images: [imageUrl],
    },
    robots: { index: true, follow: true },
  }
}

export default function ExploreObjectPage({ params }: PageProps) {
  const entry = publicDataBySlug(params.slug)
  if (!entry) notFound()

  const imagePath = publicDataExploreSrc(entry)
  const imageUrl = absoluteUrl(imagePath)
  const pageUrl = absoluteUrl(`/explore/${entry.slug}`)
  const alt = publicDataAltText(entry)

  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'ImageObject',
        '@id': `${pageUrl}#image`,
        name: `${entry.title}${entry.aliases[0] ? ` — ${entry.aliases[0]}` : ''}`,
        description: entry.description,
        contentUrl: imageUrl,
        url: imageUrl,
        creditText: SITE_NAME,
        acquireLicensePage: absoluteUrl('/dashboard/about'),
        creator: {
          '@type': 'Organization',
          name: SITE_NAME,
          url: siteOrigin(),
        },
        keywords: [entry.title, ...entry.aliases].join(', '),
      },
      {
        '@type': 'WebPage',
        '@id': pageUrl,
        url: pageUrl,
        name: `${entry.title} | ${SITE_NAME}`,
        description: entry.description,
        primaryImageOfPage: { '@id': `${pageUrl}#image` },
        isPartOf: {
          '@type': 'WebSite',
          name: SITE_NAME,
          url: siteOrigin(),
        },
      },
    ],
  }

  return (
    <article className="space-y-8">
      <JsonLd data={jsonLd} />
      <nav className="text-sm text-white/55">
        <Link href="/explore" className="hover:text-white">
          Explore
        </Link>
        <span className="mx-2">/</span>
        <span className="text-white/80">{entry.title}</span>
      </nav>

      <header className="max-w-3xl space-y-3">
        <h1 className="text-3xl font-semibold tracking-tight text-white sm:text-4xl">{entry.title}</h1>
        {entry.aliases.length > 0 ? (
          <p className="text-base text-white/70">Also known as: {entry.aliases.join(', ')}</p>
        ) : null}
        <p className="text-base leading-relaxed text-white/80 sm:text-lg">{entry.description}</p>
        <dl className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-white/65">
          {entry.integration ? (
            <div>
              <dt className="inline text-white/45">Integration: </dt>
              <dd className="inline text-white/80">{entry.integration}</dd>
            </div>
          ) : null}
          <div>
            <dt className="inline text-white/45">Filters: </dt>
            <dd className="inline text-white/80">{entry.filters}</dd>
          </div>
          <div>
            <dt className="inline text-white/45">Credit: </dt>
            <dd className="inline text-white/80">{SITE_NAME}</dd>
          </div>
        </dl>
      </header>

      <figure className="overflow-hidden rounded-lg bg-black">
        <img
          src={imagePath}
          alt={alt}
          className="mx-auto h-auto max-h-[80vh] w-full object-contain"
          decoding="async"
        />
        <figcaption className="border-t border-white/10 px-4 py-3 text-sm text-white/60">
          {entry.caption} · {SITE_NAME}
        </figcaption>
      </figure>

      <p className="text-sm text-white/50">
        <Link href="/explore" className="text-sky-400 hover:underline">
          ← Back to Explore
        </Link>
        {' · '}
        <Link href="/dashboard/about" className="text-sky-400 hover:underline">
          About the Network
        </Link>
      </p>
    </article>
  )
}
