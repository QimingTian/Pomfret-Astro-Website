import type { Metadata } from 'next'
import './globals.css'
import { ThemeProvider } from '@/components/ThemeProvider'

export const metadata: Metadata = {
  title: 'Pomfret Astro',
  description: 'Pomfret School Observatory Control System',
  metadataBase: new URL('https://www.pomfretastro.org'),
  alternates: {
    canonical: '/',
  },
  openGraph: {
    title: 'Pomfret Astro',
    description: 'Pomfret School Observatory Control System',
    url: 'https://www.pomfretastro.org',
    siteName: 'Pomfret Astro',
    locale: 'en_US',
    type: 'website',
    images: [{ url: '/olmsted-logo.png', width: 1160, height: 1160, alt: 'Olmsted Observatory' }],
  },
  twitter: {
    card: 'summary',
    title: 'Pomfret Astro',
    description: 'Pomfret School Observatory Control System',
    images: ['/olmsted-logo.png'],
  },
  icons: {
    icon: [
      { url: '/favicon.png', sizes: '32x32', type: 'image/png' },
      { url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    shortcut: '/favicon.png',
    apple: '/icons/apple-touch-icon.png',
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
          {children}
        </ThemeProvider>
      </body>
    </html>
  )
}

