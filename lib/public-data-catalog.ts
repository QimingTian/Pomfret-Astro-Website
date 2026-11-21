/**
 * Curated Our Data / Explore catalog — single source for dashboard Data UI and
 * public indexable /explore pages (Google Images SEO).
 */

export type PublicDataCategory = 'deep_sky' | 'photometry'

export type PublicDataEntry = {
  slug: string
  category: PublicDataCategory
  /** Primary display title (object name). */
  title: string
  /** Search aliases (NGC, common names). */
  aliases: string[]
  /** Short tile caption (legacy Data style). */
  caption: string
  /** Longer crawlable description for Explore pages. */
  description: string
  /** Integration time label, e.g. "70h" or "24.8min". */
  integration: string
  /** Filter / palette label, e.g. "SHO", "LRGB". */
  filters: string
  /** Legacy /gallery/photoN.webp (keep for dashboard bookmarks). */
  galleryFile: string
  /** SEO filename under /explore/ (full). */
  exploreImage: string
  /** SEO filename under /explore/ (thumb). */
  exploreThumb: string
  flagship?: boolean
}

export const PUBLIC_DATA_CATALOG: PublicDataEntry[] = [
  {
    slug: 'w80',
    category: 'deep_sky',
    title: 'W80',
    aliases: ['North America Nebula', 'NGC 7000', 'NGC7000', 'Cygnus Wall'],
    caption: 'W80 | 70h | SHO',
    description:
      'Deep SHO mosaic of the W80 / North America Nebula complex (NGC 7000) imaged with the Pomfret Astro Network. Seventy hours of narrowband hydrogen, sulfur, and oxygen data.',
    integration: '70h',
    filters: 'SHO',
    galleryFile: 'photo6.webp',
    exploreImage: 'w80-north-america-nebula-complex.webp',
    exploreThumb: 'w80-north-america-nebula-complex-thumb.webp',
    flagship: true,
  },
  {
    slug: 'ngc-7822',
    category: 'deep_sky',
    title: 'NGC 7822',
    aliases: ['Ced 214', 'Sharpless 171', 'Sh2-171'],
    caption: 'NGC 7822 | 62.5h | SHO',
    description:
      'NGC 7822 emission nebula in Cepheus, 62.5 hours of SHO narrowband imaging from the Pomfret Astro Network.',
    integration: '62.5h',
    filters: 'SHO',
    galleryFile: 'photo9.webp',
    exploreImage: 'ngc-7822-cepheus.webp',
    exploreThumb: 'ngc-7822-cepheus-thumb.webp',
  },
  {
    slug: 'm33',
    category: 'deep_sky',
    title: 'M33',
    aliases: ['Triangulum Galaxy', 'NGC 598', 'Messier 33'],
    caption: 'M33 | 23.33h | LRGB',
    description:
      'Messier 33 (Triangulum Galaxy), 23.33 hours of LRGB broadband imaging from the Pomfret Astro Network.',
    integration: '23.33h',
    filters: 'LRGB',
    galleryFile: 'photo7.webp',
    exploreImage: 'm33-triangulum-galaxy.webp',
    exploreThumb: 'm33-triangulum-galaxy-thumb.webp',
  },
  {
    slug: 'm31',
    category: 'deep_sky',
    title: 'M31',
    aliases: ['Andromeda Galaxy', 'NGC 224', 'Messier 31'],
    caption: 'M31 | 14.08h | LRGB',
    description:
      'Messier 31 (Andromeda Galaxy), 14.08 hours of LRGB broadband imaging from the Pomfret Astro Network.',
    integration: '14.08h',
    filters: 'LRGB',
    galleryFile: 'photo1.webp',
    exploreImage: 'm31-andromeda-galaxy.webp',
    exploreThumb: 'm31-andromeda-galaxy-thumb.webp',
  },
  {
    slug: 'ic1805',
    category: 'deep_sky',
    title: 'IC 1805',
    aliases: ['Heart Nebula', 'Sharpless 190', 'Sh2-190'],
    caption: 'IC1805 | 35h | SHO',
    description:
      'IC 1805 (Heart Nebula) in Cassiopeia, 35 hours of SHO narrowband imaging from the Pomfret Astro Network.',
    integration: '35h',
    filters: 'SHO',
    galleryFile: 'photo2.webp',
    exploreImage: 'ic1805-heart-nebula.webp',
    exploreThumb: 'ic1805-heart-nebula-thumb.webp',
  },
  {
    slug: 'markarians-chain',
    category: 'deep_sky',
    title: "Markarian's Chain",
    aliases: ['Markarians Chain', 'Virgo Cluster', 'M84', 'M86'],
    caption: 'Markarians Chain | 14.16h RGB + 11h Ha | HaRGB',
    description:
      "Markarian's Chain in the Virgo Cluster, 14.16 hours RGB plus 11 hours Ha (HaRGB) from the Pomfret Astro Network.",
    integration: '14.16h RGB + 11h Ha',
    filters: 'HaRGB',
    galleryFile: 'photo3.webp',
    exploreImage: 'markarians-chain-virgo-cluster.webp',
    exploreThumb: 'markarians-chain-virgo-cluster-thumb.webp',
  },
  {
    slug: 'm101',
    category: 'deep_sky',
    title: 'M101',
    aliases: ['Pinwheel Galaxy', 'NGC 5457', 'Messier 101'],
    caption: 'M101 | 12.5h LRGB + 5h Ha | HaLRGB',
    description:
      'Messier 101 (Pinwheel Galaxy), 12.5 hours LRGB plus 5 hours Ha (HaLRGB) from the Pomfret Astro Network.',
    integration: '12.5h LRGB + 5h Ha',
    filters: 'HaLRGB',
    galleryFile: 'photo4.webp',
    exploreImage: 'm101-pinwheel-galaxy.webp',
    exploreThumb: 'm101-pinwheel-galaxy-thumb.webp',
  },
  {
    slug: 'sn-2026aaiv',
    category: 'deep_sky',
    title: 'SN 2026aaiv',
    aliases: ['Supernova 2026aaiv', '2026aaiv'],
    caption: 'SN 2026aaiv | 24.8min | L',
    description:
      'Supernova SN 2026aaiv captured in luminance (24.8 minutes) by the Pomfret Astro Network.',
    integration: '24.8min',
    filters: 'L',
    galleryFile: 'photo8.webp',
    exploreImage: 'sn-2026aaiv.webp',
    exploreThumb: 'sn-2026aaiv-thumb.webp',
  },
  {
    slug: 'xz-dra',
    category: 'photometry',
    title: 'XZ Dra',
    aliases: ['XZ Draconis', 'RR Lyrae', 'XZ Dra RR Lyrae'],
    caption: 'XZ Dra | RR Lyrae',
    description:
      'XZ Draconis, an RR Lyrae variable star, from Pomfret Astro Network photometry programs.',
    integration: '',
    filters: 'Photometry',
    galleryFile: 'photo5.webp',
    exploreImage: 'xz-dra-rr-lyrae.webp',
    exploreThumb: 'xz-dra-rr-lyrae-thumb.webp',
  },
]

export function publicDataByCategory(category: PublicDataCategory): PublicDataEntry[] {
  return PUBLIC_DATA_CATALOG.filter((e) => e.category === category)
}

export function publicDataBySlug(slug: string): PublicDataEntry | undefined {
  return PUBLIC_DATA_CATALOG.find((e) => e.slug === slug)
}

export function publicDataGallerySrc(entry: PublicDataEntry): string {
  return `/gallery/${entry.galleryFile}`
}

export function publicDataGalleryThumb(entry: PublicDataEntry): string {
  return `/gallery/${entry.galleryFile.replace(/\.webp$/, '-thumb.webp')}`
}

export function publicDataExploreSrc(entry: PublicDataEntry): string {
  return `/explore/${entry.exploreImage}`
}

export function publicDataExploreThumb(entry: PublicDataEntry): string {
  return `/explore/${entry.exploreThumb}`
}

export function publicDataAltText(entry: PublicDataEntry): string {
  const aliasBit = entry.aliases.length ? ` (${entry.aliases.slice(0, 2).join(', ')})` : ''
  return `${entry.title}${aliasBit} — ${entry.caption} — Pomfret Astro Network`
}
