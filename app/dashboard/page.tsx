import { permanentRedirect } from 'next/navigation'
import { permanentLegacyDestination } from '@/lib/seo'

export default function DashboardPage() {
  permanentRedirect(permanentLegacyDestination('/dashboard'))
}
