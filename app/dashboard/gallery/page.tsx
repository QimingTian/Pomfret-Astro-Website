'use client'

import { useEffect, useState } from 'react'

// Add image filenames here (place files in /public/gallery/)
// Example: put your photos in website/public/gallery and name them to match below.
const GALLERY_IMAGES: Array<{ file: string; description: string }> = [
  { file: 'photo1.png', description: 'M31 | 14.08h | LRGB' },
  { file: 'photo2.png', description: 'IC1805 | 35h | SHO' },
]

export default function GalleryPage() {
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null)

  const images = GALLERY_IMAGES.map((entry) => ({
    src: `/gallery/${entry.file}`,
    alt: entry.file.replace(/\.[^.]+$/, ''),
    description: entry.description,
  }))

  useEffect(() => {
    if (selectedIndex == null) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSelectedIndex(null)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [selectedIndex])

  const selectedImage = selectedIndex != null ? images[selectedIndex] : null
  const openImage = (index: number) => setSelectedIndex(index)
  const closeImage = () => setSelectedIndex(null)

  return (
    <div className="flex h-full flex-col lg:-ml-3">
      <h1 className="text-2xl font-semibold text-apple-dark dark:text-white mb-4">Our Data</h1>
      <div className="flex-1 pb-8 min-h-0">
        <div className="mt-6">
          {images.length > 0 ? (
            <div className="grid gap-0 sm:grid-cols-2">
              {images.map((img, index) => (
                <div key={img.src} className="relative overflow-visible">
                  <button
                    type="button"
                    onClick={() => openImage(index)}
                    className="group relative block w-full overflow-visible text-left"
                  >
                    <div className="aspect-[4/3] bg-black/80 dark:bg-black overflow-hidden">
                      <img
                        src={img.src}
                        alt={img.alt}
                        className="w-full h-full object-cover transition-transform duration-300 ease-out group-hover:scale-105 group-hover:z-10"
                      />
                    </div>
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <div className="aspect-video min-h-[200px] flex items-center justify-center rounded-lg bg-gray-200 dark:bg-gray-700/50">
              <p className="text-gray-500 dark:text-gray-500">No images yet</p>
            </div>
          )}
        </div>
      </div>
      {selectedImage && (
        <div
          className="fixed inset-0 z-50 bg-black/85 flex items-center justify-center p-6"
          onClick={closeImage}
        >
          <div className="relative w-full max-w-6xl flex flex-col items-center gap-6">
            <img
              src={selectedImage.src}
              alt={selectedImage.alt}
              className="max-h-[65vh] w-auto max-w-full object-contain"
              onClick={(e) => e.stopPropagation()}
            />
            <p className="text-white text-sm sm:text-base text-center">{selectedImage.description}</p>
          </div>
        </div>
      )}
    </div>
  )
}
