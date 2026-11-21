import type { Metadata } from 'next'
import Link from 'next/link'
import {
  DEFAULT_DESCRIPTION,
  SITE_NAME,
  absoluteUrl,
  openGraphImages,
} from '@/lib/seo'

export const metadata: Metadata = {
  title: {
    default: `Explore Our Data | ${SITE_NAME}`,
    template: `%s | ${SITE_NAME}`,
  },
  description:
    'Deep-sky and photometry images from the Pomfret Astro Network — North America Nebula (NGC 7000), galaxies, nebulae, and more.',
  alternates: {
    canonical: '/explore',
  },
  openGraph: {
    title: `Explore Our Data | ${SITE_NAME}`,
    description: DEFAULT_DESCRIPTION,
    url: absoluteUrl('/explore'),
    siteName: SITE_NAME,
    locale: 'en_US',
    type: 'website',
    images: openGraphImages(),
  },
  twitter: {
    card: 'summary_large_image',
    title: `Explore Our Data | ${SITE_NAME}`,
    description: DEFAULT_DESCRIPTION,
    images: openGraphImages().map((image) => image.url),
  },
  robots: {
    index: true,
    follow: true,
  },
}

export default function ExploreLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[#08090a] text-[#eee9dc]">
      <header className="border-b border-white/10 bg-[#09090a]/75 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
          <Link href="/explore" className="text-sm font-semibold tracking-tight text-white">
            {SITE_NAME} Explore
          </Link>
          <nav className="flex items-center gap-4 text-sm text-white/70">
            <Link href="/dashboard/about" className="hover:text-white">
              About
            </Link>
            <Link href="/dashboard/gallery" className="hover:text-white">
              Our Data
            </Link>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-10 sm:px-6 lg:px-8">{children}</main>
      <footer className="border-t border-white/10 px-4 py-8 text-center text-xs text-white/45">
        © {new Date().getFullYear()} Qiming Tian. Pomfret Astro. All rights reserved.
      </footer>
    </div>
  )
}
