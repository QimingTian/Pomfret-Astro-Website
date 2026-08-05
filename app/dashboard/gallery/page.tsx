'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { glassPillToggleActiveMd, glassPillToggleIdleMd } from '@/lib/glass-ui'

type GalleryImage = { file: string; description: string; flagship?: boolean }

const DEEP_SKY_IMAGES: GalleryImage[] = [
  { file: 'photo6.webp', description: 'W80 | 70h | SHO', flagship: true },
  { file: 'photo1.webp', description: 'M31 | 14.08h | LRGB' },
  { file: 'photo2.webp', description: 'IC1805 | 35h | SHO' },
  { file: 'photo3.webp', description: 'Markarians Chain | 14.16h RGB + 11h Ha | HaRGB' },
  { file: 'photo4.webp', description: 'M101 | 12.5h LRGB + 5h Ha | HaLRGB' },
]

const PHOTOMETRY_IMAGES: GalleryImage[] = [
  { file: 'photo5.webp', description: 'V2563_Cyg_12.45-12.77:_Period_0.530922' },
]

type DataCategory = 'deep_sky' | 'photometry'

function categoryFromParam(raw: string | null): DataCategory {
  if (raw === 'photometry') return 'photometry'
  return 'deep_sky'
}

export default function DataPage() {
  const router = useRouter()
  const [category, setCategory] = useState<DataCategory>('deep_sky')
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null)

  const entries = category === 'deep_sky' ? DEEP_SKY_IMAGES : PHOTOMETRY_IMAGES
  const images = entries.map((entry) => ({
    src: `/gallery/${entry.file}`,
    alt: entry.description,
    description: entry.description,
    flagship: entry.flagship === true,
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

  const selectCategory = (next: DataCategory) => {
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
      <h1 className="text-2xl font-semibold text-apple-dark dark:text-white mb-4">Our Data</h1>
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
                        src={img.src}
                        alt={img.alt}
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
          </div>
        </div>
      )}
    </div>
  )
}
