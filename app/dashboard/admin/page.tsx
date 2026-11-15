import { permanentRedirect } from 'next/navigation'
import { permanentLegacyDestination } from '@/lib/seo'

/** Legacy URL — admin tools live on Account; contact cards on /dashboard/contact. */
export default function AdminPage() {
  permanentRedirect(permanentLegacyDestination('/dashboard/admin'))
}
