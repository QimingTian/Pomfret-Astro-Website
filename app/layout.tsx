import type { Metadata } from 'next'
import './globals.css'
import { ThemeProvider } from '@/components/ThemeProvider'
import { NightModeProvider } from '@/components/night-mode-provider'
import {
  DEFAULT_DESCRIPTION,
  SEO_KEYWORDS,
  SITE_NAME,
  openGraphImages,
  siteOrigin,
} from '@/lib/seo'

export const metadata: Metadata = {
  metadataBase: new URL(siteOrigin()),
  title: {
    default: SITE_NAME,
    template: `%s | ${SITE_NAME}`,
  },
  description: DEFAULT_DESCRIPTION,
  keywords: SEO_KEYWORDS,
  openGraph: {
    title: SITE_NAME,
    description: DEFAULT_DESCRIPTION,
    url: siteOrigin(),
    siteName: SITE_NAME,
    locale: 'en_US',
    type: 'website',
    images: openGraphImages(),
  },
  twitter: {
    card: 'summary_large_image',
    title: SITE_NAME,
    description: DEFAULT_DESCRIPTION,
    images: openGraphImages().map((image) => image.url),
  },
  icons: {
    icon: [{ url: '/icons/favicon-32.png?v=1', type: 'image/png', sizes: '32x32' }],
    shortcut: '/icons/favicon-32.png?v=1',
    apple: [{ url: '/icons/apple-touch-icon.png?v=1', type: 'image/png', sizes: '180x180' }],
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body>
        <ThemeProvider>
          <NightModeProvider>{children}</NightModeProvider>
        </ThemeProvider>
      </body>
    </html>
  )
}

