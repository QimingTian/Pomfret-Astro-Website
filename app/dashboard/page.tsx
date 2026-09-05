import { redirect } from 'next/navigation'
import { ABOUT_PATH } from '@/lib/seo'

export default function DashboardPage() {
  redirect(ABOUT_PATH)
}
