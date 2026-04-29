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
  },
  twitter: {
    card: 'summary',
    title: 'Pomfret Astro',
    description: 'Pomfret School Observatory Control System',
  },
  icons: {
    icon: [
      { url: '/icon.png', type: 'image/png' },
    ],
    shortcut: '/favicon.png',
    apple: '/icon.png',
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

