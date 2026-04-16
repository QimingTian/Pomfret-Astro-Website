'use client'

import { usePathname } from 'next/navigation'
import Link from 'next/link'
import { CameraIcon, CloudIcon, GalleryIcon } from '@/components/Icons'
import ThemeToggle from '@/components/ThemeToggle'

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const pathname = usePathname()

  const navItems = [
    { href: '/dashboard/camera', label: 'Camera', icon: CameraIcon },
    { href: '/dashboard/gallery', label: 'Gallery', icon: GalleryIcon },
    { href: '/dashboard/weather', label: 'Weather', icon: CloudIcon },
  ]

  return (
    <div className="min-h-screen bg-white dark:bg-gray-900">
      <div className="flex h-screen">
        {/* Sidebar */}
        <aside className="w-64 bg-apple-gray dark:bg-gray-800 border-r border-gray-200 dark:border-gray-700">
          <div className="p-6 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
            <h1 className="text-xl font-semibold text-apple-dark dark:text-white">Pomfret Astro</h1>
            <ThemeToggle />
          </div>
          <nav className="p-4 space-y-1">
            {navItems.map((item) => {
              const isActive = pathname === item.href
              const IconComponent = item.icon
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`flex items-center gap-3 px-4 py-2.5 rounded-lg transition-colors ${
                    isActive
                      ? 'bg-white dark:bg-gray-700 text-apple-blue dark:text-blue-400 shadow-sm'
                      : 'text-gray-700 dark:text-gray-300 hover:bg-white dark:hover:bg-gray-700 hover:text-apple-dark dark:hover:text-white'
                  }`}
                >
                  <IconComponent className="w-5 h-5" />
                  <span className="font-medium">{item.label}</span>
                </Link>
              )
            })}
          </nav>
        </aside>

        {/* Main Content */}
        <main className="flex-1 overflow-auto bg-white dark:bg-gray-900">
          {children}
        </main>
      </div>
    </div>
  )
}

