'use client'

import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { Suspense, useState } from 'react'

const fieldClass =
  'w-full px-4 py-3 bg-apple-gray dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-lg text-apple-dark dark:text-white placeholder-gray-500 dark:placeholder-gray-400 focus:outline-none focus:border-apple-blue dark:focus:border-blue-500 focus:ring-1 focus:ring-apple-blue dark:focus:ring-blue-500 transition-colors'

function SignUpForm() {
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
    <AuthPage
      title="Create account"
      subtitle="Sign up for Pomfret Astro. Each email and username can only be registered once."
      onSubmit={handleSubmit}
      error={error}
      submitting={submitting}
      submitLabel={submitting ? 'Creating account…' : 'Sign up'}
      submitDisabled={submitting || !canSubmit}
      footer={
        <p className="text-sm text-center text-gray-500 dark:text-gray-400 mt-6">
          Already have an account?{' '}
          <Link href={`/login?next=${encodeURIComponent(nextPath)}`} className="text-apple-blue dark:text-blue-400">
            Log in
          </Link>
        </p>
      }
    >
      <input
        type="text"
        value={firstName}
        onChange={(e) => setFirstName(e.target.value)}
        placeholder="First name"
        className={fieldClass}
        autoComplete="given-name"
        required
      />
      <input
        type="text"
        value={lastName}
        onChange={(e) => setLastName(e.target.value)}
        placeholder="Last name"
        className={fieldClass}
        autoComplete="family-name"
        required
      />
      <input
        type="text"
        value={username}
        onChange={(e) => setUsername(e.target.value)}
        placeholder="Username"
        className={fieldClass}
        autoComplete="username"
        required
      />
      <input
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="Email"
        className={fieldClass}
        autoComplete="email"
        required
      />
      <input
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="Password (8+ characters)"
        className={fieldClass}
        autoComplete="new-password"
        required
        minLength={8}
      />
      <input
        type="password"
        value={confirmPassword}
        onChange={(e) => setConfirmPassword(e.target.value)}
        placeholder="Confirm password"
        className={fieldClass}
        autoComplete="new-password"
        required
        minLength={8}
      />
    </AuthPage>
  )
}

function AuthPage(props: {
  title: string
  subtitle: string
  onSubmit: (e: React.FormEvent) => void
  error: string | null
  submitting: boolean
  submitLabel: string
  submitDisabled: boolean
  footer: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-white dark:bg-gray-900">
      <div className="w-full max-w-md px-8">
        <div className="text-center mb-12">
          <h1 className="text-4xl font-semibold mb-3 text-apple-dark dark:text-white">{props.title}</h1>
          <p className="text-gray-600 dark:text-gray-400 text-lg">{props.subtitle}</p>
        </div>
        <form onSubmit={props.onSubmit} className="space-y-4">
          {props.children}
          {props.error && <p className="text-red-600 dark:text-red-400 text-sm text-center">{props.error}</p>}
          <button
            type="submit"
            disabled={props.submitDisabled}
            className="w-full py-3 bg-apple-blue hover:bg-apple-blue-hover disabled:bg-gray-300 dark:disabled:bg-gray-700 disabled:cursor-not-allowed text-white font-medium rounded-lg transition-colors"
          >
            {props.submitLabel}
          </button>
        </form>
        {props.footer}
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
