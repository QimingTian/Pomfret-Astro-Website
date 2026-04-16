'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

export default function DashboardPage() {
  const router = useRouter()

  useEffect(() => {
    // Redirect to camera page by default
    router.replace('/dashboard/camera')
  }, [router])

  return null
}

