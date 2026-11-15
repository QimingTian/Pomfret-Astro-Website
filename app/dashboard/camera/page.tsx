import { permanentRedirect } from 'next/navigation'
import { permanentLegacyDestination } from '@/lib/seo'

export default function CameraPage() {
  permanentRedirect(permanentLegacyDestination('/dashboard/camera'))
}
