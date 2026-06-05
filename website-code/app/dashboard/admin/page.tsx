import { redirect } from 'next/navigation'

/** Legacy URL — admin tools live on Account; contact cards on /dashboard/contact. */
export default function AdminPage() {
  redirect('/dashboard/account')
}
