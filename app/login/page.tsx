'use client'

import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { Suspense, useState } from 'react'
import { SiteCopyrightFooter } from '@/components/site-copyright-footer'
import { ABOUT_PATH } from '@/lib/seo'

const fieldClass =
  'w-full px-4 py-3 bg-apple-gray dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-lg text-apple-dark dark:text-white placeholder-gray-500 dark:placeholder-gray-400 focus:outline-none focus:border-apple-blue dark:focus:border-blue-500 focus:ring-1 focus:ring-apple-blue dark:focus:ring-blue-500 transition-colors'

function LoginForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const nextPath = searchParams.get('next') || ABOUT_PATH

  const [login, setLogin] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ login: login.trim(), password }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || data?.ok !== true) {
        setError(typeof data.error === 'string' ? data.error : 'Invalid email, username, or password.')
        return
      }
      router.push(nextPath)
      router.refresh()
    } catch {
      setError('Log in failed.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-white dark:bg-gray-900">
      <div className="flex flex-1 items-center justify-center">
        <div className="w-full max-w-md px-8 py-12">
          <div className="mb-12 text-center">
            <h1 className="mb-3 text-4xl font-semibold text-apple-dark dark:text-white">Pomfret Astro</h1>
            <p className="text-lg text-gray-600 dark:text-gray-400">Log in to continue</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <input
              type="text"
              value={login}
              onChange={(e) => setLogin(e.target.value)}
              placeholder="Email or username"
              className={fieldClass}
              autoComplete="username"
              required
              autoFocus
            />
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password"
              className={fieldClass}
              autoComplete="current-password"
              required
            />
            {error && <p className="text-center text-sm text-red-600 dark:text-red-400">{error}</p>}
            <button
              type="submit"
              disabled={submitting || !login.trim() || !password}
              className="w-full rounded-lg bg-apple-blue py-3 font-medium text-white transition-colors hover:bg-apple-blue-hover disabled:cursor-not-allowed disabled:bg-gray-300 dark:disabled:bg-gray-700"
            >
              {submitting ? 'Logging in…' : 'Log in'}
            </button>
          </form>

          <p className="mt-6 text-center text-sm text-gray-500 dark:text-gray-400">
            No account?{' '}
            <Link href={`/signup?next=${encodeURIComponent(nextPath)}`} className="text-apple-blue dark:text-blue-400">
              Sign up
            </Link>
          </p>
        </div>
      </div>
      <SiteCopyrightFooter compact tone="onDark" />
    </div>
  )
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  )
}
