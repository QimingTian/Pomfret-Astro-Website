'use client'

// Add image filenames here (place files in /public/gallery/)
// Example: put your photos in website/public/gallery and name them to match below.
const GALLERY_IMAGES: string[] = ['photo1.png', 'photo2.png']

export default function GalleryPage() {
  const images = GALLERY_IMAGES.map((name) => ({
    src: `/gallery/${name}`,
    alt: name.replace(/\.[^.]+$/, ''),
  }))

  return (
    <div className="p-8 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-apple-dark dark:text-white">
          Data From Pomfret Olmsted Observatory
        </h1>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
        {images.length > 0 ? (
          images.map((img, i) => (
            <div
              key={i}
              className="bg-apple-gray dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 overflow-hidden shadow-sm"
            >
              <div className="aspect-square bg-black/80 dark:bg-black overflow-hidden">
                <img
                  src={img.src}
                  alt={img.alt}
                  className="w-full h-full object-cover"
                />
              </div>
            </div>
          ))
        ) : (
          <div className="col-span-full aspect-video min-h-[200px] flex items-center justify-center rounded-lg bg-gray-200 dark:bg-gray-700/50">
            <p className="text-gray-500 dark:text-gray-500">No images yet</p>
          </div>
        )}
      </div>
    </div>
  )
}
