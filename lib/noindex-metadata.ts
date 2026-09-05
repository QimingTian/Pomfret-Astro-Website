import type { Metadata } from 'next'

/** Utility and member-only routes — not intended for search indexing. */
export const noindexMetadata: Metadata = {
  robots: {
    index: false,
    follow: true,
  },
}
