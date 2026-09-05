import { noindexMetadata } from '@/lib/noindex-metadata'

export const metadata = noindexMetadata

export default function Layout({ children }: { children: React.ReactNode }) {
  return children
}
