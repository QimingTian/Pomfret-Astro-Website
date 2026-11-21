'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { glassPillToggleActiveMd, glassPillToggleIdleMd } from '@/lib/glass-ui'
import {
  type PublicDataCategory,
  publicDataAltText,
  publicDataByCategory,
  publicDataGallerySrc,
  publicDataGalleryThumb,
} from '@/lib/public-data-catalog'

function categoryFromParam(raw: string | null): PublicDataCategory {
  if (raw === 'photometry') return 'photometry'
  return 'deep_sky'
}

export default function DataPage() {
  const router = useRouter()
  const [category, setCategory] = useState<PublicDataCategory>('deep_sky')
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null)

  const entries = publicDataByCategory(category)
  const images = entries.map((entry) => ({
    src: publicDataGallerySrc(entry),
    // Tiles load a 1600 px thumbnail (npm run build:gallery-thumbs). Pointing them at the
    // full-size files decoded the whole gallery at once — enough bitmap to have mobile Safari
    // kill the tab with "a problem repeatedly occurred".
    thumb: publicDataGalleryThumb(entry),
    alt: publicDataAltText(entry),
    description: entry.caption,
    flagship: entry.flagship === true,
    slug: entry.slug,
  }))

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    setCategory(categoryFromParam(params.get('category')))
  }, [])

  useEffect(() => {
    setSelectedIndex(null)
  }, [category])

  useEffect(() => {
    if (selectedIndex == null) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSelectedIndex(null)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [selectedIndex])

  const selectCategory = (next: PublicDataCategory) => {
    setCategory(next)
    const params = new URLSearchParams(window.location.search)
    if (next === 'deep_sky') params.delete('category')
    else params.set('category', next)
    const qs = params.toString()
    router.replace(qs ? `/dashboard/gallery?${qs}` : '/dashboard/gallery', { scroll: false })
  }

  const selectedImage = selectedIndex != null ? images[selectedIndex] : null
  const openImage = (index: number) => setSelectedIndex(index)
  const closeImage = () => setSelectedIndex(null)

  return (
    <div className="flex h-full flex-col lg:-ml-3">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-2xl font-semibold text-apple-dark dark:text-white">Our Data</h1>
        <Link
          href="/explore"
          className="text-sm text-apple-blue hover:underline dark:text-sky-400"
        >
          Public Explore
        </Link>
      </div>
      <div className="flex flex-wrap gap-2 mb-2">
        <button
          type="button"
          onClick={() => selectCategory('deep_sky')}
          className={category === 'deep_sky' ? glassPillToggleActiveMd : glassPillToggleIdleMd}
        >
          Deep Sky Object
        </button>
        <button
          type="button"
          onClick={() => selectCategory('photometry')}
          className={category === 'photometry' ? glassPillToggleActiveMd : glassPillToggleIdleMd}
        >
          Photometry
        </button>
      </div>
      <div className="flex-1 pb-8 min-h-0">
        <div className="mt-6">
          {images.length > 0 ? (
            <div className="grid gap-0 grid-cols-1 sm:grid-cols-3">
              {images.map((img, index) => (
                <div
                  key={img.src}
                  className={
                    img.flagship
                      ? 'relative overflow-visible sm:col-span-2 sm:row-span-2'
                      : 'relative overflow-visible'
                  }
                >
                  <button
                    type="button"
                    onClick={() => openImage(index)}
                    className="group relative block h-full w-full overflow-visible text-left"
                  >
                    <div
                      className={
                        img.flagship
                          ? 'aspect-[4/3] bg-black/80 dark:bg-black overflow-hidden sm:absolute sm:inset-0 sm:aspect-auto'
                          : 'aspect-[4/3] bg-black/80 dark:bg-black overflow-hidden'
                      }
                    >
                      <img
                        src={img.thumb}
                        alt={img.alt}
                        loading="lazy"
                        decoding="async"
                        className="h-full w-full object-cover transition-transform duration-300 ease-out group-hover:scale-105 group-hover:z-10"
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
          className="fixed inset-0 z-50 bg-black/85 flex items-center justify-center p-3 sm:p-6"
          onClick={closeImage}
        >
          <div className="relative w-full max-w-6xl flex flex-col items-center gap-3 sm:gap-6">
            <img
              src={selectedImage.src}
              alt={selectedImage.alt}
              className="max-h-[70vh] w-auto max-w-full object-contain"
              onClick={(e) => e.stopPropagation()}
            />
            <p className="text-white text-sm sm:text-base text-center">{selectedImage.description}</p>
            <Link
              href={`/explore/${selectedImage.slug}`}
              className="text-sm text-sky-300 hover:underline"
              onClick={(e) => e.stopPropagation()}
            >
              Open public Explore page
            </Link>
          </div>
        </div>
      )}
    </div>
  )
}
