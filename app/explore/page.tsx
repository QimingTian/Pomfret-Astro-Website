import Link from 'next/link'
import {
  PUBLIC_DATA_CATALOG,
  publicDataAltText,
  publicDataByCategory,
  publicDataExploreThumb,
} from '@/lib/public-data-catalog'

export default function ExploreIndexPage() {
  const deepSky = publicDataByCategory('deep_sky')
  const photometry = publicDataByCategory('photometry')

  return (
    <div className="space-y-12">
      <header className="max-w-3xl space-y-3">
        <h1 className="text-3xl font-semibold tracking-tight text-white sm:text-4xl">
          Explore Our Data
        </h1>
        <p className="text-base leading-relaxed text-white/75 sm:text-lg">
          Curated deep-sky and photometry images from the Pomfret Astro Network. Each object has a
          dedicated page with full-resolution imagery for discovery and attribution.
        </p>
      </header>

      <section className="space-y-4" aria-labelledby="explore-deep-sky">
        <h2 id="explore-deep-sky" className="text-xl font-semibold text-white">
          Deep Sky
        </h2>
        <ExploreGrid entries={deepSky} />
      </section>

      <section className="space-y-4" aria-labelledby="explore-photometry">
        <h2 id="explore-photometry" className="text-xl font-semibold text-white">
          Photometry
        </h2>
        <ExploreGrid entries={photometry} />
      </section>

      <p className="text-sm text-white/50">
        {PUBLIC_DATA_CATALOG.length} public datasets · Credit: Pomfret Astro Network
      </p>
    </div>
  )
}

function ExploreGrid({
  entries,
}: {
  entries: ReturnType<typeof publicDataByCategory>
}) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {entries.map((entry) => (
        <Link
          key={entry.slug}
          href={`/explore/${entry.slug}`}
          className={
            entry.flagship
              ? 'group relative overflow-hidden rounded-lg bg-black sm:col-span-2 sm:row-span-2'
              : 'group relative overflow-hidden rounded-lg bg-black'
          }
        >
          <div className={entry.flagship ? 'aspect-[4/3] sm:aspect-auto sm:h-full sm:min-h-[22rem]' : 'aspect-[4/3]'}>
            <img
              src={publicDataExploreThumb(entry)}
              alt={publicDataAltText(entry)}
              loading="lazy"
              decoding="async"
              className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
            />
          </div>
          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/40 to-transparent p-3 pt-10">
            <p className="font-medium text-white">{entry.title}</p>
            <p className="text-sm text-white/70">{entry.caption}</p>
          </div>
        </Link>
      ))}
    </div>
  )
}
