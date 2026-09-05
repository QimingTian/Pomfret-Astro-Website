import type { Metadata } from 'next'
import { JsonLd } from '@/components/seo/json-ld'
import {
  ABOUT_PATH,
  DEFAULT_DESCRIPTION,
  SEO_KEYWORDS,
  SITE_NAME,
  absoluteUrl,
  openGraphImages,
  siteOrigin,
} from '@/lib/seo'

const ABOUT_TITLE =
  'Remote Observatory Automation & Global Telescope Network'

const ABOUT_DESCRIPTION =
  'Pomfret Astro Network redefines what an observatory network can be—intelligent multi-night automation, remote telescope access, and shared capacity across independent observatories worldwide. Submit a session once; the scheduler handles weather, Moon, and target conditions until your exposure is complete.'

export const metadata: Metadata = {
  title: ABOUT_TITLE,
  description: ABOUT_DESCRIPTION,
  keywords: SEO_KEYWORDS,
  alternates: {
    canonical: ABOUT_PATH,
  },
  openGraph: {
    title: `${ABOUT_TITLE} | ${SITE_NAME}`,
    description: ABOUT_DESCRIPTION,
    url: absoluteUrl(ABOUT_PATH),
    siteName: SITE_NAME,
    locale: 'en_US',
    type: 'website',
    images: openGraphImages(),
  },
  twitter: {
    card: 'summary_large_image',
    title: `${ABOUT_TITLE} | ${SITE_NAME}`,
    description: ABOUT_DESCRIPTION,
    images: openGraphImages().map((image) => image.url),
  },
}

const aboutJsonLd = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'Organization',
      '@id': `${siteOrigin()}/#organization`,
      name: SITE_NAME,
      url: siteOrigin(),
      logo: absoluteUrl('/icons/apple-touch-icon.png'),
      description: DEFAULT_DESCRIPTION,
      email: 'qtian.28@pomfret.org',
    },
    {
      '@type': 'WebSite',
      '@id': `${siteOrigin()}/#website`,
      name: SITE_NAME,
      url: siteOrigin(),
      description: ABOUT_DESCRIPTION,
      publisher: { '@id': `${siteOrigin()}/#organization` },
    },
    {
      '@type': 'SoftwareApplication',
      '@id': `${siteOrigin()}/#application`,
      name: SITE_NAME,
      applicationCategory: 'ScienceApplication',
      operatingSystem: 'Web',
      url: absoluteUrl(ABOUT_PATH),
      description: ABOUT_DESCRIPTION,
      offers: {
        '@type': 'Offer',
        price: '0',
        priceCurrency: 'USD',
        description: 'Contact for observatory integration and membership',
      },
      featureList: [
        'Multi-night intelligent session scheduling',
        'Remote observatory automation',
        'Weather and Moon-aware imaging',
        'Multi-user observatory coordination',
        'Shared telescope network access',
      ],
    },
  ],
}

export default function AboutLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <JsonLd data={aboutJsonLd} />
      {children}
    </>
  )
}
