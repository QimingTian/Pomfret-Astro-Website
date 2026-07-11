'use client'

import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { Suspense, useId, useState } from 'react'
import {
  authLabelClass,
  authLineInputClass,
  authPageClass,
  authPanelClass,
  authPrimaryButtonClass,
  authSecondaryButtonClass,
} from '@/components/auth-ui'
import { SiteLogo } from '@/components/SiteLogo'

function SignUpForm() {
  const id = useId()
  const router = useRouter()
  const searchParams = useSearchParams()
  const nextPath = searchParams.get('next') || '/dashboard/remote'

  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [username, setUsername] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setError(null)
    if (password !== confirmPassword) {
      setError('Passwords do not match.')
      setSubmitting(false)
      return
    }
    try {
      const res = await fetch('/api/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          email,
          password,
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          username: username.trim(),
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || data?.ok !== true) {
        setError(typeof data.error === 'string' ? data.error : 'Sign up failed.')
        return
      }
      router.push(nextPath)
      router.refresh()
    } catch {
      setError('Sign up failed.')
    } finally {
      setSubmitting(false)
    }
  }

  const canSubmit =
    Boolean(
      firstName.trim() &&
        lastName.trim() &&
        username.trim() &&
        email.trim() &&
        password.length >= 8 &&
        confirmPassword.length >= 8
    ) && password === confirmPassword

  return (
    <div className={authPageClass}>
      <div className={authPanelClass}>
        <div className="mb-6 flex justify-center">
          <SiteLogo width={180} className="h-auto w-[min(180px,65vw)] invert" priority />
        </div>
        <p className="mb-2 text-center text-lg font-semibold text-white">Pomfret Astro</p>
        <p className="mb-8 text-center text-xl font-semibold sm:text-2xl">Create An Account</p>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div>
            <label htmlFor={`${id}-first`} className={authLabelClass}>
              First name
            </label>
            <input
              id={`${id}-first`}
              type="text"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              autoComplete="given-name"
              required
              className={authLineInputClass}
            />
          </div>
          <div>
            <label htmlFor={`${id}-last`} className={authLabelClass}>
              Last name
            </label>
            <input
              id={`${id}-last`}
              type="text"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              autoComplete="family-name"
              required
              className={authLineInputClass}
            />
          </div>
          <div>
            <label htmlFor={`${id}-username`} className={authLabelClass}>
              Username
            </label>
            <input
              id={`${id}-username`}
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              required
              className={authLineInputClass}
            />
          </div>
          <div>
            <label htmlFor={`${id}-email`} className={authLabelClass}>
              Email
            </label>
            <input
              id={`${id}-email`}
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              required
              className={authLineInputClass}
            />
          </div>
          <div>
            <label htmlFor={`${id}-password`} className={authLabelClass}>
              Password (8+ characters)
            </label>
            <input
              id={`${id}-password`}
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
              required
              minLength={8}
              className={authLineInputClass}
            />
          </div>
          <div>
            <label htmlFor={`${id}-confirm-password`} className={authLabelClass}>
              Confirm password
            </label>
            <input
              id={`${id}-confirm-password`}
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              autoComplete="new-password"
              required
              minLength={8}
              className={authLineInputClass}
            />
          </div>
          {error ? <p className="text-center text-sm text-white">{error}</p> : null}
          <button type="submit" disabled={submitting || !canSubmit} className={authPrimaryButtonClass}>
            {submitting ? 'Creating account…' : 'Sign Up'}
          </button>
        </form>

        <div className="mt-6 space-y-3">
          <p className="text-center text-sm text-white">Already have an account?</p>
          <Link
            href={`/login?next=${encodeURIComponent(nextPath)}`}
            className={authSecondaryButtonClass}
          >
            Log In
          </Link>
        </div>
      </div>
    </div>
  )
}

export default function SignUpPage() {
  return (
    <Suspense fallback={null}>
      <SignUpForm />
    </Suspense>
  )
}
