'use client'

import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { Suspense, useState } from 'react'
import {
  authLabelClass,
  authLineInputClass,
  authPageClass,
  authPanelClass,
  authPrimaryButtonClass,
  authSecondaryButtonClass,
} from '@/components/auth-ui'
import { SiteLogo } from '@/components/SiteLogo'

function LoginForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const nextPath = searchParams.get('next') || '/dashboard'

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
    <div className={authPageClass}>
      <div className={authPanelClass}>
        <div className="mb-6 flex justify-center">
          <SiteLogo variant="full" width={180} className="h-auto w-[min(180px,65vw)] invert" priority />
        </div>
        <p className="mb-2 text-center text-lg font-semibold text-white">Pomfret Astro</p>
        <p className="mb-8 text-center text-xl font-semibold sm:text-2xl">Log In to Continue</p>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div>
            <label htmlFor="login-identifier" className={authLabelClass}>
              Email or username
            </label>
            <input
              id="login-identifier"
              type="text"
              value={login}
              onChange={(e) => setLogin(e.target.value)}
              autoComplete="username"
              required
              autoFocus
              className={authLineInputClass}
            />
          </div>
          <div>
            <label htmlFor="login-password" className={authLabelClass}>
              Password
            </label>
            <input
              id="login-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
              className={authLineInputClass}
            />
          </div>
          {error ? <p className="text-center text-sm text-white">{error}</p> : null}
          <button
            type="submit"
            disabled={submitting || !login.trim() || !password}
            className={authPrimaryButtonClass}
          >
            {submitting ? 'Logging in…' : 'Log In'}
          </button>
        </form>

        <div className="mt-6 space-y-3">
          <p className="text-center text-sm text-white">No account?</p>
          <Link
            href={`/signup?next=${encodeURIComponent(nextPath)}`}
            className={authSecondaryButtonClass}
          >
            Sign Up
          </Link>
        </div>
      </div>
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
