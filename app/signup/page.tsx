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
import {
  SignupAffiliationPicker,
  type AffiliationChoice,
} from '@/components/signup-affiliation-picker'

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
  const [affiliation, setAffiliation] = useState<AffiliationChoice | null>(null)
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
    if (!affiliation) {
      setError('Choose an affiliation or continue as Guest.')
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
          affiliation,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || data?.ok !== true) {
        setError(typeof data.error === 'string' ? data.error : 'Sign up failed.')
        return
      }
      const dest =
        data.membershipPending === true
          ? '/dashboard/account?membershipPending=1'
          : nextPath
      router.push(dest)
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
        confirmPassword.length >= 8 &&
        affiliation
    ) && password === confirmPassword

  return (
    <div className={authPageClass}>
      <div className={authPanelClass}>
        <p className="mb-2 text-center text-lg font-semibold text-white">Pomfret Astro</p>
        <p className="mb-8 text-center text-xl font-semibold sm:text-2xl">Create An Account</p>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
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
            <div className="sm:col-span-2 lg:col-span-1">
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
          </div>

          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
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
          </div>

          <SignupAffiliationPicker
            idPrefix={id}
            value={affiliation}
            onChange={setAffiliation}
          />

          {error ? <p className="text-center text-sm text-white">{error}</p> : null}

          <div className="flex justify-center">
            <button type="submit" disabled={submitting || !canSubmit} className={authPrimaryButtonClass}>
              {submitting ? 'Creating account…' : 'Sign Up'}
            </button>
          </div>
        </form>

        <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
          <p className="text-sm text-white">Already have an account?</p>
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
