'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

export default function Navigation() {
  const pathname = usePathname()

  // Don't show navigation on dashboard or login pages
  if (pathname?.startsWith('/dashboard') || pathname === '/login') {
    return null
  }

  const navItems = [
    { href: '/', label: 'Home' },
    { href: '/download', label: 'Download' },
  ]

  return (
    <nav className="bg-astro-dark border-b border-gray-800 sticky top-0 z-50 backdrop-blur-sm bg-opacity-95">
      <div className="container mx-auto px-4">
        <div className="flex items-center justify-between h-16">
          <Link href="/" className="text-xl font-bold text-white hover:text-astro-light transition-colors">
            Pomfret Astro
          </Link>
          <div className="flex space-x-8">
            {navItems.map((item) => {
              const isActive = pathname === item.href
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                    isActive
                      ? 'text-astro-light bg-astro-blue bg-opacity-20'
                      : 'text-gray-300 hover:text-white hover:bg-gray-800'
                  }`}
                >
                  {item.label}
                </Link>
              )
            })}
          </div>
        </div>
      </div>
    </nav>
  )
}

