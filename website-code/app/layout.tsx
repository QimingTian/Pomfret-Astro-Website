import type { Metadata } from 'next'
import './globals.css'
import { ThemeProvider } from '@/components/ThemeProvider'
import { NightModeProvider } from '@/components/night-mode-provider'

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
    icon: [{ url: '/favicon.png?v=1', type: 'image/png', sizes: '32x32' }],
    shortcut: '/favicon.png?v=1',
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

