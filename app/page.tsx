import { redirect } from 'next/navigation'
import { ABOUT_PATH } from '@/lib/seo'

export default function Home() {
  redirect(ABOUT_PATH)
}
