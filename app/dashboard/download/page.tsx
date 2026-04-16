'use client'

import Image from 'next/image'

function AppleIcon({ className = 'w-24 h-24' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M17.05 20.28c-.98.95-2.05.88-3.08.4-1.09-.5-2.08-.48-3.24 0-1.44.62-2.2.44-3.06-.4C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09l.01-.01zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z"/>
    </svg>
  )
}

export default function Download() {
  const download = {
    platform: 'Pomfret Astro (macOS)',
    fileExtension: '.zip',
    version: '4.1.0',
    downloadUrl: '/Pomfret Astro.zip',
  }

  return (
    <div className="p-8">
      <div className="mb-6">
        <h1 className="text-3xl font-semibold text-apple-dark dark:text-white mb-2">Download</h1>
      </div>

      <div className="max-w-2xl space-y-6">
        <div className="bg-apple-gray dark:bg-gray-800 rounded-2xl p-8 border border-gray-200 dark:border-gray-700">
          <div className="text-center">
            <div className="flex justify-center items-center gap-4 mb-6">
              <Image
                src="/app-icon.png"
                alt="Pomfret Astro"
                width={96}
                height={96}
                className="w-24 h-24"
              />
              <AppleIcon className="w-24 h-24 text-apple-dark dark:text-white" />
            </div>
            <h3 className="text-3xl font-semibold mb-6 text-apple-dark dark:text-white">{download.platform}</h3>
            <div className="mb-6 space-y-1">
              <p className="text-gray-500 dark:text-gray-500 text-sm">Version: {download.version}</p>
              <p className="text-gray-500 dark:text-gray-500 text-sm">macOS 13.0 (Ventura) or later</p>
            </div>
            <a
              href={download.downloadUrl}
              download
              className="inline-block px-8 py-4 rounded-lg font-medium text-lg bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors"
            >
              Download
            </a>
          </div>
        </div>
      </div>
    </div>
  )
}

